"""
Render an HTML + Markdown growth report from a resource-stability run.

Reads the `report.json` (and optional `samples.csv`) produced by
  * tests/e2e/app-status-export-keepalive-soak.py       (per-hour slopes)
  * tests/e2e/app-status-export-load-idempotency.py     (per-minute slopes)

and writes a self-contained HTML page with inline SVG time-series charts for
fds / socket fds / threads / RSS, each overlaid with:
  * the post-warmup baseline,
  * the absolute band ceiling (baseline + GROWTH_*_BAND),
  * the measured least-squares trend line,
  * the configured slope limit drawn from the same baseline for comparison.

A Markdown summary (measured vs configured limits, overshoot, % of limit) is
written alongside it, suitable for a CI job summary.

Usage:
  python3 tests/e2e/harness/growth_report.py <run-dir-or-report.json> \
      [--out-html growth-report.html] [--out-md growth-report.md] [--title "..."]

  # defaults: writes growth-report.{html,md} next to report.json
  python3 tests/e2e/harness/growth_report.py /tmp/browser/app-status-keepalive-soak
"""
from __future__ import annotations

import argparse
import csv
import html
import json
from pathlib import Path

METRICS = [
    ("fds", "File descriptors", "fds", "#2563eb"),
    ("sockets", "Socket fds", "sockets", "#0d9488"),
    ("threads", "Threads", "threads", "#7c3aed"),
    ("rss_kb", "Resident memory (MiB)", "rss_mb", "#d97706"),
]
W, H = 720, 220
PAD_L, PAD_R, PAD_T, PAD_B = 56, 16, 18, 34


# --- loading ---------------------------------------------------------------
def load_run(target: Path) -> dict:
    report_path = target / "report.json" if target.is_dir() else target
    if not report_path.exists():
        raise SystemExit(f"no report.json at {report_path}")
    report = json.loads(report_path.read_text())
    samples_path = report_path.parent / "samples.csv"
    samples: list[dict] = []
    if samples_path.exists():
        with samples_path.open() as fh:
            for row in csv.DictReader(fh):
                t = row.get("t_seconds") or row.get("t") or "0"
                point = {"t": float(t)}
                for key in ("fds", "sockets", "threads", "rss_kb"):
                    if row.get(key) not in (None, ""):
                        point[key] = float(row[key])
                samples.append(point)
    return {"report": report, "samples": samples, "dir": report_path.parent,
            "report_path": report_path}


def slopes_of(report: dict) -> tuple[dict, str]:
    if "slopes_per_hour" in report:
        return report["slopes_per_hour"], "hour"
    if "slopes_per_minute" in report:
        return report["slopes_per_minute"], "minute"
    thresholds = report.get("growth_thresholds") or {}
    unit = "hour" if thresholds.get("unit") == "hour" else "minute"
    return {r["metric"]: r["measured"] for r in thresholds.get("rows", [])}, unit


# --- svg -------------------------------------------------------------------
def _line(points: list[tuple[float, float]], color: str, dash: str = "", width: float = 2) -> str:
    if len(points) < 2:
        return ""
    d = " ".join(f"{'M' if i == 0 else 'L'}{x:.1f},{y:.1f}" for i, (x, y) in enumerate(points))
    dasharray = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"'
            f'{dasharray} stroke-linejoin="round" />')


