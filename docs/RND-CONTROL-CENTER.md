# RONSAS Admin/R&D Control Center

Route: `/admin/rnd`

This control center replaces routine dependence on Remote Desktop Commander and TRIGGERcmd with a sovereign, auditable RONSAS control plane.

## Access model

The browser route requires:

1. a valid Supabase session;
2. the existing `admin` role in `user_roles`; and
3. an exact email match in the server-only R&D allowlist. `RONSAS_RND_ALLOWED_EMAILS` can narrow access further; otherwise the existing `ADMIN_BOOTSTRAP_EMAILS` owner allowlist is reused.

There is no hidden assistant account, shared backdoor, arbitrary command field, or client-side service-role credential. The assistant can only act through the user's authorized workflow/session.

## Server configuration

Required:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `RONSAS_RND_ALLOWED_EMAILS` — stricter R&D-only email allowlist; when absent, `ADMIN_BOOTSTRAP_EMAILS` is used.
- `RONSAS_RND_EMERGENCY_KILL=true` — an additional server-side veto that prevents opening or approving live mutation windows. The database-enforced **Lock now** control is the claim-time hard stop for already staged/queued work.
- `RONSAS_RND_WORKSPACE` — defaults to `C:\Users\Ashley\Documents\GitHub\rons-sovereign-codebase`.

GitHub workflow-state diagnostics additionally use the existing `LOVABLE_API_KEY` and `GITHUB_API_KEY`.

## Recovery HOLD

GitHub runner recovery/recycle/replacement is not in the R&D operation catalog. Recovery-like operation names are rejected by the web layer and local agent.

The initial operation catalog is:

- `collect_diagnostics` — read-only.
- `git_status` — read-only.
- `verify_public_endpoints` — read-only.
- `optimize_workspace` — mutation; approval required.
- `sync_main_fast_forward` — mutation; approval required.
- `restart_public_edge` — mutation; approval required.

Mutation jobs default to dry-run in the UI. Live mutation requires all of the following: an Admin/R&D mutation window opened for 10 or 30 minutes, the database emergency lock open, no environment veto, a fresh Ealiophin agent heartbeat, local mutation capability enabled, Recovery HOLD asserted, and a second explicit per-job approval. **Lock now** sets the database emergency lock and closes the window atomically, so an already-approved queued live job is no longer claimable. The server computes the normalized SHA-256 of the approved Ops Agent source on `main`; each live job is bound to that hash, the database requires Ealiophin's heartbeat hash to match the job-bound hash both at approval and claim time, and the agent rechecks its own executing script hash against the job-bound hash immediately before each live mutation. If `main` changes after staging, the job must be restaged under the new approved identity.

## Bridge schema

Apply, in order:

1. `20260922071500_bridge_execution_core.sql`
2. `20260923203500_rnd_control_center_hardening.sql`

The hardening migration preserves the generic Bridge RPC surface for non-R&D clients, but isolates Admin/R&D jobs behind dedicated heartbeat/claim/complete RPCs and database transition guards. It enforces the R&D operation allowlist, requires approval for live mutations, binds live jobs to the approved agent SHA-256, freezes R&D job identity fields, and makes the Bridge audit log append-only.

## One-time Ealiophin enrollment

Open `/admin/rnd` and choose **Create one-time agent credentials**.

The site creates a dedicated non-admin Supabase Auth user and a Bridge device row. Save the password immediately; it is not stored for redisplay.

On Ealiophin, from the deployed Hub production workspace, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\ealiophin\control-center\INSTALL-RONS-RND-AGENT.ps1 `
  -SupabaseUrl "<shown in Admin/R&D>" `
  -PublishableKey "<shown in Admin/R&D>" `
  -AgentEmail "<shown in Admin/R&D>" `
  -DeviceId "<device UUID shown in Admin/R&D>" `
  -EnableMutations
```

The installer prompts for the one-time password using `SecureString`, stores the credential with Windows DPAPI-backed CLIXML, copies the agent into the RONS control center with SHA-256 verification, and registers a limited at-logon scheduled task.

Do not pass the password on the command line.

The local agent's mutation capability is off unless the installer is explicitly run with `-EnableMutations`. Enabling this once does not authorize a live action by itself: the Admin/R&D timed mutation window and per-job approval remain independent gates. The optional server emergency kill overrides all live mutation windows.

## Audit

R&D job creation, approval, cancellation, claim, success, and failure are retained in the Bridge audit trail. Jobs carry a correlation ID and record requested operation, dry-run/live mode, before/after Git state, result, and error.

## Safety invariants

- No `Invoke-Expression`.
- No arbitrary PowerShell or shell payload execution.
- No arbitrary path execution.
- Exact workspace equality is required.
- Git sync is clean-worktree, current-main, fast-forward-only.
- No `git reset --hard` or `git clean -fd`.
- Cache removal is restricted to explicit cache directories under the workspace.
- Recovery/recycle is blocked.
- Live mutations have independent gates: timed database window, database emergency lock, optional server environment veto, fresh local agent, exact normalized SHA-256 match to the approved `main` agent artifact, local agent mutation setting, Recovery HOLD, and per-job approval.
- Mutation windows auto-expire after 10 or 30 minutes and can be locked immediately from the Admin/R&D page.
- Live mutation requires an approval state before the agent can claim the job; the database revalidates the window and local agent gate at claim time.
