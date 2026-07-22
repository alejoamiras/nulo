# wallet-ux-fixes — plan (mid)

Post-freeze wallet UX/bug fixes off `dev` (baseline `10259cb`). Tier `mid`.

**This plan went through dual audit + two fresh codex passes and was re-scoped three times.** The audits found: item 1b's original mechanism unimplementable → corrected + deferred to PR-B; item 1a's fallback e2e-breaking → corrected; and **item 3 far bigger than a UI refresh** — a cross-account privacy leak that, over four passes, was shown to span the home feed AND the shared History page, tx/journal/incoming/task async races, and a dApp-task data-model gap (task payloads carry no account). Item 3 is therefore **split into its own PR-D** (a proper cross-account activity-isolation pass) rather than bundled.

## Scope (APPROVED: A1 = option B, A2 = one PR for everything EXCEPT item 3)

**One PR = four phases:** Phase 1 = item 2 (downloads permission), Phase 2 = item 1a (import fallback), Phase 3 = item 1b (preserve exact active network across backup), Phase 4 = item 4 option B (active-badge network list). **Item 3 → PR-D, a SEPARATE PR** (the account-switch cross-account isolation — the one genuinely high-risk item; the user kept it out).

Phases 1+2 carry codex `approve`. Phases 3 (security-sensitive backup format) + 4 (UI) were folded in per A2 — Phase 3 gets a focused codex confirm before implementation (below), and both get the standard post-impl `/code-review max` + codex audit.

Validation bar: component/unit + smoke e2e; **all e2e gates build `dist/` first** (`test:e2e` does not build — audit). (The network-e2e lands in PR-D with item 3, its natural home.)

---

### Audit verdicts (inline)

- **Codex (xhigh):** round-1 `reject` (item 1b unimplementable, item 1a e2e-breaking, item 3 races) → revised → final fresh pass `reject` (item 3 under-scoped: 4 async surfaces) → re-verify `reject` (item 3 also hits History + tasks + a data-model fork) → **item 3 split to PR-D** → **final confirm on PR-A (items 2 + 1a): `approve`**. Transcript: `audit-codex.md`.
- **Fable-leg (Opus 4.8 fallback — Fable 5 out of credits):** `reject`, corroborating codex on all three blocking findings with sharper file:line evidence. Transcript: `audit-fable.md`.
- **Gate status:** codex `approve` on Phases 1+2 (items 2+1a); after the A2 scope change (fold 1b+4B in, split item 3 → PR-D), a focused pass returned `conditional approve` on Phases 3+4 — **all four conditions ADOPTED** (Phase 3 complete identity-aware id map + no `?? raw`; Phase 4 `:to` keyboard-activatable rows; Phase 2 pointer-absent fallback smoke; chainId text corrected). Item 3 → separate PR-D.

## Phase 1 ✓ — `downloads` as a required permission (item 2)

**Root cause (verified):** `utils/files.ts:41` → `utils/general.ts:34-40` calls `chrome.permissions.contains` then `chrome.permissions.request` for `downloads`, which is declared under `optional_permissions` in the SHARED `apps/extension/manifest/manifest.config.ts:40` (both chrome+firefox spread it — one line, not two). The prompt fires AFTER the backup blob is built (on "Download backup"), steals focus, closes the MV3 popup → full restart.

**Fix:** move `downloads` from `optional_permissions` to required `permissions` in `manifest.config.ts` (single shared source; chrome+firefox inherit). Then `ensurePermissions({permissions:["downloads"]})` resolves granted for BOTH callers (`files.ts` AND `useContactImportExport.ts:43`) with no prompt. Simplify `files.ts`'s download path so the happy path never calls `request` (keep a defensive granted-check that logs, or drop it — either way, no prompt). Do NOT remove the `ensurePermissions` helper (contacts still imports it; leaving `downloads` in its granted set is fine).

**Rejected alternative (recorded):** a Blob-backed `<a download>` flow needs no permission at all (strictly least-privilege — codex/opus both noted it). User chose required-permission for simplicity; the least-privilege delta is one install-time line and no host/network grant, so accepted.