def chart(label: str, unit_label: str, color: str, series: list[tuple[float, float]],
          baseline: float | None, band_ceiling: float | None,
          trend: tuple[float, float] | None, limit_trend: tuple[float, float] | None) -> str:
    """One SVG chart. `trend`/`limit_trend` are (value_at_t0, value_at_tmax)."""
    if len(series) < 2:
        return (f'<div class="chart empty"><h3>{html.escape(label)}</h3>'
                f'<p>Not enough samples to plot.</p></div>')
    xs = [p[0] for p in series]
    ys = [p[1] for p in series]
    candidates = ys + [v for v in (baseline, band_ceiling) if v is not None]
    for pair in (trend, limit_trend):
        if pair:
            candidates += list(pair)
    lo, hi = min(candidates), max(candidates)
    if hi - lo < 1e-9:
        lo, hi = lo - 1, hi + 1
    pad = (hi - lo) * 0.12
    lo, hi = lo - pad, hi + pad
    x0, x1 = min(xs), max(xs)
    if x1 - x0 < 1e-9:
        x1 = x0 + 1

    def px(t: float) -> float:
        return PAD_L + (t - x0) / (x1 - x0) * (W - PAD_L - PAD_R)

    def py(v: float) -> float:
        return H - PAD_B - (v - lo) / (hi - lo) * (H - PAD_T - PAD_B)

    parts = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{html.escape(label)} over time">']
    parts.append(f'<rect x="{PAD_L}" y="{PAD_T}" width="{W - PAD_L - PAD_R}" '
                 f'height="{H - PAD_T - PAD_B}" fill="#0b1120" stroke="#1e293b" />')
    for frac in (0, 0.25, 0.5, 0.75, 1):
        v = lo + (hi - lo) * frac
        y = py(v)
        parts.append(f'<line x1="{PAD_L}" y1="{y:.1f}" x2="{W - PAD_R}" y2="{y:.1f}" '
                     f'stroke="#1e293b" stroke-width="1" />')
        parts.append(f'<text x="{PAD_L - 8}" y="{y + 4:.1f}" text-anchor="end" '
                     f'class="tick">{v:.1f}</text>')
    for frac in (0, 0.5, 1):
        t = x0 + (x1 - x0) * frac
        parts.append(f'<text x="{px(t):.1f}" y="{H - 10}" text-anchor="middle" '
                     f'class="tick">{t:.0f}s</text>')
    if band_ceiling is not None:
        parts.append(_line([(px(x0), py(band_ceiling)), (px(x1), py(band_ceiling))],
                           "#f43f5e", dash="6 4", width=1.5))
    if baseline is not None:
        parts.append(_line([(px(x0), py(baseline)), (px(x1), py(baseline))],
                           "#64748b", dash="3 3", width=1.5))
    if limit_trend:
        parts.append(_line([(px(x0), py(limit_trend[0])), (px(x1), py(limit_trend[1]))],
                           "#f59e0b", dash="8 5", width=1.5))
    parts.append(_line([(px(t), py(v)) for t, v in series], color))
    if trend:
        parts.append(_line([(px(x0), py(trend[0])), (px(x1), py(trend[1]))],
                           "#e2e8f0", dash="2 4", width=1.5))
    parts.append("</svg>")
    return (f'<div class="chart"><h3>{html.escape(label)} '
            f'<span class="unit">{html.escape(unit_label)}</span></h3>'
            + "".join(parts) + "</div>")


