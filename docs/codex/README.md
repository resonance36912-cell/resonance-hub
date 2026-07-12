# ChatGPT Codex — Resonance Group Wiring

Canonical configuration for the ChatGPT Codex CLI across the Resonance ecosystem.
Two wiring surfaces are covered here:

1. **Hub MCP** — point Codex at the Hub's Model Context Protocol server so it
   can call Reson8 tools (`echo`, `list_updates`, …) as an authenticated user.
2. **Spoke repo configs** — vendor `AGENTS.md` and `.codex/config.toml` into
   every spoke repository (Creative Studio, ePublisher, SyncVision, YouTube
   Optimizer) so Codex follows the same rules everywhere.

## Files in this folder

| File | Purpose |
| --- | --- |
| `mcp-connect.md` | Step-by-step: connect Codex CLI to `https://reson8.life/mcp` via Supabase OAuth. |
| `config.toml.example` | Drop-in `~/.codex/config.toml` (or repo `.codex/config.toml`) with the Hub MCP server registered. |
| `AGENTS.md` | Canonical repo-level agent instructions. Copy to the root of every spoke repo. |
| `spoke-vendor.md` | One-page brief for vendoring the above into each spoke. |

## Hub MCP endpoint (source of truth)

- URL: `https://reson8.life/mcp`
- Auth: OAuth 2.1 via Supabase (dynamic client registration enabled)
- Consent screen: `https://reson8.life/.lovable/oauth/consent`
- Tools currently advertised: `echo`, `list_updates`

Do not paste session JWTs. Codex must go through the OAuth flow so tokens
carry the `client_id` claim the MCP server requires.
