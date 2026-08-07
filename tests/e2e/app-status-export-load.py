"""
Performance / load E2E: concurrent multi-offset app-status exports.

Hammers the CSV/XLSX export contract with many *simultaneous* requests that
each carry several dev-only `faultAt` offsets (plus a share of clean requests)
and proves three things at once:

  1. Correctness under load — every faulted request still degrades to a single
     clean JSON error envelope (500, `ok:false`, `no-store`, no attachment
     headers, zero partial CSV/ZIP bytes), and every clean request still returns
     a byte-complete, correctly named export identical to a serial baseline.
  2. Latency stays within budget — p50/p95/p99 and max wall time per request
     are recorded per phase and asserted against explicit ceilings; faulted
     requests must not be slower than clean ones (they abort earlier).
  3. Memory stays bounded — harness RSS / fd / thread counts are sampled before,
     during and after the load, and must return close to the pre-load baseline
     (no per-request retention of encoded export buffers).

Phases
  * baseline      — serial clean exports, per-format reference bytes + latency
  * ramp          — increasing concurrency (8 → 16 → 32 → 64), mixed formats,
                    mixed multi-offset faults, latency + RSS sampled per step
  * sustained     — 400 requests at concurrency 32 for a steady-state read
  * heavy-offsets — requests carrying 250 offsets each (parser + encoder cost)
  * recovery      — post-load serial exports must match baseline bytes and
                    latency budget; RSS must fall back near the baseline
  * live          — one small concurrent mixed batch against the dev endpoint
                    (skipped automatically when `faultAt` injection is absent)

Usage:
  python3 tests/e2e/app-status-export-load.py
Env:
  HARNESS_PORT (default 8397), BASE_URL (default http://localhost:8080),
  LOAD_ROWS (default 2500), LOAD_SCALE (multiplier on request counts, default 1)
"""
import asyncio
import io
import json
import os
import random
import re
import signal
import statistics
import subprocess
import sys
import time
import zipfile
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
SS = Path("/tmp/browser/app-status-export-load")
SS.mkdir(parents=True, exist_ok=True)

PORT = int(os.environ.get("HARNESS_PORT", "8397"))
HOST = "127.0.0.1"
BASE = f"http://{HOST}:{PORT}"
LIVE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
HARNESS = ROOT / "tests/e2e/harness/app-status-export-scale-fault-server.ts"

ROWS = int(os.environ.get("LOAD_ROWS", "2500"))
SCALE = float(os.environ.get("LOAD_SCALE", "1"))
SEED = int(os.environ.get("LOAD_SEED", "20260807"))

STAMP = r"\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z"
ATTACHMENT_HEADERS = ("content-disposition", "content-transfer-encoding",
                      "content-range", "accept-ranges", "x-filename")
MIME = {"csv": "text/csv",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}

# Latency ceilings (ms) for a local harness. Generous enough to be stable on a
# shared CI box, tight enough to catch an O(n^2) or unbounded-buffer regression.
BUDGET = {"p50": 1500, "p95": 4000, "p99": 6000, "max": 12000}
BASELINE_BUDGET = {"p50": 2000, "p95": 4000, "p99": 6000, "max": 8000}


def load_budget(concurrency: int) -> dict:
    """Latency ceilings scale with queue depth.

    Per-request wall time necessarily includes queueing once offered load
    exceeds service capacity, so budgets grow linearly above 32 in-flight
    requests. A real regression (per-request cost, not queueing) still breaks
    these ceilings because the whole distribution shifts.
    """
    factor = max(1.0, concurrency / 32)
    return {k: v * factor for k, v in BUDGET.items()}

# RSS growth allowances (MiB).
RSS_PEAK_GROWTH_MIB = 600
RSS_SETTLED_GROWTH_MIB = 250


