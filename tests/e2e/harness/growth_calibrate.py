"""
Auto-calibration of growth_*_slope limits from the last N successful runs.

Motivation: the hand-picked slope defaults in `growth_thresholds.py` are a
guess at what a healthy runner looks like. Once a job has a handful of green
runs, the measured trends are a far better basis for the limits. This module
keeps a small JSON store of recent successful runs per profile, derives limits
from them, and feeds those limits back into future CI runs.

Store (default `baselines/growth-thresholds.json`, override with
GROWTH_CALIBRATION_FILE):

    {
      "version": 1,
      "profiles": {
        "export-keepalive-soak": {
          "unit": "hour",
          "defaults": {"fds": 4.0, ...},          # code defaults at record time
          "limits": {"fds": 3.1, ...},            # calibrated, used by CI
          "calibrated_at": "2026-08-07T08:00:00Z",
          "runs_used": 5,
          "method": "p95 x margin, clamped to [floor, default x max_factor]",
          "history": [
            {"ts": "...", "run": "gh-run-123", "ok": true,
             "slopes": {...}, "window": {...}}
          ]
        }
      }
    }

Reading (inside a test):

    LIMITS = growth.slope_limits("hour", {...}, profile="export-keepalive-soak")

Precedence is explicit env override > calibrated store > code default, so a
job can always pin a limit regardless of calibration state.

Writing (CI step, after a run):

    python tests/e2e/harness/growth_calibrate.py \
      --report /tmp/browser/app-status-keepalive-soak/report.json \
      --profile export-keepalive-soak --unit hour \
      --run "$GITHUB_RUN_ID" --update

`--update` recalibrates only from `ok: true` history entries; failing runs are
still recorded (for context) but never widen the limits.

Env knobs:
  GROWTH_CALIBRATION_FILE       store path (default baselines/growth-thresholds.json)
  GROWTH_USE_CALIBRATION        0 to ignore stored limits (default 1)
  GROWTH_CALIBRATION_KEEP       history entries retained per profile (default 10)
  GROWTH_CALIBRATION_RUNS       successful runs required to calibrate (default 3)
  GROWTH_CALIBRATION_MARGIN     headroom multiplier over p95 (default 1.5)
  GROWTH_CALIBRATION_MAX_FACTOR cap as a multiple of the code default (default 2.0)
  GROWTH_CALIBRATION_MIN_FACTOR floor as a fraction of the code default (default 0.25)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STORE = ROOT / "baselines" / "growth-thresholds.json"
METRICS = ("fds", "sockets", "threads", "rss_mb")


def suite_key(suite: str | None) -> str:
    """Normalise a suite label into an env-var scope (e.g. 'soak' -> 'SOAK')."""
    if not suite:
        return ""
    return "".join(ch if ch.isalnum() else "_" for ch in suite).strip("_").upper()


def _env_float(name: str, default: float, suite: str | None = None) -> float:
    """Read GROWTH_<SUITE>_<name>, else GROWTH_<name>, else `default`."""
    key = suite_key(suite)
    for var in ([f"GROWTH_{key}_{name}"] if key else []) + [f"GROWTH_{name}"]:
        raw = os.environ.get(var)
        if raw is None or raw.strip() == "":
            continue
        try:
            return float(raw)
        except ValueError as exc:
            raise SystemExit(f"{var}={raw!r} is not a number") from exc
    return default


def store_path(suite: str | None = None) -> Path:
    key = suite_key(suite)
    for var in ([f"GROWTH_{key}_CALIBRATION_FILE"] if key else []) + ["GROWTH_CALIBRATION_FILE"]:
        raw = os.environ.get(var)
        if raw:
            return Path(raw)
    return DEFAULT_STORE


def load_store(path: Path | None = None, suite: str | None = None) -> dict:
    path = path or store_path(suite)
    if not path.exists():
        return {"version": 1, "profiles": {}}
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path} is not valid JSON: {exc}") from exc
    data.setdefault("version", 1)
    data.setdefault("profiles", {})
    return data


def save_store(store: dict, path: Path | None = None, suite: str | None = None) -> Path:
    path = path or store_path(suite)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(store, indent=2, sort_keys=True) + "\n")
    return path


def calibrated_limits(profile: str | None, unit: str, path: Path | None = None,
                      suite: str | None = None) -> dict:
    """Stored limits for `profile`, or {} when absent/disabled/unit mismatch.

    Calibration can be disabled globally (GROWTH_USE_CALIBRATION=0) or for one
    suite only (e.g. GROWTH_SOAK_USE_CALIBRATION=0).
    """
    if not profile or _env_float("USE_CALIBRATION", 1.0, suite) == 0:
        return {}
    entry = load_store(path, suite).get("profiles", {}).get(profile) or {}
    if entry.get("unit") not in (None, unit):
        return {}
    limits = entry.get("limits") or {}
    return {m: float(v) for m, v in limits.items() if m in METRICS and v is not None}


def _percentile(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    pos = (len(ordered) - 1) * pct
    low, high = int(pos), min(int(pos) + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (pos - low)


def derive_limits(history: list[dict], defaults: dict, *, min_runs: int | None = None,
                  margin: float | None = None, suite: str | None = None) -> tuple[dict, dict]:
    """Derive limits from successful history. Returns (limits, meta).

    Every knob honours the suite scope first, e.g. GROWTH_LOAD_CALIBRATION_RUNS
    then GROWTH_CALIBRATION_RUNS.
    """
    min_runs = (int(_env_float("CALIBRATION_RUNS", 3.0, suite))
                if min_runs is None else min_runs)
    margin = _env_float("CALIBRATION_MARGIN", 1.5, suite) if margin is None else margin
    max_factor = _env_float("CALIBRATION_MAX_FACTOR", 2.0, suite)
    min_factor = _env_float("CALIBRATION_MIN_FACTOR", 0.25, suite)

    good = [h for h in history if h.get("ok")]
    if len(good) < min_runs:
        return {}, {"calibrated": False,
                    "reason": f"only {len(good)} successful run(s), need {min_runs}",
                    "runs_used": len(good)}

    limits: dict = {}
    observed: dict = {}
    for metric in METRICS:
        samples = [float(h["slopes"][metric]) for h in good
                   if isinstance(h.get("slopes"), dict) and h["slopes"].get(metric) is not None]
        default = defaults.get(metric)
        if not samples or default is None:
            continue
        p95 = _percentile(samples, 0.95)
        # Slopes can be negative (shrinking) — never derive a negative limit.
        candidate = max(p95, 0.0) * margin
        low, high = float(default) * min_factor, float(default) * max_factor
        limits[metric] = round(min(max(candidate, low), high), 4)
        observed[metric] = {"samples": len(samples), "p95": round(p95, 4),
                            "max": round(max(samples), 4), "min": round(min(samples), 4)}
    meta = {"calibrated": bool(limits), "runs_used": len(good), "margin": margin,
            "max_factor": max_factor, "min_factor": min_factor, "observed": observed,
            "method": "p95 x margin, clamped to [default x min_factor, default x max_factor]"}
    return limits, meta


def record_run(profile: str, unit: str, *, slopes: dict, defaults: dict, ok: bool,
               window: dict | None = None, run: str | None = None,
               update: bool = True, path: Path | None = None,
               suite: str | None = None) -> dict:
    """Append a run to the store and (optionally) recalibrate the limits."""
    store = load_store(path, suite)
    entry = store["profiles"].setdefault(profile, {"unit": unit, "history": []})
    entry["unit"] = unit
    if suite_key(suite):
        entry["suite"] = suite_key(suite)
    entry["defaults"] = {m: v for m, v in defaults.items() if v is not None}
    keep = int(_env_float("CALIBRATION_KEEP", 10.0, suite))
    entry["history"].append({
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "run": run or os.environ.get("GITHUB_RUN_ID") or "local",
        "ok": bool(ok),
        "slopes": {m: round(float(v), 4) for m, v in slopes.items()
                   if m in METRICS and v is not None},
        "window": window or {},
    })
    entry["history"] = entry["history"][-max(keep, 1):]

    result = {"profile": profile, "unit": unit, "suite": suite_key(suite) or None,
              "recorded": True, "updated": False}
    if update:
        limits, meta = derive_limits(entry["history"], entry["defaults"], suite=suite)
        if limits:
            entry["limits"] = limits
            entry["calibrated_at"] = entry["history"][-1]["ts"]
            entry["runs_used"] = meta["runs_used"]
            entry["method"] = meta["method"]
            entry["observed"] = meta["observed"]
            result["updated"] = True
            result["limits"] = limits
        result.update({k: meta[k] for k in ("calibrated", "runs_used") if k in meta})
        if "reason" in meta:
            result["reason"] = meta["reason"]
    result["store"] = str(save_store(store, path, suite))
    return result


def format_result(result: dict) -> str:
    scope = f", suite {result['suite']}" if result.get("suite") else ""
    lines = [f"--- growth calibration: {result['profile']} ({result['unit']}{scope}) ---",
             f"store: {result['store']}"]
    if result.get("updated"):
        lines.append(f"limits from last {result['runs_used']} successful run(s):")
        lines += [f"  {m:<8} {v:>10.3f} /{result['unit']}"
                  for m, v in sorted(result["limits"].items())]
    else:
        lines.append("limits unchanged: " + result.get("reason", "no metrics to calibrate"))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Calibrate growth slope limits from run reports")
    ap.add_argument("--report", required=True, help="path to a test report.json")
    ap.add_argument("--profile", required=True, help="calibration profile key")
    ap.add_argument("--unit", choices=("minute", "hour"), help="slope unit (default: from report)")
    ap.add_argument("--run", help="run identifier (defaults to $GITHUB_RUN_ID)")
    ap.add_argument("--suite", help="suite scope for GROWTH_<SUITE>_* env overrides "
                                    "(default: from report growth_suite)")
    ap.add_argument("--update", action="store_true", help="recalibrate stored limits")
    ap.add_argument("--store", help="override store path")
    args = ap.parse_args(argv)

    report_path = Path(args.report)
    if not report_path.exists():
        print(f"report not found: {report_path}", file=sys.stderr)
        return 1
    report = json.loads(report_path.read_text())

    growth = report.get("growth_thresholds") or {}
    unit = args.unit or ("hour" if growth.get("unit") == "hour" else "minute")
    slopes = (report.get("slopes_per_hour") if unit == "hour"
              else report.get("slopes_per_minute")) or {}
    if not slopes and growth.get("rows"):
        slopes = {r["metric"]: r["measured"] for r in growth["rows"]}
    if "rss_kb" in slopes and "rss_mb" not in slopes:
        slopes["rss_mb"] = float(slopes["rss_kb"]) / 1024.0
    if not slopes:
        print("report has no measured slopes; nothing to record", file=sys.stderr)
        return 1

    defaults = report.get("growth_defaults") or {r["metric"]: r["limit"]
                                                for r in growth.get("rows", [])}
    suite = args.suite or report.get("growth_suite") or growth.get("suite")
    result = record_run(args.profile, unit, slopes=slopes, defaults=defaults,
                        ok=bool(report.get("ok")), window=growth.get("window"),
                        run=args.run, update=args.update,
                        path=Path(args.store) if args.store else None, suite=suite)
    print(format_result(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
