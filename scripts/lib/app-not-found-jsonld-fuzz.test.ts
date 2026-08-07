/**
 * Fuzz test: random near-miss slugs must never crash the not-found metadata
 * pipeline, and must produce EITHER no JSON-LD at all or a fully schema-valid
 * ItemList. There is no third outcome.
 *
 * Strategy: deterministically mutate real registry keys and labels (character
 * swaps, deletions, insertions, case flips, separator churn, unicode, padding,
 * absurd lengths) plus fully random junk, then assert the invariant on every
 * generated payload.
 */
import { describe, expect, it } from "bun:test";

import { APP_REGISTRY, type AppKey } from "@/lib/app-registry";
import {
  NOT_FOUND_DESCRIPTION_MAX,
  NOT_FOUND_TITLE_MAX,
  notFoundHead,
  notFoundStructuredData,
} from "@/lib/app-not-found-meta";
import { suggestApps } from "@/lib/app-slug-suggest";
import { SITE_ORIGIN } from "@/lib/app-status-meta";
import { formatIssues, validateItemList } from "./schema-org-validate";

const KEYS = Object.keys(APP_REGISTRY) as AppKey[];

/** Deterministic PRNG so a failure is always reproducible from the seed. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

const SEPARATORS = ["-", "_", " ", ".", "", "--", "__", "  "];
const NOISE = [
  "!",
  "?",
  "%20",
  "<",
  ">",
  "&",
  '"',
  "'",
  "\\",
  "\u0000",
  "\u200b",
  "\u00e9",
  "🙂",
  "–",
  "\t",
  "\n",
];
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789-_ ";

/** One mutation applied to a base string. */
function mutate(base: string, rand: () => number): string {
  const chars = Array.from(base);
  const at = () => Math.floor(rand() * Math.max(1, chars.length));
  switch (Math.floor(rand() * 10)) {
    case 0: // delete a char
      chars.splice(at(), 1);
      return chars.join("");
    case 1: // duplicate a char
      chars.splice(at(), 0, chars[at()] ?? "x");
      return chars.join("");
    case 2: { // transpose neighbours
      const i = at();
      const j = Math.min(chars.length - 1, i + 1);
      [chars[i], chars[j]] = [chars[j]!, chars[i]!];
      return chars.join("");
    }
    case 3: // random letter substitution
      chars[at()] = ALPHABET[Math.floor(rand() * ALPHABET.length)]!;
      return chars.join("");
    case 4: // separator churn
      return base.replace(/[-_ ]/g, SEPARATORS[Math.floor(rand() * SEPARATORS.length)]!);
    case 5: // case flip
      return Array.from(base)
        .map((c) => (rand() > 0.5 ? c.toUpperCase() : c.toLowerCase()))
        .join("");
    case 6: // noise injection
      chars.splice(at(), 0, NOISE[Math.floor(rand() * NOISE.length)]!);
      return chars.join("");
    case 7: // padding
      return `${" ".repeat(Math.floor(rand() * 4))}${base}${SEPARATORS[Math.floor(rand() * SEPARATORS.length)]}`;
    case 8: // truncate to a prefix
      return base.slice(0, Math.max(1, Math.floor(rand() * base.length)));
    default: // absurd repetition
      return base.repeat(1 + Math.floor(rand() * 40));
  }
}

/** Fully random junk slug. */
function junk(rand: () => number): string {
  const len = Math.floor(rand() * 24);
  let out = "";
  for (let i = 0; i < len; i++) {
    out +=
      rand() > 0.85
        ? NOISE[Math.floor(rand() * NOISE.length)]!
        : ALPHABET[Math.floor(rand() * ALPHABET.length)]!;
  }
  return out;
}

/** The corpus: derived near-misses + random junk + pathological edges. */
function corpus(): string[] {
  const rand = rng(0xc0ffee);
  const bases = [
    ...KEYS,
    ...KEYS.map((k) => k.replace(/_/g, "-")),
    ...KEYS.map((k) => APP_REGISTRY[k].label),
    "apps",
    "resonance",
    "studio",
    "vision",
    "publisher",
    "optimizer",
  ];
  const out = new Set<string>();
  for (const base of bases) {
    for (let i = 0; i < 12; i++) out.add(mutate(base, rand));
    // Two-step mutations reach further from the registry.
    for (let i = 0; i < 6; i++) out.add(mutate(mutate(base, rand), rand));
  }
  for (let i = 0; i < 250; i++) out.add(junk(rand));
  for (const edge of [
    "",
    " ",
    "   ",
    "-",
    "_",
    "--__--",
    ".",
    "..",
    "/",
    "//",
    "%",
    "%2e%2e",
    "\u0000",
    "\u200b\u200b",
    "🙂".repeat(50),
    "a".repeat(2000),
    "-".repeat(300),
    "null",
    "undefined",
    "NaN",
    "0",
    "constructor",
    "__proto__",
    "prototype",
    "toString",
  ]) {
    out.add(edge);
  }
  return [...out];
}