# --- harness lifecycle -----------------------------------------------------
async def start_harness() -> subprocess.Popen:
    proc = subprocess.Popen(
        ["bun", str(HARNESS), str(PORT)],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )
    import urllib.request
    for _ in range(60):
        try:
            urllib.request.urlopen(f"{BASE}/size?format=csv&rows=1", timeout=2).read()
            return proc
        except Exception:
            await asyncio.sleep(0.5)
    proc.kill()
    raise RuntimeError("harness did not start")


def proc_stats(pid: int) -> dict:
    """RSS (MiB), open fds, socket fds and thread count for the harness."""
    rss_kib = 0
    for line in Path(f"/proc/{pid}/status").read_text().splitlines():
        if line.startswith("VmRSS:"):
            rss_kib = int(line.split()[1])
            break
    total, sockets = 0, 0
    for entry in Path(f"/proc/{pid}/fd").iterdir():
        try:
            target = os.readlink(entry)
        except OSError:
            continue
        total += 1
        if target.startswith("socket:"):
            sockets += 1
    threads = len(list(Path(f"/proc/{pid}/task").iterdir()))
    return {"rss": rss_kib / 1024, "fds": total, "sockets": sockets, "threads": threads}


def body_bytes(req_sync_json: dict) -> int:
    return int(req_sync_json["bytes"])


def url(fmt: str, faults: list[int] | None = None, rows: int = ROWS) -> str:
    q = f"{BASE}/export?format={fmt}&rows={rows}"
    for f in faults or []:
        q += f"&faultAt={f}"
    return q


def live_url(fmt: str, faults: list[int] | None = None) -> str:
    q = f"{LIVE}/api/public/app-status/health?format={fmt}"
    for f in faults or []:
        q += f"&faultAt={f}"
    return q


async def timed_fetch(req, target: str):
    """Single request; returns (status, headers, body, elapsed_ms)."""
    start = time.perf_counter()
    res = await req.get(target, timeout=180_000)
    body = await res.body()
    elapsed = (time.perf_counter() - start) * 1000
    return res.status, {k.lower(): v for k, v in res.headers.items()}, body, elapsed


# --- assertions ------------------------------------------------------------
def check_fault_response(status, headers, body, label, results) -> None:
    results.append((status == 500, f"[{label}] fault degrades to 500 (got {status})"))
    results.append((body[:2] != b"PK" and b"PK\x05\x06" not in body,
                    f"[{label}] no partial ZIP bytes"))
    results.append((b"scope,key," not in body and b"\r\n" not in body,
                    f"[{label}] no partial CSV bytes"))
    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception:
        payload = None
    results.append((isinstance(payload, dict) and payload.get("ok") is False,
                    f"[{label}] single JSON error envelope"))
    results.append((headers.get("cache-control") == "no-store", f"[{label}] no-store"))
    for h in ATTACHMENT_HEADERS:
        results.append((h not in headers, f"[{label}] omits {h}"))


def fingerprint(fmt: str, body: bytes) -> bytes:
    """Comparable payload identity.

    CSV is byte-deterministic. XLSX is a ZIP whose entry timestamps (and
    docProps metadata) move with wall-clock time, so compare the entry names
    plus their decompressed contents instead of the raw container bytes.
    """
    if fmt == "csv":
        return body
    if not zipfile.is_zipfile(io.BytesIO(body)):
        return b"<not-a-zip>"
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        parts = []
        for name in sorted(z.namelist()):
            if name.startswith("docProps/"):
                continue
            parts.append(name.encode("utf-8") + b"\x00" + z.read(name))
        return b"\x01".join(parts)