**Validation gate — Phase 1 (discriminating checks only):**
- `bun run --cwd apps/extension build:chrome && bun run --cwd apps/extension build:firefox` → both exit 0.
- Grep each built `dist/*/manifest.json`: `downloads` appears in `permissions`, NOT `optional_permissions`.
- `bun run --cwd apps/extension test src/utils/files` → unit **forces `chrome.permissions.contains(...,cb)` to return `false`** and still asserts `chrome.permissions.request` is NEVER called (with `contains→true` the current code already passes, so the test must drive the false branch to be discriminating — final-pass note). Depends on the manifest making `downloads` granted, so the real path never asks.
- `bun run lint && bun run typecheck:all` → exit 0.
- **NOT a gate**: the export smoke e2e — the capture stub (`tests/e2e/helpers/backup-export.ts:25`) forces `contains→true`, so it passes before AND after the fix (non-discriminating; audit). Smoke still runs as a no-regression check, not as proof.
- Layers: typecheck/lint · unit · build (chrome+firefox).

---

## Phase 2 — Import network fallback → the primary network (item 1a)

**Root cause (verified):** `useProfileBootstrap.ts:36` hardcodes the no-active fallback to `kind === "testnet"`; `#305` flipped `DEFAULT_SEEDS` primary-active to Alpha V5 but left this stale → imported profiles (whose active pointer isn't restored — that's item 1b, deferred) fall through to Testnet while fresh profiles get the seed's `isPrimaryActive`.

**Fix (single-sourced — audit-mandated):** do NOT hardcode `kind === "mainnet"` in the composable — `DEFAULT_SEEDS.isPrimaryActive` deliberately selects **Testnet under the e2e flag** (`VITE_NULO_E2E_DEFAULT_NET=testnet`, set by `agent.sh` because CI can't reach Alpha's RPC without blowing the 60s-abort×retry budget). Hardcoding mainnet would make imported profiles bootstrap on a blackholed RPC in e2e AND diverge from fresh profiles. Instead: expose the primary from `NetworkService` (a method returning the profile's network whose seed carried `isPrimaryActive`, i.e. reading the same signal `DEFAULT_SEEDS` uses — currently private to the seed list). `useProfileBootstrap` calls that; keep `?? networks[0]` as the tail (unstable insertion order, but only when the profile has no primary — acceptable, documented).

**Convergence (with the final-pass edge):** fresh (`getOrInitNetworks` seeds + writes active via `isPrimaryActive`) and imported (no pointer → this fallback → same primary) END ON THE SAME network **when the primary network is present**. Match the imported row by the active seed's **`chainId`** (not the attacker-controlled `kind`). Edge (final pass): a backup where the user had deleted the primary (e.g. deleted Alpha, kept only Testnet+Local) has no primary candidate → the tail `?? networks[0]` picks insertion order, which a fresh profile would not. Spec: "primary when present, else `networks[0]`"; test the absence case explicitly and accept the documented divergence (there's no primary to converge on).

**Validation gate — Phase 2:**
- `bun run --cwd apps/extension test src/composables/useProfileBootstrap` → component-unit: no-active → the primary network from the service (NOT hardcoded testnet); primary-absent → `networks[0]` (the documented edge).
- `bun run --cwd apps/extension test src/wallet/services/network` → the new "primary network" method returns the network matching the `isPrimaryActive` seed's `chainId`, honoring the e2e flag; returns undefined when absent.
- `bun run lint && bun run typecheck:all` → exit 0.
- **Both build modes** (flag-OFF `build:chrome` + flag-ON `VITE_NULO_E2E_DEFAULT_NET=testnet build:chrome`): import a backup and assert the imported profile's active network **equals what a FRESH profile selects in that same build** (Alpha vs Testnet). **Critical (codex interaction condition):** this smoke MUST use a **pointer-ABSENT (legacy/stripped) backup** — one with NO `active-network-id` field — so it actually exercises the Phase 2 fallback. A backup exported AFTER Phase 3 carries the pointer and would pass by restoring it, masking the fallback. (Phase 3 separately tests the explicit-selection round-trip.)
- Layers: typecheck/lint · unit/component · build (×2 modes) · smoke e2e.

---

## Phase 3 — Preserve the ACTUAL active network across export/import (item 1b)

Phase 2 makes an imported profile land on the *primary* network; Phase 3 makes it land on *the network you were actually on*. Security-sensitive (backup-format change over attacker-controlled input) — spec'd carefully; gets a focused codex confirm before implementation and again in the post-impl audit.

