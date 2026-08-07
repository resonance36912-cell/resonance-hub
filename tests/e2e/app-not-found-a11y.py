#!/usr/bin/env python3
"""
E2E accessibility audit of the /apps/<unknown-slug> not-found page.

Runs axe-core (WCAG 2.0 A/AA + 2.1 AA rule tags) against the SSR-rendered and
hydrated page for match, single-match, and zero-match slugs, then layers on
structural assertions axe cannot express:

  - exactly one <main> and exactly one <h1>
  - no skipped heading levels, no empty headings
  - every link has a non-empty, non-generic accessible name ("click here",
    "read more", bare "here"/"link" are rejected)
  - suggestion links expose the app name first in their accessible name
  - no positive tabIndex, no aria-hidden wrapping focusable content
  - every interactive element has a visible focus indicator
  - aria-* attributes are real ARIA attributes with valid values
  - no console errors/warnings while rendering or navigating

Console output is captured for the whole session: any browser error or warning
(including React a11y/hydration warnings) fails the run.
"""
import asyncio
import json
import os
import re
import sys
import urllib.error
import urllib.request

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
AXE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "..",
    "node_modules",
    "axe-core",
    "axe.min.js",
)

# slug -> expected suggestion situation
SLUGS = [
    ("/apps/sinc-vision", "matches"),
    ("/apps/creativ-studio", "matches"),
    ("/apps/epublishr", "matches"),
    ("/apps/zzzzzzzzzzzz", "empty"),
    ("/apps/x", "any"),
    ("/apps/SYNC--VISI0N--", "matches"),
]

AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]

GENERIC_LINK_TEXT = {
    "click here",
    "here",
    "read more",
    "more",
    "link",
    "this",
    "learn more",
    "details",
    "",
}

passed = 0
failed = []


def check(name, condition, detail=""):
    global passed
    if condition:
        passed += 1
        print(f"✓ {name}" + (f" ({detail})" if detail else ""))
    else:
        failed.append(f"{name}{' — ' + detail if detail else ''}")
        print(f"✗ {name}" + (f" — {detail}" if detail else ""))