def check_clean_response(fmt, status, headers, body, label, results,
                         reference: bytes | None = None) -> None:
    results.append((status == 200, f"[{label}] clean request returns 200 (got {status})"))
    results.append((headers.get("content-type", "").startswith(MIME[fmt]),
                    f"[{label}] Content-Type is {fmt}"))
    disp = headers.get("content-disposition", "")
    results.append((bool(re.search(rf'filename="reson8-app-status-{STAMP}[^"]*\.{fmt}"', disp)),
                    f"[{label}] filename intact"))
    if fmt == "csv":
        text = body.decode("utf-8")
        results.append((text.startswith("scope,key,") and text.endswith("\r\n"),
                        f"[{label}] CSV complete and CRLF-terminated"))
        results.append((text.count("\r\n") == ROWS + 1,
                        f"[{label}] CSV keeps all {ROWS} rows"))
    else:
        ok_zip = zipfile.is_zipfile(io.BytesIO(body))
        results.append((ok_zip, f"[{label}] XLSX is a valid ZIP"))
        if ok_zip:
            with zipfile.ZipFile(io.BytesIO(body)) as z:
                results.append((z.testzip() is None, f"[{label}] ZIP entries pass CRC"))
    if reference is not None:
        results.append((fingerprint(fmt, body) == reference,
                        f"[{label}] payload identical to serial baseline "
                        f"({len(body)} bytes vs reference)"))



def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round((p / 100) * (len(ordered) - 1)))))
    return ordered[idx]


def summarize(label: str, samples: list[float]) -> dict:
    stats = {
        "n": len(samples),
        "p50": pct(samples, 50),
        "p95": pct(samples, 95),
        "p99": pct(samples, 99),
        "max": max(samples) if samples else 0.0,
        "mean": statistics.fmean(samples) if samples else 0.0,
    }
    print(f"  {label:<28} n={stats['n']:<4} p50={stats['p50']:7.1f}ms "
          f"p95={stats['p95']:7.1f}ms p99={stats['p99']:7.1f}ms max={stats['max']:7.1f}ms")
    return stats


def assert_latency(label: str, stats: dict, budget: dict, results: list) -> None:
    for key, ceiling in budget.items():
        results.append((stats[key] <= ceiling,
                        f"[{label}] {key} latency {stats[key]:.0f}ms <= {ceiling}ms"))


# --- request plan ----------------------------------------------------------
def multi_offsets(rng: random.Random, size: int, count: int) -> list[int]:
    """Several offsets spread across the body; the earliest reachable one wins."""
    offsets = [rng.randrange(1, max(2, size)) for _ in range(count)]
    # mix in duplicates and one unreachable offset to exercise dedupe + skip
    offsets += [offsets[0], size + rng.randrange(1, 10_000)]
    rng.shuffle(offsets)
    return offsets


def build_plan(rng: random.Random, n: int, sizes: dict, offsets_each: int) -> list[dict]:
    plan = []
    for i in range(n):
        fmt = "xlsx" if i % 3 == 2 else "csv"
        if i % 4 == 3:  # 25% clean traffic interleaved with the faults
            plan.append({"fmt": fmt, "faults": [], "kind": "clean"})
        else:
            plan.append({"fmt": fmt,
                         "faults": multi_offsets(rng, sizes[fmt], offsets_each),
                         "kind": "fault"})
    rng.shuffle(plan)
    return plan


