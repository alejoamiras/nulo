## Facts

- F3 is narrowly true but misleading: `value-projection` exists in `backup-migration-registry.ts`, but only normalizes/denormalizes backup schema versions through a static storage key. It is not part of live export or restore orchestration.

- F5 is materially incomplete. `RecentActivityView.vue` scopes journal records by account, but `appStore.transactions` is rendered without account filtering. Moreover, `app.vue` already watches `appStore.account` and calls `syncTransactions()`, so the defect is not simply “missing watcher”; it includes stale asynchronous commits and unscoped transaction events.

- Fresh and imported profiles diverge: `NetworkService.getOrInitNetworks()` seeds and writes the active network for a fresh profile, but returns early when imported rows exist. Imported profiles therefore need their active pointer restored before profile activation.

## Inferences

- I1 is overstated. `NetworkService.restore()` normally preserves row IDs. It regenerates an ID only when it collides with existing global storage. `useFullBackupImport.ts` already constructs an exact old-ID → restored-ID mapping for this case. Raw ID plus that mapping is therefore the most precise selection representation.

  Chain ID is usable only because the service rejects duplicate `(profileId, chainId)` rows. It is not inherently unambiguous, and hostile or malformed chain IDs remain possible because the schema is only numeric.

- I2 is false and blocking. A `value-projection` cannot resolve a backed-up chain ID against restored network rows, cannot access the new profile ID, and cannot call/write the active-network pointer. Adding a registry entry would neither export the pointer nor restore it.

  The correct mechanism is an explicit optional backup field/slice handled by the full exporter/importer. Pass the saved raw network ID into network restore, resolve it through the existing restore mapping, and write the mapped pointer for the new profile before `finalizeRestore`. Old, invalid, or unmatched selections should invoke the service-owned default.

- I3 is only partly correct. Re-running `resnapshotJournal()` does not add subscriptions, so no teardown/reconnect is needed. Reconnecting the already-global task, journal, config, and incoming-transfer services risks port churn or duplicate behavior.

  More importantly, a component watcher alone is insufficient. `syncTransactions()` can commit account A after account B becomes active; `onTxAdded()` accepts global events without account filtering; incoming-transfer event handlers are similarly unscoped. These paths need captured account/generation guards, synchronous clearing on account change, and event-time scope checks.

- I4 is supported: the e2e backup helper stubs `chrome.downloads` and does not rely on `permissions.request`. However, contacts also explicitly calls `ensurePermissions()`. Removing the request only from `files.ts` does not establish “no runtime prompt.”

## Asks

- A1 is unresolved, and the promised options artifact does not exist yet. The directions have substantially different implementation and accessibility consequences. “Active badge + chevron” preserves navigation semantics with the least risk; inline radio/row selection must resolve click-to-detail conflicts, keyboard behavior, and network-switch initialization.

- Split item 4 into a follow-up after the user selects an artifact. Leaving an unresolved human decision in the same implementation PR makes the plan non-executable.

## Security

- Treat the selection as attacker-controlled. Validate type and safe-integer/range constraints, bind resolution strictly to successfully restored networks for the newly created profile, require exactly one match, and fall back on missing or invalid data. Never search global networks by chain ID.

- Making `downloads` required changes it from user-triggered optional authority to always-available extension authority. It adds no host permission, but a compromised extension gains persistent download capability. A Blob-backed `<a download>` flow deserves consideration if least privilege matters.

- The account-switch races are a privacy issue, not merely stale UI: transactions or incoming transfers belonging to another account can be painted in the active account’s feed.

## Correctness/Plan

- “Use the same source of truth” conflicts with the proposed `kind === "mainnet"` fallback. `DEFAULT_SEEDS.isPrimaryActive` deliberately selects Testnet in e2e builds. Put selection in a service method that owns both seeding and fallback; do not duplicate seed policy in the composable.

- Phase 1’s migration round-trip tests would not prove live export, restore mapping, or pre-activation pointer timing. Add full import/export orchestration tests covering ID collision, partial restore, invalid/unmatched selection, old backups, fresh profiles, and explicit non-default selection.

