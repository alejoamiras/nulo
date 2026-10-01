# Recon — profile-service-dedup (Phase 0.4)

Read-only recon against `origin/dev` @ `7f2a4dfd` (worktree content identical). Target: `apps/extension/src/wallet/services/profile/service.ts` (2601 lines).

## Reuse map

| Capability needed | Existing code found | Verdict |
|---|---|---|
| Exclusive execution | `Lock`/`KeyedLock` in `packages/wallet-core/src/utils/lock.ts:17` + local `runExclusive` wrapper (`service.ts:281`) | **reuse-as-is** (primitive); wrapper stays |
| Snapshot/state-capture helper | none — "snapshot" is a local variable convention; searched `captureState|getState|snapshot` across `packages/wallet-core` + `profile/` (only unrelated hits: `migration/migrator.ts:445`, `activity/causal.ts`) | **build new** (private methods; "fence" vocabulary already established via `ExecutionFence`, `profile-deletion-state.ts:17`) |
| Unlock/session guard helper | `require-active-profile.ts:24` — consumer-side guard used by 13+ sibling services, NOT usable for service-internal phases (duck-typed `{getActiveProfile()}`, can't reach `this.repo`/`this.deletionState`) | **build new** (service-internal) |
| Extraction precedent | `…HoldingLock` private-method convention: `token-balance/service.ts:60,310,462`, `token/service.ts:548-554` (doc: "caller MUST already hold the lock — not reentrant"); separate-file collaborators for substantial concerns (`profile/` already does this: `session-manager.ts`, `repository.ts`, …) | **adapt** (imitate the convention) |
| Prior in-file burn-down | none — `#490` (`3f6a0528`) added the 11 directives mechanically, zero logic change; `#489` did NOT touch this file (it exported this file's fencing idiom to siblings) | **build new** (first extraction attempt) |

## Directive inventory (matches `scripts/complexity-baseline/manifest.json`: 8 cognitive + 3 lines-per-function)

| Line | Method | Rule / score |
|---|---|---|
| 485 | `unlockProfile` (438–551) | cognitive 19 |
| 682 | `unlockPasskeyProfile` (638–739) | cognitive 21 |
| 890 | `changeProfilePassword` (888–1031) | cognitive 33 |
| 1237 | `deleteProfile` (1232–1345) | cognitive 28 |
| 1368 | `resumePendingDeletions` (1369–1470) | cognitive 16 |
| 1489 | `exportPlain` (1490–1618) | cognitive 25 |
| 2085/2086 | `restore` (2087–2412) | cognitive 36 + 171 lines |
| 2434 | `finalizeRestore` outer (2435–2600) | 94 lines |
| 2438/2439 | `finalizeRestore` inner | 92 lines + cognitive 46 |

All 8 suppressed methods participate in ≥1 clone — complexity and duplication are the same mass.

## Clone families (jscpd 5.0.16, min-tokens 50: 13 clones, 202 dup lines, 7.77% on this file)

- **F1** mint row → `repo.set` → emit `onProfileAdded` → `openSessionVerified`: `createProfile` 391–420, `createPasskeyProfile` 596–611, `importPasswordProfile` 1993–2012, `importPasskeyProfile` 2038–2069, `restore` both branches (no `openSessionVerified` there, by design).
- **F2** phase-1 snapshot under lock: `unlockProfile` 441–457, `unlockPasskeyProfile` 641–658, `confirmProfileOperation` 1042–1053.
- **F3** phase-3 re-fetch + revalidate + reject-stale: `unlockProfile` 487–498, `unlockPasskeyProfile` 684–696.
- **F4** minimal `runExclusive(get + null-check)` opener: `changeProfileName` 871–875, `changeProfilePassword` 891–895.
- **F5** post-hoc revalidate `!row || isReserved || !isCurrent(epoch)` — 5 sites with a byte-identical CONDITION but **two wrappings** (codex round-1 correction): 1092 + 1821 refetch+check INSIDE their own `runExclusive`; 1596, 1656, 1751 refetch+check lock-free. Any helper must preserve the wrapping per site.
- **F6** capture `{profile, capturedEpoch}` under lock — **5 byte-identical sites**: 1053, 1504, 1639, 1734, 1796 (1053 names the row `snapshot`, the rest `profile` — same shape).
- **F7/F8** unseal(password, triple) → null-check: `exportPlain` 1581–1588, `exportBackupMaterial` 1644–1653, `exportImportedKeysDek` 1740–1748, `exportMnemonic` 1801–1811. **Divergent tails** (codex round-1 correction): `exportImportedKeysDek` has NO `assertEntropyMasterPair` at all; `exportMnemonic` derives the words BEFORE the pair-assert; the others assert after revalidation. Only the ciphertext-triple projection is truly shared — it recurs **8×**: 462, 901, 1062, 1582, 1645, 1741, 1802, 2484.
- **F9** restorePending marker → `repo.set` + compensating delete → emit, password vs passkey branch of `restore`: 2219–2240 ↔ 2348–2367.
- jscpd's 40-line `1490–1529 ↔ 1784–1805` pair is a scanner artifact straddling F6+F7/F8 with different control flow either side — NOT an extract-verbatim target.

## Near-clone deviations (behavior-preservation traps)

1. **Unseal-failure error matrix** (corrected in codex round 1): `exportBackupMaterial`/`exportImportedKeysDek` propagate typed `InvalidPasswordError`; `exportPlain` throws it internally but its outer catch (1614–1617) FLATTENS every failure to plain `Error(message)` — the observable contract is the message, not the class; `exportMnemonic` (1807–1811) throws plain `Error("Invalid profile old password")`. That exact string is consumed by `popup/pages/settings/security/change-password.vue:79` matching `changeProfilePassword`'s identical throw (`service.ts:906`); `exportMnemonic`'s inline comment misattributes the consumer to "the import flow" — fix the attribution when touched. Errors stay per-site; no shared throw helper.
2. **Import guards differ**: `createPasskeyProfile` 590–592 throws typed `ProfileIdConflictError`; `importPasskeyProfile` 2038–2040 throws plain `Error("Passkey profile already exists")`, adds `assertNotDuplicateCredential` (2043) and threads `allowDuplicate` (2045) where create paths hardcode `false`. Guards stay call-site-specific.
3. **Unlock phase-3 differs in kind**: `unlockProfile` compares raw ciphertext strings (499); `unlockPasskeyProfile` recomputes `computeWalletFingerprint` (706–709). Degraded-session log messages differ (533 vs 719–721). **`zeroize(dek)` timing differs**: `unlockProfile` zeroizes in the outer `finally` (549, after lock release); `unlockPasskeyProfile` inside the locked callback (725–733). Preserve per-site.
4. **Event order is uniform but the earlier wording was wrong** (codex round-1 correction): the creation/import order is `repo.set` → emit `onProfileAdded` → `openSessionVerified` at all four opening sites (413–417, 605–609, 2009–2011, 2066–2068); restore's two branches do set → emit with NO open (late activation). The degrade emit (`onImportedKeysDegraded`) fires AFTER the open at all four degrade sites. Uniform ⇒ a set+emit tail helper is safe for create/import; restore needs a marker-bracket variant WITHOUT the emit (its compensation catch wraps only `repo.set`, and the emit comes after the bracket — 2225–2235).
5. **Restore error-conversion lock boundary differs by branch** (codex round 1): the password branch catches and builds `restoreError` INSIDE the locked callback (2254–2266 — comment says byte-equivalent to catch-before-release); the passkey branch's catch sits OUTSIDE `runExclusive` (2387–2394). A branch split must carry each catch verbatim with its branch.

Also: `runExclusive` (`service.ts:281`) drops `Lock.withLock`'s `isCurrent` callback param added by #489 — call sites can't see displacement. Do NOT widen in this arc (scope); note as follow-up.

## Test surface

- **The suite**: `apps/extension/src/wallet/services/profile/service.integration.test.ts` (2647 lines) — only file constructing a real `ProfileService`; real crypto + `FakeBrowserApi`; 21 describe blocks pinning exactly the phase-1/2/3 concurrency shapes. Run: `bun run --cwd apps/extension test src/wallet/services/profile/service.integration.test.ts` (or the whole `src/wallet/services/profile/` dir to include collaborator units).
- Collaborator units: `session-manager.test.ts`, `session-manager.fence.test.ts`, `repository.test.ts`, `profile-deletion-state.test.ts`, etc.
- E2E touching profiles indirectly: `auth-flows`, `backup-*`, `passkey-paths`, `import-paths`, `security*`, `profile-rename`, `registration` (Puppeteer; CI smoke gate covers).

## Collision risks

Three stale worktrees diff `service.ts` (`fix-profile-deletion-status` 78 behind, `mac-identity-binding` 46 behind, `account-artifact-freeze` 162 behind) — each pre-dates a feature that already landed via another lineage (#405, #446); git evidence says abandoned, none is a live tip. Non-blocking; flag to owner at wrap-up, delete nothing.

## Baseline mechanics (operative for every phase)

Removing a directive without regenerating reds `bun run lint` (shrinkage-not-recorded). So every phase that drops a method under budget ends with `bun run baseline:complexity` + commit the shrunken manifest. Generator refuses growth without `--adopt` — safe to run repeatedly.