**Mechanism (audit-corrected; the value-projection idea was proven unimplementable):**
- Export: add a **top-level backup field** `active-network-id` = the active network's RAW id (`full.vue:145-159`, from `getActiveNetwork()?.id`), alongside `master-key`/`compat-epoch` — NOT a slice.
- Restore: `useFullBackupImport.ts`'s `oldToNew` map records ONLY changed ids (`:424-430`) — unchanged successful ids are absent (codex confirm). So build a **COMPLETE** unique source-id→successful-result-id map by result index (include identity mappings for unchanged ids). Look `active-network-id` up in THAT complete map; if it maps to exactly one SUCCESSFULLY-created network for the NEW profile, write it as active (keyed by `newProfile.id`) **before `finalizeRestore`** (`:629-632`), via a new `NetworkService.setActiveForProfile(profileId, networkId)` that `requireOwnedRow`-checks then `_writeActive` (`service.ts:801-803`) without an active session (mirrors how `restore` writes rows). Else → Phase 2's primary/default. **NEVER `oldToNew.get(raw) ?? raw`** — a hostile/absent id must NOT fall through to a global lookup; it must resolve only within this restore's successful pairings or hit the default.
- **Raw-id, not chainId (codex, both passes):** chainId can pick the WRONG source row when two hostile same-chain rows exist and the selected one fails restore but the other succeeds; a raw-id bound to a unique successful old→new pairing avoids that. (Also fix the stray local `chainId: string` annotation at `useFullBackupImport.ts:393` if touched.)
- Security: treat `active-network-id` as hostile (any string / absent / duplicate / foreign) — resolve ONLY against this restore's successful pairings, require exactly one, `requireOwnedRow` on write, never a global lookup; unmatched → default. **NEW validation tests** (the footprint keystone does NOT cover top-level fields — audit).

**Validation gate — Phase 3:**
- `bun run --cwd apps/extension test src/wallet/services/backup src/wallet/services/network src/composables/useFullBackupImport` → unit/component covering ALL id cases (codex): **changed** id → mapped new id; **unchanged** id → identity-mapped new id; **failed-selected** (the exported id's row didn't restore) → primary; **duplicate / absent / foreign** id → primary (never a global lookup); and assert `setActiveForProfile` is called **before `finalizeRestore`** and is `requireOwnedRow`-guarded (rejects a foreign/non-restored id).
- `bun run lint && bun run typecheck:all` → exit 0.
- `bun run --cwd apps/extension build:chrome` then `bun run test:e2e` (smoke round-trip: export a backup while on network X → fresh import → active network is X, not the default).
- Layers: typecheck/lint · unit/component · build · smoke e2e.

## Phase 4 — Settings Network-list: active badge, no fake radio (item 4 — option B)

**Chosen (A1 = B):** remove the misleading left `check-circle`/`circle` (`settings/networks/index.vue`); the active row shows a small **status dot + "Active" label** on the right (before the chevron); every row stays a drill-in (chevron → detail, where `network-set-active` lives). Makes the affordance honest with no interaction change.

**Implementation:** edit `settings/networks/index.vue` (+ its row icon slot). **Preserve every `data-testid` verbatim** (`network-row`, `data-network-id`, `data-network-name`). The active indicator is non-interactive/informational (no new focusable element). **A11y fix (codex):** the rows are currently click-only focusable `<div>`s (`SettingItem.vue:44-51` — not keyboard-activatable). Render them via `SettingItem :to="/popup/settings/networks/<id>"` so they become real keyboard-activatable router links (Enter/Space), instead of `@click` only. Convey active by text ("Active"), not color alone.

**Validation gate — Phase 4:**
- `bun run --cwd apps/extension test src/popup/pages/settings/networks` → NEW component test (greenfield): active row renders dot + "Active" badge, non-active rows don't, all testids preserved, and the row is **keyboard-activatable** (Enter/Space routes to detail — not only a mouse `click`).
- `bun run lint && bun run typecheck:all` → exit 0.
- `bun run --cwd apps/extension build:chrome` then `bun run test:e2e` (smoke: settings network path opens detail + sets active + returns to general).
- Layers: typecheck/lint · component · build · smoke e2e.

---

## Deferred — PR-D (separate PR, per A2): item 3 cross-account activity isolation