const CORPUS = corpus();

describe("not-found JSON-LD fuzz — never crashes", () => {
  it("generates a corpus of near-miss and junk slugs", () => {
    expect(CORPUS.length).toBeGreaterThan(300);
  });

  it("notFoundStructuredData never throws for any slug", () => {
    for (const slug of CORPUS) {
      expect(() => notFoundStructuredData(slug)).not.toThrow();
    }
  });

  it("notFoundHead never throws and is always JSON-serializable", () => {
    for (const slug of CORPUS) {
      let head: ReturnType<typeof notFoundHead> | undefined;
      expect(() => {
        head = notFoundHead(slug);
      }).not.toThrow();
      expect(() => JSON.stringify(head)).not.toThrow();
    }
  });

  it("suggestApps never throws for any slug", () => {
    for (const slug of CORPUS) {
      expect(() => suggestApps(slug)).not.toThrow();
    }
  });
});

describe("not-found JSON-LD fuzz — omitted or schema-valid, nothing in between", () => {
  it("every payload is either null or a valid ItemList", () => {
    const problems: string[] = [];
    let omitted = 0;
    let valid = 0;

    for (const slug of CORPUS) {
      const payload = notFoundStructuredData(slug);
      if (payload === null) {
        omitted += 1;
        // Omission must be consistent: zero suggestions and zero scripts.
        if (suggestApps(slug).length !== 0) {
          problems.push(`${JSON.stringify(slug)}: null payload but has suggestions`);
        }
        if (notFoundHead(slug).scripts.length !== 0) {
          problems.push(`${JSON.stringify(slug)}: null payload but emitted a script tag`);
        }
        continue;
      }
      const issues = validateItemList(payload);
      if (issues.length > 0) {
        problems.push(`${JSON.stringify(slug)}:\n${formatIssues(issues)}`);
      } else {
        valid += 1;
      }
    }

    expect(problems.join("\n---\n")).toBe("");
    // Guard against a vacuous run: the corpus must hit both branches.
    expect(omitted).toBeGreaterThan(0);
    expect(valid).toBeGreaterThan(0);
  });

  it("emitted script tags always contain parseable, valid ItemList JSON", () => {
    for (const slug of CORPUS) {
      const { scripts } = notFoundHead(slug);
      expect(scripts.length).toBeLessThanOrEqual(1);
      if (scripts.length === 0) continue;
      const script = scripts[0]!;
      expect(script.type).toBe("application/ld+json");
      expect(script.children).not.toContain("</script");
      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(script.children);
      }).not.toThrow();
      expect(validateItemList(parsed)).toEqual([]);
    }
  });

  it("item count, positions and URLs stay internally consistent", () => {
    for (const slug of CORPUS) {
      const payload = notFoundStructuredData(slug) as Record<string, unknown> | null;
      if (!payload) continue;
      const items = payload.itemListElement as Array<Record<string, any>>;
      expect(items.length).toBeGreaterThan(0);
      expect(payload.numberOfItems).toBe(items.length);
      expect(items.map((i) => i.position)).toEqual(items.map((_, idx) => idx + 1));
      const urls = items.map((i) => String(i.item.url));
      expect(new Set(urls).size).toBe(urls.length);
      for (const url of urls) {
        expect(url.startsWith(`${SITE_ORIGIN}/apps/`)).toBe(true);
        expect(url).not.toContain(" ");
      }
      // Suggested apps are always real registry entries, never the fuzz slug.
      const keys = urls.map((u) => u.replace(`${SITE_ORIGIN}/apps/`, ""));
      for (const key of keys) expect(KEYS).toContain(key as AppKey);
    }
  });

  it("titles and descriptions stay inside the SEO budgets for fuzzed slugs", () => {
    for (const slug of CORPUS) {
      const { meta } = notFoundHead(slug);
      for (const tag of meta) {
        if ("title" in tag) {
          expect(Array.from(tag.title).length).toBeLessThanOrEqual(NOT_FOUND_TITLE_MAX);
        } else if (tag.name === "description") {
          expect(Array.from(tag.content).length).toBeLessThanOrEqual(
            NOT_FOUND_DESCRIPTION_MAX,
          );
        }
      }
    }
  });

  it("is deterministic — repeated runs produce identical payloads", () => {
    for (const slug of CORPUS) {
      expect(JSON.stringify(notFoundStructuredData(slug))).toBe(
        JSON.stringify(notFoundStructuredData(slug)),
      );
    }
  });
});

describe("not-found JSON-LD fuzz — prototype pollution safety", () => {
  it("dangerous keys behave like ordinary unknown slugs", () => {
    for (const slug of ["__proto__", "constructor", "prototype", "toString", "valueOf"]) {
      const payload = notFoundStructuredData(slug);
      if (payload) expect(validateItemList(payload)).toEqual([]);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });
});
