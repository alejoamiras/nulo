## Findings

### 1. Clipboard behavior is duplicated across twelve call sites

**Smell:** Duplicate Code, with Shotgun Surgery. The same “write text, then show a copy toast” policy appears in twelve implementations. Two security-export pages additionally duplicate the entire delayed clipboard-scrub lifecycle.

**Impact bucket:** structural. Blast radius: 12 files across settings, transaction/detail pages, and one composable. Change frequency: high collectively—10 commits touched these files since 2026-07-01.

**Evidence:**

- Seven handlers repeat the same two operations, differing only in value and toast label:
  - [about.vue](apps/extension/src/popup/pages/settings/about.vue:19)
  - [accounts/index.vue](apps/extension/src/popup/pages/settings/accounts/index.vue:60)
  - [contacts/index.vue](apps/extension/src/popup/pages/settings/contacts/index.vue:121)
  - [fpcs/index.vue](apps/extension/src/popup/pages/settings/fpcs/index.vue:70)
  - [connected-apps/[id].vue](apps/extension/src/popup/pages/settings/connected-apps/[id].vue:131)
  - [tokens/[id].vue](apps/extension/src/popup/pages/tokens/[id].vue:101)
  - [tx/[id].vue](apps/extension/src/popup/pages/tx/[id].vue:106)

  Each calls `navigator.clipboard.writeText(...)` followed by `openToast({ label: ..., icon: "copy" })`.

- Three variants surround the same logic with local copied-state or error handling:
  - [senders/index.vue](apps/extension/src/popup/pages/settings/advanced/account-state/senders/index.vue:46)
  - [useProfileImportFlow.ts](apps/extension/src/composables/useProfileImportFlow.ts:85)
  - [received/[id].vue](apps/extension/src/popup/pages/received/[id].vue:139)

- The secret exporters duplicate the security-sensitive implementation: copied-state, copy toast, replacement of the previous scrub timer, a 60-second unconditional clipboard clear, and the deliberate decision not to cancel that timer on unmount:
  - [export/key.vue](apps/extension/src/popup/pages/settings/security/export/key.vue:76), copy/scrub at lines 82–95 and unmount policy at 109–116.
  - [export/seed.vue](apps/extension/src/popup/pages/settings/security/export/seed.vue:66), copy/scrub at lines 72–85 and unmount policy at 99–106.

**Why it harms future change:** A change to clipboard failure handling, toast wording/duration, copied-state timing, or browser permission behavior must be found and repeated across the ordinary handlers. More seriously, changing the secret retention interval or scrub lifecycle requires synchronized edits to both exporters; missing one creates two different secret-handling policies.

**Smallest safe refactoring:** Apply **Extract Function** to the seven identical fire-and-forget copy/toast handlers, preserving their current behavior and accepting the value and label. Apply **Extract Composable** separately to the two secret-export blocks—for example, a narrowly scoped secret clipboard hook owning `isCopied`, the scrub timer, and its intentional post-unmount lifetime. The copied handlers, timer constant, duplicated rationale, and duplicated scrub callback disappear; richer senders/import/received variants can delegate only their shared copy step without forcing one oversized options API.

**Instances:**

- `apps/extension/src/popup/pages/settings/about.vue:19-22`
- `apps/extension/src/popup/pages/settings/accounts/index.vue:60-63`
- `apps/extension/src/popup/pages/settings/contacts/index.vue:121-124`
- `apps/extension/src/popup/pages/settings/fpcs/index.vue:70-73`
- `apps/extension/src/popup/pages/settings/connected-apps/[id].vue:131-134`
- `apps/extension/src/popup/pages/tokens/[id].vue:101-104`
- `apps/extension/src/popup/pages/tx/[id].vue:106-109`
- `apps/extension/src/popup/pages/settings/advanced/account-state/senders/index.vue:46-55`
- `apps/extension/src/composables/useProfileImportFlow.ts:85-93`
- `apps/extension/src/popup/pages/received/[id].vue:139-146`
- `apps/extension/src/popup/pages/settings/security/export/key.vue:76-95,109-116`
- `apps/extension/src/popup/pages/settings/security/export/seed.vue:66-85,99-106`

---

### 2. Single-slot and keyed fee estimators maintain parallel copies of the same state machine

**Smell:** Duplicate Code, producing Shotgun Surgery. `useFeeEstimationMap` is largely a keyed translation of `useFeeEstimation`: both independently implement debounce ownership, sequence invalidation, RPC token generation, remote cancellation, stale-result suppression, completion handoff, and disposal.

**Impact bucket:** structural. Blast radius: 2 composable modules and their consumers. Change frequency: 2 commits since 2026-07-01; importantly, both fee-estimation files were changed together in both execution-estimation commits on 2026-08-07.

