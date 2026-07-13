# Audit — Opus (contradiction-check + adversarial security) — plan v1

VERDICT: reject as written (architecture sound; restore-path P1–P5 essentially correct; delete-path P8 coordinator leaf-set incomplete + D7-retain masks it → false "atomic/awaited/privacy-erasing" claim for contacts, dApp-sessions, network-less-chain rows). Fix the four §3 items → approve.

## Forks
- D4 defer-derive-verify: **ACCEPTABLE, not release-blocking.** getAccountContract re-derives + throws "account address inconsistency" → all signing/tx-build/balance paths throw (inert). Phantom is importer's OWN profile only: profileId remapped unconditionally; AccountService.restore aborts batch on "Duplicate address" if the address exists in ANY profile → phantom can't be a victim's existing address; cross-profile needs predicting poseidon2([victimMaster,chainId,type,index]) (254-bit) — infeasible. getSecret throws "Profile locked" at restore (late activation) → derive-verify truly impossible at boundary. Ship canonicalize + (chainId,address) tuple; post-finalizeRestore sweep = follow-up (UX, not security gate).
- D6: **dedicated ProfileDeletionCoordinator started last.** ProfileService has ZERO coupling to leaves today; all leaves depend on ProfileService; making it orchestrate = runtime call-cycle into the facade-locked root; resume-after-services.start() is unnatural (ProfileService starts first). deleteProfile writes tombstone+deletes row under lock, releases, awaits coordinator.runFor() outside lock, re-enters lock to clear tombstone.
- D7: **REMOVE backstops; relocate their LOGIC into awaited coordinator-invoked purgeForProfile methods.** Retain = zero durability, doesn't re-fire on restart (so doesn't cover its justifying case), races coordinator, double-emits, and is currently the ONLY cleanup for contacts/dApp-sessions/network-less rows → retaining keeps finding-D's gap. Removal safe ONLY IF coordinator awaited-purges everything the subs did. Keep onAccountDeleted/onTokenDeleted leaf subs (serve standalone deleteNetwork).

## Release-blocking holes
- H1 (privacy): coordinator omits contacts + dApp-sessions; only network-scopes accounts/tokens/FPC/journal (per-network purgeChain) → rows on a chainId with no surviving network survive; tombstone-resume re-runs only the coordinator → PERMANENT leak. SEVEN onProfileDeleted consumers today (account:46, token:84, fpc:72, network:189, incoming:168, contact:59, dapp-session:61). Coordinator must await profile-scoped purge for ALL + address-derived tx/auth/token-balance; resume re-runs the COMPLETE set.
- H2 (cross-profile): tombstone id-exclusion from decoded getValues() fails OPEN on a codec-hidden tombstone (decodeRow returns undefined, getValues skips) → successor-clobber reopens. Source id-exclusion from getKeys() (no decode → fail-CLOSED); drive cleanup from getValues(). Unreadable tombstone must still RESERVE its id (not brick creation, but not fail-open).
- H3 (correctness/privacy): plan gates only restore/generateUniqueId, not getProfiles/getActiveProfile/unlockProfile → SW-death after tombstone-write before row-delete leaves a visible+unlockable half-deleted profile. Tombstoned id must be absent to ALL profile reads + unlock; phase-1 (tombstone→row-delete→session-close) idempotently re-run by resume.
- H4 (deadlock): phase-1 snapshot under facade lock must use lock-free profileId reads only (TokenService.getTokensRaw(profileId) safe; AccountService.getAccounts(profileId,chainId) safe; NOT backup()/requireActiveProfile → runExclusive → self-deadlock).
- H5: coordinator MUST purge tx/auth/token-balance BEFORE purgeProfile (network tail purgeChain re-emits onAccountDeleted → leaf subs re-run). Ordering correctness-critical; pin with a test.

## Unsafe assumptions
- "backstops correctness-equivalent" FALSE (H1/D7).
- "account-state no forgeable account field" VERIFIED SAFE (keyed by networkId; senders are attacker-chosen addresses into the importer's OWN PXE = self-profile note-discovery nuisance, not cross-profile).
- "TokenService.restore one-ordered-per-input" VERIFIED (restore-rows one-per-input in order); NetworkService.restore too; but AccountService.restore is ALL-OR-NOTHING (throws Duplicate address for whole batch) — not index-pairing-compatible (plan doesn't index-pair accounts, fine).
- "tombstone-resume post-services.start()" feasible only under D6-dedicated-coordinator.

## #275 regression guards + separability
- P4 split: unconditional profileId normalization MUST map to normalizeAllIds (all-rows); if split makes it oldId-scoped, re-opens graft. Test-pin.
- P5 deletes composite key: re-pin "same contract two chains" coverage under index-pairing.
- C3: P1 RestoreResult shape flip breaks 5 inline composable .restoreError reads (:372,:396,:418,:441,:534) owned by P3/P4/P5 → they'd read undefined → treat failures as successes → provenance admits foreign rows. P1 NOT separately-green without those reads. (Recommend either fold into P1 or land P1 as precursor refactor.)
- P4/P5 duplicate attacker source IDs: two old networks same id can't fit old→new Map; duplicate old token ids unattributable → reject duplicate source ids or drop dependent rows.
