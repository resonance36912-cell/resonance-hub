# Codex - RONSAS repository wiring

Canonical configuration for Codex across the Resonance ecosystem.

The former public Hub MCP compatibility server has been retired. RONSAS keeps tool/control interfaces local or behind explicitly approved connector and broker boundaries. Public `/mcp`, `/.mcp/*`, and the former MCP OAuth metadata endpoint are blocked at the Cloudflare edge.

## Files

| File | Purpose |
| --- | --- |
| `config.toml.example` | Minimal Codex configuration without a public Hub MCP dependency. |
| `AGENTS.md` | Canonical repo-level agent instructions for spokes. |
| `spoke-vendor.md` | Brief for vendoring the canonical guidance into each spoke. |

## Tool connectivity

Use the RONSAS control plane, approved ChatGPT/GitHub connectors and governed local services for tool access. A future RONS-owned MCP service may be introduced only after its authentication, authorization, audit logging and public-edge policy are separately validated.

Do not point Codex or another agent at historical Lovable MCP endpoints.
