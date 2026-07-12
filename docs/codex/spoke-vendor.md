# Vendoring Codex config into each spoke

Apply to: `creative-studio`, `epublisher`, `syncvision`, `youtube-optimizer`.

## Files to copy (from `hub/docs/codex/`)

| Source | Destination in spoke |
| --- | --- |
| `AGENTS.md` | `AGENTS.md` (repo root) |
| `config.toml.example` | `.codex/config.toml` |
| `mcp-connect.md` | `docs/codex/mcp-connect.md` (reference) |

## Per-spoke edits

In the copied `AGENTS.md`, fill in the **Spoke identity** block:

- `Spoke name`
- `App slug used in checkout` — must equal the slug in the hub's `SKU_CATALOG`
  (`creative-studio`, `epublisher`, `syncvision`, `youtube-optimizer`).

Nothing else in `AGENTS.md` should be edited without a hub-side change first.

## Verify

```bash
# From the spoke repo:
bun run typecheck
codex mcp list reson8_hub    # should list echo, list_updates
```

## Drift protection

Add a `docs/codex/SOURCE` file in each spoke containing:

```
Synced from resonance-hub@<short-sha> on <YYYY-MM-DD>
```

so future audits can tell how stale the vendored copy is. The hub CI already
runs `verify-back-to-hub` and route-string checks; spokes should mirror those
scripts once vendored.
