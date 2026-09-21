# Discernment Contract

Cross-app contract for paid content generation in the Resonance App Suite.

Owner: Resonance Hub (`src/lib/discernment.ts`, `src/lib/discernment-guard.ts`).
Consumers: every spoke that generates paid output — ePublisher, Creative
Studio, Sync Vision, YouTube Optimizer.

## Why

Paid outputs in the suite must be honest. The Discernment Lens prevents:

- fabricated analytics, testimonials, or "results"
- unsupported medical / legal / financial claims
- manipulative or predatory targeting
- generation from briefs that lack enough context to be reliable
- outputs that hide where the underlying data came from

Every spoke enforces the same rules by importing the shared helpers from the
Hub package, so behavior cannot drift app-to-app.

## Surface

From `@/lib/discernment`:

- `verifyBriefDiscernment(input: BriefDiscernmentInput): DiscernmentEvaluation`
- `type DataProvenance = "verified_source" | "user_provided" | "public_estimate" | "insufficient"`

From `@/lib/discernment-guard`:

- `assertBriefDiscernment(input)` — throws `DiscernmentBlockedError` on fail,
  returns the full evaluation on pass.
- `formatProvenanceLabel(provenance)` — returns `{ short, long, tone }` for
  badge UI on every paid output.
- `class DiscernmentBlockedError extends Error` with `code = "DISCERNMENT_BLOCKED"`
  and `.evaluation`.

## Required call site (spokes)

Every server function that produces a paid generation MUST follow this shape:

```ts
// src/lib/generate-manuscript.functions.ts  (spoke: ePublisher)
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertBriefDiscernment,
  formatProvenanceLabel,
  DiscernmentBlockedError,
} from "@/lib/discernment-guard";

export const generateManuscript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ManuscriptBriefSchema.parse(data))
  .handler(async ({ data, context }) => {
    try {
      const evaluation = assertBriefDiscernment({
        rawInputLength: data.brief.length,
        hasSubstantialContext: data.hasContext,
        hasClearSource: Boolean(data.sourceUrl),
        includesUnsupportedClaims: data.flags.unsupportedClaims,
        includesFakeAnalytics: data.flags.fakeAnalytics,
        includesMedicalOrLegalClaims: data.flags.medicalOrLegal,
        includesManipulativeTargeting: data.flags.manipulative,
        userCanEditBeforeGeneration: true,
      });

      const output = await runGeneration(data, context);

      return {
        output,
        provenance: formatProvenanceLabel(evaluation.dataProvenance),
        warnings: evaluation.warnings,
        confidenceScore: evaluation.confidenceScore,
      };
    } catch (err) {
      if (err instanceof DiscernmentBlockedError) {
        return {
          blocked: true,
          reason: err.message,
          evaluation: err.evaluation,
        };
      }
      throw err;
    }
  });
```

## Required UI contract

Every paid output surface MUST render the provenance label returned from the
server function. Use `formatProvenanceLabel().short` as the visible badge text
and `.long` in a tooltip or in the exported PDF/DOCX footer.

- `verified_source` → positive tone (e.g. green)
- `user_provided` → neutral tone
- `public_estimate` → caution tone
- `insufficient` → blocked tone (do not render the output)

## CI enforcement (lint rules)

Each spoke MUST include `scripts/verify-discernment-usage.ts` (copied from
the Hub) and wire `verify:discernment-usage` into its `prebuild` step.

The linter scans for files matching:

- `src/**/*generate*.functions.ts`
- `src/**/*generate*.server.ts`
- `src/routes/api/**/*generate*.ts`

and enforces 5 rules per file:

1. **missing-guard-import** — must `import` from `@/lib/discernment-guard`.
2. **missing-assert-call** — must call `assertBriefDiscernment(...)`.
3. **missing-provenance-label** — must call `formatProvenanceLabel(...)`.
4. **unhandled-blocked-error** — must `catch` `DiscernmentBlockedError`, OR
   declare `// discernment:bubble-up` if the error is intentionally
   propagated to the caller.
5. **no-direct-verify** — must not call `verifyBriefDiscernment` directly
   (it bypasses the throw-on-fail guard).

A file can opt out only by adding BOTH marker comments:

```ts
// discernment:skip
// discernment:reason: <why this route does not produce paid output>
```

`// discernment:skip` without a paired reason fails the lint
(`skip-requires-reason`).

The Hub itself hosts no generation routes, so the linter no-ops there —
but the script is identical across the suite so the contract cannot drift.

### Wiring a spoke (one-shot)

From the spoke repo root, run the Hub bootstrap script:

```bash
HUB_DIR=../resonance-hub \
  bun run ../resonance-hub/scripts/install-discernment-lint.ts
```

This will:

1. Copy `src/lib/discernment.ts`, `src/lib/discernment-guard.ts`, and
   `scripts/verify-discernment-usage.ts` from the Hub into the spoke
   (overwriting any drift).
2. Add `verify:discernment-usage` to `package.json` and append it to
   `prebuild` if not already wired.
3. Write `.github/workflows/discernment-lint.yml` that calls the Hub's
   reusable workflow on every PR (and on pushes to `main`).

### Reusable GitHub workflow

The Hub publishes `.github/workflows/discernment-lint.yml` as a
`workflow_call` target. Each spoke's workflow is a 3-line stub:

```yaml
jobs:
  discernment:
    uses: resonance-org/resonance-hub/.github/workflows/discernment-lint.yml@main
```

The reusable workflow runs two jobs:

- **lint** — installs deps and runs `verify-discernment-usage.ts`.
- **parity** — checks out the Hub at `inputs.hub-ref` (default `main`) and
  diffs `discernment.ts`, `discernment-guard.ts`, and the linter script
  against the spoke's copies. Any drift fails the PR with an annotation
  pointing at the file to re-sync.

Together, the prebuild hook blocks local builds and the PR workflow blocks
merges, so no generation route can reach production without the guard and
provenance label.

## Versioning

Breaking changes to `BriefDiscernmentInput`, `DataProvenance`, or
`DiscernmentEvaluation` require a coordinated update across all spokes.
Add new optional fields rather than renaming existing ones whenever possible.
