"""
Turn a growth `report.json` into GitHub CI feedback:

  * workflow annotations (`::error` / `::notice`) so failing metrics show up as
    check annotations on the run, one line per metric over its limit;
  * a compact measured-vs-limit diff table written to a markdown file, ready to
    be posted as a sticky PR comment;
  * an exit code: 1 when any configured growth slope was exceeded, else 0.

The annotation is attached to the thresholds module so the check surfaces next
to the file that owns the limits (override with --annotate-file).

Usage:
  python3 tests/e2e/harness/growth_annotate.py <run-dir-or-report.json> \
      --label "Keep-alive soak" \
      --comment-out /tmp/browser/<run>/growth-comment.md \
      [--artifact "export-keepalive-soak"] [--run-url "https://..."] \
      [--annotate-file tests/e2e/harness/growth_thresholds.py]

Exit code is advisory: the underlying test already fails on its own
assertions. Pass --always-zero in workflows that only want the comment.
"""
import argparse
import json
import sys
from pathlib import Path

MARKER_PREFIX = "growth-report"


def load_report(target: Path) -> tuple[dict, Path]:
    path = target / "report.json" if target.is_dir() else target
    if not path.exists():
        raise SystemExit(f"no report.json at {target}")
    return json.loads(path.read_text()), path


def rows_of(report: dict) -> tuple[list, str, bool]:
    thresholds = report.get("growth_thresholds") or {}
    rows = [r for r in thresholds.get("rows", []) if isinstance(r, dict)]
    unit = thresholds.get("unit") or ("min" if "slopes_per_min" in report else "hour")
    return rows, unit, bool(thresholds.get("ok", True))


def fmt(value, spec: str = "+.3f") -> str:
    return "-" if value is None else format(value, spec)


def diff_table(rows: list, unit: str) -> list[str]:
    if not rows:
        return ["_No slope limits were recorded for this run._"]
    out = [f"| metric | measured /{unit} | limit /{unit} | overshoot | % of limit | status |",
           "| --- | --- | --- | --- | --- | --- |"]
    for r in sorted(rows, key=lambda r: (r.get("ok", True), r.get("metric", ""))):
        pct = r.get("percent_of_limit")
        out.append(
            f"| `{r.get('metric')}` | {fmt(r.get('measured'), '.3f')} | "
            f"{fmt(r.get('limit'), '.3f')} | {fmt(r.get('overshoot'))} | "
            f"{'-' if pct is None else f'{pct:.1f}%'} | "
            f"{'OK' if r.get('ok', True) else '**EXCEEDS LIMIT**'} |")
    return out


def annotations(rows: list, unit: str, label: str, file_hint: str) -> list[str]:
    lines = []
    for r in rows:
        if r.get("ok", True):
            continue
        metric = r.get("metric")
        pct = r.get("percent_of_limit")
        msg = (f"{label}: {metric} grew {fmt(r.get('measured'), '.3f')}/{unit}, "
               f"limit {fmt(r.get('limit'), '.3f')}/{unit} "
               f"(over by {fmt(r.get('overshoot'))}/{unit}"
               + (f", {pct:.1f}% of limit" if pct is not None else "") + "). "
               f"Raise the limit via GROWTH_{str(metric).upper()}_SLOPE_PER_"
               f"{unit.upper()} only if the growth is understood.")
        lines.append(f"::error file={file_hint},title=Growth threshold exceeded"
                     f" ({metric})::{msg}")
    return lines


def build_comment(label: str, report: dict, rows: list, unit: str, growth_ok: bool,
                  artifact: str | None, run_url: str | None, slug: str) -> str:
    failures = report.get("failures") or []
    body = [f"<!-- {MARKER_PREFIX}:{slug} -->",
            f"### {label} — resource growth {'within limits' if growth_ok else 'EXCEEDED'}",
            "",
            f"{report.get('assertions', 0)} assertions, {len(failures)} failures · "
            f"{report.get('samples', 0)} samples · trends measured per {unit}",
            ""]
    body += diff_table(rows, unit)
    body.append("")
    if not growth_ok:
        worst = [r for r in rows if not r.get("ok", True)]
        body += ["**What this means:** one or more resources (fds, sockets, threads, RSS) "
                 "trended upward faster than the configured budget over the sampled window, "
                 "which is the signature of a leak on the export fault/retry path.",
                 "",
                 "**Next steps:**",
                 f"- Inspect the charted trend in the `growth-report.html` artifact"
                 + (f" (`{artifact}`)" if artifact else "") + ".",
                 "- Compare `baseline` → `peak` → `settled` in `report.json`; a settled value "
                 "back near baseline points at slow release rather than an unbounded leak.",
                 "- If the new trend is expected, adjust the limit explicitly via "
                 + ", ".join(f"`GROWTH_{str(r.get('metric')).upper()}_SLOPE_PER_{unit.upper()}`"
                             for r in worst) + " (or `GROWTH_SLOPE_TOLERANCE`).",
                 ""]
    growth_failures = [f for f in failures if "[trend]" in f]
    if growth_failures:
        body += ["<details><summary>Threshold assertion messages</summary>", ""]
        body += [f"- {f}" for f in growth_failures[:20]]
        body += ["", "</details>", ""]
    if run_url:
        body.append(f"[View the full workflow run]({run_url})")
    return "\n".join(body).rstrip() + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="Annotate + comment growth threshold results.")
    ap.add_argument("target", help="run directory or path to report.json")
    ap.add_argument("--label", default="Export growth")
    ap.add_argument("--comment-out", default=None)
    ap.add_argument("--artifact", default=None)
    ap.add_argument("--run-url", default=None)
    ap.add_argument("--annotate-file", default="tests/e2e/harness/growth_thresholds.py")
    ap.add_argument("--slug", default=None)
    ap.add_argument("--always-zero", action="store_true")
    args = ap.parse_args()

    target = Path(args.target)
    report, report_path = load_report(target)
    rows, unit, growth_ok = rows_of(report)
    slug = args.slug or report_path.parent.name

    for line in annotations(rows, unit, args.label, args.annotate_file):
        print(line)
    if growth_ok:
        print(f"::notice title=Growth within limits::{args.label}: all "
              f"{len(rows)} growth slopes are inside their configured limits.")

    comment = build_comment(args.label, report, rows, unit, growth_ok,
                            args.artifact, args.run_url, slug)
    out = Path(args.comment_out) if args.comment_out else report_path.parent / "growth-comment.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(comment)
    print(f"wrote {out}")
    print(f"growth_ok={'true' if growth_ok else 'false'}")
    return 0 if (growth_ok or args.always_zero) else 1


if __name__ == "__main__":
    sys.exit(main())
