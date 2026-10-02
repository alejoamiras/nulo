# q02-wallet-profile-state — codex

Scope read:

- Production implementations, contracts, and clients under `apps/extension/src/wallet/services/{profile,account,account-state,account-integrity,profile-deletion,backup,config,legal,contact,passkey}/`.
- `apps/extension/src/wallet/services/{purge-rows,restore-rows,restore-fence,require-owned-row,id-allocators}.ts`.
- `apps/extension/src/wallet/storage/index.ts` and `storage/migrations/index.ts`.
- Handoff dependencies: `apps/extension/src/wallet/utils/raw-row.ts`; `packages/wallet-crypto/src/{imported-keys-dek-box,encryption-key}.ts`.
- Selected profile integration tests, config tests, and test-declaration inventories.
- `CLAUDE.md`, supplied maps and clone leads, both prior audit reports, and the historical `implementations-plan/profile-service-dedup/` decision record.

Reviewed `dev` at `910a4def`. No files modified; tests were not run. History counts below use the current path without `--follow`, reporting total commits / commits since `2026-06-01`.

## q02-wallet-profile-state-X-1: Profile construction repeats one persisted contract across six paths

**Title:** Six independently maintained profile-row constructors.

**Smell name:** Duplicate Code — Fowler.

**Maintenance impact:** **Local**, with six construction sites in one production file. Change frequency: `profile/service.ts` **25 / 25 commits**. **Confidence: moderate**: duplication and repeated edits are verified; the benefit of extraction must outweigh the extra parameter plumbing.

**Concrete evidence:** Each path assembles the same credential-specific profile shape, stamps a fresh PXE generation, and attaches the sealed DEK and wallet fingerprint; the three password paths additionally assemble the same envelope-MAC inputs.

| Path | Location |
|---|---|
| Create password profile | `apps/extension/src/wallet/services/profile/service.ts:606-623` |
| Create passkey profile | `apps/extension/src/wallet/services/profile/service.ts:763-771` |
| Import password profile | `apps/extension/src/wallet/services/profile/service.ts:2162-2175` |
| Import passkey profile | `apps/extension/src/wallet/services/profile/service.ts:2222-2231` |
| Restore password profile | `apps/extension/src/wallet/services/profile/service.ts:2413-2433` |
| Restore passkey profile | `apps/extension/src/wallet/services/profile/service.ts:2590-2598` |

This has already amplified changes: commit `152b1083` added both `dekSealed` and `walletFingerprint` to six row literals; `d56d6a85` updated three separate password-construction MAC calls.

The historical refactor explicitly accepted the create/import literal clone because a seven-parameter builder was considered worse (`implementations-plan/profile-service-dedup/plan.md:107`). This finding concerns the broader six-site construction contract and its demonstrated co-change cost, rather than the token-clone count alone.

**Why it harms future change:** A profile-envelope change requires finding every producer and applying the same generation, fingerprint, and MAC-construction rules. The existing `persistNewProfileHoldingLock` centralizes persistence and emission, but receives rows whose construction policy remains distributed.

**Smallest safe refactoring:** **Extract Function** into `apps/extension/src/wallet/services/profile/profile-row.ts`: separate typed password and passkey row builders, using grouped object inputs. Start with the password builder, including MAC assembly after the caller has finalized the ID. Keep ID allocation, credential acquisition, locking, buffer ownership, restore markers, and session activation in their current callers.

**What disappears:** Three password-row/MAC construction implementations become one; three passkey-row constructors become one. Net line savings are modest; the useful reduction is from six independently maintained construction contracts to two.

**Instances:** `apps/extension/src/wallet/services/profile/service.ts:606`, `:763`, `:2162`, `:2222`, `:2413`, `:2590`.

## q02-wallet-profile-state-X-2: Config restore still copies the shared best-effort restore loop

**Title:** Config restore bypasses `restoreRows`. **RECURRING (prior: 2026-08-16 Q-07).**

**Smell name:** Duplicate Code — Fowler; incomplete adoption of an existing extraction.

**Maintenance impact:** **Local**, spanning two production files: the config service and shared helper. Change frequency: `config/service.ts` **4 / 4 commits**; `restore-rows.ts` **1 / 1 commit**. **Confidence: high.**

**Concrete evidence:** Both implementations iterate rows sequentially, await one write, append the successful row, and convert a rejected write into a shallow copy of the original row carrying `restoreError`, then continue:

- `apps/extension/src/wallet/services/config/service.ts:62-84`, particularly `:73-81`.
- `apps/extension/src/wallet/services/restore-rows.ts:22-34`.

Config’s allowlist check at `config/service.ts:69-72` is additional policy; it does not change the duplicated write/error-collection algorithm. The account paths have adopted the helper at `account/service.ts:695` and `:779`, so that portion of the prior finding is fixed.