# --- report ----------------------------------------------------------------
def build(run: dict, title: str) -> tuple[str, str]:
    report, samples = run["report"], run["samples"]
    slopes, unit = slopes_of(report)
    per = 3600.0 if unit == "hour" else 60.0
    thresholds = report.get("growth_thresholds") or {}
    limits = {r["metric"]: r["limit"] for r in thresholds.get("rows", [])}
    rows = thresholds.get("rows", [])
    baseline = report.get("baseline") or {}
    bands = report.get("bands") or {}
    peaks = report.get("peaks") or {}
    settled = report.get("settled") or {}
    ok = bool(report.get("ok"))
    growth_ok = thresholds.get("ok", True)

    span = (samples[-1]["t"] - samples[0]["t"]) if len(samples) >= 2 else 0.0
    charts = []
    for key, label, slope_key, color in METRICS:
        scale = 1 / 1024.0 if key == "rss_kb" else 1.0
        series = [(s["t"], s[key] * scale) for s in samples if key in s]
        base = baseline.get(key)
        base = base * scale if base is not None else None
        band = bands.get(key if key != "rss_kb" else "rss_mb")
        ceiling = base + band if (base is not None and band is not None) else None
        measured = slopes.get(slope_key)
        trend = None
        if base is not None and measured is not None and span:
            trend = (base, base + measured * (span / per))
        limit_trend = None
        limit = limits.get(slope_key)
        if base is not None and limit is not None and span:
            limit_trend = (base, base + limit * (span / per))
        unit_label = f"count, trend per {unit}" if key != "rss_kb" else f"MiB, trend per {unit}"
        charts.append(chart(label, unit_label, color, series, base, ceiling, trend, limit_trend))

    def level(src: dict, key: str, missing=None):
        """Resource level, converting rss_kb -> MiB so tables match the charts."""
        value = src.get(key)
        if value is None:
            return missing
        return round(value / 1024.0, 1) if key == "rss_kb" else value

    # --- markdown ---

    md = [f"# {title}", "",
          f"- Result: **{'PASS' if ok else 'FAIL'}** "
          f"({report.get('assertions', 0)} assertions, "
          f"{len(report.get('failures') or [])} failures)",
          f"- Growth slopes: **{'within limits' if growth_ok else 'EXCEEDED'}** "
          f"(measured per {unit})",
          f"- Samples: {len(samples)}"
          + (f" over {span:.0f}s" if span else ""), ""]
    if rows:
        md += [f"| metric | measured /{unit} | limit /{unit} | overshoot | % of limit | status |",
               "| --- | --- | --- | --- | --- | --- |"]
        for r in sorted(rows, key=lambda r: (r["ok"], r["metric"])):
            pct = "-" if r["percent_of_limit"] is None else f"{r['percent_of_limit']:.1f}%"
            md.append(f"| `{r['metric']}` | {r['measured']:.3f} | {r['limit']:.3f} | "
                      f"{r['overshoot']:+.3f} | {pct} | "
                      f"{'OK' if r['ok'] else '**EXCEEDS LIMIT**'} |")
        md.append("")
    if baseline:
        md += ["| metric | baseline | peak | settled | band ceiling |",
               "| --- | --- | --- | --- | --- |"]
        for key, label, slope_key, _ in METRICS:
            band = bands.get(key if key != "rss_kb" else "rss_mb")
            base = level(baseline, key)
            ceiling = "-" if (base is None or band is None) else f"{base + band:g}"
            md.append(f"| {label} | {base if base is not None else '-'} | "
                      f"{level(peaks, key, '-')} | {level(settled, key, '-')} | {ceiling} |")

        md.append("")
    for msg in (report.get("failures") or [])[:20]:
        md.append(f"- FAIL {msg}")
    md.append("")
    md.append("Legend: measured trend vs configured slope limit; band ceiling is "
              "baseline + `GROWTH_*_BAND`. Limits are configurable via `GROWTH_*` env vars.")
    markdown = "\n".join(md)

    # --- html ---
    def cell(v) -> str:
        return html.escape("-" if v is None else (f"{v:g}" if isinstance(v, float) else str(v)))

    def pct_cell(r: dict) -> str:
        return "-" if r["percent_of_limit"] is None else f"{r['percent_of_limit']:.1f}%"

    table_rows = "".join(
        f'<tr class="{"ok" if r["ok"] else "bad"}"><td><code>{html.escape(r["metric"])}</code></td>'
        f"<td>{r['measured']:.3f}</td><td>{r['limit']:.3f}</td>"
        f"<td>{r['overshoot']:+.3f}</td>"
        f"<td>{pct_cell(r)}</td>"
        f"<td>{'OK' if r['ok'] else 'EXCEEDS LIMIT'}</td></tr>"
        for r in sorted(rows, key=lambda r: (r["ok"], r["metric"])))

    res_rows = "".join(
        f"<tr><td>{html.escape(label)}</td><td>{cell(level(baseline, key))}</td>"
        f"<td>{cell(level(peaks, key))}</td><td>{cell(level(settled, key))}</td>"
        f"<td>{cell(bands.get(key if key != 'rss_kb' else 'rss_mb'))}</td></tr>"
        for key, label, _s, _c in METRICS)

    window = thresholds.get("window") or {}
    window_html = ", ".join(f"{html.escape(str(k))}={html.escape(str(v))}"
                            for k, v in window.items())
    failures = (report.get("failures") or [])[:20]
    fail_html = ("<ul class='fails'>" + "".join(f"<li>{html.escape(m)}</li>" for m in failures)
                 + "</ul>") if failures else ""

    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{html.escape(title)}</title>
