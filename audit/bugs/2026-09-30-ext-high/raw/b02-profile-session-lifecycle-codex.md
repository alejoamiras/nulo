# b02-profile-session-lifecycle — codex

**Scope read:** Full files or relevant sections of:

- `CLAUDE.md`, `ARCHITECTURE.md`, `implementations-plan/lessons.md`.
- Assigned `_outer.md`, `extension-wallet.md`, and handoff map `extension-popup.md`; quality-run leads; both prior bug reports and the August 24 adjudication.
- `apps/extension/src/wallet/{runtime.ts,single-flight-start.ts,index.ts}`.
- `apps/extension/src/wallet/services/profile/{service.ts,session-manager.ts,repository.ts,profile-deletion-state.ts,tombstone-repository.ts,passkey-recovery-coordinator.ts}` and lifecycle/fence integration tests.
- `apps/extension/src/wallet/services/account/{service.ts,spec.ts,imported-keys-repository.ts}` and service, import/export, composite-key tests.
- `apps/extension/src/wallet/services/{account-integrity,profile-deletion}/coordinator.ts`.
- `apps/extension/src/wallet/services/passkey/{service.ts,check-rp-id.ts}`.
- `apps/extension/src/wallet/services/{config,legal}/service.ts`; configuration tests and `apps/extension/src/wallet/config/{store.ts,config.ts,store.test.ts,config.test.ts}`.
- Handoffs in `apps/extension/src/wallet/services/network/service.ts`, `apps/extension/src/popup/components/popups/EditAccountPopup.vue`, `apps/extension/src/popup/pages/settings/security/export/{account,seed}.vue`, and `packages/extension-messaging/src/errors.ts`.

Verification used three isolated, in-memory probes of extracted production methods. No files were written and no services were started.

## b02-profile-session-lifecycle-X-1: [Major] Account edits can resurrect an imported account after its signing key is deleted

**1. Title:** Account edits can resurrect purged accounts.

**2. Severity:** Major.

**3. Repro confidence:** High. The isolated probe finished with one Account row, zero imported-key rows, and a successful rename.

**4. Type:** Race; secondary: state invariant violation.

**5. Counter-example:** Profile P has imported account A on chain C.

1. Window A submits a rename; `patchAccountField` reads A.
2. Window B switches to another chain and deletes C’s network.
3. `clearChainState(P, C)` removes A and its imported signing key.
4. The delayed rename writes its captured Account row back and succeeds.

Re-adding C exposes A again, but attempting to use it throws “signing key missing.” The same interleaving works for visibility changes.

**6. Violated invariant:** Imported Account rows and imported-key rows must remain paired, as documented in `apps/extension/src/wallet/services/account/imported-keys-repository.ts`. A completed scope purge must not be undone by an earlier metadata edit.

**7. Failing path:** `changeAccountName` at `apps/extension/src/wallet/services/account/service.ts:303` → `patchAccountField` reads under its row lock at `:320–321` → `clearChainState` independently deletes the Account and key at `:154–156` → the edit recreates the Account at `:327` → `loadImportedAccountContract` rejects the missing key at `:370–371`.

The network handoff is `apps/extension/src/wallet/services/network/service.ts:538`, with the account subscriber registered at `apps/extension/src/wallet/services/account/service.ts:113`.

**8. Expected vs actual behavior:** The edit should finish before deletion or observe that the row is gone. Instead, it reports success and recreates an unusable account.

**9. Recommended fix:** Acquire the same per-row lock in account deletion paths, covering Account/key removal together. An edit queued after deletion then reads no row.

**10. Instances:** `apps/extension/src/wallet/services/account/service.ts:303`, `:307`, `:320–327`; uncoordinated deletion sites at `:154–156`, `:633`, and `:852`. The profile-purge variant leaves an orphan; the chain-purge variant produces the unusable imported account above.

## b02-profile-session-lifecycle-X-2: [Minor] Single-account import can publish rows after profile deletion completes

**1. Title:** Account import lacks the profile deletion fence.

**2. Severity:** Minor. Confirmed impact is persistent orphan state and false-success import completion; no loss of another live profile’s funds was established.

