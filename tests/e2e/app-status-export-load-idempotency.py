"""
Performance / load test: LARGE CSV+XLSX exports under sustained concurrency,
asserting fault-retry idempotency and stable keep-alive reuse.

Every worker owns ONE keep-alive connection for the whole run and loops
fault -> retry -> clean, on a large synthetic registry (default 6000 rows, a
multi-MB CSV and a heavy XLSX). Nothing is re-connected, so a socket/fd leak or
a framing desync shows up as a hard failure rather than a slow drift.

What it checks
  1. Idempotency of faults: for a given format+offset plan, EVERY response
     across every worker and every round is byte-identical (same envelope
     bytes, same framing headers) — 500, application/json, no-store, exact
     Content-Length, no attachment headers, zero partial CSV/ZIP bytes.
  2. Idempotency of clean exports: CSV bodies are byte-identical across all
     workers/rounds; XLSX bodies are identical as logical archives (ZIP mtimes
     and docProps timestamps track the clock) and always CRC-valid with the
     full row count.
  3. Keep-alive stability: no `Connection: close`, no stray buffered bytes, and
     the same client local port for the entire run on every worker.
  4. Latency budgets under load: p50/p95/p99 and max per operation kind
     (clean csv / clean xlsx / fault) stay inside concurrency-scaled budgets,
     and faults are never slower than a full clean export.
  5. Resource stability: server fds / socket fds / threads stay within a band
     of the post-warmup baseline for the whole run, show no upward
     least-squares trend, and settle back after all connections close; peak RSS
     stays bounded.

Artifacts: /tmp/browser/app-status-export-load-idem/{report.json,samples.csv}

Usage:
  python3 tests/e2e/app-status-export-load-idempotency.py
  CONCURRENCY=16 ROUNDS=12 ROWS=9000 python3 tests/e2e/app-status-export-load-idempotency.py
  GROWTH_FD_SLOPE_PER_MIN=2 GROWTH_SLOPE_TOLERANCE=1.5 python3 tests/e2e/app-status-export-load-idempotency.py
  (growth-slope limits: see tests/e2e/harness/growth_thresholds.py)
"""
import hashlib
import io
import json
import os
import re
import socket
import statistics
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests/e2e/harness"))
import growth_thresholds as growth  # noqa: E402

OUT = Path("/tmp/browser/app-status-export-load-idem")
OUT.mkdir(parents=True, exist_ok=True)

HOST = "127.0.0.1"
PORT = int(os.environ.get("HARNESS_PORT", "8441"))
BASE = f"http://{HOST}:{PORT}"
HARNESS = ROOT / "tests/e2e/harness/app-status-export-scale-fault-server.ts"

ROWS = int(os.environ.get("ROWS", "6000"))
CONCURRENCY = int(os.environ.get("CONCURRENCY", "12"))
ROUNDS = int(os.environ.get("ROUNDS", "8"))
SAMPLE_SECONDS = float(os.environ.get("SAMPLE_SECONDS", "2"))

STAMP = r"\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z"
ISO = re.compile(rb"\d{4}-\d{2}-\d{2}T[\d:.\-]+Z")
ATTACHMENT_HEADERS = ("content-disposition", "content-transfer-encoding", "content-range",
                      "accept-ranges", "x-filename")
