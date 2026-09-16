# CI Runbook: GitHub Actions Billing / Spending-Limit Failures

Use this runbook when a GitHub Actions job fails at start (not from test/build code) with an annotation like:

> The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings.

This is a **GitHub account-level billing block**, not a workflow or code issue. No commit, workflow edit, or re-run from Lovable will resolve it — the fix happens in GitHub billing settings.

---

## 1. Confirm the failure is billing, not code

Signs it is a billing block:
- Job duration is `0s`–`2s` and shows "The job was not started…".
- No steps ran; there is no test/build log output.
- Both consolidated workflows (`RONSAS CI` and `Security scan`) fail at start around the same time.
- The runner is already `ubuntu-latest` (free GitHub-hosted). Confirm in the workflow file, e.g. `.github/workflows/verify-prebuild.yml`.

If a job actually started and produced logs, this runbook does **not** apply — treat that as a real test/build failure.

---

## 2. Resolve the billing block in GitHub

Do this in the GitHub web UI. It cannot be done from Lovable or via API tokens.

1. GitHub → click your avatar (top-right) → **Settings**.
2. Sidebar → **Billing and plans** → **Payment information**.
3. Do **one** of the following:
   - **Fix the failed payment**: update the card on file, then click **Retry payment** on the outstanding invoice.
   - **Raise the Actions spending limit**: **Billing and plans → Plans and usage → Actions → Spending limit → Update limit**. Set it above the current usage.
4. Wait ~1 minute for GitHub to release the block.

### Organization repos

If the repo is owned by an organization (not a personal account), switch to the org's billing page:
GitHub → **Your organizations** → select the org → **Settings** → **Billing and plans**. Only organization owners / billing managers can update payment info or raise the spending limit.

---

## 3. Understand the private-repo minute quota

On **private repos**, every `ubuntu-latest` minute counts against the monthly Actions quota:
- Free plan: **2,000 minutes/month**
- Pro plan: **3,000 minutes/month**
- Team plan: **3,000 minutes/month**

If the quota is exhausted, every workflow keeps failing at start until:
- Billing is unblocked / the spending limit is raised, **or**
- The quota resets on the next billing cycle, **or**
- The repo is made public (public repos have **unlimited** Actions minutes).

Check current usage at **Settings → Billing and plans → Plans and usage → Actions**.

---

## 4. Re-run RONSAS CI after billing is fixed

Once billing is cleared:

1. Go to the repo → **Actions** tab.
2. In the left sidebar, click **RONSAS CI**.
3. Open the most recent failed run.
4. Top-right → **Re-run jobs** → **Re-run all jobs**.

Alternatively, push any commit to `main` (or open a PR) to trigger a fresh run.

### Re-running other blocked workflows

Repeat step 4 for each workflow that was blocked:
- **RONSAS CI** (`.github/workflows/verify-prebuild.yml`)
- **Security scan** (`.github/workflows/security-scan.yml`, including CodeQL)

---

## 5. If a job still fails after re-run

If the job now **starts** but fails inside a step, it is a real failure — not a billing issue. Open the step log, identify the failing script, and treat it as a normal CI failure. Do not return to this runbook.

Common real-failure entry points:
- `bun run typecheck` → TypeScript error; fix the reported file.
- `bun run verify:checkout-links` → invalid `/checkout?app=…&plan=…` link; see `scripts/verify-checkout-links.ts`.
- `bun run verify:security` → policy/RLS/grant regression; see `scripts/verify-security-invariants.ts`.
- `bun run prebuild` → check the first failing sub-script in the chain (`package.json` → `prebuild`).

---

## 6. Prevention

- Keep a valid payment method on file and enable email alerts under **Billing and plans → Payment information**.
- Set a spending-limit **notification** (not just a hard cap) so the account warns before jobs start being refused.
- Prefer `ubuntu-latest` over larger/paid runners in every workflow to keep per-minute cost at the lowest tier.
- For heavy scanners that are not release-blocking (e.g. `gitleaks` on private repos with a license quota), keep `continue-on-error: true` so a quota hit on one scanner does not cascade.