**3. Repro confidence:** High. The isolated probe resumed import after account purge and persisted both an Account row and an imported-key row.

**4. Type:** Race; secondary: state invariant violation.

**5. Counter-example:** Start `importAccount(P, C, validFile, A, password)`. It obtains P’s DEK and reads C’s L1 identity, then waits for signing-key encryption. Another window deletes P, completing its purge and clearing the tombstone. Encryption completes; import writes both rows for the now-absent P and returns success.

**6. Violated invariant:** `ProfileDeletionState` explicitly requires leaf writers to capture a deletion epoch before asynchronous work and reject stale writes. `createAccountInternal` follows that contract at `apps/extension/src/wallet/services/account/service.ts:249–284`; `importAccount` does not.

**7. Failing path:** `importAccount` obtains the DEK at `apps/extension/src/wallet/services/account/service.ts:469`, reads network identity at `:487`, and awaits encryption at `:493`. Profile deletion advances the epoch at `apps/extension/src/wallet/services/profile/service.ts:1486` and invokes the awaited purge at `:1512`. Import subsequently writes the key at `account/service.ts:499` and Account at `:513` without checking that epoch.

**8. Expected vs actual behavior:** An import whose profile was deleted should reject without publishing rows. Instead, it succeeds after cleanup. The startup orphan-key sweep retains the key because its matching Account row also exists.

**9. Recommended fix:** Capture the deletion epoch before obtaining the DEK, reject reserved profiles, and validate the captured epoch when committing. Coordinate the key/Account commit with profile purge so deletion between the two writes cannot leave partial state.

**10. Instances:** `apps/extension/src/wallet/services/account/service.ts:469`, `:493`, `:499`, `:513–519`.

## b02-profile-session-lifecycle-X-3: [Minor] Retrying a failed configuration write reports success without saving

**1. Title:** A failed settings write poisons the same-value retry.

**2. Severity:** Minor.

**3. Repro confidence:** High. The isolated probe produced a successful retry with `memory.theme === "dark"`, persisted theme `"system"`, and only one attempted storage write.

**4. Type:** Wrong result; secondary: bad error path.

**5. Counter-example:** Persisted and in-memory theme are `"system"`. Call `ConfigService.setValue("theme", "dark")` while the next storage write fails transiently. The call rejects, but memory already contains `"dark"`. Storage recovers; retry the identical call. It resolves without writing. After worker restart, the theme returns to `"system"`.

**6. Violated invariant:** A successful settings setter must save the requested setting. Equality with an unpersisted in-memory value does not establish that the setting is already saved.

**7. Failing path:** `apps/extension/src/wallet/services/config/service.ts:50–51` → `ConfigStore.set` mutates memory and emits at `apps/extension/src/wallet/config/store.ts:64–65` → persistence rejects at `:66` → retry exits through the equality shortcut at `:61–62`.

**8. Expected vs actual behavior:** The retry should persist `"dark"` or report failure. It instead reports success while durable configuration remains unchanged.

**9. Recommended fix:** Under the existing lock, persist a staged configuration before replacing memory and emitting updates. Apply the same ordering to `apply()`, which also publishes changes before persistence.

**10. Instances:** `apps/extension/src/wallet/config/store.ts:61–66` and `:93–98`; exposed through `apps/extension/src/wallet/services/config/service.ts:50–55` and restore at `:74`.

## Leads adjudicated

- **q02 — `patchAccountField` address mismatch:** Rejected as a normal-operation correctness finding; the supplied counter-example requires a transplanted storage row. Routed to security. X-1 is a separate purge race requiring valid rows only.
- **q02 — `exportMnemonic` legacy password error:** Rejected. `apps/extension/src/popup/pages/settings/security/export/seed.vue:64–65` handles any rejection as the wrong-password state; it does not require `InvalidPasswordError`.
- **q10 — profile master-byte comparisons:** Rejected as correctness findings. Timing properties belong to security review; no wrong result was established.
- **q13 — `ImportedAccountUnusableError` loses its class across RPC:** Rejected. The transport does flatten it, but no production popup/composable consumer checking that class was found. Its explanatory message survives.

## Routed to security