### PR-D — item 3: cross-account activity isolation (own PR; likely its own blueprint)
Splitting item 3 out is the resolution to the final codex reject — it is NOT a UI-refresh fix; four review passes showed it is a **cross-account privacy leak spanning two pages + shared builders + task state + a data-model gap**. Surfaces to fix (all verified):
- **Home feed** (`RecentActivityView.vue`): settled render unfiltered (`:57-60`); `syncTransactions()` has no generation guard (`app.store.ts:153-156`); incoming render unfiltered + no scope watcher (`:103-112`, `useIncomingTransfers.ts:74,80`); journal snapshot commit racy (`:553-556`); global `onTxAdded/onTxUpdated` unscoped (`app.store.ts:131-151`).
- **History page** (`activity.vue`) — SAME bug, so the fix belongs in SHARED code: `buildActivityRows` filters journal only, tx + incoming unconditional (`activity-rows.ts:50-52,62-73`); terminal-journal snapshot unguarded (`activity.vue:75-79`).
- **Task/cancellation state**: `clearExecutingTaskIfPendingCancelTerminal()` checks Account-A's job id then unconditionally nulls whichever task is active (`RecentActivityView.vue:480-485`) → an A-cancellation clears B's task; `pendingCancelJobIds` must clear on scope change; `onTxAdded`'s awaiting-placeholder cleanup must be scope-suppressed.
- **Data-model FORK (design decision)**: dApp task payloads carry NO account (`task/spec.ts:76-82`; `isExecutingTask` accepts every dApp send `:568-580`) → filtering them needs EITHER plumbing `accountAddress/networkId` into task content OR removing the dApp orphan fallback and relying on account-scoped journal records. This fork is why PR-D deserves its own plan.
- **Fix shape**: one captured-generation discipline over tx-sync + journal-snapshot + incoming + task state, synchronous clear on switch, account-scope filters pushed into the SHARED `buildActivityRows`/`useIncomingTransfers` so home AND History are covered, re-fetch-only (no reconnect). The **network e2e** the user asked for lives here (its natural home): two funded accounts, assert settled + incoming + journal cards don't cross accounts on switch, on BOTH home and History.

## Security & Adversarial Considerations

- **Backup import = attacker-controlled input.** (Phase 3) the `active-network-id` field is hostile: resolve ONLY through this restore's COMPLETE source→successful-result id map, `requireOwnedRow` on the write (`service.ts:801-803`), NEVER a global lookup or a `?? raw` fallthrough; unmatched/absent → default. The "already covered by footprint tests" claim is FALSE for a top-level field — NEW tests required.
- **Item 2 privilege:** `downloads` becomes always-available (no host/network grant); a compromised extension gains persistent download capability — the least-privilege delta vs the Blob-`<a download>` alternative is recorded and accepted. CWS re-review/re-prompt is a non-issue pre-prod.
- **Item 3 = privacy, not cosmetics:** the incoming-transfer race can paint another account's transfers in the active feed. The captured-generation guard + event-time scope filter are the security-relevant parts, not just UX polish.
- No crypto, no deps, no new endpoints.

## Assumptions

**Facts (verified — both audits confirm):**
- [F1] `useProfileBootstrap.ts:36` hardcodes testnet fallback; `getActiveNetwork()` → null when pointer absent (`network/service.ts:259-267`).
- [F2] `DEFAULT_SEEDS.isPrimaryActive` = Alpha in prod, Testnet under `VITE_NULO_E2E_DEFAULT_NET=testnet` (`service.ts:82-104`); `agent.sh` sets that flag for e2e deliberately.
- [F3] Active pointer `nulo:core:active-network@<profileId>` — written via DIRECT `browserApi.storage.local` access (`network/service.ts:795-803`), not a `ValueStorage` wrapper (final-pass correction); not in the backup registry.
- [F4] `downloads` is `optional_permissions` in shared `manifest.config.ts:40`; requested at download time. e2e stub (`backup-export.ts:25-42`) forces `contains→true` + replaces `download`.
- [F5] `RecentActivityView.vue` **settled-tx render (`:57-60`) is NOT account-filtered** (final-pass correction — it uses all `appStore.transactions`; the `:216-217` scope is *incoming*); `syncTransactions()` has no generation guard (`app.store.ts:153-156`); incoming render (`:103-112`) unfiltered + no scope watcher (`:74,80`); journal snapshot commit racy (`:553-556`); orphan/dApp task renders unguarded (`:427-431`, `:568-607`); `awaitingTransactions` IS filtered (`:116-123`); global `onTxAdded/onTxUpdated` unscoped (`app.store.ts:131-151`).
- [F6] Network selection lives on `[id].vue` (`network-set-active`); list is `index.vue` (informational icon → detail).