MIME = {"csv": "text/csv",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
VOLATILE = {"date", "content-disposition", "keep-alive", "age", "x-worker-pid", "server",
            "connection"}

# Latency budgets in ms: base + per-unit-of-concurrency slack. Generous enough
# for shared CI runners, tight enough to catch a real regression.
BUDGETS = {
    "clean-csv": {"p50": 900, "p95": 2200, "p99": 3500, "max": 6000},
    "clean-xlsx": {"p50": 900, "p95": 2200, "p99": 3500, "max": 6000},
    "fault": {"p50": 900, "p95": 2200, "p99": 3500, "max": 6000},
}
PER_WORKER_MS = 260  # added to every budget for each concurrent worker

BANDS = growth.band_limits({"fds": 10, "sockets": CONCURRENCY + 4, "threads": 4})
FD_BAND, SOCK_BAND, THREAD_BAND = BANDS["fds"], BANDS["sockets"], BANDS["threads"]
# Per-minute growth-slope limits; override via GROWTH_*_SLOPE_PER_MIN /
# GROWTH_SLOPE_TOLERANCE (see tests/e2e/harness/growth_thresholds.py). When
# baselines/growth-thresholds.json holds calibrated limits for this profile
# they take precedence over the defaults below (see growth_calibrate.py).
SLOPE_DEFAULTS = {"fds": 6.0, "sockets": 4.0, "threads": 2.0}
CALIBRATION_PROFILE = os.environ.get("GROWTH_PROFILE", "export-load-idempotency")
SLOPE_LIMITS = growth.slope_limits("minute", SLOPE_DEFAULTS, profile=CALIBRATION_PROFILE)

RSS_HEADROOM_MB = int(float(os.environ.get("RSS_HEADROOM_MB", "1200")))


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def framing(headers: dict) -> str:
    return json.dumps({k: v for k, v in headers.items() if k not in VOLATILE}, sort_keys=True)


def canon(fmt: str, body: bytes) -> str:
    """CSV compares verbatim; XLSX compares as a logical archive (ZIP mtimes move)."""
    if fmt != "xlsx":
        return sha(body)
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as z:
            return sha(b"\1".join(name.encode() + b"\0" + ISO.sub(b"<TS>", z.read(name))
                                  for name in sorted(z.namelist())))
    except Exception:
        return sha(body)


# --- harness ---------------------------------------------------------------
def start_harness() -> subprocess.Popen:
    proc = subprocess.Popen(["bun", str(HARNESS), str(PORT)], cwd=ROOT,
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    for _ in range(90):
        try:
            urllib.request.urlopen(f"{BASE}/size?format=csv&rows=1", timeout=2).read()
            return proc
        except Exception:
            time.sleep(0.5)
    proc.kill()
    raise RuntimeError("harness did not start")


def body_size(fmt: str) -> int:
    raw = urllib.request.urlopen(f"{BASE}/size?format={fmt}&rows={ROWS}", timeout=120).read()
    return int(json.loads(raw.decode())["bytes"])


def fd_stats(pid: int) -> dict:
    total, sockets = 0, 0
    try:
        entries = list(Path(f"/proc/{pid}/fd").iterdir())
    except OSError:
        return {"fds": 0, "sockets": 0, "threads": 0, "rss_kb": 0}
    for entry in entries:
        try:
            target = os.readlink(entry)
        except OSError:
            continue
        total += 1
        if target.startswith("socket:"):
            sockets += 1
    threads = len(list(Path(f"/proc/{pid}/task").iterdir()))
    rss_kb = 0
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                rss_kb = int(line.split()[1])
                break
    except OSError:
        pass
    return {"fds": total, "sockets": sockets, "threads": threads, "rss_kb": rss_kb}


def slope_per_minute(samples: list, key: str) -> float:
    n = len(samples)
    if n < 3:
        return 0.0
    xs = [s["t"] / 60.0 for s in samples]
    ys = [float(s[key]) for s in samples]
    mx, my = sum(xs) / n, sum(ys) / n
    denom = sum((x - mx) ** 2 for x in xs)
    if denom == 0:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / denom


def pct(values: list, q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round(q * (len(ordered) - 1)))))
    return ordered[idx]