- Several smoke gates can exercise stale `dist/`: `bun run test:e2e` does not build. Build first. The download smoke also replaces the real downloads API, so manifest assertions plus a test proving no `permissions.request` path are required.

- The competing order is better: item 2, then the fully scoped item 3, then redesigned item 1; split item 4. `mid` remains appropriate for corrected items 1–3. Escalate to `deep` only if inventing a generic restore-aware projection framework.

reject (with blocking findings: item 1b cannot work through value-projection, item 3 leaves cross-account async/event races, and item 4 lacks the required decision artifact)
---

## Final fresh pass + re-verify + confirm (session 019f8b5a)

- **Final fresh pass:** `reject` — item 3 under-scoped to incoming-only; the cross-account race spans settled-tx (`:57-60` unfiltered + `syncTransactions` racy), journal snapshot, and awaiting/dApp tasks. Item 1a + 1b mechanisms RESOLVED. Gates need `contains(false)` unit + flag-on/off dual-build.
- **Re-verify (after 4-surface expansion):** `reject` — item 3 ALSO hits the shared History page (`activity.vue`/`buildActivityRows`), cancellation state (`:480-485`), and a dApp-task data-model gap (`task/spec.ts:76-82` carries no account). Item 1a, Phase-1 gate, F3/F5/I3 all ADDRESSED.
- **Resolution:** item 3 split into its own PR-D (its size + the data-model fork make it non-bundleable).
- **Final confirm (PR-A = items 2 + 1a only):** Phase 1 OK, Phase 2 OK, scope explicit, no deferred-work dependency → **`approve`**.

## Scope-change confirm (A2: fold 1b + 4B in, split only item 3) — Phase 3/4 focused pass

User approved A1=option B, A2=one PR for items 2+1a+1b+4B with item 3 as a separate PR-D. Item 1b (was deferred) promoted to shipping Phase 3; item 4 (option B) to Phase 4. Focused codex confirm:
- **Phase 3 (1b): conditional** — mechanism sound (pre-finalize ordering + ownership OK), BUT `oldToNew` records only CHANGED ids; must build a COMPLETE identity-aware source→result map and never `oldToNew.get(raw) ?? raw` (a hostile id would trigger a global lookup). Gate must cover changed/unchanged/failed/duplicate/absent/foreign + before-finalize ordering + `useFullBackupImport` tests.
- **Phase 4: conditional** — badge sound, but rows are click-only `<div>`s (`SettingItem.vue:44-51`); use `SettingItem :to=` for keyboard-activatable router links; test keyboard, not just tap.
- **Interaction:** Phase 2's fallback smoke could be masked by Phase 3's new pointer field → the dual-mode smoke MUST use a pointer-ABSENT (legacy) backup.
- Fix stale chainId/PR-B text.
- **Verdict: `conditional approve`** — all four conditions ADOPTED into the plan (Phase 3 complete-map + no-`?? raw`; Phase 4 `:to` + keyboard test; Phase 2 pointer-absent smoke; chainId text corrected).

## Post-implementation audit (session 019f8ba3) — VERDICT: approve

Fresh codex audit of the 4-phase implementation diff + the code-review commit. **`approve` — no correctness/security blockers.**
- Phase 3 guarded correctly: checksum covers the top-level `active-network-id`; resolution is index-paired, successful-row-only, duplicate/unmatched-safe; `requireOwnedRow` prevents cross-profile targeting; write is `nulo:core:active-network@${profileId}` under the network lock before finalization.
- Phase 2 single-sources fresh + fallback from the same `isPrimaryActive` seed (incl. the e2e flag).
- Phase 1 still propagates genuine `chrome.downloads.download` failures.
- Phase 4 preserves selectors + native link keyboard behavior + synthetic-click e2e-helper compatibility.
- **[Low]** dangling `ensurePermissions` in the generated `auto-imports.d.ts` + obsolete contacts test mock → FIXED (regenerated declarations; removed the mock).
- **[Informational]** required `downloads` shows Chrome's "Manage your downloads" install warning — pre-production, no upgrade-disable impact; document the export use case for store review.

Prior Anthropic-family `/code-review max` pass: no critical/high; its two cleanups (dead ensurePermissions check + redundant setActiveNetwork) were applied in commit `95f3504`.