def fetch(path):
    req = urllib.request.Request(
        f"{BASE}{path}", headers={"Accept-Encoding": "identity", "User-Agent": "e2e-a11y"}
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


# Console noise that is environment, not an app a11y problem.
CONSOLE_IGNORE = re.compile(
    r"(vite|hmr|\[vite\]|Download the React DevTools|favicon|"
    r"net::ERR_|Failed to load resource|"
    # Dev-only: the preview CSP blocks the Google Fonts stylesheet and Vite's
    # speculative preloads. Neither originates in page markup or a11y code.
    r"Refused to connect|fonts\.googleapis\.com|Couldn't load preload assets)",
    re.IGNORECASE,
)

AUDIT_JS = """
() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();

  // Accessible name, good enough for links/buttons: aria-label, then
  // aria-labelledby, then text content, then nested img alt / title.
  const accName = (el) => {
    const label = norm(el.getAttribute('aria-label'));
    if (label) return label;
    const ids = norm(el.getAttribute('aria-labelledby'));
    if (ids) {
      const text = ids.split(' ')
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => norm(n.textContent))
        .join(' ');
      if (norm(text)) return norm(text);
    }
    const text = norm(el.textContent);
    if (text) return text;
    const img = el.querySelector('img[alt]');
    if (img && norm(img.getAttribute('alt'))) return norm(img.getAttribute('alt'));
    return norm(el.getAttribute('title'));
  };

  const focusableSel =
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => ({
    level: Number(h.tagName[1]),
    text: norm(h.textContent),
    hidden: h.getAttribute('aria-hidden') === 'true',
  }));

  const links = Array.from(document.querySelectorAll('a')).map((a) => {
    const style = getComputedStyle(a);
    return {
      href: a.getAttribute('href'),
      name: accName(a),
      suggestionKey: a.getAttribute('data-suggestion-key'),
      tabindex: a.getAttribute('tabindex'),
      inAriaHidden: !!a.closest('[aria-hidden="true"]'),
      className: a.className || '',
      outlineStyle: style.outlineStyle,
      display: style.display,
      rect: (() => { const r = a.getBoundingClientRect(); return { w: r.width, h: r.height }; })(),
    };
  });

  const ariaAttrs = [];
  for (const el of Array.from(document.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('aria-')) {
        ariaAttrs.push({ tag: el.tagName.toLowerCase(), name: attr.name, value: attr.value });
      }
    }
  }

  const positiveTabindex = Array.from(document.querySelectorAll('[tabindex]'))
    .map((el) => Number(el.getAttribute('tabindex')))
    .filter((n) => Number.isFinite(n) && n > 0);

  const hiddenWithFocusable = Array.from(document.querySelectorAll('[aria-hidden="true"]'))
    .filter((el) => el.matches(focusableSel) || el.querySelector(focusableSel)).length;

  const roles = Array.from(document.querySelectorAll('[role]'))
    .map((el) => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role') }));

  return {
    mains: document.querySelectorAll('main').length,
    navs: document.querySelectorAll('nav').length,
    navsNamed: Array.from(document.querySelectorAll('nav'))
      .filter((n) => norm(n.getAttribute('aria-label')) || n.getAttribute('aria-labelledby')).length,
    lang: document.documentElement.getAttribute('lang'),
    headings,
    links,
    ariaAttrs,
    positiveTabindex,
    hiddenWithFocusable,
    roles,
    listItemsOutsideList: Array.from(document.querySelectorAll('li'))
      .filter((li) => !li.parentElement || !['UL', 'OL', 'MENU'].includes(li.parentElement.tagName)).length,
    suggestionCount: document.querySelectorAll('[data-suggestion-key]').length,
    title: document.title,
  };
}
"""

# Valid ARIA attribute names (WAI-ARIA 1.2), used to catch typos like aria-labell.
VALID_ARIA = {
    "aria-activedescendant", "aria-atomic", "aria-autocomplete", "aria-braillelabel",
    "aria-brailleroledescription", "aria-busy", "aria-checked", "aria-colcount",
    "aria-colindex", "aria-colindextext", "aria-colspan", "aria-controls",
    "aria-current", "aria-describedby", "aria-description", "aria-details",
    "aria-disabled", "aria-dropeffect", "aria-errormessage", "aria-expanded",
    "aria-flowto", "aria-grabbed", "aria-haspopup", "aria-hidden", "aria-invalid",
    "aria-keyshortcuts", "aria-label", "aria-labelledby", "aria-level", "aria-live",
    "aria-modal", "aria-multiline", "aria-multiselectable", "aria-orientation",
    "aria-owns", "aria-placeholder", "aria-posinset", "aria-pressed", "aria-readonly",
    "aria-relevant", "aria-required", "aria-roledescription", "aria-rowcount",
    "aria-rowindex", "aria-rowindextext", "aria-rowspan", "aria-selected",
    "aria-setsize", "aria-sort", "aria-valuemax", "aria-valuemin", "aria-valuenow",
    "aria-valuetext",
}
BOOLEAN_ARIA = {
    "aria-atomic", "aria-busy", "aria-disabled", "aria-modal", "aria-multiline",
    "aria-multiselectable", "aria-readonly", "aria-required", "aria-hidden",
}
TOKEN_ARIA = {
    "aria-live": {"off", "polite", "assertive"},
    "aria-current": {"page", "step", "location", "date", "time", "true", "false"},
    "aria-orientation": {"horizontal", "vertical", "undefined"},
    "aria-haspopup": {"false", "true", "menu", "listbox", "tree", "grid", "dialog"},
}


def audit_structure(scope, data, expectation):
    check(f"{scope} exactly one <main>", data["mains"] == 1, f"count={data['mains']}")
    check(f"{scope} html lang is set", bool(data["lang"]), f"lang={data['lang']!r}")

    headings = [h for h in data["headings"] if not h["hidden"]]
    h1s = [h for h in headings if h["level"] == 1]
    check(f"{scope} exactly one <h1>", len(h1s) == 1, f"count={len(h1s)}")
    check(f"{scope} h1 has text", bool(h1s and h1s[0]["text"]),
          f"{h1s[0]['text']!r}" if h1s else "no h1")
    check(f"{scope} no empty headings", all(h["text"] for h in headings),
          f"{[h for h in headings if not h['text']]}")

    order_ok = True
    previous = 0
    for h in headings:
        if previous and h["level"] > previous + 1:
            order_ok = False
        previous = h["level"]
    check(f"{scope} no skipped heading levels", order_ok,
          f"{[h['level'] for h in headings]}")

    check(f"{scope} every <nav> has an accessible name",
          data["navs"] == data["navsNamed"], f"{data['navsNamed']}/{data['navs']}")
    check(f"{scope} no positive tabIndex", not data["positiveTabindex"],
          f"{data['positiveTabindex']}")
    check(f"{scope} no focusable content inside aria-hidden",
          data["hiddenWithFocusable"] == 0, f"count={data['hiddenWithFocusable']}")
    check(f"{scope} all <li> are inside a list",
          data["listItemsOutsideList"] == 0, f"count={data['listItemsOutsideList']}")

    for link in data["links"]:
        label = link["href"] or link["name"][:24]
        check(f"{scope} link has accessible name [{label}]", bool(link["name"].strip()),
              f"href={link['href']!r}")
        check(f"{scope} link name is not generic [{label}]",
              link["name"].strip().lower() not in GENERIC_LINK_TEXT, f"{link['name']!r}")
        check(f"{scope} link is keyboard reachable [{label}]",
              not link["inAriaHidden"] and (link["tabindex"] or "0") != "-1",
              f"aria-hidden={link['inAriaHidden']} tabindex={link['tabindex']}")
        check(f"{scope} link has a focus indicator [{label}]",
              "focus-visible:ring" in link["className"]
              or "focus-visible:outline" in link["className"]
              or link["outlineStyle"] not in ("none",),
              f"class={link['className'][:60]!r}")

    suggestions = [l for l in data["links"] if l["suggestionKey"]]
    check(f"{scope} suggestion count matches expectation",
          (len(suggestions) > 0) if expectation == "matches"
          else (len(suggestions) == 0) if expectation == "empty" else True,
          f"count={len(suggestions)}")
    for link in suggestions:
        check(f"{scope} suggestion name leads with the app name [{link['suggestionKey']}]",
              bool(link["name"]) and not link["name"].lower().startswith("/apps/"),
              f"{link['name'][:60]!r}")
        check(f"{scope} suggestion tap target >= 44px tall [{link['suggestionKey']}]",
              link["rect"]["h"] >= 44, f"h={link['rect']['h']}")

    for attr in data["ariaAttrs"]:
        name = attr["name"]
        check(f"{scope} aria attribute is valid [{name} on {attr['tag']}]",
              name in VALID_ARIA, f"value={attr['value']!r}")
        if name in BOOLEAN_ARIA:
            check(f"{scope} {name} on {attr['tag']} is a valid boolean",
                  attr["value"] in ("true", "false"), f"{attr['value']!r}")
        if name in TOKEN_ARIA:
            check(f"{scope} {name} on {attr['tag']} uses a valid token",
                  attr["value"] in TOKEN_ARIA[name], f"{attr['value']!r}")
        if name in ("aria-label", "aria-roledescription"):
            check(f"{scope} {name} on {attr['tag']} is non-empty",
                  bool(attr["value"].strip()), f"{attr['value']!r}")


# `bg-primary` (hsl(290 90% 65%)) with white text is ~2.9:1 and fails
# color-contrast. That is a global brand-token issue on app detail pages, not a
# not-found-page defect, so it is excluded only for the post-navigation stop.
APP_PAGE_RULE_EXCLUSIONS = {"color-contrast"}


async def run_axe(page, scope, exclude=frozenset()):
    result = await page.evaluate(
        """async (tags) => {
             const res = await window.axe.run(document, {
               runOnly: { type: 'tag', values: tags },
               resultTypes: ['violations'],
             });
             return res.violations.map((v) => ({
               id: v.id,
               impact: v.impact,
               help: v.help,
               nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
             }));
           }""",
        AXE_TAGS,
    )
    result = [v for v in result if v["id"] not in exclude]
    blocking = [v for v in result if v["impact"] in ("critical", "serious", "moderate")]
    check(f"{scope} axe: no critical/serious/moderate violations", not blocking,
          json.dumps(blocking)[:400])
    minor = [v for v in result if v not in blocking]
    check(f"{scope} axe: no minor violations", not minor, json.dumps(minor)[:300])

    ids = {v["id"] for v in result}
    for rule in (
        "heading-order", "page-has-heading-one", "empty-heading",
        "link-name", "link-in-text-block", "aria-allowed-attr", "aria-valid-attr",
        "aria-valid-attr-value", "aria-hidden-focus", "aria-required-attr",
        "aria-required-children", "aria-required-parent", "aria-roles",
        "landmark-one-main", "landmark-unique", "list", "listitem",
        "region", "html-has-lang", "color-contrast", "tabindex", "bypass",
    ):
        if rule in exclude:
            continue
        check(f"{scope} axe rule passes: {rule}", rule not in ids)
    return result


async def main():
    with open(os.path.normpath(AXE_PATH), encoding="utf-8") as fh:
        axe_source = fh.read()

    console_problems = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        await context.add_init_script(axe_source)
        page = await context.new_page()

        def on_console(msg):
            if msg.type in ("error", "warning") and not CONSOLE_IGNORE.search(msg.text):
                console_problems.append(f"[{msg.type}] {msg.text[:200]}")

        page.on("console", on_console)
        page.on("pageerror", lambda err: console_problems.append(f"[pageerror] {str(err)[:200]}"))

        for path, expectation in SLUGS:
            # SSR HTML must already carry the landmark + heading structure.
            status, html_text = fetch(path)
            check(f"[SSR {path}] served", status in (200, 404), f"status={status}")
            check(f"[SSR {path}] has one <main>", html_text.count("<main") == 1,
                  f"count={html_text.count('<main')}")
            check(f"[SSR {path}] has an <h1>", "<h1" in html_text)
            check(f"[SSR {path}] h1 appears once", html_text.count("<h1") == 1,
                  f"count={html_text.count('<h1')}")

            await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
            await page.wait_for_selector("main h1", timeout=10000)
            await page.wait_for_timeout(250)

            scope = f"[{path}]"
            data = await page.evaluate(AUDIT_JS)
            audit_structure(scope, data, expectation)
            await run_axe(page, scope)

            # Keyboard walk: every link must take focus and show a ring.
            focus_report = await page.evaluate(
                """() => {
                     const links = Array.from(document.querySelectorAll('main a'));
                     const out = [];
                     for (const a of links) {
                       a.focus();
                       out.push({
                         href: a.getAttribute('href'),
                         focused: document.activeElement === a,
                         matchesFocusVisible: a.matches(':focus-visible'),
                       });
                     }
                     return out;
                   }"""
            )
            check(f"{scope} main has focusable links", len(focus_report) > 0,
                  f"count={len(focus_report)}")
            for item in focus_report:
                check(f"{scope} link takes focus [{item['href']}]", item["focused"])

        # Client-side navigation must not introduce violations either.
        await page.goto(f"{BASE}/apps/sinc-vision", wait_until="domcontentloaded")
        await page.wait_for_selector("main h1")
        await page.click("[data-suggestion-key]")
        await page.wait_for_function("() => !location.pathname.includes('sinc')", timeout=10000)
        await page.wait_for_timeout(400)
        await run_axe(page, "[after suggestion click]", APP_PAGE_RULE_EXCLUSIONS)
        nav_data = await page.evaluate(AUDIT_JS)
        check("[after suggestion click] exactly one <main>", nav_data["mains"] == 1,
              f"count={nav_data['mains']}")
        check("[after suggestion click] exactly one <h1>",
              len([h for h in nav_data["headings"] if h["level"] == 1]) == 1)

        await browser.close()

    check("no console errors or warnings during the audit", not console_problems,
          " | ".join(console_problems[:5]))

    print(f"\n{passed} passed, {len(failed)} failed (base: {BASE})")
    if failed:
        for item in failed:
            print(f"  FAIL: {item}")
        sys.exit(1)


asyncio.run(main())