- `apps/extension/src/wallet/services/account/service.ts:322–327`: missing address-identity check lets a storage-transplanted row redirect a metadata write onto another account’s key.
- `apps/extension/src/wallet/services/profile/service.ts:2015`, `:2330`: secret-byte equality timing lead; security assessment only, with exploitability unestablished here.
- `apps/extension/src/wallet/services/profile/session-manager.ts:858–861`: a rejected refresh persistence write skips alarm rescheduling after the in-memory deadline changed; the old alarm is then discarded at `:828`. This concerns proactive auto-lock enforcement; lazy expiry remains.

## Non-findings considered

- Prior B-01: session open/close now mutate memory first and explicit lock performs durable read-back.
- Prior B-12: failed tombstone writes now release reservations when durable absence is confirmed.
- Prior N-03: `createAccountInternal` now captures and checks deletion epochs. X-2 concerns the separate import path.
- Prior N-06: orphan imported-key sweeping now uses physical Account keys.
- Prior N-12: session artifact locking and generation checks protect successor session artifacts.
- Strict-mode locking after worker restart and passkey finalization fallback are documented behavior.
- Same-row rename/visibility lost updates are serialized correctly; X-1 concerns deletion outside that serializer.
- Single-flight startup’s retry veto after partial registration is intentional.
- Tombstoned-profile rename behavior is explicitly marked `(BUG PIN)` and was excluded.
- A stale deletion-resume snapshot was considered, but no sufficiently grounded production interleaving was established within the context cap.

## Cross-rebuttal (codex on claude)

**1. Overconfident / wrong in Claude’s findings**

- **b02-profile-session-lifecycle-C-1 — Partially agree (high confidence).** The missing fence is real, but the stated counter-example fails: if deletion completes during file decoding, the subsequent network lookup throws at `apps/extension/src/wallet/services/network/service.ts:383`. The surviving counter-example requires import to pass `account/service.ts:487` before deletion, then resume encryption or persistence afterward.
- **C-1’s severity — Minor fits orphaned imports; the rename variant is understated.** Calling it “negligible” overlooks the consequence: `account/service.ts:154–156` deletes an imported account and its key, while a delayed edit recreates only the Account at `:327`; signing subsequently fails at `:371`. That supports **Major** for the chain-purge variant, regardless of its short timing window.
- **C-1’s fix — Incomplete.** Checking the epoch only before `importedKeys.set` at `account/service.ts:499` leaves an awaited gap before the Account write at `:513`. Coordinate both writes with purge and retain appropriate cleanup; the first check alone does not protect the pair.

**2. Rejected leads / non-findings I dispute**

- **Configuration persistence — Disagree (high confidence).** Storage failures are explicitly eligible environmental conditions. More importantly, this is not merely temporary memory/disk disagreement: after persistence rejects at `apps/extension/src/wallet/config/store.ts:66`, retrying the identical value returns success at `:61–62` without another write. My in-memory probe reproduced this.
- **q02 address transplant, q02 mnemonic error string, q13 error-class flattening — Agree with rejection as correctness findings.** The transplant needs a storage writer; `export/seed.vue:64–65` catches all errors; no production consumer relying on `ImportedAccountUnusableError` identity was found.
- **q10 byte comparisons — Agree with excluding them from correctness.** That exclusion does not establish Claude’s separate assertion that the paths are untimable.

**3. What Claude missed that I found**

- **b02-profile-session-lifecycle-X-1 — Missed impact, not mechanism:** chain purge plus delayed rename/visibility edit leaves a visible imported account without its signing key; `apps/extension/src/wallet/services/account/service.ts:156`, `:327`, `:371`. I retain **Major**, high confidence.
- **b02-profile-session-lifecycle-X-3 — Missed retry failure:** a rejected settings write makes the same-value retry falsely succeed without persisting; `apps/extension/src/wallet/config/store.ts:61–66`. I retain **Minor**, high confidence.
- **b02-profile-session-lifecycle-X-2 overlaps C-1.** Retain one consolidated import finding with the corrected post-network-lookup interleaving; do not count it twice.

**4. What BOTH missed**

No additional finding established in this light pass.