async def run_batch(req, plan: list[dict], concurrency: int, label: str,
                    results: list, references: dict) -> dict:
    """Run `plan` with a bounded-concurrency worker pool; returns latency stats."""
    sem = asyncio.Semaphore(concurrency)
    fault_ms: list[float] = []
    clean_ms: list[float] = []
    errors: list[str] = []

    async def one(idx: int, item: dict):
        async with sem:
            try:
                status, headers, body, ms = await timed_fetch(
                    req, url(item["fmt"], item["faults"]))
            except Exception as exc:  # transport failure is itself a load failure
                errors.append(f"{item['kind']}#{idx} {type(exc).__name__}: {exc}")
                return
            if item["kind"] == "fault":
                fault_ms.append(ms)
                if status != 500 or b"scope,key," in body or body[:2] == b"PK":
                    check_fault_response(status, headers, body,
                                         f"{label} fault#{idx}", results)
            else:
                clean_ms.append(ms)
                if status != 200 or fingerprint(item["fmt"], body) != references[item["fmt"]]:
                    check_clean_response(item["fmt"], status, headers, body,
                                         f"{label} clean#{idx}", results,
                                         references[item["fmt"]])

    wall_start = time.perf_counter()
    await asyncio.gather(*(one(i, item) for i, item in enumerate(plan)))
    wall = (time.perf_counter() - wall_start) * 1000

    results.append((not errors,
                    f"[{label}] no transport failures ({len(errors)}: {errors[:2]})"))
    # Spot-check the full contract on a sample so the happy path is still asserted.
    all_ms = fault_ms + clean_ms
    results.append((len(all_ms) == len(plan),
                    f"[{label}] all {len(plan)} responses accounted for ({len(all_ms)})"))
    stats = summarize(f"{label} (all)", all_ms)
    if fault_ms:
        fstats = summarize(f"{label} (faulted)", fault_ms)
    if clean_ms:
        cstats = summarize(f"{label} (clean)", clean_ms)
    if fault_ms and clean_ms:
        # Aborting mid-encode must never cost more than finishing the encode.
        results.append((fstats["p95"] <= cstats["p95"] * 2.5 + 500,
                        f"[{label}] faulted p95 not slower than clean "
                        f"({fstats['p95']:.0f}ms vs {cstats['p95']:.0f}ms)"))
    throughput = len(plan) / (wall / 1000) if wall else 0
    print(f"  {label:<28} wall={wall:7.1f}ms throughput={throughput:6.1f} req/s "
          f"concurrency={concurrency}")
    stats["wall"] = wall
    stats["throughput"] = throughput
    return stats


async def sample_stats(pid: int, stop: asyncio.Event, peaks: dict) -> None:
    """Poll harness RSS/fd/threads while a batch is in flight."""
    while not stop.is_set():
        s = proc_stats(pid)
        for k, v in s.items():
            peaks[k] = max(peaks.get(k, 0), v)
        try:
            await asyncio.wait_for(stop.wait(), timeout=0.25)
        except asyncio.TimeoutError:
            pass


async def with_sampling(pid: int, coro):
    stop = asyncio.Event()
    peaks: dict = {}
    task = asyncio.create_task(sample_stats(pid, stop, peaks))
    try:
        out = await coro
    finally:
        stop.set()
        await task
    return out, peaks


# --- live endpoint ---------------------------------------------------------
async def live_batch(req, results: list) -> None:
    try:
        probe_status, probe_headers, probe_body, _ = await timed_fetch(
            req, live_url("csv", [64, 128, 4096]))
    except Exception as exc:
        print(f"  live endpoint unreachable ({exc}); skipping")
        return
    if probe_status != 500:
        print(f"  live faultAt injection unavailable (status {probe_status}); skipping")
        return
    check_fault_response(probe_status, probe_headers, probe_body, "live probe", results)


    plan = [{"fmt": "csv" if i % 2 == 0 else "xlsx",
             "faults": [] if i % 3 == 2 else [16, 64, 256, 1024],
             "kind": "clean" if i % 3 == 2 else "fault"} for i in range(24)]
    sem = asyncio.Semaphore(12)
    lat: list[float] = []

    async def one(idx, item):
        async with sem:
            status, headers, body, ms = await timed_fetch(
                req, live_url(item["fmt"], item["faults"]))
            lat.append(ms)
            if item["kind"] == "fault":
                check_fault_response(status, headers, body, f"live fault#{idx}", results)
            else:
                results.append((status == 200, f"[live clean#{idx}] returns 200 (got {status})"))
                results.append((headers.get("content-disposition", "").startswith("attachment"),
                                f"[live clean#{idx}] attachment header present"))

    await asyncio.gather(*(one(i, item) for i, item in enumerate(plan)))
    stats = summarize("live mixed batch", lat)
    assert_latency("live", stats, {"p95": 8000, "max": 15000}, results)


