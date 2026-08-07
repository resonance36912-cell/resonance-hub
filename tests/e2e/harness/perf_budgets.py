"""
Performance budgets for Hub page loads, shared by the e2e perf suites.

Two profiles, because an unbundled Vite dev server and a production build have
fundamentally different asset shapes (dev ships hundreds of ES modules; prod
ships a handful of hashed chunks). The suite auto-detects the profile by
looking for Vite dev-only resources (`/@vite/client`, `?v=` module queries) and
can be forced with PERF_PROFILE=dev|prod.

Every budget is overridable per run, most specific first:

    PERF_<SUITE>_<KEY>   e.g. PERF_NOT_FOUND_FCP_MS=1800
    PERF_<KEY>           e.g. PERF_FCP_MS=1800

Values are milliseconds (…_MS), bytes (…_BYTES) or plain counts.
"""
from __future__ import annotations

import os
from typing import Any

# key -> (dev budget, prod budget, unit, human label)
BUDGETS: dict[str, tuple[float, float, str, str]] = {
    # Server + document
    "TTFB_MS": (800, 500, "ms", "time to first byte"),
    "HTML_BYTES": (80_000, 120_000, "bytes", "document transfer size"),
    # Paint / readiness
    "FCP_MS": (1_800, 1_200, "ms", "first contentful paint"),
    "LCP_MS": (2_800, 2_000, "ms", "largest contentful paint"),
    "DCL_MS": (2_800, 1_800, "ms", "DOMContentLoaded"),
    "LOAD_MS": (4_000, 2_500, "ms", "load event"),
    "SUGGESTIONS_MS": (3_000, 2_000, "ms", "suggestion links visible"),
    "CONTENT_MS": (3_000, 2_000, "ms", "main content visible"),
    # Client-side (SPA) navigation between catalog and detail pages
    "SPA_NAV_MS": (2_000, 1_200, "ms", "client-side navigation"),
    "SPA_BACK_MS": (2_000, 1_000, "ms", "history-back navigation"),
    "SPA_REQUESTS": (60, 12, "count", "requests during SPA nav"),
    "SPA_BYTES": (8_000_000, 250_000, "bytes", "bytes during SPA nav"),

    # Asset graph
    "REQUESTS": (600, 45, "count", "subresource requests"),
    "CSS_REQUESTS": (10, 6, "count", "stylesheet requests"),
    "FONT_REQUESTS": (4, 4, "count", "font requests"),
    "IMAGE_BYTES": (400_000, 250_000, "bytes", "image transfer bytes"),
    "CSS_BYTES": (400_000, 120_000, "bytes", "stylesheet transfer bytes"),
    # dev serves JS unminified and unbundled, so JS bytes are only budgeted in prod
    "JS_BYTES": (40_000_000, 900_000, "bytes", "script transfer bytes"),
    # Tail latency
    "SLOWEST_ASSET_MS": (2_000, 1_200, "ms", "slowest single asset"),
    "FULLY_LOADED_MS": (6_000, 3_000, "ms", "last asset finished"),
    "THIRD_PARTY_REQUESTS": (0, 0, "count", "third-party requests before load"),
}


def detect_profile(resource_names: list[str]) -> str:
    forced = os.environ.get("PERF_PROFILE")
    if forced in ("dev", "prod"):
        return forced
    dev_markers = ("/@vite/client", "/@react-refresh", "/@fs/", "/node_modules/.vite/")
    if any(any(m in n for m in dev_markers) for n in resource_names):
        return "dev"
    return "prod"


def budget(key: str, profile: str, suite: str) -> float:
    dev, prod, _unit, _label = BUDGETS[key]
    default = dev if profile == "dev" else prod
    suite_env = f"PERF_{suite.upper().replace('-', '_')}_{key}"
    for name in (suite_env, f"PERF_{key}"):
        raw = os.environ.get(name)
        if raw:
            return float(raw)
    return float(default)


def fmt(value: float, unit: str) -> str:
    if unit == "bytes":
        return f"{value / 1024:.1f} KiB"
    if unit == "ms":
        return f"{value:.0f} ms"
    return f"{value:.0f}"


def diff_table(rows: list[dict[str, Any]]) -> str:
    """rows: {key, measured, limit, unit, label, ok}"""
    head = f"{'metric':<26} {'measured':>12} {'budget':>12}  status"
    lines = [head, "-" * len(head)]
    for r in rows:
        status = "ok" if r["ok"] else "OVER BUDGET"
        lines.append(
            f"{r['label']:<26} {fmt(r['measured'], r['unit']):>12} "
            f"{fmt(r['limit'], r['unit']):>12}  {status}"
        )
    return "\n".join(lines)
