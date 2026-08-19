# key-model-v2-hardening — DEK isolation, duplicate-phrase guard, passkey 512-bit reduce, missing e2e

**Tier**: `/blueprint mid` (rubric: security sensitivity HIGH; novelty LOW — extends code the
key-model-v2 stack just built; blast radius MODERATE, pre-production; irreversibility LOW;
migration NONE; external coupling NONE). Crypto-adversarial rider carried over from the parent
plan per the owner's explicit "be adversarial in terms of entropy/crypto, ultra-safe" instruction.

**Worktree**: adopts `key-model-v2` (deliberate slug≠plan deviation — this plan stacks new arcs on
the parent plan's live gh stack #420, so it must share the worktree). Base:
`feat/kdf-v2-account-io` (arc 3 tip).

**Parent context**: `implementations-plan/key-model-v2/` (all 6 phases ✓, PRs #417/#418/#419
draft). This plan resolves the two owner-adjudication items its post-implementation review
surfaced (`key-model-v2/lessons/code-review.md`) plus the P5 gate debt (the three account
export/import smoke tests named in the parent P5 gate were never written — the ✓ overstated it).

## Goal

Four deliverables, two new stacked arcs:

1. **Passkey entropy alignment** — `deriveBits(512)` + 64-byte `Fr.fromBufferReduce` in
   `passkey-credential.ts` (kills the 20%-relative-bias / 253.415-bit-min-entropy reduce, aligning
   with the mnemonic path's ~2⁻²⁵⁸ bias); extend the frozen `NULO_KDF_SPEC` to cover the passkey
   branch (the regime tripwire is currently blind to half the derivation surface).
2. **Imported-key credential isolation (fix A)** — a per-profile random **imported-keys DEK**,
   sealed under the profile *credential* (not the master), becomes the HKDF root for imported
   signing-key rows. Closes: two profiles sharing a phrase share the master, so a storage reader
   knowing only profile B's password can today decrypt profile A's *imported* (external) keys
   offline.
3. **Duplicate-phrase guard (fix B)** — a plaintext one-way `walletFingerprint` on the profile row
   + warn-and-confirm (owner decision: warn+confirm on BOTH mnemonic import and full-backup
   restore, never a hard block). **Consequence the owner accepted implicitly and this plan makes
   explicit: B is UX guardrail only; fix A carries the entire isolation guarantee.**
4. **The missing e2e** — the three account export/import smoke tests the parent P5 gate promised
   (round-trip into a second profile, tamper rejection, duplicate rejection), the dup-guard confirm
   flow, and a **new passkey execution canary** (network, prover-ON) — the passkey chain has never
   been execution-tested.

Out of scope: any change to the mnemonic derivation chain, the account-export envelope format,
the address-freeze regime *mechanics* (only the spec text is amended), production migrations
(pre-production), multi-device/server dedup (fingerprint scope is same-device).

## Architecture & Implementation

### A. Passkey 512-bit reduce + KDF-spec extension (arc 4)

- `packages/wallet-crypto/src/passkey-credential.ts` `deriveMasterSecret()`:
  `deriveBits(…, 256)` → `deriveBits(…, 512)`; reduce the full 64 bytes. Labels
  (`PASSKEY_KDF_LABEL`, `PASSKEY_MASTER_LABEL`) untouched. Structural copy of
  `mnemonic-master.ts:50-62`. `MasterSecretBytes` is size-agnostic and `Fr.toBuffer()` stays 32 B —
  no downstream type changes (recon §3).
- Pinned-value blast radius is exactly ONE literal: V3's hex in
  `apps/extension/src/wallet/crypto/key-vectors.test.ts:153` (recon enumerated V1–V11+P1; V10 was
  never implemented). Regenerate per the file's own header ritual. Add a 64-byte case to
  `zeroize.test.ts`'s reduce-copy coverage.
- `packages/aztec-runtime/src/account/address-freeze.ts`: append a passkey clause to
  `NULO_KDF_SPEC` (`passkeyMaster = Fr.fromBufferReduce(HKDF-SHA256(prf,
  salt=SHA256("nulo:kdf:v1"||credentialId), info="nulo:master:v1", 64B))`), recompute
  `NULO_KDF_DIGEST`, update `address-freeze.test.ts`'s independent literals
  (`EXPECTED_KDF_DIGEST`, `EXPECTED_REGIMES` incl. the hand-typed `ack`) + new substring
  assertions, and update the rules text — three files, one commit, per the freeze module's own
  rule.
- **Governance position (audits: attack this)**: the rules text's "one-time pre-launch carve-out…
  exercised once" is not re-exercised here — the `nulo-v5` regime record exists only on unmerged
  draft PRs; amending `NULO_KDF_SPEC` before the stack lands is amending the not-yet-shipped
  baseline. The rules-text update states this explicitly.
- Accepted consequence: every passkey profile's address AND its `derivePxeStoreKey` output rotate
  (pre-production; PXE re-sync is self-documented crypto-erase-safe, `pxe-store-key.ts:9-13`).

### B. Imported-keys DEK (arc 5)

**Why credential-rooted, verbatim rationale (recon challenged it; keep this in the code docs):**
master possession is precisely what the attack grants — a shared phrase means a shared master, so
any `HKDF(master, …)` root is decryptable by the sibling profile *by construction*. The credential
is the only input distinguishing the two profiles in the threat model, so it is the only valid
root. (`pxe-store-key`'s master-derived pattern is fine for per-profile operational state; imported
keys are external secret material with an isolation promise — different requirement.)

**Key hierarchy** (uniform across profile types, per owner decision):

```
credential wrap key:
  password: EncryptionKey.fromPasshash(passhash)                       (existing primitive)
  passkey:  PasskeyCredential.deriveDekWrapKey()                       (NEW: HKDF(baseKey, salt,
            info="nulo:dek-wrap:v1") → 256-bit AES-GCM CryptoKey; new info label, frozen labels
            untouched; derived inside the 4 PasskeyRecoveryCoordinator methods while the
            credential is transiently alive)

profile row (4th slot):
  dekSealed = AES-GCM(wrapKey, dek, AAD="nulo:profile-imported-dek:v1")  — independent field via
  EncryptionKey/.a small ImportedKeysDekBox; the byte-frozen PasswordSecretBox 3-field shape and
  PROFILE_AAD's existing tags are NOT touched (recon: "DO NOT CHANGE" freeze)

imported-key rows (root swap, envelope shape unchanged):
  rowKey = HKDF(dek, "nulo:imported-account-key:v2" | chainId | address)   (v1→v2 info prefix;
  per-row binding, profileId-free restore-remap survival, and the AES-GCM transplant rejection
  all carry over from the shipped imported-account-key-box design)
```

- **New brand**: `ImportedKeysDek` (32 B CSPRNG) in `secret-types.ts`, minted at profile
  create/import/restore.
- **Session threading** (recon §1: nothing credential-shaped survives unlock): the DEK is unsealed
  at unlock — the one moment the credential is in hand — and threaded
  `openSessionVerified → SessionManager.open → ActiveSession.dek` exactly like the master; new
  `getDek(profileId)` accessor; ~8 `open()` call sites.
- **Bearer (the recon-flagged trap)**: the DEK joins the F-11 silent-restore wrap —
  `SessionSecretBox` generalizes from a 32-byte `MasterSecretBytes` payload to `master || dek`
  (version-bumped box envelope). Without this, every MV3 SW suspend breaks imported accounts until
  re-unlock while derived accounts keep working. Adversarial check: the bearer lives in the
  profile's own ephemeral `chrome.storage.session`; the threat model (storage.local read + sibling
  password) never sees it — reading storage.session implies extension-context code execution, at
  which point all secrets are lost regardless. Passkey profiles have no bearer (every unlock is a
  fresh ceremony) — no change on that branch.
- **Envelope MAC v2**: password-profile preimage becomes
  `` `${guard}.${secret}.${entropy}.${dek}` `` — all 5 preimage call sites + the `macEnvelope()`
  helper (recon §2 enumerates them). Legal: the MAC shape exists only on unmerged PRs. Passkey
  rows need no MAC for the DEK — AES-GCM auth under the PRF-derived wrap key already fails closed
  on any transplant (sibling ceremony derives a different wrap key).
- **`changeProfilePassword`**: reseals the DEK in the same single-row atomic write as
  guard/secret/entropy (extends `reseal`'s "always all fields" audit-H2 invariant). The
  easy-to-miss site — it gets a dedicated integration test.
- **Backup carriage (the recon-critical finding — profile rows are block-listed from backups)**:
  - Password backups: the DEK travels **plaintext** as a new top-level field beside the already-
    plaintext `master-key` + `entropy` (identical trust envelope — zero marginal exposure; the
    backup file's own encryption is the protection, and it is a different trust domain from
    `chrome.storage.local`, so the storage-reader attacker never holds it).
    `exportBackupMaterial` exports it under the same auth + pairing check; `restore()` reseals it
    under the restoring credential pre-commit.
  - Passkey backups: the DEK travels as the **sealed blob** (passkey backups carry no plaintext
    secrets today and won't start); the restore ceremony re-derives the same PRF wrap key
    (same credential) and unseals → reseals.
  - Epoch: **no bump** — `CURRENT_COMPAT_EPOCH = 4` exists only on unmerged PRs; the DEK field
    joins epoch 4's required shape (password: required; passkey: required sealed blob), same
    pre-launch latitude as parent decision A2.
- **Account service**: the 3 imported-key call sites (`loadImportedAccountContract`,
  `exportAccount`'s imported branch, `importAccount`) swap `master.toBuffer()` for
  `sessionManager.getDek(...)`; derived-account paths keep the master untouched. The quarantine
  taxonomy (`ImportedAccountUnusableError`, single-account blast radius) is unchanged — a
  missing/undecryptable DEK surfaces as the same typed error.

### C. Duplicate-phrase guard (arc 5)

- `walletFingerprint = hex(sha256("nulo:wallet-fingerprint:v1" || master.toBuffer()))` — plaintext
  field on every profile row (both variants), computed at the 5 row-construction sites where the
  master is already in hand pre-persist (recon §2 enumerates). Fingerprints the MASTER, not the
  entropy — well-defined for passkey profiles too, one code path.
- **Privacy analysis (pre-empted)**: zero marginal linkability — two same-phrase profiles already
  carry byte-identical account addresses in plaintext rows; a storage reader sees the linkage
  today. The fingerprint reveals nothing new. One-way: recovering the master from
  sha256(label||master) is infeasible; no reduction in secret entropy.
- **Flow (service-side — the popup never holds a master, recon §2)**: `importMnemonic`,
  `importPasskeyProfile`, and `restore()` (both branches) gain an `allowDuplicate = false` param;
  on a fingerprint match against `repo.getAll()` they throw a typed `DuplicateWalletError`
  (carrying the existing profile's NAME only — never key material) which crosses the RPC like
  `InvalidPasswordError` does. UI (`useProfileImportFlow` + `useFullBackupImport`) catches it,
  raises the existing `cacheStore.confirm` dialog ("You already have a profile with this recovery
  phrase — continue?"), and re-calls with `allowDuplicate: true`. No token machinery, no
  two-phase-commit change; the check runs pre-persist inside the existing derive→persist window.
- `createProfile` (fresh CSPRNG entropy) gets the check too — a collision there is cryptographically
  impossible, so it's an invariant assertion, not a UX path.
- Passkey duplicate-credential import stays HARD-blocked (existing structural check, untouched).

### D. Missing e2e (arc 5) + passkey execution canary (arc 4)

Smoke (per recon §4, using proven idioms only):
1. **Round-trip into a second profile** (plaintext + encrypted): cross-browser two-profile pattern
   (`backup-roundtrip.test.ts` precedent — the in-session second-profile path is unproven); export
   read straight off `export-account-reveal input.value`; import via paste into
   `import-account-body-input` (+ one file-chooser leg via `waitForFileChooser` to cover
   `import-account-pick-file`); assert `import-account-preview-address` → confirm →
   `account-imported-badge` + toast. Temp files `rmSync`-cleaned in `finally` (plaintext exports
   carry a real signing key).
2. **Tamper rejection**: flip a char (base64 for encrypted; claimed address for plaintext), assert
   `import-account-error`, assert the confirm step never renders.
3. **Duplicate rejection**: same-profile — import once, re-import, assert "This account is already
   in your wallet".
4. **Dup-phrase confirm flow**: register A, capture phrase, drive a duplicate import → assert the
   confirm dialog (via `acceptConfirmPopup`) → accept → second profile exists. Service-level
   integration coverage of the check + `allowDuplicate` is REQUIRED regardless; the e2e drives
   whichever import surface is reachable (in-session path needs proving — fall back to the
   full-backup-restore surface if the mnemonic path can't be reached with a live profile).
   Traps encoded: row-scoped clicks via `data-account-name` (shared per-row testids);
   never bare `clickByTestId` on multi-account pages.

Passkey execution canary (network, prover-ON — the passkey analog of the frozen-account canary;
the address KAT cannot see execution breakage):
- New fixture: passkey registration (`registerPasskeyProfile` + `setupPasskeyVirtualAuth`,
  `hasPrf: true`) combined with dApp connection + capability grant (never combined before —
  net-new wiring).
- Stage 1 cross-check fork (resolve during implementation with a codex consult): (a) capture the
  PRF bytes at the `navigator.credentials` boundary in-page, re-derive master+address
  independently node-side — a true formula cross-check; or (b) execution-only (register → real
  proven tx), formula pinned by the V3 unit vector. Prefer (a); fall back to (b) if the boundary
  hook proves flaky. PRF secrets cannot be read back via CDP (recon §3), so those are the only
  options.
- Stages: register → derive → ctor-deploy with real proof → authwit consume (reusing the mnemonic
  canary's machinery: playground bridge, nullifier witness, `mintPublicTokensForAccount`).

### File-level change map (adds ✚ / modifies ✎)

Arc 4: ✎ `wallet-crypto/src/passkey-credential.ts` · ✎ `wallet-crypto/src/zeroize.test.ts` ·
✎ `aztec-runtime/src/account/address-freeze.ts` + `.test.ts` · ✎ `extension/src/wallet/crypto/
key-vectors.test.ts` (V3) · ✚ `extension/tests/e2e/network/passkey-execution-canary.test.ts` ·
✚ passkey dApp-connected fixture (extends `fixtures/passkey.ts` / `fixtures/extension.ts`).

Arc 5: ✚ `wallet-crypto/src/imported-keys-dek-box.ts` (+test) · ✎ `secret-types.ts`
(ImportedKeysDek brand) · ✎ `imported-account-key-box.ts` (root swap, info v2, +test) ·
✎ `entropy-mac.ts` (MacEnvelope v2, +test) · ✎ `session-secret-box.ts` (master||dek, +test) ·
✎ `passkey-credential.ts` (`deriveDekWrapKey`, +V-vector) · ✎ `profile/spec.ts` (Profile.dek,
walletFingerprint, RestoreSecret, DuplicateWalletError) · ✎ `profile/service.ts` (unlock/create/
import/restore/changePassword/exportBackupMaterial/fingerprint checks) · ✎ `profile/
session-manager.ts` (ActiveSession.dek, getDek, bearer, MAC verify) · ✎ `passkey-recovery-
coordinator.ts` (4 methods + PasskeyRecovery.dekWrapKey) · ✎ `account/service.ts` (3 call sites) ·
✎ `useProfileImportFlow.ts` + `useFullBackupImport.ts` (DuplicateWalletError → confirm → retry) ·
✎ `export/full.vue` (backup field) · ✎ integration/component tests · ✚ `tests/e2e/
account-import-export.test.ts` · ✚ dup-phrase e2e leg · ✎ `key-vectors.test.ts` (new pins).

### Trade-offs & alternatives not taken

- **Master-derived DEK (no storage)** — rejected: decryptable by the sibling profile by
  construction; defeats the purpose (recon challenged, rationale above).
- **Passhash-as-direct-root (no DEK indirection)** — rejected: password change would force
  rewrapping N imported-key rows (multi-row torn-write risk); the DEK reduces that to one more
  field in the existing single-row atomic reseal.
- **profileCryptoId salt in HKDF info (codex's original sketch)** — rejected: the info string is
  plaintext beside the ciphertext and the MAC is master-keyed; neither survives the attacker
  actually holding the master. Root-of-key change is the only sound fix.
- **Hard-block dedup instead of the DEK** (the competing outline) — see decision ledger.
- **Epoch bump 4→5** — rejected: epoch 4 exists only on unmerged PRs; redefining its required
  shape pre-launch is the same latitude the parent plan's A2 exercised.
- **Deferring the passkey reduce to V6** — rejected: this stack already rotates every mnemonic
  address in place (parent A2); the passkey rotation is the identical class of change, free now,
  an extension-major after launch.

## Phases & validation gates

### Arc 4 — `feat/kdf-v2-passkey-512` (stacks on #419)

**P1 — passkey 512-bit reduce + KDF-spec extension.**
512-bit deriveBits + 64B reduce; V3 regen (header ritual); zeroize 64B case; `NULO_KDF_SPEC`
passkey clause + digest recompute + freeze-test literals + substring pins + rules-text update
(carve-out rationale). One commit for the freeze triple per the module's own rule.
**Gate**: `bun run audit:vue` — exit 0; V3 + address-freeze + zeroize green with new pins
committed. Layers: typecheck/unit/component/lint/build.
**Rider (blocking)**: focused codex xhigh attack on the implemented P1 diff — entropy accounting
(is the 64B reduce correctly wired end-to-end? any remaining sub-512 reduce anywhere in the
tree?), spec-text fidelity (does the clause byte-match the implementation?), governance position.
No unresolved High.

**P2 — passkey execution canary.**
New network e2e: passkey registration via virtual authenticator (PRF) + dApp connect fixture →
real proven transaction; stage-1 cross-check per design fork (codex consult logged in lessons).
**Gate**: `bun run e2e:agent tests/e2e/network/passkey-execution-canary.test.ts
tests/e2e/network/frozen-account-canary.test.ts` (prover-ON, solo host per owner memory) — exit 0;
both canaries green (the mnemonic canary re-run proves no arc-4 regression). Layers:
e2e-live-network.

### Arc 5 — `feat/kdf-v2-dek-isolation` (stacks on arc 4)

**P3 — DEK crypto primitives (wallet-crypto).**
`ImportedKeysDek` brand; `imported-keys-dek-box` (seal under EncryptionKey / PRF-derived wrap key,
AAD `nulo:profile-imported-dek:v1`); `PasskeyCredential.deriveDekWrapKey` (info
`nulo:dek-wrap:v1`); `imported-account-key-box` root swap (info `nulo:imported-account-key:v2`);
`MacEnvelope` v2 (4-field preimage + separator-unambiguity test); `SessionSecretBox` master||dek
(version-bumped envelope). House-style real-WebCrypto tests: round-trip, wrong-key,
cross-slot/cross-row transplant, corrupt-fails-closed, unambiguity; new key-vector pins.
**Gate**: `bun run lint && bun run typecheck:all && bun run test` — exit 0; all new crypto tests
green. Layers: lint/typecheck/unit.
**Rider (blocking)**: focused codex xhigh attack on the implemented P3 diff — key hierarchy
(can any path still reach an imported key with master-only material?), wrap-key domain separation,
MAC v2 preimage ambiguity, bearer wrap (does master||dek leak cross-slot?), zeroization. No
unresolved High.

**P4 — service threading + fingerprint + backup carriage.**
ActiveSession.dek + getDek + 8 open() call sites; unlock/create/import/restore unseal-and-thread;
bearer wrap; MAC v2 at all 5 sites; `changeProfilePassword` DEK reseal (dedicated test);
`exportBackupMaterial`/`RestoreSecret`/`full.vue` carriage (password plaintext-beside-master,
passkey sealed-blob); restore reseal pre-commit; account-service 3-site swap; `walletFingerprint`
compute at 5 sites; `DuplicateWalletError` + `allowDuplicate` on importMnemonic/importPasskey/
restore. Integration tests: DEK full lifecycle (create→unlock→SW-restart bearer→password-change→
export→restore), transplant matrix extended to the DEK slot, dup-guard check+override, fingerprint
determinism.
**Gate**: `bun run audit:vue` — exit 0; the new integration tests green. Layers:
typecheck/unit/integration/component/lint/build.
**Rider (blocking)**: resumed codex session re-attack on P3+P4 together — the transplant matrix
end-to-end, backup-carriage trust analysis, restore reseal, bearer restore. No unresolved High.

**P5 — dup-guard UI + copy.**
`useProfileImportFlow` + `useFullBackupImport` catch `DuplicateWalletError` → `cacheStore.confirm`
("You already have a profile with this recovery phrase — continue?") → retry with
`allowDuplicate: true`; copy per the frontend addendum (no jargon); component tests for the
catch-confirm-retry path.
**Gate**: `bun run audit:vue && bun run test:e2e` — both exit 0 (smoke on a solo host; armed build
for the migration-fixture tests as in CI). Layers: + smoke e2e.

**P6 — the missing e2e + reconciliation.**
`account-import-export.test.ts` (round-trip ×2, tamper, duplicate — per recon idioms + traps);
dup-phrase confirm e2e leg; full smoke; targeted network re-run at the stack tip.
**Gate**: `bun run test:e2e` exit 0 (new tests green in the suite) AND `bun run e2e:agent
tests/e2e/network/passkey-execution-canary.test.ts tests/e2e/network/frozen-account-canary.test.ts
tests/e2e/network/profile-reimport-matrix.test.ts` exit 0 (prover-ON, solo). Layers: smoke e2e +
e2e-live-network.

## Security & Adversarial Considerations

- **Threat model**: storage.local reader/writer holding ONE profile's password on a device where
  two profiles share a recovery phrase (the DEK's raison d'être); hostile backup blobs (DEK +
  fingerprint fields presence-guarded, pairing check unchanged, orphan-drop taxonomy unchanged);
  hostile account-export files (envelope unchanged from parent plan); ciphertext transplants
  (AAD purpose tags + MAC v2 + wrap-key mismatch — each slot fails closed); a compromised popup
  (dup check + DEK unseal are service-side; `DuplicateWalletError` carries a profile NAME, never
  key material; `allowDuplicate` gates a duplicate CREATION, not any secret access).
- **Explicit residual (owner-accepted via warn+confirm choice)**: B does not prevent deliberate
  same-phrase profiles; A alone carries isolation. A user who confirms the duplicate warning AND
  reuses the same password across both profiles re-creates the confused-deputy case codex
  adjudicated LOW (same credential unlocks both directly — no new authority).
- **Entropy accounting (the owner's named worry)**: the passkey change is strictly entropy-
  POSITIVE (253.415-bit min-entropy → ~253.6-bit, bias 2⁻¹·⁶ᵇⁱᵗ-scale → ≤2⁻²⁵⁸); the DEK is 32 B
  CSPRNG (`crypto.getRandomValues`), full 256-bit; the fingerprint is one-way sha256 with a
  dedicated domain label — no secret's effective keyspace is reduced anywhere in this plan. The
  mnemonic chain is untouched (KATs + reference vectors must stay green with ZERO edits — that is
  itself a gate invariant).
- **Cryptography**: WebCrypto only (HKDF-SHA256, AES-GCM, SHA-256, PBKDF2 via existing
  EncryptionKey); `@aztec/foundation` 5.0.1 exact-pinned Fr. No new dependencies.
- **Domain separation**: three new labels (`nulo:dek-wrap:v1`, `nulo:profile-imported-dek:v1`,
  `nulo:wallet-fingerprint:v1`) + one bumped (`nulo:imported-account-key:v2`) — all under the
  house `nulo:<purpose>:v<n>` convention, mutual-distinctness tested alongside the existing
  inventory; frozen labels (`PASSKEY_KDF_LABEL`, `PASSKEY_MASTER_LABEL`, `PROFILE_AAD` existing
  tags) untouched.
- **Input validation**: backup DEK field length/base64-guarded before use; fingerprint compared
  via constant-time-irrelevant equality (public values); `allowDuplicate` is a boolean param, not
  attacker-controllable state.
- **Least privilege / CI**: no workflow, token, or endpoint changes.

## Assumptions

**Facts** (verified in recon against the working tree): ActiveSession carries only the master
post-unlock, both profile types (recon §1, spec.ts:101-108, service.ts:417); the bearer restores
master-only and passkey profiles never silently restore (session-manager.ts:202-260, 419-424);
profile rows are block-listed from backups — top-level master-key/entropy only
(backup-migration-registry.ts:198,233, full.vue:163-178); the envelope-MAC preimage has exactly 5
call sites + 1 helper; V3 at key-vectors.test.ts:153 is the ONLY passkey-sensitive pinned literal
(V10 never implemented); the harness drives real WebAuthn PRF (fixtures/passkey.ts:52,
per-FrameTreeNode); PRF secrets cannot be read back via CDP (PRF-NON-PORTABLE.md); the popup never
derives a master (zero client-side deriveMasterFromMnemonic call sites); no in-session
second-profile e2e fixture exists — the cross-browser pattern is the proven one; `importAccount`'s
duplicate check is (profileId, chainId)-scoped; passkey duplicate-credential import is hard-blocked
structurally.

**Inferences** (audits: attack these): (1) the `navigator.credentials` boundary hook for the
canary's stage-1 cross-check is implementable without destabilizing the ceremony — UNVERIFIED;
fallback (b) is the hedge. (2) Generalizing SessionSecretBox to a 64-byte payload doesn't disturb
any consumer beyond SessionManager — believed single-consumer, verify at implementation.
(3) Passkey full-backup restore re-runs a ceremony with the SAME credential, so the PRF wrap key
is re-derivable at restore — believed true from restore()'s recoverFromCredentialData path,
verify. (4) The e2e virtual authenticator's PRF output is deterministic per credential across a
browser relaunch within one test (needed for the canary's SW-restart leg) — plausible, verify.

**Asks** — none unresolved. Owner decisions already taken: warn+confirm on both dup paths (B is
UX-only; A carries isolation); uniform DEK across profile types; two new arcs; all four gate
layers including the new passkey canary; pre-production in-place latitude (parent A2) extends to
the KDF-spec amendment and the epoch-4 shape.

## Decision ledger

- **Chosen**: credential-rooted stored-random DEK + soft dup guard + passkey 512 + full e2e
  (the main outline).
- **Competing outline (rejected)** — "DEK-less minimal surface": passkey 512 identical; close the
  imported-key hole by making the dup guard a HARD block (same-master profiles become impossible
  on-device, so the precondition never exists) + document the imported-key master-rooting as
  accepted; e2e identical. Cheaper (~40% of arc 5), zero new key hierarchy. Rejected because:
  (1) the owner explicitly chose warn+confirm — a soft guard cannot carry a security guarantee;
  (2) a policy check is bypassable by any code path that forgets it (restore, future import
  surfaces), while a key-hierarchy fix is structural; (3) hard-block strands the legitimate
  restore-while-original-exists recovery case. Recorded so audits can re-litigate with full
  context.
- **Codex's profileCryptoId sketch rejected** (plaintext-info + master-keyed-MAC both fall to a
  master-holding attacker) — the root-of-key must change, not the binding metadata.
- **Canary placement**: in arc 4 (a KDF change ships with its execution canary — CLAUDE.md
  principle) despite making arc 4 slower to merge; the owner's "mergeable fast" preference yields
  to the canary-gates-the-bump rule they also chose.
- **Disputed / to audit**: password-backup DEK carried plaintext-beside-master vs sealed-in-backup
  (chosen: plaintext beside — identical trust envelope, and sealed-under-passhash would break
  restore-with-new-password); fingerprint of master vs entropy (chosen: master — uniform across
  profile types); canary cross-check fork (a) vs (b).

## Post-implementation (self-contained — execute from this file)

1. **`/code-review max --fix`** on the full implementation diff (both arcs vs #419's tip) → skim
   applied fixes → commit them separately from implementation commits.
2. **Codex post-impl audit** (`/codex` xhigh, NEW session): net diff from the plan baseline +
   summary of the code-review commits + this plan.md + the decision ledger + the adversarial/
   security ask (attack the DEK hierarchy, the transplant matrix, the backup carriage, the
   entropy accounting) + this rule verbatim: *"Report bugs and small, targeted improvements only.
   Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites —
   the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
3. **Iterative fix loop**: verify codex's factual claims against the repo first; apply accepted
   fixes; commit; log round + verdict in `lessons/`; RESUME the same codex session with the fix
   diff; repeat until a round yields no new material findings. >3 material rounds → stop, surface
   to the owner (scope smell).
4. **Delivery**: `gh stack sync` + refresh PR bodies; the two new arc PRs stay draft until the fix
   loop converges, then mark ready. `gh stack merge` remains the owner's call, never autonomous.

## Delivery

Two new arcs on the existing stack #420 (`dev ← #417 ← #418 ← #419`):

- **Arc 4** `feat/kdf-v2-passkey-512` (phases P1–P2) — stacks on `feat/kdf-v2-account-io` (#419).
  `gh stack add feat/kdf-v2-passkey-512` at the boundary; `gh stack submit --draft --auto` early
  so CI runs; PR title `feat(passkey): 512-bit master reduce + kdf-spec passkey clause + execution canary`.
- **Arc 5** `feat/kdf-v2-dek-isolation` (phases P3–P6) — stacks on arc 4.
  PR title `feat(profile): credential-rooted imported-keys dek + duplicate-phrase guard + account e2e`.
- Post-impl fixes land on the arc they belong to (`gh stack down`/`up`), then `gh stack sync`
  (cascade rebase, `--force-with-lease` — agent owns every arc branch).
- Independently revertable: arc 4 reverts to the parent stack's passkey behavior; arc 5 reverts to
  master-rooted imported keys with no dup guard — each is one coherent story.

## Seeds

(final versions delivered post-approval; drafts in the ELI5 companion)

## Audit verdicts

_(filled during the dual audit + final pass)_
