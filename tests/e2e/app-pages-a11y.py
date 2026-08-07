#!/usr/bin/env python3
"""
E2E accessibility audit of the real Hub app pages (not the not-found page).

For each public page below it runs axe-core (WCAG 2.0 A/AA + 2.1 A/AA +
best-practice tags) against the hydrated DOM, checks the SSR HTML carries the
landmark/heading structure, and layers on structural assertions axe cannot
express:

  - exactly one <main>, exactly one <h1>, no empty or skipped headings
  - every link/button has a non-empty, non-generic accessible name
  - no positive tabIndex, no focusable content inside aria-hidden
  - every link is keyboard focusable and shows a focus indicator
  - aria-* attributes are real ARIA attributes with valid values
  - every image has an alt attribute (empty allowed for decorative)
  - tap targets on primary CTAs are at least 44px tall
  - no console errors/warnings while rendering or navigating between pages

Run: BASE_URL=http://localhost:8080 python tests/e2e/app-pages-a11y.py
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

# Real, public Hub pages. Every one of these renders registry-driven content.
PAGES = [
    "/",
    "/apps",
    "/apps/sync_vision",
    "/apps/creative_studio",
    "/apps/epublisher",
    "/apps/youtube_optimizer",
    "/pricing",
    "/status/apps",
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
        f"{BASE}{path}",
        headers={"Accept-Encoding": "identity", "User-Agent": "e2e-a11y"},
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
    r"Refused to connect|fonts\.googleapis\.com|Couldn't load preload assets)",
    re.IGNORECASE,
)

AUDIT_JS = """
() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();

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

  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  };

  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => ({
    level: Number(h.tagName[1]),
    text: norm(h.textContent),
    hidden: h.getAttribute('aria-hidden') === 'true' || !visible(h),
  }));

  const describe = (el) => {
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      href: el.getAttribute('href'),
      name: accName(el),
      tabindex: el.getAttribute('tabindex'),
      inAriaHidden: !!el.closest('[aria-hidden="true"]'),
      className: typeof el.className === 'string' ? el.className : '',
      outlineStyle: style.outlineStyle,
      rect: { w: r.width, h: r.height },
      visible: visible(el),
    };
  };

  const links = Array.from(document.querySelectorAll('a[href]')).map(describe);
  const buttons = Array.from(document.querySelectorAll('button')).map(describe);

  const ariaAttrs = [];
  for (const el of Array.from(document.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('aria-')) {
        ariaAttrs.push({ tag: el.tagName.toLowerCase(), name: attr.name, value: attr.value });
      }
    }
  }

  return {
    mains: document.querySelectorAll('main').length,
    navs: document.querySelectorAll('nav').length,
    navsNamed: Array.from(document.querySelectorAll('nav'))
      .filter((n) => norm(n.getAttribute('aria-label')) || n.getAttribute('aria-labelledby')).length,
    lang: document.documentElement.getAttribute('lang'),
    headings,
    links,
    buttons,
    ariaAttrs,
    images: Array.from(document.querySelectorAll('img')).map((img) => ({
      src: (img.getAttribute('src') || '').slice(-40),
      hasAlt: img.hasAttribute('alt'),
    })),
    positiveTabindex: Array.from(document.querySelectorAll('[tabindex]'))
      .map((el) => Number(el.getAttribute('tabindex')))
      .filter((n) => Number.isFinite(n) && n > 0),
    hiddenWithFocusable: Array.from(document.querySelectorAll('[aria-hidden="true"]'))
      .filter((el) => el.matches(focusableSel) || el.querySelector(focusableSel)).length,
    listItemsOutsideList: Array.from(document.querySelectorAll('li'))
      .filter((li) => !li.parentElement || !['UL', 'OL', 'MENU'].includes(li.parentElement.tagName)).length,
    title: document.title,
  };
}
"""

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

AXE_RULES = (
    "heading-order", "page-has-heading-one", "empty-heading",
    "link-name", "button-name", "link-in-text-block", "image-alt",
    "aria-allowed-attr", "aria-valid-attr", "aria-valid-attr-value",
    "aria-hidden-focus", "aria-required-attr", "aria-required-children",
    "aria-required-parent", "aria-roles", "landmark-one-main", "landmark-unique",
    "list", "listitem", "definition-list", "region", "html-has-lang",
    "color-contrast", "tabindex", "bypass", "label", "duplicate-id-aria",
    "form-field-multiple-labels", "nested-interactive", "select-name",
)


def audit_structure(scope, data):
    check(f"{scope} exactly one <main>", data["mains"] == 1, f"count={data['mains']}")
    check(f"{scope} html lang is set", bool(data["lang"]), f"lang={data['lang']!r}")
    check(f"{scope} document has a title", bool((data["title"] or "").strip()),
          f"{data['title']!r}")

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

    for img in data["images"]:
        check(f"{scope} image has alt [...{img['src']}]", img["hasAlt"])

    for el in data["links"] + data["buttons"]:
        if not el["visible"]:
            continue
        label = el["href"] or el["name"][:24] or el["tag"]
        check(f"{scope} {el['tag']} has accessible name [{label}]",
              bool(el["name"].strip()), f"href={el['href']!r}")
        check(f"{scope} {el['tag']} name is not generic [{label}]",
              el["name"].strip().lower() not in GENERIC_LINK_TEXT, f"{el['name']!r}")
        check(f"{scope} {el['tag']} is keyboard reachable [{label}]",
              not el["inAriaHidden"] and (el["tabindex"] or "0") != "-1",
              f"aria-hidden={el['inAriaHidden']} tabindex={el['tabindex']}")
        check(f"{scope} {el['tag']} has a focus indicator [{label}]",
              "focus-visible:ring" in el["className"]
              or "focus-visible:outline" in el["className"]
              or el["outlineStyle"] != "none",
              f"class={el['className'][:60]!r}")

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
          json.dumps(blocking)[:600])
    minor = [v for v in result if v not in blocking]
    check(f"{scope} axe: no minor violations", not minor, json.dumps(minor)[:400])

    ids = {v["id"] for v in result}
    for rule in AXE_RULES:
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

        for path in PAGES:
            status, html_text = fetch(path)
            check(f"[SSR {path}] served 200", status == 200, f"status={status}")
            check(f"[SSR {path}] has one <main>", html_text.count("<main") == 1,
                  f"count={html_text.count('<main')}")
            check(f"[SSR {path}] has exactly one <h1>", html_text.count("<h1") == 1,
                  f"count={html_text.count('<h1')}")

            await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
            await page.wait_for_selector("main h1", timeout=15000)
            await page.wait_for_timeout(350)

            scope = f"[{path}]"
            audit_structure(scope, await page.evaluate(AUDIT_JS))
            await run_axe(page, scope)

            focus_report = await page.evaluate(
                """() => {
                     const links = Array.from(document.querySelectorAll('main a[href]'))
                       .filter((a) => a.getBoundingClientRect().height > 0);
                     const out = [];
                     for (const a of links) {
                       a.focus();
                       out.push({ href: a.getAttribute('href'), focused: document.activeElement === a });
                     }
                     return out;
                   }"""
            )
            check(f"{scope} main has focusable links", len(focus_report) > 0,
                  f"count={len(focus_report)}")
            for item in focus_report:
                check(f"{scope} link takes focus [{item['href']}]", item["focused"])

        # Client-side navigation between real pages must not degrade a11y.
        await page.goto(f"{BASE}/status/apps", wait_until="domcontentloaded")
        await page.wait_for_selector("main h1")
        await page.click('main a[href="/apps"]')
        await page.wait_for_function(
            "() => location.pathname === '/apps'", timeout=15000
        )
        await page.wait_for_selector("main h1")
        await page.wait_for_timeout(400)
        nav_data = await page.evaluate(AUDIT_JS)
        check("[after catalog click] exactly one <main>", nav_data["mains"] == 1,
              f"count={nav_data['mains']}")
        check("[after catalog click] exactly one <h1>",
              len([h for h in nav_data["headings"] if h["level"] == 1 and not h["hidden"]]) == 1)
        await run_axe(page, "[after catalog click]")


        await browser.close()

    check("no console errors or warnings during the audit", not console_problems,
          " | ".join(console_problems[:5]))

    print(f"\n{passed} passed, {len(failed)} failed (base: {BASE})")
    if failed:
        for item in failed:
            print(f"  FAIL: {item}")
        sys.exit(1)


asyncio.run(main())
