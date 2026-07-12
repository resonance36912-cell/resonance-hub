# Connect ChatGPT Codex CLI to the Reson8 Hub MCP

The Hub exposes an OAuth-protected MCP server at `https://reson8.life/mcp`.
Codex CLI (0.20+) supports remote MCP servers over Streamable HTTP with OAuth.

## 1. Add the server to Codex

Edit `~/.codex/config.toml` (create if missing) and append:

```toml
[mcp_servers.reson8_hub]
transport = "http"
url = "https://reson8.life/mcp"
# Codex will run the OAuth dance on first use; no static token needed.
```

A ready-to-copy version lives at `docs/codex/config.toml.example`.

## 2. First-run OAuth

Run any Codex command that lists MCP tools, e.g.:

```bash
codex mcp list
codex mcp call reson8_hub echo --input '{"text":"hi"}'
```

On first use Codex opens a browser to `https://reson8.life/.lovable/oauth/consent`.
Sign in with your Reson8 account and click **Approve**. Codex stores the
resulting access + refresh tokens locally under `~/.codex/`.

## 3. Verify

```bash
codex mcp list reson8_hub
```

Should show at least:

- `echo` — connectivity check
- `list_updates` — recent Reson8 project updates

If `echo` returns your input, the tool loop is wired end-to-end as the
authenticated user (RLS runs as that user in every tool).

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `401 invalid_token` on every call | Session JWT pasted instead of running OAuth. Delete the token, re-run to trigger consent. |
| Consent screen bounces to `/` | You were signed out; the consent route now preserves `next` — sign in again from the same tab. |
| `issuer mismatch` in Codex logs | An old config points at a `.lovable.cloud` URL. Use `https://reson8.life/mcp` (or the direct project URL) — never the proxy. |
| No tools listed | Publish is stale; re-run after the next deploy or check `/mcp` manifest via `app_mcp_server--extract_mcp_manifest`. |

## Do NOT

- Do not embed `SUPABASE_SERVICE_ROLE_KEY` anywhere in Codex config.
- Do not add a static `Authorization: Bearer <session>` header — the MCP
  server rejects tokens without the `client_id` claim.
- Do not point Codex at `project--<id>.lovable.app/mcp` for day-to-day use;
  the canonical URL is `https://reson8.life/mcp`.
