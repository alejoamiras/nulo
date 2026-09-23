# Phase 1 — the identity rename

Commits (on `worktree-tools-rename`, base `01d06692`):

| # | sha | what |
|---|---|---|
| 1 | `ef67ec23` | `git mv` ×3 + every literal path consumer + the complexity manifest re-key |
| 2 | `dd338260` | names: package, root scripts, CI outputs/jobs/artifact, release + refresh-landing, harness vars, build-target types, `VITE_TOOLS_TARGET`, release-script identifiers, deployer dir + logger ns, fixture hosts, page title |
| 3 | `b2dd9a3a` | `bun.lock` re-key |
| 5 | `3746b352` | direct host-pin test |
| 6 | `2bb515f0` | `APP_ID`/`metadata.name` → `nulo-tools`, `legacyAppId` migration + 6 unit + 1 jsdom cases, three CI-graph pins |
| 7 | `d7144349` | testid prefix `fa-` → `tl-` |

## Deviations from the plan's commit order (gates unchanged)

- **The manifest re-key rode in commit 1, not commit 4.** The pre-commit hook runs `scripts/complexity-baseline/check.ts`, which refuses a tree whose manifest keys name a directory that no longer exists — so commit 1 could not land with the manifest untouched. `bun run baseline:complexity -- --adopt` was run at that point; both gate halves passed there: `inserted 0 directive(s)`, `git status` showed only `manifest.json` changed, and the `jq -S 'del(.generated)'` transform-diff against `01d06692`'s manifest was empty. Two `apps/faucet` entries (errors.ts, phase-clock.ts — the owner-accepted residue) became `apps/tools` entries; counts 51/11 unchanged.
- **Commit 2 needed one formatter pass** (a fixture line grew past the width after the longer `nulo-tools-testnet.pages.dev` slug).
- **Fewer bridge-core path literals than recon counted**: 7 files carried the string form and 8 the split `join(…, "apps", "faucet", …)` form (recon's "≈40 sites / 15 files" was the union). Both forms were repathed in commit 1; the split form is why the plain `apps/faucet` grep alone is not a complete inventory.
- **The legacy-literal allow-list is two files, not three**: the factory's unit test uses `old-app` as its legacy id, so only `useWalletConnection.ts` (the `LEGACY_APP_ID` value) and `tools-smoke.test.ts` (case 2c) contain `nulo-faucet`.
- **Sandbox friction**: the worktree-isolated shell refuses `xargs`, heredocs and several `&&` chains that mention `git`; every sed ran with an explicit file list, and the `resolve-ports.ts` check has to be run with absolute paths because a `cd` persists across calls (one gate run was silently executed from `apps/extension` and re-run).

## Storage migration shape (post-#512 controller layout)

`createSessionState` derives `legacyStorageKey`/`legacySelectedKey` from `config.legacyAppId`; `readPreferredFor` accepts `null`; `readPreferred` and the `preferredWalletName` initializer read new-then-legacy; `readRememberedMap` falls back to the legacy key only when the current key is absent; `clearPreferred` removes both; the connected-success write fires when the flow was fresh OR the current key is still empty (the legacy-restored remembered path) — promotion happens only after `registerContracts` succeeds, never on read (codex round 2).

## Gate (all green, 2026-09-01 22:10–22:15 UTC)

```
lockfile:   LOCK OK (structural deep-compare vs transformed 01d06692:bun.lock); lockfile-exception-diff → all []; bun install --frozen-lockfile → no changes
manifest:   transform-diff (del .generated) EMPTY; --adopt inserted 0; only manifest.json changed
typecheck:all  → every workspace exit 0
lint           → biome 0 errors; complexity-baseline check OK
test:tools     → 67 files, 737 tests passed (incl. legacy app-id migration ×6, host pin, capabilities name)
tools test:e2e → 3 files, 16 tests passed (incl. 2c legacy key)
bridge-core    → 320 passed, 5 skipped
extension unit → 5305 passed, 2 skipped, 7 todo
test:ci-gating → 66 passed (incl. the new build-tools wiring pin)
lint:actions   → exit 0
verify:deployments → both committed addresses match
resolve-ports  → tools=:16861; jq check on .e2e-state/ports.json → true
residue greps  → apps/faucet 0 · identity tokens 0 · harness+CI files 0 · nulo-faucet only in useWalletConnection.ts (1) + tools-smoke.test.ts (1)
lint-glob probe → viem/chains import under apps/tools/src → noRestrictedImports error (override still binds); probe removed
```
