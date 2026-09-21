# First-admin access

`/admin/access` is the only place that can claim the first Resonance admin
role. The action is shown only when all of these conditions are true:

- the visitor has a valid signed-in session;
- Supabase Auth reports a confirmed email for that user;
- the normalized email exactly matches the private server allowlist;
- no admin exists; and
- the permanent one-time bootstrap slot has never been claimed.

Before the admin action appears, the server sends a 32-byte, short-lived,
single-use proof link to that canonical email address. Only a live proof stored
as a SHA-256 hash can make the action eligible. This independently proves inbox
control even if Supabase's **Confirm Email** setting was disabled when the
account was created.

## Deployment

1. Keep `ADMIN_BOOTSTRAP_EMAILS` unset while rolling out. This disables the
   legacy bootstrap path before any change is deployed.
2. Apply `supabase/migrations/20260821000000_secure_first_admin_bootstrap.sql`.
   The migration backfills existing installations and installs a database
   trigger that rejects the legacy direct first-admin insert, so the migration
   can safely precede the application deployment.
3. Deploy the application code and verify the existing `LOVABLE_API_KEY` email
   delivery secret is available. If the canonical Hub URL is not
   `https://reson8.life`, configure `ADMIN_BOOTSTRAP_BASE_URL` as an HTTPS
   server/runtime value.
4. Configure `ADMIN_BOOTSTRAP_EMAILS` as an encrypted server/runtime secret.
   Its value is a comma-separated list of exact email addresses.
5. Never prefix the variable with `VITE_`, place it in client code, print it,
   or commit its value to an environment file.
6. Sign in with a listed account and visit `/admin/access`. Choose **Send
   verification link**, open the link delivered to that same email, then
   explicitly choose **Create first administrator**.
7. After a successful claim, remove the allowlist secret if it is no longer
   needed. The database marker keeps the bootstrap permanently closed.

The server re-checks every condition on each action POST. The database function
locks and consumes the email proof together with the bootstrap marker and role
write, so copied links, double-clicks, retries, and competing eligible users
produce one winner and safe finite results instead of duplicate first admins.
