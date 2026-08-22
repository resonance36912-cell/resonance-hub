# resonance-hub — GitHub repo manifest

Apply these settings when creating **https://github.com/resonance36912-cell/resonance-hub**.

## Repository

- **Name:** `resonance-hub`
- **Owner:** `resonance36912-cell`
- **Visibility:** Public
- **Description:** Reson8 ecosystem hub — billing authority, entitlements, ROP telemetry, and shared governance (RCGF v1.0) for Creative Studio, ePublisher, SyncVision, and YouTube Optimizer.
- **Homepage:** https://reson8.life
- **License:** Apache-2.0 (see `LICENSE`)
- **Default branch:** `main`

## Topics

```
reson8 resonance rcgf governance billing payfast entitlements tanstack-start
supabase lovable ecosystem hub webhooks rop
```

## Features

- Issues: ✅
- Discussions: ✅
- Wiki: ❌ (docs live in `/docs`)
- Projects: ✅

## Branch protection (`main`)

- Require pull request before merging (1 approving review, dismiss stale on push)
- Require status checks to pass:
  - `verify-prebuild`
  - `security-scan`
  - `codeql`
  - `discernment-lint`
  - `verify-checkout-links`
  - `verify-epublisher`
- Require branches to be up to date before merging
- Require conversation resolution before merging
- Require signed commits: recommended
- Restrict who can push: admins + CODEOWNERS
- Do not allow force pushes or deletions

## Secrets (repo scope)

Set via GitHub → Settings → Secrets and variables → Actions:

| Name | Purpose |
| --- | --- |
| (billing/webhook secrets are provisioned in Lovable Cloud, not GitHub) | — |

CI workflows in `.github/workflows/` currently rely only on GitHub-provided tokens; no additional repo secrets are required for the standard prebuild/security scans.

## Wiring after repo creation

1. In Lovable: workspace → GitHub → **Connect project** → select `resonance36912-cell/resonance-hub`. Two-way sync will push this codebase up.
2. Verify `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `.github/CODEOWNERS`, and `.github/pull_request_template.md` land at the repo root.
3. Enable branch protection per above.
4. Add `RCGF` and `RCGF-Examples` as related repos in the repo sidebar.

## Governance link-back

This hub implements RCGF v1.0. Canonical constitution: https://github.com/resonance36912-cell/RCGF.
