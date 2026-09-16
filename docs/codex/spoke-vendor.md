# Vendoring Codex config into each spoke

Apply to: `creative-studio`, `epublisher`, `syncvision`, `youtube-optimizer`.

## Files to copy

| Source | Destination in spoke |
| --- | --- |
| `AGENTS.md` | `AGENTS.md` (repo root) |
| `config.toml.example` | `.codex/config.toml` |

## Per-spoke edits

Fill in the Spoke identity block in `AGENTS.md`:

- Spoke name
- App slug used in checkout (must equal the Hub `SKU_CATALOG` slug)

Nothing else should diverge from the Hub copy without a Hub-side change first.

## Verify

```bash
bun run typecheck
```

Also verify that the spoke does not expose `/mcp`, `/.mcp/*`, or vendor-specific tool endpoints unless the RONSAS control plane explicitly authorizes them.

## Drift protection

Add `docs/codex/SOURCE` in each spoke:

```
Synced from resonance-hub@<short-sha> on <YYYY-MM-DD>
```
