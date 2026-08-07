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

Per-suite profiles
------------------
Every variable above also has a suite-scoped form, so the keep-alive soak and
the load/idempotency test can be tuned independently in the same environment:

    GROWTH_<SUITE>_<NAME>          e.g. GROWTH_SOAK_FD_SLOPE_PER_HOUR
                                        GROWTH_LOAD_FD_SLOPE_PER_MIN
                                        GROWTH_SOAK_SLOPE_TOLERANCE
                                        GROWTH_LOAD_SOCKET_BAND

Suite keys are declared by each test (`SUITE` constant): `SOAK` for the
keep-alive soak, `LOAD` for the load/idempotency test. Resolution order per
value is:

    GROWTH_<SUITE>_<NAME>  >  GROWTH_<NAME>  >  calibrated store  >  code default

so a scoped variable tunes one suite only, and the unscoped variable still
works as a global default for both.
"""
from __future__ import annotations

import os

from growth_calibrate import calibrated_limits, suite_key

UNIT_SUFFIX = {"minute": "PER_MIN", "hour": "PER_HOUR"}
UNIT_LABEL = {"minute": "/min", "hour": "/hour"}
METRIC_ENV = {"fds": "FD", "sockets": "SOCKET", "threads": "THREAD", "rss_mb": "RSS_MB"}


def env_names(name: str, suite: str | None) -> list[str]:
    """Candidate env var names for `name`, suite-scoped first."""
    key = suite_key(suite)
    return ([f"GROWTH_{key}_{name}"] if key else []) + [f"GROWTH_{name}"]


def _env_float(name: str, default: float | None, suite: str | None = None) -> float | None:
    """Read GROWTH_<SUITE>_<name>, else GROWTH_<name>, else `default`."""
    for var in env_names(name, suite):
        raw = os.environ.get(var)
        if raw is None or raw.strip() == "":
            continue
        try:
            return float(raw)
        except ValueError as exc:
            raise SystemExit(f"{var}={raw!r} is not a number") from exc
    return default


def _env_int(name: str, default: int, suite: str | None = None) -> int:
    value = _env_float(name, float(default), suite)
    return int(value if value is not None else default)


def slope_limits(unit: str, defaults: dict, profile: str | None = None,
                 suite: str | None = None) -> dict:
    """Resolve slope limits for `unit` ('minute' | 'hour') from env + defaults.

    Precedence per metric: suite-scoped env var (GROWTH_<SUITE>_*) > global env
    var (GROWTH_*) > limit auto-calibrated from recent successful runs (see
    growth_calibrate.py, only when `profile` is given) > code default.

    Returns a dict of metric -> limit, dropping metrics with no limit at all.
    """
    if unit not in UNIT_SUFFIX:
        raise ValueError(f"unit must be 'minute' or 'hour', got {unit!r}")
    tolerance = _env_float("SLOPE_TOLERANCE", 1.0, suite) or 1.0
    if tolerance <= 0:
        raise SystemExit("GROWTH_SLOPE_TOLERANCE must be > 0")
    suffix = UNIT_SUFFIX[unit]
    calibrated = calibrated_limits(profile, unit, suite=suite) if profile else {}
    limits: dict = {}
    for metric, prefix in METRIC_ENV.items():
        fallback = calibrated.get(metric, defaults.get(metric))
        limit = _env_float(f"{prefix}_SLOPE_{suffix}", fallback, suite)
        if limit is None:
            continue
        limits[metric] = round(limit * tolerance, 4)
    return limits


def band_limits(defaults: dict, suite: str | None = None) -> dict:
    """Resolve absolute baseline bands from env + defaults (suite-scoped first)."""
    return {metric: _env_int(f"{METRIC_ENV[metric]}_BAND", default, suite)
            for metric, default in defaults.items()}



def evaluate(slopes: dict, limits: dict, unit: str, window: dict | None = None,
             suite: str | None = None) -> dict:
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
    return {"unit": label.lstrip("/"), "suite": suite_key(suite) or None,
            "window": window or {}, "rows": rows,
            "violations": [r["metric"] for r in rows if not r["ok"]],
            "ok": all(r["ok"] for r in rows)}


def format_report(report: dict, title: str = "growth-slope thresholds") -> str:
    """Human-readable diff table; violations are marked and listed first."""
    label = "/" + report.get("unit", "min")
    suite = report.get("suite")
    width = max([len(r["metric"]) for r in report["rows"]] + [6])
    heading = f"{title}{f' [{suite}]' if suite else ''}"
    lines = [f"--- {heading} ({'FAIL' if not report['ok'] else 'ok'}) ---",
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
        suffix = "PER_MIN" if report.get("unit") == "min" else "PER_HOUR"
        scope = f"{suite}_" if suite else ""
        lines.append(f"tune this suite with GROWTH_{scope}<FD|SOCKET|THREAD>_SLOPE_{suffix}"
                     f" or GROWTH_{scope}SLOPE_TOLERANCE"
                     + (f" (drop the {suite}_ scope to change both suites)" if suite else ""))
    return "\n".join(lines)


def assert_slopes(tally, slopes: dict, limits: dict, unit: str,
                  window: dict | None = None, prefix: str = "trend",
                  suite: str | None = None) -> dict:
    """Run one assertion per metric on `tally` and print a diff report on failure.

    `tally` is any object with `.check(ok: bool, msg: str)`.
    """
    report = evaluate(slopes, limits, unit, window, suite)
    label = UNIT_LABEL[unit]
    for row in report["rows"]:
        tally.check(row["ok"],
                    f"[{prefix}] {row['metric']} growth within limit "
                    f"({row['measured']:.3f}{label} <= {row['limit']:.3f}{label}"
                    + ("" if row["ok"] else f", over by {row['overshoot']:+.3f}{label}") + ")")
    if not report["ok"]:
        print(format_report(report), flush=True)
    return report