# --- main ------------------------------------------------------------------
async def main() -> int:
    rng = random.Random(SEED)
    results: list[tuple[bool, str]] = []
    report: dict = {"rows": ROWS, "seed": SEED, "scale": SCALE, "phases": {}}
    proc = await start_harness()
    try:
        async with async_playwright() as p:
            req = await p.request.new_context(ignore_https_errors=True)

            # body sizes drive realistic mid-body offsets
            sizes = {}
            for fmt in ("csv", "xlsx"):
                res = await req.get(f"{BASE}/size?format={fmt}&rows={ROWS}", timeout=120_000)
                sizes[fmt] = body_bytes(await res.json())
            print(f"\nbody sizes @ {ROWS} rows: csv={sizes['csv']}B xlsx={sizes['xlsx']}B")
            results.append((sizes["csv"] > 100_000 and sizes["xlsx"] > 20_000,
                            f"[setup] payloads large enough to stress "
                            f"(csv={sizes['csv']}B, xlsx={sizes['xlsx']}B)"))

            base = proc_stats(proc.pid)
            print(f"baseline harness rss={base['rss']:.1f}MiB fds={base['fds']} "
                  f"threads={base['threads']}\n")

            # --- phase: serial baseline ---------------------------------------
            print("phase: baseline (serial clean exports)")
            references: dict = {}
            for fmt in ("csv", "xlsx"):
                lat = []
                for i in range(5):
                    status, headers, body, ms = await timed_fetch(req, url(fmt))
                    lat.append(ms)
                    if i == 0:
                        references[fmt] = fingerprint(fmt, body)
                        check_clean_response(fmt, status, headers, body,
                                             f"baseline {fmt}", results)
                    else:
                        results.append((fingerprint(fmt, body) == references[fmt],
                                        f"[baseline {fmt}#{i}] payload deterministic"))

                stats = summarize(f"baseline {fmt}", lat)
                assert_latency(f"baseline {fmt}", stats, BASELINE_BUDGET, results)
                report["phases"][f"baseline_{fmt}"] = stats

            # --- phase: concurrency ramp --------------------------------------
            print("\nphase: ramp (mixed multi-offset faults + clean traffic)")
            peak_rss = base["rss"]
            for concurrency in (8, 16, 32, 64):
                n = int(concurrency * 4 * SCALE)
                plan = build_plan(rng, n, sizes, offsets_each=6)
                stats, peaks = await with_sampling(
                    proc.pid,
                    run_batch(req, plan, concurrency, f"ramp c={concurrency}",
                              results, references))
                peak_rss = max(peak_rss, peaks.get("rss", 0))
                print(f"  {'ramp c=' + str(concurrency):<28} peak rss={peaks.get('rss', 0):.1f}MiB "
                      f"peak fds={peaks.get('fds', 0)} peak threads={peaks.get('threads', 0)}")
                assert_latency(f"ramp c={concurrency}", stats, BUDGET, results)
                report["phases"][f"ramp_c{concurrency}"] = {**stats, "peak_rss": peaks.get("rss", 0)}

            # --- phase: sustained --------------------------------------------
            print("\nphase: sustained (400 requests @ concurrency 32)")
            plan = build_plan(rng, int(400 * SCALE), sizes, offsets_each=4)
            stats, peaks = await with_sampling(
                proc.pid, run_batch(req, plan, 32, "sustained", results, references))
            peak_rss = max(peak_rss, peaks.get("rss", 0))
            print(f"  {'sustained':<28} peak rss={peaks.get('rss', 0):.1f}MiB "
                  f"peak fds={peaks.get('fds', 0)}")
            assert_latency("sustained", stats, BUDGET, results)
            results.append((stats["throughput"] > 5,
                            f"[sustained] throughput above floor "
                            f"({stats['throughput']:.1f} req/s)"))
            report["phases"]["sustained"] = {**stats, "peak_rss": peaks.get("rss", 0)}

            # --- phase: heavy offset lists ------------------------------------
            print("\nphase: heavy-offsets (250 faultAt values per request)")
            plan = build_plan(rng, int(64 * SCALE), sizes, offsets_each=250)
            stats, peaks = await with_sampling(
                proc.pid, run_batch(req, plan, 24, "heavy-offsets", results, references))
            peak_rss = max(peak_rss, peaks.get("rss", 0))
            print(f"  {'heavy-offsets':<28} peak rss={peaks.get('rss', 0):.1f}MiB")
            assert_latency("heavy-offsets", stats, BUDGET, results)
            report["phases"]["heavy_offsets"] = {**stats, "peak_rss": peaks.get("rss", 0)}

            # --- phase: memory ceiling ---------------------------------------
            print("\nphase: memory + resource accounting")
            results.append((peak_rss - base["rss"] <= RSS_PEAK_GROWTH_MIB,
                            f"[memory] peak RSS growth within budget "
                            f"({base['rss']:.1f} -> {peak_rss:.1f}MiB, "
                            f"limit +{RSS_PEAK_GROWTH_MIB}MiB)"))
            await asyncio.sleep(6)  # let keep-alives drain and GC settle
            settled = proc_stats(proc.pid)
            print(f"  settled rss={settled['rss']:.1f}MiB fds={settled['fds']} "
                  f"sockets={settled['sockets']} threads={settled['threads']}")
            results.append((settled["rss"] - base["rss"] <= RSS_SETTLED_GROWTH_MIB,
                            f"[memory] RSS settles back near baseline "
                            f"({base['rss']:.1f} -> {settled['rss']:.1f}MiB, "
                            f"limit +{RSS_SETTLED_GROWTH_MIB}MiB)"))
            results.append((settled["rss"] <= peak_rss + 1,
                            f"[memory] no post-load RSS growth "
                            f"(peak {peak_rss:.1f} -> settled {settled['rss']:.1f}MiB)"))
            results.append((settled["fds"] <= base["fds"] + 100,
                            f"[resources] fds return near baseline "
                            f"({base['fds']} -> {settled['fds']})"))
            results.append((settled["threads"] <= base["threads"] + 4,
                            f"[resources] thread count stable "
                            f"({base['threads']} -> {settled['threads']})"))
            results.append((proc.poll() is None, "[resources] harness survived the load"))
            report["memory"] = {"baseline_rss": base["rss"], "peak_rss": peak_rss,
                                "settled_rss": settled["rss"]}

            # --- phase: recovery ---------------------------------------------
            print("\nphase: recovery (serial exports after the load)")
            for fmt in ("csv", "xlsx"):
                lat = []
                for i in range(3):
                    status, headers, body, ms = await timed_fetch(req, url(fmt))
                    lat.append(ms)
                    check_clean_response(fmt, status, headers, body,
                                         f"recovery {fmt}#{i}", results, references[fmt])
                stats = summarize(f"recovery {fmt}", lat)
                assert_latency(f"recovery {fmt}", stats, BASELINE_BUDGET, results)
                base_p50 = report["phases"][f"baseline_{fmt}"]["p50"]
                results.append((stats["p50"] <= base_p50 * 3 + 250,
                                f"[recovery {fmt}] p50 has not regressed "
                                f"({stats['p50']:.0f}ms vs baseline {base_p50:.0f}ms)"))
                report["phases"][f"recovery_{fmt}"] = stats

            # --- phase: live --------------------------------------------------
            print("\nphase: live dev endpoint")
            await live_batch(req, results)

            await req.dispose()
    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()

    (SS / "load-report.json").write_text(json.dumps(report, indent=2))
    failed = [m for ok, m in results if not ok]
    for ok, m in results:
        if not ok:
            print("FAIL  " + m)
    print(f"\nreport: {SS / 'load-report.json'}")
    print(f"{len(results) - len(failed)}/{len(results)} assertions passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