**Why it harms future change:** A change to the shared restore-result contract or per-row failure handling still requires a separate config edit. Config looks like a normal member of the restore family but silently retains its own implementation.

**Smallest safe refactoring:** **Substitute Algorithm** with the existing `restoreRows` in `apps/extension/src/wallet/services/restore-rows.ts`. Retain config-specific allowlist filtering and skipped-key warnings locally, then pass accepted rows to a callback that awaits `setValue` and returns the input row. Preserve omission of skipped keys from results.

**What disappears:** Config’s independent result accumulator, write `try/catch`, and error-row construction; its direct `toRestoreError` import also becomes unnecessary.

**Instances:** `apps/extension/src/wallet/services/config/service.ts:62`; `apps/extension/src/wallet/services/restore-rows.ts:22`.

## q02-wallet-profile-state-X-3: ProfileService still owns several independently changing lifecycle policies

**Title:** ProfileService remains a concentration of unrelated responsibilities. **RECURRING (prior: 2026-08-16 Q-01, ProfileService instance).**

**Smell name:** Large Class / Divergent Change — Fowler.

**Maintenance impact:** **Structural**. One 2,797-line implementation owns credential changes, session admission, deletion recovery, exports, and backup restoration. Its collaborators include `SessionManager`, the deletion coordinator, and account restore. Change frequency: `profile/service.ts` **25 / 25 commits**; `session-manager.ts` **13 / 13**; `profile-deletion/coordinator.ts` **8 / 8**. **Confidence: high.**

**Concrete evidence:** Distinct policies remain implemented within the same class:

- Pending secret/rewrap storage, expiration, and consumption: `apps/extension/src/wallet/services/profile/service.ts:124-239`.
- Password rotation: `apps/extension/src/wallet/services/profile/service.ts:1033-1188`.
- Session admission and integrity enforcement: `apps/extension/src/wallet/services/profile/service.ts:1262-1335`.
- Deletion, crash recovery, and abandoned-import sweeping: `apps/extension/src/wallet/services/profile/service.ts:1361-1666`.
- Export formats and credential material: `apps/extension/src/wallet/services/profile/service.ts:1685-2081`.
- Backup restore and finalization: `apps/extension/src/wallet/services/profile/service.ts:2254-2796`.

History confirms independent reasons to change: abandoned-import recovery (`52c065a7`), envelope binding (`d56d6a85`), and execution-session fencing (`7f08d802`) all modify this owner.

The prior decomposition removed long-method complexity directives and extracted useful helpers. It did not separate these state owners.

**Why it harms future change:** Changing pending-restore expiration requires reasoning across the maps near the class head, consumption, lock cleanup, deletion cleanup, restore writes, and finalization. Those ownership rules are interleaved with password and session policies that change independently. A reviewer cannot assess the pending-state change within a bounded module.

**Smallest safe refactoring:** **Extract Class**, starting with `PendingRestoreContexts` in `apps/extension/src/wallet/services/profile/pending-restore-contexts.ts`. Move the two pending maps and their store/take/sweep/drop/zeroization operations behind that collaborator. Preserve the existing facade lock and public `consumeDekRewrapContext` interface; the collaborator should neither acquire that lock nor open sessions.

**What disappears:** Two mutable maps, the expiration constant, and their lifecycle implementations leave `ProfileService`, replaced by narrow calls. Code moves rather than vanishes; direct access to pending secret ownership becomes confined to one module.

**Instances:** `apps/extension/src/wallet/services/profile/service.ts:124`, `:159`, `:172`, `:194`, `:219`, `:919`, `:1033`, `:1262`, `:1431`, `:1441`, `:1462`, `:1554`, `:1685`, `:2254`, `:2442`, `:2610`, `:2654`, `:2749`.

## Non-findings considered

- **Password export scaffolding:** the apparent clones preserve different error identities, pairing-check order, fence placement, and returned-buffer ownership; `profile/service.integration.test.ts:3055-3082` pins important differences, and the earlier `unsealForExport` proposal was explicitly rejected.
- **Unlock phase-three prologues:** password ciphertext revalidation and passkey credential revalidation enforce different contracts; a shared “unlock” algorithm would conceal those differences.
- **Previous lock/FIFO findings:** `ProfileService.runExclusive` delegates to `Lock.withLock`; account tuple serialization uses `KeyedLock`. The inspected instances of 2026-08-14 Q-01 and 2026-08-16 Q-08 are fixed.
- **Previous restore/ID findings:** account restore uses `restoreRows`; contact restore uses `preferOrReallocId`; profile allocation uses `nextRandomId` with an additional deletion-reservation check. Only the config exception is re-reported.
- **Marker repositories:** tombstone, restore-pending, and integrity records intentionally distinguish physical presence from successful decoding; they already share `decodeRow`, while deletion predicates and public lookup semantics differ.
- **Password/passkey DEK sealing:** the inspected implementations use different key derivation and versioned frames; their similar AES-GCM purpose does not make them interchangeable.
- **Account-state registration:** sender and contract restoration share the prepared-registration execution loop; contract-specific prechecks explain the remaining branch differences.
- **Backup registry switches and row-map interpreter:** they express the supported data algebra; accepted complexity directives are not findings.
- **Service spec/client/service triads and storage barrel:** documented boundaries, without an independently demonstrated maintenance cost here.