**Evidence:**

- Single-slot state and algorithm:
  - state ownership: [useFeeEstimation.ts](apps/extension/src/composables/useFeeEstimation.ts:61)
  - timer and owned-token cancellation: lines 70–94
  - debounced estimation, stale counter, transport-failure cancellation: lines 96–129
  - handoff and disposal: lines 131–145

- Keyed copy of that algorithm:
  - keyed state ownership: [useFeeEstimationMap.ts](apps/extension/src/composables/useFeeEstimationMap.ts:61)
  - keyed timer and owned-token cancellation: lines 73–99
  - keyed debounced estimation, stale counter, transport-failure cancellation: lines 106–141
  - handoff and disposal: lines 143–166

The keyed error path even says “See `useFeeEstimation`” at lines 128–129, while reimplementing the behavior beneath it. Git blame shows remote cancellation and handoff changes from commits `5f1152863` and `204f2bf45` applied to both copies.

**Why it harms future change:** Any evolution of estimate ownership—such as changing when an RPC token is considered started, how transport failures are canceled, or which completed estimates may be handed off—requires two equivalent edits. This is concurrency-sensitive code, so a subtle difference between the scalar and keyed versions is expensive to review and test.

**Smallest safe refactoring:** Use **Extract Function** to create one internal keyed estimation engine containing timer, counter, in-flight/completed-token, cancellation, and disposal behavior. Implement the scalar composable as a one-key adapter and retain the two existing public result shapes. The duplicate state-transition and cleanup implementations disappear while callers remain unchanged.

**Instances:**

- `apps/extension/src/composables/useFeeEstimation.ts:61-145`
- `apps/extension/src/composables/useFeeEstimationMap.ts:61-166`

---

### 3. `restoreBackup` is a 532-line restore transaction

**Smell:** Long Method. It contains validation, migration, credential ceremony, entity restoration, hostile-input filtering, identifier remapping, rollback, session activation, network synchronization, error presentation, and client lifecycle management in one function.

**Impact bucket:** structural. Direct blast radius: 1 file/function; dependency blast radius: profile, network, account, token, token-balance, transaction, auth-registry, FPC, contact, config, and account-state modules. Change frequency: high—9 commits since 2026-07-01.

**Evidence:** [useFullBackupImport.ts](apps/extension/src/composables/useFullBackupImport.ts:208) contains one uninterrupted `restoreBackup` method through line 739:

- integrity, compatibility, version, and migration gates: lines 219–312
- profile/passkey restoration and rollback bookkeeping: lines 314–397
- network restoration and ID remapping: lines 398–460
- account restoration and provenance filtering: lines 462–557
- token restoration and balance relinking: lines 559–619
- six additional service restores and cleanup: lines 621–648
- session finalization and account-state chain synchronization: lines 650–718
- outer rollback and client cleanup: lines 719–738

**Why it harms future change:** Adding or changing a backup slice requires reasoning about ordering across all of these phases: whether it runs before or after activation, which identifiers must be remapped, which hostile references must be filtered, how errors are accumulated, and whether a failure deletes or preserves the created profile. The nine recent commits show this coordinator is already a frequent landing point for unrelated backup concerns.

**Smallest safe refactoring:** Apply staged **Extract Function** refactorings while retaining `restoreBackup` as the transaction coordinator. Extract the self-contained trust-gate/migration phase, profile/network graph restoration, account-owned-slice filtering, token/balance relinking, generic slice restoration, and finalization/chain-sync phases. The 532-line body becomes an explicit ordered pipeline, while rollback flags and top-level `try/finally` remain centralized.

**Instances:**

- `apps/extension/src/composables/useFullBackupImport.ts:208-739`

## Non-findings

- **Settings-page shell:** Repeated `SubPageHeader` and `Flex` markup is shallow declarative layout; pages vary in wrappers, slots, gaps, and navigation targets, so no synchronized behavioral policy was established.
- **Account-state watchers:** The four pages watch different identity scopes and have different fetch guards; the resemblance does not justify a common lifecycle abstraction.
- **Multi-client page cleanup:** Parent-owned connect/disconnect is the repository’s explicit C1 convention, and teardown ordering can be significant. A generic ownership helper would hide rather than remove that responsibility.
- **Fee formatting guards:** The three `formatFeeJuice(BigInt(...))` expressions are trivial and localized; extraction would add more indirection than change leverage.
- **Service-owning composables:** `fullscreenPopupSetting` and `useProfileBootstrap` deviate from the documented C1 convention, but convention deviation alone does not establish a named catalog smell.
- **Dead code:** No production symbol met the required absence-of-references standard. Page routing and the repository’s component/composable/store auto-registration mechanisms make raw textual reference counts insufficient evidence.