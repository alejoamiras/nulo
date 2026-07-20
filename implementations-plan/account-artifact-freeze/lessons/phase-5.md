# Phase 5 — Background integrity coordinator + mismatch state

## What shipped

- **`AccountIntegrityCoordinator`** (`wallet/services/account-integrity/coordinator.ts`):
  last-phase service (deps on Profile + Account), registers itself via setter injection into BOTH
  (`setIntegrityDelegate`) — the exact ProfileDeletionCoordinator anti-cycle pattern. Verify =
  per stored account (all chains, Nulo_v1 only): `poseidon2Hash([master, chainId, type, index])`
  → `NuloAccount.new` → compare; deterministic, PXE/node-free. Mismatch → persist blocking
  record + throw `AccountAddressInconsistencyError`; green → HEAL any stale record (installing a
  compatible build is the recovery path). Derivation is constructor-injectable so unit tests stay
  bb-free (jsdom can't run bb.js poseidon — Phase 1 lesson applied at design time).
- **Session-open chokepoint**: all 9 `sessionManager.open` call sites in ProfileService now route
  through `openSessionVerified` (unlock ×2, create ×2, import ×2, finalizeRestore ×2, password
  change). The backup-import hook falls out for free: `finalizeRestore` opens AFTER accounts are
  restored, so the check runs between restoration and activation.
- **SW-restart persistence**: blocking records live in a raw-`storage.local`
  TombstoneRepository-style repo (`nulo:core:account-integrity-blocked@<profileId>`; corrupt
  record still blocks — fail-closed, never auto-deleted). `ProfileService.init` gates the silent
  session rehydrate on it (the coordinator starts later, so init reads the repo directly).
- **Runtime mismatch** (`account/service.ts` — the formerly untested bare throw): now emits the
  typed `AccountAddressInconsistencyError`. Post-audit (see `audit-codex.md` second pass) this was
  hardened: AccountService writes the DURABLE block ITSELF (fail-closed, delegate-independent — so
  a mismatch during the startup window before the coordinator injects its delegate still persists)
  and AWAITS it before throwing; the delegate then closes the session for the MISMATCHING profile
  (`lockProfileIfActive(profileId)`, not "the active one"). Covers the mid-session window where an
  extension update rehydrates a live session under new derivation code without passing the pre-open
  verifier.
- **Boot re-verification** (post-audit): the silent SW rehydrate on the first boot of a NEW build
  IS re-verified — `AccountIntegrityCoordinator.start()` runs `verifyRestoredSessionOnce`, guarded
  by a durable per-(profile, walletVersion) verified-stamp so steady-state SW wakes stay free. It
  is fire-and-forget by necessity (awaiting inside `services.start()` stalls all service RPCs past
  the popup boot budget), but the verdict lands mid-flight and the stamp is invalidated on any
  account-set change.
- **Typed error**: `AccountAddressInconsistencyError` in `@nulo/extension-messaging/errors`
  (payload union + reconstruction switch), instanceof survives the RPC boundary.
- **dApp sanitization**: `error-envelope.ts` maps it to a bare
  `{code:-32603, message:"The wallet could not process the request."}` — NO discriminator, no
  detail (fingerprinting resistance), pinned by a leak-test.
- **Blocking screen**: `AccountIntegrityBarrier.vue` (MigrationBarrier pattern — raw
  `chrome.storage` observe + onChanged, facade-ban allowlisted), mounted in the popup shell.
  Copy: what happened + "seed phrase still derives your accounts on a compatible version" (no
  categorical "funds are safe"); NO inputs, NO links, NO buttons — pinned by a phishing-surface
  test that asserts the absence of all three element kinds.

## Tests (all five plan-mandated layers)

1. Coordinator unit (5): green-heals, tampered→typed error + record, all-chains sweep,
   non-Nulo_v1 skip, runtime report → record + session close.
2. SW-restart persistence: integration — blocked profile NOT rehydrated after a simulated SW
   restart (`makeServiceFromExistingApi`), plus the no-record control (gate is targeted).
3. RPC-reconstruction test (extension-messaging errors suite).
4. Barrier component tests (6) incl. corrupt-record fail-closed + live appear/heal + area filter.
5. Backup-import path: `finalizeRestore` with a mismatching delegate → rejects typed, NO session,
   NO `onActiveProfileChanged` emit.
Plus repo unit tests (3) and the envelope leak-test.

## Lessons

- `SessionManager.open` SWALLOWS its own errors (logs "Failed to open profile session") — an
  integrity hook inside `open` would never propagate. The chokepoint must live in ProfileService
  BEFORE the `open` call; worth remembering for any future pre-open guard.
- The barrier reads storage RAW on purpose (facade would re-order behind the migration barrier);
  every such component needs its `storage-facade-ban.test.ts` allowlist entry with a why-comment.
- Cost note: the verify adds N-accounts × (poseidon + `NuloAccount.new`) to unlock (~hundreds of
  ms for typical 1–3 accounts) — same per-op cost the wallet already pays on `getAccountContract`;
  accepted for an unlock-time security invariant. The silent SW-restart rehydrate IS re-verified on
  the first boot of a NEW build (`verifyRestoredSessionOnce`), then a per-(profile, walletVersion)
  stamp keeps every subsequent same-build wake free — so it is neither "re-hash on every boot" nor
  "never re-derived", but "re-derive once per build change". The runtime operation-time check +
  the version-keyed stamp + the durable fail-closed block are the three overlapping backstops.

## Validation gate

`bun run lint && bun run typecheck:all && bun run test:all && bun run test` — 0 / 0 / 0 / 0
(transcript).