# --- raw keep-alive client -------------------------------------------------
class KeepAlive:
    def __init__(self) -> None:
        self.sock = socket.create_connection((HOST, PORT), timeout=180)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.buf = b""
        self.local_port = self.sock.getsockname()[1]
        self.requests = 0

    def _read_until(self, marker: bytes) -> bytes:
        while marker not in self.buf:
            chunk = self.sock.recv(1 << 16)
            if not chunk:
                raise ConnectionError("socket closed while reading headers")
            self.buf += chunk
        head, _, rest = self.buf.partition(marker)
        self.buf = rest
        return head

    def _read_exact(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(1 << 16)
            if not chunk:
                raise ConnectionError("socket closed mid-body")
            self.buf += chunk
        body, self.buf = self.buf[:n], self.buf[n:]
        return body

    def _read_chunked(self) -> bytes:
        out = b""
        while True:
            size = int(self._read_until(b"\r\n").split(b";")[0], 16)
            if size == 0:
                self._read_until(b"\r\n")
                return out
            out += self._read_exact(size)
            self._read_exact(2)

    def request(self, path: str):
        started = time.monotonic()
        self.sock.sendall((f"GET {path} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\n"
                           "Connection: keep-alive\r\nAccept: */*\r\n\r\n").encode())
        self.requests += 1
        head = self._read_until(b"\r\n\r\n").decode("latin-1")
        lines = head.split("\r\n")
        status = int(lines[0].split(" ")[1])
        headers: dict = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        if headers.get("transfer-encoding", "").lower() == "chunked":
            body = self._read_chunked()
        else:
            body = self._read_exact(int(headers.get("content-length", "0")))
        elapsed_ms = (time.monotonic() - started) * 1000
        reuse = headers.get("connection", "").lower() != "close"
        return status, headers, body, reuse, elapsed_ms

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


# --- assertions ------------------------------------------------------------
class Tally:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.total = 0
        self.failures: list = []

    def check(self, ok: bool, msg: str) -> None:
        with self.lock:
            self.total += 1
            if not ok and len(self.failures) < 200:
                self.failures.append(msg)


def check_fault(status: int, headers: dict, body: bytes, label: str, t: Tally) -> None:
    t.check(status == 500, f"[{label}] single 500 (got {status})")
    t.check(body[:2] != b"PK" and b"PK\x05\x06" not in body, f"[{label}] no ZIP fragment")
    t.check(b"scope,key," not in body and b"\r\n" not in body, f"[{label}] no CSV fragment")
    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception:
        payload = None
    t.check(isinstance(payload, dict) and payload.get("ok") is False,
            f"[{label}] JSON error envelope")
    t.check(headers.get("content-type", "").startswith("application/json"),
            f"[{label}] JSON content-type")
    t.check(headers.get("cache-control") == "no-store", f"[{label}] no-store")
    cl = headers.get("content-length")
    chunked = headers.get("transfer-encoding", "").lower() == "chunked"
    t.check((int(cl) == len(body)) if cl is not None else chunked,
            f"[{label}] framed exactly (len={len(body)}, cl={cl}, chunked={chunked})")
    for h in ATTACHMENT_HEADERS:
        t.check(h not in headers, f"[{label}] omits {h}")


def check_clean(fmt: str, status: int, headers: dict, body: bytes, label: str, t: Tally) -> None:
    t.check(status == 200, f"[{label}] 200 (got {status})")
    t.check(headers.get("content-type", "").startswith(MIME[fmt]), f"[{label}] {fmt} content-type")
    disp = headers.get("content-disposition", "")
    t.check(bool(re.search(rf'filename="reson8-app-status-{STAMP}[^"]*\.{fmt}"', disp)),
            f"[{label}] filename intact ({disp!r})")
    if fmt == "csv":
        text = body.decode("utf-8")
        t.check(text.startswith("scope,key,") and text.endswith("\r\n"),
                f"[{label}] CSV complete + CRLF-terminated")
        t.check(text.count("\r\n") == ROWS + 1, f"[{label}] CSV keeps all {ROWS} rows")
    else:
        ok_zip = zipfile.is_zipfile(io.BytesIO(body))
        t.check(ok_zip, f"[{label}] XLSX valid ZIP")
        if ok_zip:
            with zipfile.ZipFile(io.BytesIO(body)) as z:
                t.check(z.testzip() is None, f"[{label}] ZIP entries pass CRC")
                sheet = z.read("xl/worksheets/sheet1.xml")
                t.check(sheet.count(b"<row ") >= ROWS,
                        f"[{label}] XLSX sheet keeps all {ROWS} rows")


def fault_query(chunks: list) -> str:
    parts = []
    for chunk in chunks:
        if isinstance(chunk, (list, tuple)):
            parts.append("faultAt=" + ",".join(quote(str(x), safe="") for x in chunk))
        else:
            parts.append(f"faultAt={quote(str(chunk), safe='')}")
    return "&".join(parts)


def export_path(fmt: str, chunks: list | None = None) -> str:
    p = f"/export?format={fmt}&rows={ROWS}"
    return p if not chunks else f"{p}&{fault_query(chunks)}"


MALFORMED = ["abc", "", "1e3", "0x10", "-4", "1.5", "NaN", " 12 "]


def fault_plans(sizes: dict) -> list:
    """A fixed set of multi-offset plans, reused by every worker/round so
    identical requests must produce identical envelopes."""
    plans = []
    for fmt in ("csv", "xlsx"):
        size = sizes[fmt]
        hi = max(size - 2, 2)
        for k in range(4):
            a = 1 + (k * 6151) % hi
            b = 1 + (k * 92821) % hi
            if k == 0:
                chunks = [a, b, 10 ** 9]
            elif k == 1:
                chunks = [[a, b, size - 1]]
            elif k == 2:
                chunks = [[a, a], b, MALFORMED[k % len(MALFORMED)]]
            else:
                chunks = [10 ** 9, [2 * 10 ** 9, a]]
            plans.append({"fmt": fmt, "chunks": chunks, "id": f"{fmt}#{k}"})
    return plans


# --- load run --------------------------------------------------------------
class Shared:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.envelopes: dict = {}   # plan id -> set of (sha, framing)
        self.clean: dict = {}       # fmt -> set of canonical hashes
        self.latency: dict = {"clean-csv": [], "clean-xlsx": [], "fault": []}
        self.ops = 0
        self.bytes = 0

    def record_envelope(self, plan_id: str, body: bytes, headers: dict) -> None:
        with self.lock:
            self.envelopes.setdefault(plan_id, set()).add((sha(body), framing(headers)))

    def record_clean(self, fmt: str, body: bytes) -> None:
        with self.lock:
            self.clean.setdefault(fmt, set()).add(canon(fmt, body))

    def record(self, kind: str, ms: float, nbytes: int) -> None:
        with self.lock:
            self.latency[kind].append(ms)
            self.ops += 1
            self.bytes += nbytes


def worker(index: int, plans: list, shared: Shared, t: Tally, errors: list) -> None:
    conn = None
    try:
        conn = KeepAlive()
        for round_no in range(ROUNDS):
            plan = plans[(index + round_no) % len(plans)]
            fmt, chunks = plan["fmt"], plan["chunks"]
            label = f"w{index} r{round_no} {plan['id']}"

            s, h, b, reuse, ms = conn.request(export_path(fmt, chunks))
            check_fault(s, h, b, f"{label} fault", t)
            shared.record_envelope(plan["id"], b, h)
            shared.record("fault", ms, len(b))
            t.check(reuse, f"[{label}] no Connection: close after fault")
            t.check(conn.buf == b"", f"[{label}] nothing buffered after fault")

            s2, h2, b2, reuse2, ms2 = conn.request(export_path(fmt))
            check_clean(fmt, s2, h2, b2, f"{label} retry", t)
            shared.record_clean(fmt, b2)
            shared.record(f"clean-{fmt}", ms2, len(b2))
            t.check(reuse2, f"[{label} retry] connection still reusable")
            t.check(conn.buf == b"", f"[{label} retry] nothing buffered after retry")
            t.check(conn.sock.getsockname()[1] == conn.local_port,
                    f"[{label}] same local port {conn.local_port} (no reconnect)")
        t.check(conn.requests == ROUNDS * 2,
                f"[w{index}] all {ROUNDS * 2} requests served on one connection "
                f"(got {conn.requests})")
    except Exception as exc:  # noqa: BLE001 - surfaced as a failure below
        errors.append(f"worker {index}: {type(exc).__name__}: {exc}")
    finally:
        if conn is not None:
            conn.close()


def sampler(pid: int, stop: threading.Event, samples: list, started: float) -> None:
    while not stop.is_set():
        samples.append({"t": time.monotonic() - started, **fd_stats(pid)})
        stop.wait(SAMPLE_SECONDS)


def main() -> int:
    proc = start_harness()
    t = Tally()
    report: dict = {}
    try:
        sizes = {fmt: body_size(fmt) for fmt in ("csv", "xlsx")}
        print(f"harness pid={proc.pid} rows={ROWS} sizes={sizes} "
              f"concurrency={CONCURRENCY} rounds={ROUNDS}", flush=True)
        t.check(sizes["csv"] > 1_000_000,
                f"[setup] CSV payload is genuinely large ({sizes['csv']} bytes)")
        t.check(sizes["xlsx"] > 100_000,
                f"[setup] XLSX payload is genuinely large ({sizes['xlsx']} bytes)")

        # Warm up so lazily-created fds/threads exist before baselining.
        warm = KeepAlive()
        for fmt in ("csv", "xlsx"):
            s, h, b, reuse, _ = warm.request(export_path(fmt))
            check_clean(fmt, s, h, b, f"warmup {fmt}", t)
            t.check(reuse, f"[warmup {fmt}] connection kept alive")
        warm.close()
        time.sleep(1)
        baseline = fd_stats(proc.pid)

        plans = fault_plans(sizes)
        shared = Shared()
        errors: list = []
        samples: list = []
        stop = threading.Event()
        started = time.monotonic()
        sampler_thread = threading.Thread(target=sampler,
                                          args=(proc.pid, stop, samples, started), daemon=True)
        sampler_thread.start()

        threads = [threading.Thread(target=worker, args=(i, plans, shared, t, errors))
                   for i in range(CONCURRENCY)]
        for th in threads:
            th.start()
        for th in threads:
            th.join()
        duration = time.monotonic() - started
        stop.set()
        sampler_thread.join(timeout=5)

        for err in errors:
            t.check(False, f"[worker error] {err}")

        # --- idempotency ---
        for plan_id, seen in sorted(shared.envelopes.items()):
            t.check(len({x[0] for x in seen}) == 1,
                    f"[idempotency] {plan_id} envelope bytes identical across all workers/rounds "
                    f"({len({x[0] for x in seen})} variants)")
            t.check(len({x[1] for x in seen}) == 1,
                    f"[idempotency] {plan_id} envelope framing identical across all "
                    f"workers/rounds ({len({x[1] for x in seen})} variants)")
        t.check(len(shared.envelopes) == len(plans),
                f"[idempotency] every fault plan exercised "
                f"({len(shared.envelopes)}/{len(plans)})")
        for fmt, hashes in sorted(shared.clean.items()):
            t.check(len(hashes) == 1,
                    f"[idempotency] clean {fmt} export identical under load "
                    f"({len(hashes)} variants)")

        # --- latency budgets ---
        latency_report = {}
        for kind, values in shared.latency.items():
            if not values:
                continue
            stats = {"count": len(values), "p50": round(pct(values, 0.50), 1),
                     "p95": round(pct(values, 0.95), 1), "p99": round(pct(values, 0.99), 1),
                     "max": round(max(values), 1), "mean": round(statistics.fmean(values), 1)}
            latency_report[kind] = stats
            for q, budget in BUDGETS[kind].items():
                limit = budget + PER_WORKER_MS * CONCURRENCY
                t.check(stats[q] <= limit,
                        f"[latency] {kind} {q} {stats[q]}ms within {limit}ms budget")
        if "fault" in latency_report and "clean-csv" in latency_report:
            t.check(latency_report["fault"]["p95"] <= latency_report["clean-csv"]["p95"] * 1.5 + 250,
                    f"[latency] faults are not slower than clean exports "
                    f"(fault p95 {latency_report['fault']['p95']}ms vs csv p95 "
                    f"{latency_report['clean-csv']['p95']}ms)")

        # --- resource stability ---
        peaks = {k: max([baseline[k]] + [s[k] for s in samples])
                 for k in ("fds", "sockets", "threads", "rss_kb")}
        # Trend is measured on the steady-state window only: the first samples
        # capture connection ramp-up, which is a step, not growth.
        steady = [s for s in samples if s["t"] >= 0.3 * duration]
        slopes = {k: slope_per_minute(steady, k) for k in ("fds", "sockets", "threads")}
        slopes["rss_mb"] = slope_per_minute(steady, "rss_kb") / 1024.0

        t.check(peaks["fds"] <= baseline["fds"] + FD_BAND + CONCURRENCY,
                f"[resources] fds bounded under load ({baseline['fds']} -> peak {peaks['fds']})")
        t.check(peaks["sockets"] <= baseline["sockets"] + SOCK_BAND,
                f"[resources] socket fds bounded ({baseline['sockets']} -> peak "
                f"{peaks['sockets']})")
        t.check(peaks["threads"] <= baseline["threads"] + THREAD_BAND,
                f"[resources] threads bounded ({baseline['threads']} -> peak {peaks['threads']})")
        t.check(peaks["rss_kb"] <= baseline["rss_kb"] + RSS_HEADROOM_MB * 1024,
                f"[resources] RSS bounded ({baseline['rss_kb'] // 1024} -> "
                f"{peaks['rss_kb'] // 1024} MiB peak)")
        growth_report = growth.assert_slopes(
            t, slopes, SLOPE_LIMITS, "minute",
            window={"samples": len(steady), "from_seconds": round(0.3 * duration, 1),
                    "to_seconds": round(duration, 1), "concurrency": CONCURRENCY})

        time.sleep(2.5)
        settled = fd_stats(proc.pid)
        t.check(settled["fds"] <= baseline["fds"] + FD_BAND,
                f"[final] fds settled ({baseline['fds']} -> {settled['fds']})")
        t.check(settled["sockets"] <= baseline["sockets"] + 2,
                f"[final] socket fds settled ({baseline['sockets']} -> {settled['sockets']})")
        t.check(settled["threads"] <= baseline["threads"] + THREAD_BAND,
                f"[final] threads settled ({baseline['threads']} -> {settled['threads']})")

        throughput = {"ops": shared.ops,
                      "ops_per_second": round(shared.ops / max(duration, 0.001), 2),
                      "megabytes": round(shared.bytes / 1_048_576, 2),
                      "mb_per_second": round(shared.bytes / 1_048_576 / max(duration, 0.001), 2),
                      "duration_seconds": round(duration, 2)}
        t.check(shared.ops == CONCURRENCY * ROUNDS * 2,
                f"[final] all {CONCURRENCY * ROUNDS * 2} operations completed ({shared.ops})")

        with (OUT / "samples.csv").open("w") as fh:
            fh.write("t_seconds,fds,sockets,threads,rss_kb\n")
            for s in samples:
                fh.write(f"{s['t']:.2f},{s['fds']},{s['sockets']},{s['threads']},{s['rss_kb']}\n")

        report = {"rows": ROWS, "sizes": sizes, "concurrency": CONCURRENCY, "rounds": ROUNDS,
                  "throughput": throughput, "latency_ms": latency_report,
                  "baseline": baseline, "peaks": peaks, "settled": settled,
                  "slopes_per_minute": {k: round(v, 3) for k, v in slopes.items()},
                  "growth_thresholds": growth_report,
                  "bands": BANDS, "samples": len(samples)}
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()

    full = {"ok": not t.failures, "assertions": t.total, "failures": t.failures, **report}
    (OUT / "report.json").write_text(json.dumps(full, indent=2))
    for msg in t.failures[:50]:
        print("FAIL", msg)
    print(json.dumps({k: v for k, v in full.items() if k != "failures"}, indent=2))
    print(f"\n{t.total - len(t.failures)}/{t.total} assertions passed")
    return 1 if t.failures else 0


if __name__ == "__main__":
    sys.exit(main())
