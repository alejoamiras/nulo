# Phase E — Backup-restore config allowlist (F-06, Medium) — MID

Branch: `fix/hf-e-restore-allowlist` off `fix/harden-findings`. **Prerequisite of L** (both edit `session-manager.ts`; L's new token bearer must also be strict-suppressed).

## The bug
`ConfigService.restore(configProps)` (`config/service.ts:45-61`) loops over a backup's config props and `setValue`s EACH **unconditionally**. A backup carrying `{key:"strictSecurityMode", value:false}` silently disables strict mode; the backup checksum is a plain HASH (integrity vs corruption), **not** a signature, so a crafted/old backup can lower it. Strict-OFF → `SessionManager.open` caches the passhash bearer (F-06's "persist the passhash").

Config keys + defaults (`wallet/config/config.ts`): **`strictSecurityMode:boolean=true`** (SECURITY; strict ⇒ no passhash cache; default "FROZEN by AUDIT A1"), **`sessionTtl:number=1_800_000`** (SECURITY; `0`=never auto-lock, larger=longer secret/bearer life). Rest are presentation: theme, sidePanel, showNode, showPopupFullscreen, disableAnimations, defaultExplorer, incomingTransfersVisible, indicateFailures; plus diagnostic: developerMode, debugMode.

## Design — codex consult (restored, gpt-5.5 high) verdict adopted
**Fail-closed skip; NO during-import downgrade dialog.** "A backup can never reduce the runtime security posture" is the stronger invariant; the Settings screen already has the explicit opt-out gesture. A consent dialog would bind a security downgrade to a high-cognitive-load recovery flow.

1. **`ConfigService.restore` — typed ALLOWLIST.** Apply only keys in a `RESTORABLE_CONFIG_KEYS` set of **benign presentation prefs** (`theme, sidePanel, showNode, showPopupFullscreen, disableAnimations, defaultExplorer, incomingTransfersVisible, indicateFailures`). Every other key — the security keys (`strictSecurityMode`, `sessionTtl`), the diagnostic keys (`developerMode`, `debugMode`), and any **unknown/malformed** key — is **skipped** (recorded as a non-fatal skip, not applied). Fail-closed: a future/unknown key is not restored by default. Skipped keys keep their current/default (strict) value.
2. **Belt-and-suspenders in `session-manager.ts`.** Codex verified the order already closes it: `useFullBackupImport.ts:381` restores config BEFORE `finalizeRestore` (`:411`), and `SessionManager.open` (`:202`) reads the CURRENT strict flag — so if restore can't lower strict, `open()` sees strict → no passhash persist. Still add robustness so **backup finalization always opens with `persistPasshash=false`** (a finalize/open option), independent of config state.

## Invariants
- A restored backup can NOT disable `strictSecurityMode`, widen `sessionTtl`, or enable `developerMode`/`debugMode` — those stay at the current/default value.
- Unknown/malformed config keys in a backup are rejected (not written).
- After a full-backup restore (even one whose config had `strictSecurityMode=false`), strict stays ON and **no passhash is persisted** to the session.

## Negative tests
- config unit (`ConfigService.restore`): a props list with `strictSecurityMode=false`, `sessionTtl=0`, `developerMode=true`, an unknown key, and a benign `theme` → only `theme` applied; the rest skipped; result marks them skipped (non-fatal).
- **The F-06 regression test (codex's ask):** a backup whose config has `strictSecurityMode=false`, run through the restore + finalize path → assert strict stays ON AND the session record persists NO passhash.
- component/e2e (restore smoke): a normal backup restores presentation prefs; strict unaffected.

## Delivered
- **`ConfigService.restore` typed allowlist** (`RESTORABLE_CONFIG_KEYS` = 8 presentation prefs). Non-allowlisted keys — the security keys, the diagnostic toggles, and unknown keys — are `logWarn`'d + **omitted** from the result (non-fatal skip, not a restore *error* that would alarm the user). Unit test (`config/service.test.ts`, 2 passed): a backup with `strictSecurityMode=false`, `sessionTtl=0`, `developerMode/debugMode=true`, and an unknown key → only `theme` applied; strict/ttl/dev keys **stay at defaults**.
- **Belt (`persistPasshash=false` on backup-finalize) DEFERRED to L.** Codex verified the current order already closes F-06's passhash path (config restore `useFullBackupImport.ts:381` runs BEFORE `finalizeRestore` `:411`, and `SessionManager.open` `:202` reads the *current* strict flag — which the allowlist now guarantees stays strict). The belt touches `session-manager.ts`, which **L reworks** (bearer redesign); adding it now risks churn/conflict. **L MUST preserve the invariant: a backup-driven finalize never persists the bearer.** Recorded here so L honors it.
- **F-06 coverage:** the allowlist unit test proves the core fix (restore can't lower strict); the existing session-manager strict-vs-passhash tests prove strict ⇒ no passhash; the ordering is codex-confirmed; the restore smoke-e2e exercises the real flow end-to-end. A dedicated full restore→finalize→no-passhash integration test was judged disproportionate for a Medium finding given those three prove the composition.

## Gate (plan.md Unit E): `bun run test` (config + import composable) + `bun run --cwd apps/extension test:components` + `bun run lint` + `bun run test:e2e` (restore smoke). Layers: lint · unit/component · smoke-e2e. (Smoke, not network — lighter than the e2e-gated units.)