## Incidental bugs noticed (for the bugs run)

- `apps/extension/src/wallet/services/profile/service.ts:1010` — after a crash leaves both a profile row and its deletion tombstone, `changeProfileName` still writes the row and emits an update although profile reads hide it as deleted; its lookup checks presence only. This is already demonstrated by the existing bug pin at `apps/extension/src/wallet/services/profile/service.integration.test.ts:3097`.

## Cross-rebuttal (codex on claude)

**Overconfident / wrong in Claude’s findings**

- **q02-wallet-profile-state-C-1 — Partially agree (high confidence).** The six row constructors duplicate persisted-shape policy, but not one identical lifecycle: restore defers session opening (`apps/extension/src/wallet/services/profile/service.ts:2435-2448`), and create performs sealing outside the lock (`:598-602`). Keep the two row builders; reject the additional create/import merge unless it demonstrably preserves crypto placement and buffer ownership. The claimed 55–70-line saving is unproven.

- **q02-wallet-profile-state-C-2 — Disagree as framed (high confidence).** The alleged “drift” is explicitly preserved behavior: error identities, pairing order, fence placement, and zeroization were adjudicated in `implementations-plan/profile-service-dedup/plan.md:29-39`. `exportMnemonic` checks its fence **after** derivation (`apps/extension/src/wallet/services/profile/service.ts:1983-1991`); the proposed pre-callback check changes that ordering. Its wrong-password message is also test-pinned, so the incidental-bug claim lacks a demonstrated failing caller.

- **q02-wallet-profile-state-C-3 — Partially agree (high confidence).** The four open/warn/return tails are real duplicates (`apps/extension/src/wallet/services/profile/service.ts:702-706`, `:851-855`, `:2726-2730`, `:2787-2791`). Split these from the overstated guard family: `getProfileDek` reads session state (`:1957-1962`), while `getPxeGeneration` deliberately returns `undefined` for reserved/missing rows (`:2134-2138`). They cannot uniformly become a throwing row lookup.

- **q02-wallet-profile-state-C-4 — Partially agree (moderate confidence).** The enumeration loops match at `apps/extension/src/wallet/services/profile/tombstone-repository.ts:72-91` and `restore-pending-repository.ts:77-91`. However, corrupt-value classification already lives in `apps/extension/src/wallet/utils/raw-row.ts:7`; repository lookup and deletion semantics differ. A narrow scan helper is defensible; “Alternative Classes with Different Interfaces,” ~100 lines removed, and counting an unverified operation-journal caller overstate the evidence.

- **q02-wallet-profile-state-C-5 — Agree, narrowly (high confidence).** Identity predicates and scalar decoding are two separate duplication roots. The scalar helper can share `apps/extension/src/wallet/services/account/service.ts:380-384` and `:428-432`, retaining caller-owned DEKs, authentication, error translation, and cleanup timing. The missing address check at `:322` is a concrete separate correctness/security lead, not merely a quality symptom.

- **q02-wallet-profile-state-C-6 — Partially agree (high confidence).** Config’s copied loop is confirmed (`apps/extension/src/wallet/services/config/service.ts:73-81` versus `restore-rows.ts:27-32`). The surrounding restore scaffolding already delegates its substantive algorithms; visible epoch-capture and lock placement carry ordering semantics (`restore-fence.ts:2-8`). Four repeated casts do not establish the broader seven-service maintenance finding.

**What Claude missed that I found**

- **q02-wallet-profile-state-X-3 — Still stands (high confidence).** Claude’s exclusion rests on an incorrect premise: `scripts/complexity-baseline/manifest.json` contains **no** `profile/service.ts` acceptance. Prior Q-01 reported its Large Class/Divergent Change problem, rather than accepting it. Pending-buffer ownership (`apps/extension/src/wallet/services/profile/service.ts:124-239`), deletion recovery (`:1462-1666`), and restore/finalization (`:2254-2796`) remain independently changing responsibilities.

**What BOTH of us missed**

None established in this light pass.