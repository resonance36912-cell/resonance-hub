/**
 * Lightweight "visual" snapshot of the `/checkout/success` CTA row.
 *
 * We serialize `computeCheckoutSuccessCtas` output into the same HTML
 * fragment the route renders (gradient button vs bordered outline,
 * external anchor vs internal AppLink target). Any future regression
 * that reintroduces a duplicate button — or silently reorders / relabels
 * the row — will diff the stored snapshot and fail CI.
 *
 * Runs as `bun test scripts/lib/checkout-success-ctas.snapshot.test.ts`.
 * Update intentional changes with `bun test --update-snapshots`.
 */
import { describe, expect, it } from "bun:test";
import {
  computeCheckoutSuccessCtas,
  type CtaSpec,
  type Phase,
} from "../../src/lib/checkout-success-ctas";
import { resolveCheckoutContext } from "../../src/lib/checkout-return";

const ALL_PHASES: readonly Phase[] = [
  "verifying",
  "pending",
  "succeeded",
  "skip",
  "failed",
  "cancelled",
  "refunded",
];

const contexts = {
  pass: resolveCheckoutContext({ sku: "all_access:creator_pass:monthly" }),
  pack: resolveCheckoutContext({ pack: "epublisher_starter_pack" }),
} as const;

function renderCta(cta: CtaSpec): string {
  const cls =
    cta.variant === "gradient"
      ? "btn-gradient"
      : "btn-outline";
  if (cta.target.kind === "external") {
    return `<a class="${cls}" href="${cta.target.href}">${cta.label}</a>`;
  }
  const hash = cta.target.hash ? `#${cta.target.hash}` : "";
  return `<AppLink class="${cls}" to="${cta.target.to}${hash}">${cta.label}</AppLink>`;
}

function renderRow(phase: Phase, kind: keyof typeof contexts): string {
  const ctas = computeCheckoutSuccessCtas({ phase, ctx: contexts[kind] });
  return [
    `<!-- phase=${phase} kind=${kind} count=${ctas.length} -->`,
    `<div class="cta-row">`,
    ...ctas.map((c) => `  ${renderCta(c)}`),
    `</div>`,
  ].join("\n");
}

describe("checkout success CTA row snapshots", () => {
  for (const kind of ["pass", "pack"] as const) {
    for (const phase of ALL_PHASES) {
      it(`${kind} · ${phase}`, () => {
        expect(renderRow(phase, kind)).toMatchSnapshot();
      });
    }
  }
});
