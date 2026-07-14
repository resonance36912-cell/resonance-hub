# Updating pinned dependencies

Every dependency in `package.json` is pinned to an **exact** version (no `^`,
`~`, ranges, `*`, or `latest`), and `bun.lock` must resolve to that same
version. CI enforces this via `scripts/verify-deps-pinned.ts` — a failing
check blocks the build.

This guide covers the two things you'll actually do: **bump a version** and
**know when to commit `bun.lock`**.

---

## When to commit `bun.lock`

Rule of thumb: **if `bun install` changed `bun.lock`, commit it.** Never
commit `package.json` without the matching `bun.lock` update (or vice versa).

| Situation                                                    | Commit `bun.lock`? |
| ------------------------------------------------------------ | ------------------ |
| Added / removed / bumped a dep in `package.json`             | **Yes**            |
| Ran `bun install` and `git status` shows `bun.lock` changed  | **Yes**            |
| Ran `bun install --frozen-lockfile` (lockfile can't change)  | N/A                |
| Only touched app code, no dep changes, `bun.lock` unchanged  | Nothing to commit  |
| CI failed with `run \`bun install\` then commit bun.lock`    | **Yes** — run it locally, commit the diff |

Always commit `package.json` and `bun.lock` in the **same commit**. A commit
that changes only one of the two will fail CI on the next push.

---

## Bumping a pinned version

1. **Pick the new exact version.** Check the changelog first for breaking
   changes. Example: upgrading `zod` from `4.0.10` to `4.0.11`.

2. **Edit `package.json`** — replace the exact version with the new exact
   version. Keep it exact:

   ```diff
   -    "zod": "4.0.10",
   +    "zod": "4.0.11",
   ```

3. **Install and let Bun rewrite `bun.lock`:**

   ```sh
   bun install
   ```

4. **Verify:**

   ```sh
   bun run verify:deps-pinned
   ```

   This runs `bun install --frozen-lockfile` + the pin/consistency checks.
   If it passes, you're good.

5. **Commit both files together:**

   ```sh
   git add package.json bun.lock
   git commit -m "chore(deps): bump zod 4.0.10 → 4.0.11"
   ```

---

## Adding a new dependency

```sh
bun add <pkg>@<exact-version>          # runtime
bun add -d <pkg>@<exact-version>       # dev
```

Always pass an **exact version** (`bun add zod@4.0.11`, not `bun add zod`) —
otherwise Bun writes a caret range and the pin check fails. Then:

```sh
bun run verify:deps-pinned
git add package.json bun.lock
```

---

## Removing a dependency

```sh
bun remove <pkg>
bun run verify:deps-pinned
git add package.json bun.lock
```

---

## Bumping an override

Overrides live under `pnpm.overrides` in `package.json` (Bun honors this
key). If you change one manually, or if a transitive dep resolves to a new
version, run:

```sh
bun run scripts/sync-overrides-from-lock.ts
bun install
bun run verify:deps-pinned
```

The sync script rewrites `pnpm.overrides` to match what `bun.lock` actually
resolved, eliminating drift.

---

## When CI fails the pin check

The error block from `verify-deps-pinned.ts` tells you the fix. The common
patterns:

- **`"^x.y.z" is not a pinned exact version`** — someone reintroduced a
  caret range. Replace with the exact version from `bun.lock`.
- **`package.json="x.y.z" but bun.lock resolved "x.y.w"`** — `package.json`
  and `bun.lock` disagree. Run `bun install` locally and commit `bun.lock`.
- **`overrides sync → package.json drift`** — run
  `bun run scripts/sync-overrides-from-lock.ts && bun install` and commit
  both files.

If the local check passes but CI still fails, you almost certainly forgot
to `git add bun.lock`.

---

## Why we pin

- **Reproducible builds** — the same commit installs byte-for-byte the same
  dependency tree six months from now.
- **Security review integrity** — a scan approving version `x.y.z` doesn't
  quietly become approval for `x.y.(z+5)` on the next fresh install.
- **No surprise transitive bumps** — lockfile drift is the #1 source of
  "works on my machine" regressions.
