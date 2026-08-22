# Required CI checks (branch protection)

The `Verify checkout links` workflow runs automatically on every pull
request, every push to `main`, and every merge-queue entry. To make it
**block merges** when it fails, enable it as a required status check —
this is a one-time GitHub setting and can only be done via the UI or
`gh api`, not from a workflow file.

## Enable via GitHub UI

1. Repo → **Settings** → **Branches** → **Branch protection rules**.
2. Add rule for `main` (or edit the existing one).
3. Check **Require status checks to pass before merging**.
4. Check **Require branches to be up to date before merging** (recommended).
5. In the search box, add these checks:
   - `Pricing pages → /checkout SKU links` (from `Verify checkout links`)
   - `bun run prebuild` (from `Verify prebuild`)
6. Save.

The check name is the job's `name:` in the workflow, not the workflow
file. If GitHub can't find the name, run the workflow once first so it
appears in the picker.

## Enable via `gh` CLI

```bash
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  /repos/resonance36912-cell/resonance-hub/branches/main/protection \
  -f required_status_checks.strict=true \
  -f 'required_status_checks.contexts[]=Pricing pages → /checkout SKU links' \
  -f 'required_status_checks.contexts[]=bun run prebuild' \
  -f enforce_admins=true \
  -f required_pull_request_reviews.required_approving_review_count=0 \
  -f restrictions=
```

## What the check guards

- Every `/checkout?...` URL in `src/` is relative (or in the absolute-URL allowlist).
- Every literal `app`/`plan` tuple resolves to a `SKU_CATALOG` entry.
- Every literal `pack=<id>` resolves to a `PACK_CATALOG` entry.
- Every dynamic CTA (`${app}` / `${plan}` interpolation) is covered by a
  `DYNAMIC_CTA_CONTRACTS` entry, and each call site's literal args resolve
  to a valid SKU.
- Unit tests for the tracing helpers pass (`scripts/lib/*.test.ts`).

A broken pricing link fails CI before merge.