<style>
:root {{ color-scheme: dark; }}
body {{ margin:0; padding:32px; background:#020617; color:#e2e8f0;
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }}
main {{ max-width:820px; margin:0 auto; }}
h1 {{ font-size:24px; margin:0 0 4px; }}
h2 {{ font-size:17px; margin:32px 0 10px; }}
h3 {{ font-size:14px; margin:0 0 8px; font-weight:600; }}
.unit {{ color:#94a3b8; font-weight:400; }}
.badge {{ display:inline-block; padding:3px 10px; border-radius:999px; font-size:12px;
  font-weight:600; letter-spacing:.02em; }}
.badge.pass {{ background:#064e3b; color:#6ee7b7; }}
.badge.fail {{ background:#4c0519; color:#fda4af; }}
.meta {{ color:#94a3b8; font-size:13px; margin:8px 0 0; }}
table {{ width:100%; border-collapse:collapse; font-size:13px; margin:0 0 8px; }}
th,td {{ text-align:left; padding:7px 10px; border-bottom:1px solid #1e293b; }}
th {{ color:#94a3b8; font-weight:600; }}
tr.bad td {{ color:#fda4af; }}
.chart {{ background:#0f172a; border:1px solid #1e293b; border-radius:10px;
  padding:12px 14px; margin:0 0 14px; }}
.chart svg {{ width:100%; height:auto; display:block; }}
.chart.empty p {{ color:#94a3b8; font-size:13px; margin:0; }}
.tick {{ fill:#64748b; font-size:10px; }}
.legend {{ display:flex; flex-wrap:wrap; gap:14px; color:#94a3b8; font-size:12px;
  margin:0 0 18px; }}
.legend span::before {{ content:""; display:inline-block; width:18px; height:0;
  border-top:2px dashed currentColor; margin-right:6px; vertical-align:middle; }}
.legend .measured {{ color:#e2e8f0; }} .legend .limit {{ color:#f59e0b; }}
.legend .band {{ color:#f43f5e; }} .legend .base {{ color:#64748b; }}
.fails li {{ color:#fda4af; font-size:13px; }}
code {{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; }}
</style></head><body><main>
<h1>{html.escape(title)}</h1>
<p><span class="badge {'pass' if ok else 'fail'}">{'PASS' if ok else 'FAIL'}</span>
<span class="badge {'pass' if growth_ok else 'fail'}">growth
{'within limits' if growth_ok else 'exceeded'}</span></p>
<p class="meta">{report.get('assertions', 0)} assertions,
{len(report.get('failures') or [])} failures &middot; {len(samples)} samples
{f'over {span:.0f}s' if span else ''} &middot; trends measured per {unit}
{(' &middot; window: ' + window_html) if window_html else ''}</p>
<h2>Measured growth vs configured limits</h2>
<table><thead><tr><th>metric</th><th>measured /{unit}</th><th>limit /{unit}</th>
<th>overshoot</th><th>% of limit</th><th>status</th></tr></thead>
<tbody>{table_rows or '<tr><td colspan="6">No slope limits recorded.</td></tr>'}</tbody></table>
<h2>Resource levels</h2>
<table><thead><tr><th>metric</th><th>baseline</th><th>peak</th><th>settled</th>
<th>band (+/-)</th></tr></thead><tbody>{res_rows}</tbody></table>
<h2>Over time</h2>
<div class="legend"><span class="measured">measured trend</span>
<span class="limit">configured slope limit</span>
<span class="band">band ceiling (baseline + band)</span>
<span class="base">baseline</span></div>
{''.join(charts)}
{('<h2>Failures</h2>' + fail_html) if fail_html else ''}
<p class="meta">Source: <code>{html.escape(str(run['report_path']))}</code>.
Limits configurable via <code>GROWTH_*_SLOPE_PER_MIN</code> /
<code>_PER_HOUR</code>, <code>GROWTH_*_BAND</code>,
<code>GROWTH_SLOPE_TOLERANCE</code>.</p>
</main></body></html>
"""
    return page, markdown


def main() -> int:
    ap = argparse.ArgumentParser(description="Render an HTML/Markdown growth report.")
    ap.add_argument("target", help="run directory or path to report.json")
    ap.add_argument("--out-html", default=None)
    ap.add_argument("--out-md", default=None)
    ap.add_argument("--title", default=None)
    args = ap.parse_args()

    run = load_run(Path(args.target))
    title = args.title or f"Export resource growth - {run['dir'].name}"
    page, markdown = build(run, title)
    out_html = Path(args.out_html) if args.out_html else run["dir"] / "growth-report.html"
    out_md = Path(args.out_md) if args.out_md else run["dir"] / "growth-report.md"
    out_html.parent.mkdir(parents=True, exist_ok=True)
    out_md.parent.mkdir(parents=True, exist_ok=True)
    out_html.write_text(page)
    out_md.write_text(markdown)
    print(f"wrote {out_html}\nwrote {out_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