**Inferences (audit-resolved):**
- [I1] ✓ Restore remaps ids on collision (`service.ts:687`); the `oldToNew` map (`useFullBackupImport.ts:424-434`) records only CHANGED ids → Phase 3 builds a COMPLETE identity-aware source→result map and keys the active selection by RAW id (codex: chainId mis-picks on a hostile same-chain collision).
- [I2] ✗ REJECTED — value-projection cannot carry the pointer (1-descriptor-per-service, static key, no restore write, regenerated profileId). PR-B uses a top-level field + profileId-keyed restore write.
- [I3] Re-fetch-only is safe (idempotent connect, listeners set once). Fix target = a captured-generation guard across FOUR surfaces (settled tx sync, journal snapshot, tasks, incoming) + account-scope filters on the unfiltered renders (final-pass correction — NOT incoming-only).
- [I4] ✓ Required-permission change doesn't break the e2e stub.

**Asks — RESOLVED at the gate:**
- [A1] **Item-4 UX direction** → **B (active badge, no fake radio)**. Implemented in Phase 4.
- [A2] **PR structure** → **one PR for items 2 + 1a + 1b + 4B; item 3 split to a SEPARATE PR-D.** (User kept only the high-risk item 3 out; folded 1b + 4B back in.)

## Decision ledger

- **Item 1b mechanism:** value-projection slice (original) → REJECTED (unimplementable). ADOPTED: top-level `active-network-id` (RAW id) field + a COMPLETE source→successful-result id map + `setActiveForProfile(requireOwnedRow)` written before `finalizeRestore`. Now a SHIPPING **Phase 3** (folded in per A2), not deferred.
- **Item 1a fallback:** `kind === "mainnet"` in composable (original) → REJECTED (breaks e2e, diverges fresh vs imported). ADOPTED: single-sourced `NetworkService` primary method honoring `isPrimaryActive`/the e2e flag.
- **Item 3 scope:** "missing account watcher" (original) → "incoming-transfers only" (round 2) → **CORRECTED AGAIN by the final pass to FOUR surfaces**: settled-tx render is ALSO unfiltered (`:57-60`) and `syncTransactions` is racy, journal snapshot commit is racy, orphan/dApp tasks unguarded. ADOPTED: one captured-generation discipline over tx-sync + journal-snapshot + tasks + incoming, synchronous clear on switch, account-scope every unfiltered render. This is the reason the final pass rejected; the fix is now spec'd to cover all of it.
- **Ordering:** impact-first (original) → REJECTED. ADOPTED: safest-first.
- **Structure:** one PR (user) → **4-way split** (audit + 3 codex passes). Item 3's four-pass expansion (home + History + shared builders + task state + a dApp-task data-model fork) proved it is NOT a mid contained fix → **item 3 split to its own PR-D**. Final PR map: **PR-A = items 2 + 1a** (both codex-ADDRESSED), PR-B = 1b, PR-C = item 4, PR-D = item 3. This directly resolved the final codex reject (which was entirely about item 3 being incomplete inside PR-A). SURFACED at gate as [A2].
- **Gates:** original e2e claims → REPLACED with discriminating checks (manifest-grep + `contains(false)` files.ts unit for item 2; flag-on/off dual-build for item 1a; build-before-smoke throughout). The network e2e moved to PR-D with item 3.
- **chainId-vs-raw-id → RESOLVED (raw id):** codex (all passes) showed chainId mis-picks when two hostile same-chain rows exist and the selected one fails restore but the other succeeds. ADOPTED raw id bound to a unique successful old→new pairing (complete identity-aware map, never `?? raw`). fable/opus had preferred chainId for simplicity; codex's collision argument wins. Fix the stray local `chainId: string` annotation at `useFullBackupImport.ts:393`.
- **Final-pass findings (adopted into PR-A):** item-3 four-surface expansion (above); item-1a "primary when present, else `networks[0]`" edge + match-by-seed-chainId; Phase-1 `contains(false)` unit; Phase-3 flag-on/flag-off dual-build comparison; F3/F5 factual corrections. Final codex verdict was `reject` on the item-3 under-scope; this revision adopts every named surface + gate — see the re-verification note below.

## Seeds

_(finalized post-approval — see eli5.html)_
