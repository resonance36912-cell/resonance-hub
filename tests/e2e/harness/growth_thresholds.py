"""
Configurable growth-slope thresholds for the export resource-stability tests.

Both the load/idempotency test (per-minute trends) and the keep-alive soak
(per-hour trends) assert that server fd / socket-fd / thread counts do not grow
over the steady-state window. This module centralises:

  * the default limits,
  * env-var overrides so CI can tighten or loosen them per job,
  * a clear diff report that shows measured vs configured limits, the overshoot
    and the sample window used, printed whenever a limit is exceeded.

Env overrides (all optional, floats):

  Per-minute limits (load tests)
    GROWTH_FD_SLOPE_PER_MIN
    GROWTH_SOCKET_SLOPE_PER_MIN
    GROWTH_THREAD_SLOPE_PER_MIN
    GROWTH_RSS_MB_SLOPE_PER_MIN      (only checked when a limit is configured)

  Per-hour limits (soak tests)
    GROWTH_FD_SLOPE_PER_HOUR
    GROWTH_SOCKET_SLOPE_PER_HOUR
    GROWTH_THREAD_SLOPE_PER_HOUR
    GROWTH_RSS_MB_SLOPE_PER_HOUR     (only checked when a limit is configured)

  Absolute bands vs the post-warmup baseline (integers)
    GROWTH_FD_BAND / GROWTH_SOCKET_BAND / GROWTH_THREAD_BAND

  GROWTH_SLOPE_TOLERANCE  multiplier applied to every slope limit (default 1.0)
                          e.g. 1.5 on a noisy shared runner.

Any unset variable falls back to the caller-supplied default.
"""
from __future__ import annotations

import os

UNIT_SUFFIX = {"minute": "PER_MIN", "hour": "PER_HOUR"}
UNIT_LABEL = {"minute": "/min", "hour": "/hour"}
METRIC_ENV = {"fds": "FD", "sockets": "SOCKET", "threads": "THREAD", "rss_mb": "RSS_MB"}


def _env_float(name: str, default: float | None) -> float | None:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise SystemExit(f"{name}={raw!r} is not a number") from exc


def _env_int(name: str, default: int) -> int:
    value = _env_float(name, float(default))
    return int(value if value is not None else default)


def slope_limits(unit: str, defaults: dict) -> dict:
    """Resolve slope limits for `unit` ('minute' | 'hour') from env + defaults.

    Returns a dict of metric -> limit, dropping metrics with no limit at all.
    """
    if unit not in UNIT_SUFFIX:
        raise ValueError(f"unit must be 'minute' or 'hour', got {unit!r}")
    tolerance = _env_float("GROWTH_SLOPE_TOLERANCE", 1.0) or 1.0
    if tolerance <= 0:
        raise SystemExit("GROWTH_SLOPE_TOLERANCE must be > 0")
    suffix = UNIT_SUFFIX[unit]
    limits: dict = {}
    for metric, prefix in METRIC_ENV.items():
        limit = _env_float(f"GROWTH_{prefix}_SLOPE_{suffix}", defaults.get(metric))
        if limit is None:
            continue
        limits[metric] = round(limit * tolerance, 4)
    return limits


def band_limits(defaults: dict) -> dict:
    """Resolve absolute baseline bands from env + defaults."""
    return {metric: _env_int(f"GROWTH_{METRIC_ENV[metric]}_BAND", default)
            for metric, default in defaults.items()}


def evaluate(slopes: dict, limits: dict, unit: str, window: dict | None = None) -> dict:
    """Compare measured slopes against limits. Returns a serialisable report."""
    label = UNIT_LABEL[unit]
    rows = []
    for metric, limit in limits.items():
        if metric not in slopes:
            continue
        measured = float(slopes[metric])
        overshoot = round(measured - limit, 4)
        rows.append({
            "metric": metric,
            "measured": round(measured, 4),
            "limit": limit,
            "overshoot": overshoot,
            "percent_of_limit": round(measured / limit * 100, 1) if limit else None,
            "unit": label.lstrip("/"),
            "ok": measured <= limit,
        })
    return {"unit": label.lstrip("/"), "window": window or {}, "rows": rows,
            "violations": [r["metric"] for r in rows if not r["ok"]],
            "ok": all(r["ok"] for r in rows)}


def format_report(report: dict, title: str = "growth-slope thresholds") -> str:
    """Human-readable diff table; violations are marked and listed first."""
    label = "/" + report.get("unit", "minute")
    width = max([len(r["metric"]) for r in report["rows"]] + [6])
    lines = [f"--- {title} ({'FAIL' if not report['ok'] else 'ok'}) ---",
             f"{'metric'.ljust(width)}  {'measured':>10}  {'limit':>10}  "
             f"{'overshoot':>10}  {'% of limit':>10}  status"]
    for row in sorted(report["rows"], key=lambda r: (r["ok"], r["metric"])):
        pct = "-" if row["percent_of_limit"] is None else f"{row['percent_of_limit']:.1f}%"
        lines.append(f"{row['metric'].ljust(width)}  {row['measured']:>10.3f}  "
                     f"{row['limit']:>10.3f}  {row['overshoot']:>+10.3f}  {pct:>10}  "
                     f"{'OK' if row['ok'] else 'EXCEEDS LIMIT'}")
    lines.append(f"units: counts{label} (least-squares trend over the steady-state window)")
    window = report.get("window") or {}
    if window:
        lines.append("window: " + ", ".join(f"{k}={v}" for k, v in window.items()))
    if report["violations"]:
        lines.append("violations: " + ", ".join(report["violations"]))
        lines.append("override with GROWTH_<FD|SOCKET|THREAD>_SLOPE_"
                     f"{'PER_MIN' if report.get('unit') == 'minute' else 'PER_HOUR'}"
                     " or GROWTH_SLOPE_TOLERANCE")
    return "\n".join(lines)


def assert_slopes(tally, slopes: dict, limits: dict, unit: str,
                  window: dict | None = None, prefix: str = "trend") -> dict:
    """Run one assertion per metric on `tally` and print a diff report on failure.

    `tally` is any object with `.check(ok: bool, msg: str)`.
    """
    report = evaluate(slopes, limits, unit, window)
    label = UNIT_LABEL[unit]
    for row in report["rows"]:
        tally.check(row["ok"],
                    f"[{prefix}] {row['metric']} growth within limit "
                    f"({row['measured']:.3f}{label} <= {row['limit']:.3f}{label}"
                    + ("" if row["ok"] else f", over by {row['overshoot']:+.3f}{label}") + ")")
    if not report["ok"]:
        print(format_report(report), flush=True)
    return report
