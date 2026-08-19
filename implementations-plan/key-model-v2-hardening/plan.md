# key-model-v2-hardening — DEK isolation, duplicate-phrase guard, passkey 512-bit reduce, missing e2e

**Rev 4** — round-1 dual audit (codex + fable, both conditional-approve → rev 2), final
fresh-context codex pass (reject: clone-divergence blocker → rev 3), re-verdict (conditional
approve → rev 4: rewrap-handoff lifetime defined, rev-2 leftovers swept). Transcripts in
`audit-codex.md` / `audit-fable.md`; every adoption/rejection in the decision ledger. Open at the
approval gate: owner ratification of the KDF-spec amendment (the re-verdict's third condition).

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
(pre-production), multi-device/server dedup (fingerprint scope is same-device), requiring
encryption on password-profile full backups (codex suggestion — surfaced as a separate product
follow-up, not taken here).

## Architecture & Implementation

### A. Passkey 512-bit reduce + KDF-spec extension (arc 4)

- `packages/wallet-crypto/src/passkey-credential.ts` `deriveMasterSecret()`:
  `deriveBits(…, 256)` → `deriveBits(…, 512)`; reduce the full 64 bytes. Labels
  (`PASSKEY_KDF_LABEL`, `PASSKEY_MASTER_LABEL`) untouched. Structural copy of
  `mnemonic-master.ts:50-62`. `MasterSecretBytes` is size-agnostic and `Fr.toBuffer()` stays 32 B —
  no downstream type changes (recon §3; fable verified both production reduce sites end at 64 B
  after this change).
- Pinned-value blast radius is exactly ONE literal: V3's hex in
  `apps/extension/src/wallet/crypto/key-vectors.test.ts:153`. **Regeneration is
  INDEPENDENT, not hand-captured** (audit-adopted — a fixture captured from the implementation
  would self-consistently pass even if the ceremony inputs were consistently mis-wired): a small
  reference script under `implementations-plan/key-model-v2-hardening/reference/` recomputes the
  expected value from raw WebCrypto HKDF + `Fr.fromBufferReduce` only (mirroring the parent plan's
  mnemonic reference-generator pattern), and V3's new pin comes from IT. Add a 64-byte case to
  `zeroize.test.ts`'s reduce-copy coverage.
- `packages/aztec-runtime/src/account/address-freeze.ts`: append a **byte-precise** passkey clause
  to `NULO_KDF_SPEC` — decoded PRF bytes as IKM, `salt = SHA-256(UTF8("nulo:kdf:v1") ||
  credentialIdBytes)`, `info = UTF8("nulo:master:v1")`, HKDF-SHA256, 64-byte output,
  `Fr.fromBufferReduce` — recompute `NULO_KDF_DIGEST`, update `address-freeze.test.ts`'s
  independent literals (`EXPECTED_KDF_DIGEST`, `EXPECTED_REGIMES` incl. the hand-typed `ack`) +
  new substring assertions, and update the rules text — three files, one commit, per the freeze
  module's own rule.
- **Governance (audit-verified + owner ratification required at the gate)**: fable fact-checked
  origin/dev — the carve-out text and the v2 regime record exist ONLY on this unmerged stack, so
  amending `NULO_KDF_SPEC` amends the not-yet-shipped baseline. The rules text is reworded to
  define the latitude honestly: *"the in-place redefinition window closes at the first shipped
  build"* (fable's phrasing), rather than exercise-counting. **Known blast radius the owner
  ratifies explicitly**: changing `NULO_KDF_DIGEST` invalidates every account-export file minted
  before the change (the export envelope pins the regime digests) — including mnemonic-account
  exports whose formula did not change. Pre-production: no real exports exist; e2e regenerate
  fresh.
- Accepted consequence: every passkey profile's address AND its `derivePxeStoreKey` output rotate
  (pre-production; PXE re-sync is self-documented crypto-erase-safe, `pxe-store-key.ts:9-13`).

### B. Imported-keys DEK (arc 5)

**Why credential-rooted, verbatim rationale (keep in code docs):** master possession is precisely
what the attack grants — a shared phrase means a shared master, so any `HKDF(master, …)` root is
decryptable by the sibling profile *by construction*. The credential is the only input
distinguishing the two profiles in the threat model, so it is the only valid root.
(`pxe-store-key`'s master-derived pattern is fine for per-profile operational state; imported keys
are external secret material with an isolation promise — different requirement.)

**Key hierarchy** (uniform across profile types, per owner decision):

```
credential wrap key:
  password: EncryptionKey.fromPasshash(passhash)                       (existing primitive)
  passkey:  PasskeyCredential.deriveDekWrapKey()                       (NEW: HKDF(baseKey, salt,
            info="nulo:dek-wrap:v1") → 256-bit AES-GCM CryptoKey; new info label, frozen labels
            untouched; derived inside the 4 PasskeyRecoveryCoordinator methods while the
            credential is transiently alive; PasskeyRecovery gains the wrap-key field.
            NOTE (final audit): the HKDF importKey call currently declares usages
            ["deriveBits"] only — deriveDekWrapKey requires adding "deriveKey")

profile row (4th slot, BOTH variants):
  dekSealed = AES-GCM(wrapKey, dek, AAD="nulo:profile-imported-dek:v1")  — independent field via a
  small ImportedKeysDekBox; the byte-frozen PasswordSecretBox 3-field shape and PROFILE_AAD's
  existing tags are NOT touched

imported-key rows (root swap, envelope shape unchanged):
  rowKey = HKDF(dek, "nulo:imported-account-key:v2" | chainId | address)   (v1→v2 info prefix;
  per-row binding, profileId-free restore-remap survival, and the AES-GCM transplant rejection
  all carry over)
```

- **New brand**: `ImportedKeysDek` (32 B CSPRNG) in `secret-types.ts`. **A fresh DEK is minted at
  EVERY profile-row creation — including restore** (final-audit blocking fix): restore unseals the
  SOURCE DEK from the backup carriage, mints a fresh DESTINATION DEK, and **rewraps every
  imported-key row in the backup slice source→destination pre-activation** (both DEKs are in hand
  during restore; the source DEK never persists on the destination row). This closes the
  clone-divergence hole: the owner's warn+confirm choice sanctions restoring A's backup while A
  still exists, and a shared DEK would let the clone's password unseal keys A imports LATER —
  recreating the target attack without password reuse. Rewrap (not fresh-mint-and-orphan) keeps
  every restored row usable, honoring the round-1 concern that pushed rev 2 the wrong way.
  Imported-key APIs accept only the brand (codex: no bare Uint8Array).
- **Row-construction sites: SIX** (audit HIGH — the draft said five): `createProfile`,
  **`createPasskeyProfile` (service.ts:463-470, master in hand at 474)**, `importPasswordProfile`,
  `importPasskeyProfile`, `restore()` password branch, `restore()` passkey branch. Every one mints
  (or reseals, for restore) the DEK AND stamps `walletFingerprint`. The P4 integration suite
  asserts both fields on the persisted row for ALL SIX paths.
- **Session threading** (recon §1: nothing credential-shaped survives unlock): the DEK is unsealed
  at unlock — the one moment the credential is in hand — and threaded
  `openSessionVerified → SessionManager.open → ActiveSession.dek` exactly like the master; new
  accessor **returns a COPY** (codex: callers zeroize their buffers — a shared mutable reference
  would be destroyed under the house discipline); `ActiveSession.dek` zeroized on
  close/replace/expiry. **NINE `openSessionVerified`/`open` call sites** (corrected count),
  including the password-change reopen and both `finalizeRestore` branches.
- **Restore rewrap context (re-verdict HIGH — the rewrap needs an implementable ownership path)**:
  `ProfileService.restore()` runs BEFORE `AccountService.restoreImportedKeys()`, so the source DEK
  cannot be zeroized inside `restore()` itself. `restore()` stashes a **TTL-bound, memory-only
  rewrap context** — `{sourceDek, destinationDek}` per pending restore, both profile types —
  mirroring the existing `pendingRestoreSecrets` discipline (same TTL, same zeroize-on-expiry).
  `restoreImportedKeys` consumes it atomically (rewraps every row source→destination, then
  zeroizes `sourceDek` immediately; `destinationDek` survives for `finalizeRestore`'s session
  open). Named edge cases, each a test: empty slice (context still cleaned), partial rewrap
  failure (rollback per the existing restore rollback — no half-rewrapped slice persists),
  context expiry before consumption (imported rows dropped with the existing orphan taxonomy,
  never silently kept undecryptable), abandoned restore + SW death (TTL zeroize).
- **`pendingRestoreSecrets` (round-1 both auditors)**: the passkey restore→`finalizeRestore` stash
  extends from master-only to `{secret, dek}` — carrying the DESTINATION DEK (TTL-zeroized as
  today) — otherwise the first post-restore session is dek-less and every restored imported
  account quarantines until the next full unlock. Dedicated integration leg: "restore a passkey
  backup carrying an imported account → the account signs BEFORE any re-unlock."
- **Degradation state machine (final-audit condition — replaces rev 2's underspecified fail-soft
  bullet; a dek-less session has no MAC key, so the two failure modes must be defined together)**:
  1. `guard`/`secret`/`entropy` decrypt failure, or pairing failure → **unlock BLOCKS** (as
     today — core material).
  2. DEK-unseal failure OR MAC-v2 verification failure at unlock → the session opens
     **derived-only**: the DEK (if any) is discarded, imported accounts quarantine per-account
     (`ImportedAccountUnusableError`, A4 taxonomy — imported material must never profile-block
     derived funds; a corrupt MAC alone must not either), a **user-visible warning** fires at
     unlock (a toast/banner, not just a log — final-audit loudness condition), and **no
     silent-restore bearer is persisted**.
  3. Bearer restore requires BOTH a valid DEK AND a valid MAC v2, else `silentClose` (forcing a
     password unlock, which re-surfaces the state visibly).
  Pinned by dedicated tests at both verify sites, healthy and degraded.
- **Bearer**: the DEK joins the F-11 silent-restore wrap — `SessionSecretBox` generalizes to a
  fixed 32+32 `master || dek` payload (version-bumped box envelope; v1 records fail the version
  gate → silentClose → re-unlock; single wrap chosen over two so restore is atomic — no state
  where the master restores but the DEK doesn't). **Honest consequence (audit)**: a passive
  `chrome.storage.session` reader could previously recover the master (all derived accounts) and
  now additionally recovers imported-key authority — a deliberate, stated expansion within an
  already-fatal read capability, accepted for UX parity (imported accounts must not break at every
  SW suspend). Passkey profiles have no bearer (every unlock is a fresh ceremony) — unchanged.
- **Envelope MAC v2 (audit HIGH — the draft's version was worthless against this threat model)**:
  the attacker HOLDS the shared master, so a master-keyed MAC is forgeable by them. v2 is keyed by
  `HKDF(master || dek, info="nulo:envelope-mac:v2")` (info label bumped with the grammar, C5) over
  the 4-field preimage `` `${guard}.${secret}.${entropy}.${dek}` ``, and is verified **at password
  unlock as well as bearer restore** (previously bearer-only). Forging it requires A's DEK — the
  exact thing the attacker lacks. Compute sites all hold both secrets at MAC time. New test: an
  attacker holding the master + B's password but not A's DEK cannot produce an envelope that
  passes either verify site. Passkey rows still need no MAC for the DEK — AES-GCM under the
  PRF-derived wrap key already fails closed on transplant.
- **`changeProfilePassword`**: reseals the DEK in the same single-row atomic write as
  guard/secret/entropy (extends `reseal`'s "always all fields" audit-H2 invariant) + recomputes
  MAC v2. Dedicated integration test.
- **Backup carriage (profile rows are block-listed from backups — recon-critical)**: restated
  invariant (audit): *any backup — encrypted or not — already carries jointly-sufficient material
  (plaintext `master-key` + the sealed imported-key rows are both in it); the DEK adds nothing a
  backup holder could not already reach*, so carriage adds zero marginal exposure. Password
  backups carry the SOURCE DEK plaintext beside `master-key`/`entropy`; passkey backups carry the
  **sealed row blob verbatim** (the restore ceremony re-derives the same wrap key to unseal it —
  `recoverFromCredentialData` + credentialId assert, service.ts:1746-1755). Either way the source
  DEK exists only inside the TTL-bound rewrap context (above) until `restoreImportedKeys` consumes
  it — it never persists on the restored profile. Export goes through ONE
  authenticated, discriminated `exportBackupMaterial` result carrying
  credentialId/master/entropy/DEK atomically (codex: no cross-call races). Epoch: **no bump** —
  epoch 4 exists only on unmerged PRs; the DEK field joins its required shape (password: required
  plaintext field; passkey: required sealed blob), same pre-launch latitude as parent A2.
- **Account service**: `loadImportedAccountContract` and `importAccount` swap the master for the
  DEK via a **facade-mediated `ProfileService.getProfileDek(id)`** mirroring `getProfileSecret`
  (deletionState guards preserved; AccountService never touches SessionManager directly — audit
  LOW-2). `exportAccount`'s imported branch keeps its **fresh-auth posture**: it unseals
  `dekSealed` under the supplied password directly (extending `exportPlain`'s path), staying
  session-independent. Quarantine taxonomy unchanged.
- **Perf (documented so nobody "fixes" it by caching passhashes)**: the DEK adds one PBKDF2-600k
  frame per password unlock and two per password change (~0.3–1 s on top of the existing frames).

### C. Duplicate-phrase guard (arc 5)

- `walletFingerprint = hex(sha256("nulo:wallet-fingerprint:v1" || master.toBuffer()))` — plaintext
  field on every profile row (both variants; uniform = one code path, owner preference; codex's
  password-only alternative ledgered), computed at the SIX row-construction sites. Fingerprints
  the MASTER (well-defined for passkey profiles; entropy doesn't exist there).
- **Privacy (audit-corrected wording)**: *negligible marginal* same-device linkability, not zero —
  same-phrase profiles with populated same-network account rows already expose identical plaintext
  addresses, but zero-account or disjoint-network profiles do not, and the fingerprint is a
  stable equality oracle (and marginally cheaper to test against than address recompute).
  Accepted: the oracle only confirms a candidate master the attacker already possesses; one-way
  (sha256 preimage); no secret-entropy reduction. Stated honestly in the code doc.
- **Flow (service-side; the popup never holds a master)**: `importMnemonic`,
  `importPasskeyProfile`, and `restore()` (both branches) gain `allowDuplicate = false`; on a
  fingerprint match vs `repo.getAll()` they throw **`DuplicateWalletError`** carrying the existing
  profile's NAME only.
  - **Wire transport (audit HIGH — the draft would have silently broken)**: the error is
    registered in `packages/extension-messaging/src/errors.ts`'s code-based reconstruction union
    (the `InvalidPasswordError` mechanism) with a transport round-trip test — an unregistered
    class flattens to plain `Error` and the UI can never match it.
  - **Restore-path escape + atomicity (round-1 HIGH, tightened by the final audit)**: `restore()`
    flattens thrown errors into `restoreError` dead-end strings inside its persistence zone, and a
    check placed BEFORE the lock is a check→write TOCTOU (two concurrent same-phrase restores both
    pass). Fix: the fingerprint check and the row commit run **under the same `runExclusive`
    lock**, and the flatten-catch **explicitly rethrows `DuplicateWalletError`** (both branches) so
    the typed error reaches the UI.
  - **Passkey retry without a second ceremony (simplified per the final audit — no service-side
    stash)**: the UI already holds the `credentialData` it passed in; on confirm it re-calls with
    the SAME data + `allowDuplicate: true`, and `recoverFromCredentialData` re-derives from the
    carried PRF bytes without a new WebAuthn prompt.
  - UI (`useProfileImportFlow` + `useFullBackupImport`) catches the typed error → existing
    `cacheStore.confirm` dialog ("You already have a profile with this recovery phrase —
    continue?") → re-call with `allowDuplicate: true`.
- `createProfile`/`createPasskeyProfile` (fresh CSPRNG/PRF material) get the check as an invariant
  assertion — a collision there is cryptographically impossible.
- Passkey duplicate-credential handling (final-audit fact correction — the "structural hard block"
  claim was overstated): `userHandle` is OPTIONAL, and restore generates a fresh profile id when it
  is absent, so the same credential CAN currently land twice. The dup check therefore also **scans
  passkey rows by `credentialId`** (hard-reject on a same-credential duplicate — same-credential ⇒
  same master ⇒ pure footgun, no legitimate use; the fingerprint path covers the cross-type
  theoretical case). The duplicate-CONFIRM e2e scenario remains a **password-profile** flow.

### D. Missing e2e (arc 5) + passkey execution canary (arc 4)

Smoke (per recon §4, proven idioms only):
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
4. **Dup-phrase confirm flow** (password-profile scenario per §C): register A, capture phrase,
   drive a duplicate import → `acceptConfirmPopup` → second profile exists. Service-level
   integration coverage of check + `allowDuplicate` REQUIRED regardless; the e2e drives whichever
   import surface is reachable (fall back to the full-backup-restore surface if the mnemonic path
   can't be reached with a live profile).
   Traps encoded: row-scoped clicks via `data-account-name` (shared per-row testids); never bare
   `clickByTestId` on multi-account pages.

Passkey execution canary (network, prover-ON — the passkey analog of the frozen-account canary):
- **Execution-only design (audit-resolved fork)**: register a passkey profile via the virtual
  authenticator (PRF) → dApp connect + capability grant (net-new fixture wiring) → ctor-deploy
  with a REAL proof → authwit consume → **MV3 SW-restart leg within the same browser instance and
  popup FrameTreeNode** (re-runs the ceremony — passkey profiles never silently restore) → still
  signs/proves. **No browser-relaunch leg** (virtual-authenticator credentials die with the
  browser; PRF is deterministic across SW restarts only — audit-corrected Inference 4). §A's
  reference-computed V3 vector independently pins everything AFTER the PRF boundary (final-audit
  scoping: it cannot detect a consistently mis-wired WebAuthn ceremony itself — that residual is
  covered by the existing ceremony unit pins plus this execution canary, judged adequate), so the
  fragile in-page hook (which would also leak PRF material into test-runner traces) is not
  needed. Reuses the mnemonic canary's machinery (playground bridge, nullifier witness,
  `mintPublicTokensForAccount`).

### File-level change map (adds ✚ / modifies ✎)

Arc 4: ✎ `wallet-crypto/src/passkey-credential.ts` · ✎ `wallet-crypto/src/zeroize.test.ts` ·
✎ `aztec-runtime/src/account/address-freeze.ts` + `.test.ts` · ✎ `extension/src/wallet/crypto/
key-vectors.test.ts` (V3, reference-pinned) · ✚ `implementations-plan/key-model-v2-hardening/
reference/passkey-master-vector.ts` (+ output json) · ✚ `extension/tests/e2e/network/
passkey-execution-canary.test.ts` · ✚ passkey dApp-connected fixture (extends
`fixtures/passkey.ts` / `fixtures/extension.ts`).

Arc 5: ✚ `wallet-crypto/src/imported-keys-dek-box.ts` (+test) · ✎ `secret-types.ts`
(ImportedKeysDek brand) · ✎ `imported-account-key-box.ts` (root swap, info v2, brand-typed, +test)
· ✎ `entropy-mac.ts` (MacEnvelope v2: 4-field preimage, master||dek key, info v2, +tests incl.
master-holder forgery attempt) · ✎ `session-secret-box.ts` (master||dek, version bump, +test) ·
✎ `passkey-credential.ts` (`deriveDekWrapKey`, +reference-pinned vector) · ✎ `profile/spec.ts`
(Profile.dekSealed + walletFingerprint both variants, RestoreSecret, exportBackupMaterial shape)
· ✎ **`packages/extension-messaging/src/errors.ts` (+ transport test)** — DuplicateWalletError
registration · ✎ `profile/service.ts` (SIX row sites, unlock/create/import/restore/
changeProfilePassword/exportBackupMaterial/getProfileDek/fingerprint checks/locked dup
check+commit with explicit typed-error rethrow/rewrap context/credentialId scan) ·
✎ `profile/session-manager.ts` (ActiveSession.dek, copy
accessor, zeroize on close/replace, bearer v2, MAC verify at unlock + restore, dek-less no-bearer
rule) · ✎ `passkey-recovery-coordinator.ts` (4 methods + PasskeyRecovery.dekWrapKey) ·
✎ `account/service.ts` (getProfileDek at load/import; fresh-auth dek unseal at export) ·
✎ `useProfileImportFlow.ts` + `useFullBackupImport.ts` (typed-error catch → confirm → retry) ·
✎ `export/full.vue` (backup field) · ✎ integration/component tests · ✚ `tests/e2e/
account-import-export.test.ts` · ✚ dup-phrase e2e leg · ✎ `key-vectors.test.ts` (new pins).

### Trade-offs & alternatives not taken

- **Master-derived DEK (no storage)** — rejected: decryptable by the sibling profile by
  construction.
- **Passhash-as-direct-root (no DEK indirection)** — rejected: password change would rewrap N
  imported-key rows (multi-row torn-write risk) vs one field in the existing atomic reseal.
- **profileCryptoId salt in HKDF info (codex's original sketch)** — rejected: plaintext info +
  master-keyed MAC both fall to a master-holding attacker; the root-of-key must change.
- **Hard-block dedup instead of the DEK** (competing outline) — see ledger.
- **Epoch bump 4→5** — rejected: epoch 4 exists only on unmerged PRs (parent-A2 latitude).
- **Deferring the passkey reduce to V6** — rejected: this stack already rotates every mnemonic
  address in place; identical class of change, free now, an extension-major after launch.
- **PRF-boundary-capture canary cross-check** — rejected in favor of execution-only + an
  independent reference-computed V3 (closes the same self-consistency hole without the fragile
  hook or PRF-in-traces leak).
- **Requiring encryption on password full backups** (codex) — out of scope; surfaced as product
  follow-up.

## Phases & validation gates

### Arc 4 — `feat/kdf-v2-passkey-512` (stacks on #419)

**P1 — passkey 512-bit reduce + KDF-spec extension.** ✓ (gate passed 2026-08-19: audit:vue exit 0
over the final state; mnemonic KATs/vectors green with ZERO edits; rider: codex xhigh FAIL —
un-wiped 64-byte OKM copy — fixed 987cd239 → re-verdict PASS; lessons/phase-1.md)
512-bit deriveBits + 64 B reduce; independent reference script → V3 re-pin; zeroize 64 B case;
byte-precise `NULO_KDF_SPEC` passkey clause + digest recompute + freeze-test literals + substring
pins + honest rules-text rewording ("window closes at the first shipped build"). Freeze triple in
one commit.
**Gate**: `bun run audit:vue` — exit 0; V3 (reference-pinned) + address-freeze + zeroize green;
**the mnemonic KATs and reference vectors green with ZERO edits** (mechanical partial guarantee:
any spec edit reds the digest test). Layers: typecheck/unit/component/lint/build.
**Rider (blocking)**: focused codex xhigh attack on the implemented P1 diff — entropy accounting
(64 B reduce correctly wired; no remaining sub-512 reduce anywhere), spec-clause byte-fidelity vs
the implementation, reference-script independence. No unresolved High.

**P2 — passkey execution canary.**
Execution-only design per §D: registration fixture (virtual authenticator PRF) + dApp connect →
real proven tx → authwit → same-instance/same-FTN SW-restart leg (fresh ceremony) → proves again.
**Gate**: `bun run e2e:agent tests/e2e/network/passkey-execution-canary.test.ts
tests/e2e/network/frozen-account-canary.test.ts` (prover-ON, solo host per owner memory) — exit 0;
both canaries green (the mnemonic canary re-run proves no arc-4 regression). Layers:
e2e-live-network.

### Arc 5 — `feat/kdf-v2-dek-isolation` (stacks on arc 4)

**P3 — DEK crypto primitives (wallet-crypto + messaging).**
`ImportedKeysDek` brand (APIs accept only the brand); `imported-keys-dek-box` (AAD
`nulo:profile-imported-dek:v1`, wrap under EncryptionKey / PRF-derived key);
`PasskeyCredential.deriveDekWrapKey` (info `nulo:dek-wrap:v1`); `imported-account-key-box` root
swap (info `nulo:imported-account-key:v2`); `MacEnvelope` v2 (4-field preimage, `master||dek` key,
info `nulo:envelope-mac:v2`); `SessionSecretBox` master||dek (version bump);
`DuplicateWalletError` in `extension-messaging` (+ transport round-trip test). House-style
real-WebCrypto tests: round-trip, wrong-key, cross-slot/cross-row transplant,
corrupt-fails-closed, separator/version unambiguity, **master-holder MAC-forgery attempt (must
fail without the DEK)**; new reference-pinned key vectors.
**Gate**: `bun run lint && bun run typecheck:all && bun run test` — exit 0; all new crypto +
transport tests green. Layers: lint/typecheck/unit.
**Rider (blocking)**: focused codex xhigh attack on the implemented P3 diff — key hierarchy (any
path reaching an imported key with master-only material?), wrap-key domain separation, MAC v2
keying + preimage, bearer wrap, zeroization. No unresolved High.

**P4 — service threading + fingerprint + backup carriage.**
ActiveSession.dek (copy accessor, zeroize on close/replace/expiry) + NINE open() call sites;
unlock unseal-and-thread + the degradation state machine (derived-only + visible warning +
no-bearer on DEK/MAC failure); bearer v2; fresh destination DEK at restore + the TTL-bound rewrap
context consumed by `restoreImportedKeys` (source→destination rewrap; edge cases per §B);
`pendingRestoreSecrets` → `{secret, dek}`; `changeProfilePassword` DEK reseal; atomic
discriminated `exportBackupMaterial`; `getProfileDek` facade; account-service swaps (fresh-auth
export path); `walletFingerprint` at ALL SIX row sites; fingerprint check + row commit under one
`runExclusive` lock with the flatten-catch explicitly rethrowing `DuplicateWalletError`;
UI-held-credentialData retry (no stash, no second ceremony); passkey credentialId dup scan;
`allowDuplicate` params.
**Gate**: `bun run audit:vue` — exit 0 — AND these NAMED integration criteria green (audit
conditions absorbed as pass criteria): (a) all-six-creation-paths test asserts `dekSealed` +
`walletFingerprint` on the persisted row, both profile types; (b) restore-passkey-backup-with-
imported-account signs BEFORE any re-unlock; (c) an imported key DECRYPTS post-restore via the
freshly minted destination DEK (not merely row-exists); (d) degraded unlock per the state
machine: DEK-unseal or MAC failure → derived-only session, imported accounts quarantine,
user-visible warning, NO bearer persisted, next wake forces re-unlock — pinned at BOTH verify
sites, healthy and degraded; (e) DEK full lifecycle
(create→unlock→SW-bearer-restart→password-change→export→restore) incl. DEK zeroization on
close/replace/expiry; (f) transplant matrix extended to the DEK slot incl. the master-holder
MAC-forgery; (g) dup-guard check + `allowDuplicate` override on import AND restore paths, under
the lock (concurrent same-phrase restores: exactly one dup verdict, no double-commit);
(h) **clone divergence**: restore A's backup as B (different password) while A exists, A imports a
NEW account afterward, assert B's material cannot decrypt it; (i) absent-`userHandle`
same-credential passkey import is rejected by the credentialId scan; (j) rewrap-context edges:
empty slice cleans the context, partial rewrap failure rolls back (no half-rewrapped slice
persists), context expiry drops imported rows via the orphan taxonomy (never silently kept
undecryptable). Layers: typecheck/unit/integration/component/lint/build.
**Rider (blocking)**: resumed codex session re-attack on P3+P4 together — transplant matrix
end-to-end, backup carriage, restore reseal, bearer restore, dek-less semantics. No unresolved
High.

**P5 — dup-guard UI + copy.**
Typed-error catch in `useProfileImportFlow` + `useFullBackupImport` → `cacheStore.confirm` →
retry; copy per the frontend addendum; component tests for catch-confirm-retry.
**Gate**: `bun run audit:vue && bun run test:e2e` — both exit 0 (smoke solo; armed build for the
migration-fixture tests as in CI). Layers: + smoke e2e.

**P6 — the missing e2e + reconciliation.**
`account-import-export.test.ts` (round-trip ×2, tamper, duplicate); dup-phrase confirm e2e
(password-profile scenario); full smoke; targeted network re-run at the stack tip.
**Gate**: `bun run test:e2e` exit 0 (new tests green in the suite) AND `bun run e2e:agent
tests/e2e/network/passkey-execution-canary.test.ts tests/e2e/network/frozen-account-canary.test.ts
tests/e2e/network/profile-reimport-matrix.test.ts` exit 0 (prover-ON, solo). Layers: smoke e2e +
e2e-live-network.

## Security & Adversarial Considerations

- **Threat model**: storage.local reader/writer holding ONE profile's password on a device where
  two profiles share a recovery phrase (the DEK's raison d'être — and the MAC v2 keying exists
  because this attacker HOLDS the master, so master-keyed MACs are forgeable by them); hostile
  backup blobs (DEK + fingerprint presence-guarded; pairing check unchanged; orphan-drop taxonomy
  unchanged); hostile account-export files (envelope unchanged); ciphertext transplants (AAD
  purpose tags + DEK-keyed MAC v2 + wrap-key mismatch — each slot fails closed, and the dek slot's
  failure is contained to imported accounts by the fail-soft rule, never a profile-wide DoS
  lever); a compromised popup (dup check + DEK unseal are service-side; `DuplicateWalletError`
  carries a profile NAME, never key material; `allowDuplicate` gates a duplicate CREATION, not
  secret access).
- **Honest residuals (stated, owner-accepted)**: (1) B is UX-only — a user who confirms the
  duplicate warning AND reuses the same password re-creates the confused-deputy case codex
  adjudicated LOW. (2) A passive `chrome.storage.session` reader gains imported-key authority
  along with the master it already got — deliberate bearer-parity expansion inside an
  already-fatal capability. (3) The fingerprint is a negligible-marginal-linkability equality
  oracle (confirms only a master the attacker already possesses).
- **Entropy accounting (the owner's named worry)**: strictly entropy-positive everywhere — passkey
  master 253.415-bit min-entropy → ~253.6 (bias ≤ 2⁻²⁵⁸); DEK = 32 B CSPRNG (full 256-bit);
  fingerprint one-way sha256 under a dedicated label; **the mnemonic chain is untouched and its
  KATs/reference vectors must stay green with ZERO edits (a named gate invariant)**.
- **Cryptography**: WebCrypto only (HKDF-SHA256, AES-GCM, SHA-256, PBKDF2 via EncryptionKey);
  `@aztec/foundation` 5.0.1 exact-pinned Fr. No new dependencies.
- **Domain separation**: three new labels (`nulo:dek-wrap:v1`, `nulo:profile-imported-dek:v1`,
  `nulo:wallet-fingerprint:v1`) + two bumped (`nulo:imported-account-key:v2`,
  `nulo:envelope-mac:v2`) — all under the house convention, mutual-distinctness tested against the
  inventory; frozen labels untouched.
- **Input validation**: backup DEK field length/base64-guarded; fingerprint equality on public
  values; `allowDuplicate` a boolean param.
- **Least privilege / CI**: no workflow, token, or endpoint changes.

## Assumptions

**Facts** (recon-verified; audit-corrected where noted): ActiveSession carries only the master
post-unlock, both types; the bearer restores master-only and passkey never silently restores;
profile rows are block-listed from backups (top-level master-key/entropy only); the envelope-MAC
preimage has 4 compute sites + 1 verify + 1 helper; V3 is the only REDUCE-sensitive pinned literal
(final-audit narrowing: V8 pins the — untouched — PRF label, so it is passkey-sensitive but not
affected by P1; V10 never implemented; both production `fromBufferReduce` sites end at 64 B after
P1); the harness drives real WebAuthn PRF (per-FrameTreeNode); PRF secrets cannot be read back via
CDP; the popup never derives a master; no in-session second-profile fixture exists (cross-browser
pattern is the proven one); `importAccount`'s dup check is (profileId, chainId)-scoped; passkey
duplicate-credential import is NOT structurally blocked when `userHandle` is absent (final-audit
correction — restore mints a fresh id then; hence the credentialId scan in §C); **SIX profile-row
construction sites** (audit-corrected: + `createPasskeyProfile:463-470`); **NINE session-open call
sites** (audit-corrected); **typed errors survive the RPC only via
`extension-messaging/src/errors.ts` code-based reconstruction** (audit-established);
**`restore()` flattens thrown errors into `restoreError` strings inside its persistence zone**
(final-audit narrowing — hence §C's check-and-commit-under-one-lock + explicit rethrow);
origin/dev's freeze record has no `kdfDigest` and no carve-out text (fable-verified — grounds the
governance position).

**Inferences** (audits attacked round 1; current state): (1) ~~PRF boundary hook~~ — resolved:
not needed; the reference-computed V3 closes the self-consistency hole. (2) SessionSecretBox
single-production-consumer — VERIFIED TRUE (fable). (3) Passkey restore re-derives the wrap key —
VERIFIED TRUE (recoverFromCredentialData + credentialId assert; corollary: row blob and backup
blob are interchangeable). (4) ~~Relaunch determinism~~ — FALSE; PRF is deterministic across SW
restarts within one instance only; the canary has no relaunch leg.

**Asks** — one for the approval gate: **ratify the `NULO_KDF_SPEC` amendment** (the reworded
carve-out window + the known consequence that the digest change invalidates any account-export
file minted before it — none exist outside e2e). All other owner decisions already taken:
warn+confirm both paths (B is UX-only; A carries isolation); uniform DEK; two new arcs; all four
gate layers incl. the passkey canary; pre-production in-place latitude.

## Decision ledger

- **Chosen**: credential-rooted stored-random DEK + soft dup guard + passkey 512 + full e2e.
- **Competing outline (rejected)** — DEK-less hard-block variant: cheaper (~40% of arc 5), zero
  new key hierarchy. Rejected: (1) the owner chose warn+confirm — a soft guard cannot carry a
  security guarantee; (2) a policy check's guarantee equals the completeness of its call-site
  coverage forever (audit round 1 proved the point live: even this plan's own dup check had a
  path — `restore()`'s error flattening — where it silently wouldn't fire), while the DEK's
  guarantee is carried by key material; (3) hard-block strands the restore-while-original-exists
  recovery case. **Both auditors independently endorsed the rejection.**
- **Round-1 dual-audit adoptions**: MAC v2 keyed by `master||dek` + verified at unlock (codex
  HIGH) + info-label bump (fable C5); DEK lifecycle semantics (codex HIGH + fable C3/C4):
  `pendingRestoreSecrets` carries the DEK, fail-soft + no-bearer on dek-less unlock;
  `DuplicateWalletError` registered in extension-messaging (codex HIGH) + restore throwing-zone
  placement + passkey rethrow/retry-stash (fable HIGH-2); SIX row sites (fable HIGH-1) + NINE
  opens + brand-only APIs + copy-returning accessor + zeroize-on-close (codex); atomic
  discriminated export + honest bearer/backup wording (codex/fable); fingerprint "negligible not
  zero" + equality-oracle note (both); byte-precise spec clause + honest rules-text rewording +
  owner-ratification ask + export-file-invalidation disclosure (codex + fable); fresh-auth export
  path via password-direct unseal, `getProfileDek` facade (fable LOW-2); mint-vs-reseal wording
  (fable LOW-4); perf documentation (fable); canary: no relaunch leg (both).
- **Auditor disagreement 1 — dek-less unlock: fail-closed (codex) vs fail-soft (fable). Resolved:
  fail-soft** — the A4 taxonomy (imported material never profile-blocks derived funds) is a parent
  owner decision this plan must not silently reverse, and fail-closed hands a storage-writer a
  one-field profile-wide DoS lever; codex's loudness concern is met by the unlock-time error
  surface + the no-bearer rule (every SW suspend re-surfaces it). For the final codex pass to
  re-litigate.
- **Auditor disagreement 2 — canary cross-check: execution-only (codex) vs attempt-the-PRF-hook
  (fable, for its unique mis-wired-ceremony coverage). Resolved: execution-only PLUS an
  independent reference-computed V3** — the reference script (raw WebCrypto, no wallet-crypto
  imports) catches exactly the consistently-mis-wired-implementation case fable worried about,
  without the fragile hook or PRF-material-in-traces leak codex objected to. Strictly better than
  either auditor's position; both concerns closed.
- **Rejected (audit suggestions not taken)**: password-only fingerprint (codex — uniformity is an
  owner choice + one code path; passkey fingerprints are harmless); requiring encrypted password
  backups (codex — product change, out of scope, surfaced as follow-up); PRF boundary capture
  (fable — superseded by the reference-vector resolution).
- **Final-pass (fresh-context codex) round — verdict `reject`, blocking finding adopted → rev 3**:
  1. **BLOCKER adopted — clone divergence**: rev 2's "restore reseals the SAME DEK" let the
     owner-sanctioned restore-while-original-exists path clone the DEK; the clone's password then
     unseals keys the ORIGINAL imports later — the target attack without password reuse, and the
     forgeable-MAC hole reopened for the pair. Fix: fresh destination DEK at restore + service-side
     rewrap of the backup's imported-key rows (both DEKs in hand during restore; the source DEK is
     zeroized, never persisted). This REVERSES rev 2's LOW-4 wording adoption while still honoring
     its substance (rows stay usable — via rewrap, not via sharing). Criterion (h) pins it.
  2. Degradation state machine made explicit (core-failure blocks; DEK-or-MAC failure →
     derived-only + visible warning + no bearer; bearer needs DEK+MAC or silentClose) — replaces
     the underspecified fail-soft bullet; codex agreed fail-soft itself was right once explicit.
  3. Dup-check TOCTOU closed (check+commit under one lock, flatten-catch rethrows the typed
     error); passkey retry simplified (UI re-sends credentialData — no service-side stash, no
     second ceremony); absent-`userHandle` credentialId scan added (the "structural block" claim
     was overstated).
  4. Facts narrowed (V8 label pin; restore-flatten scope); `deriveDekWrapKey` needs the
     `"deriveKey"` HKDF usage; the V3-reference "exactly closes" claim softened (it pins everything
     after the PRF boundary; a consistently mis-wired ceremony is covered by ceremony unit pins +
     the execution canary — judged adequate).
  Both disagreement resolutions ENDORSED by the fresh pass (fail-soft narrowly — visible warning
  required; execution-only canary — claim-scoping required). Re-verdict on rev 3: see Audit
  verdicts.

## Post-implementation (self-contained — execute from this file)

1. **`/code-review max --fix`** on the full implementation diff (both arcs vs #419's tip) → skim
   applied fixes → commit them separately from implementation commits.
2. **Codex post-impl audit** (`/codex` xhigh, NEW session): net diff from the plan baseline +
   summary of the code-review commits + this plan.md + the decision ledger + the adversarial/
   security ask (attack the DEK hierarchy, the MAC v2 keying, the transplant matrix, the backup
   carriage, the entropy accounting) + this rule verbatim: *"Report bugs and small, targeted
   improvements only. Do not propose speculative abstractions, extra configuration surface, new
   layers, or rewrites — the smallest change that fixes each real problem. If code works and is
   clear, leave it alone."*
3. **Iterative fix loop**: verify codex's factual claims against the repo first; apply accepted
   fixes; commit; log round + verdict in `lessons/`; RESUME the same codex session with the fix
   diff; repeat until a round yields no new material findings. >3 material rounds → stop, surface
   to the owner (scope smell).
4. **Delivery**: `gh stack sync` + refresh PR bodies; the two new arc PRs stay draft until the fix
   loop converges, then mark ready. `gh stack merge` remains the owner's call, never autonomous.

## Delivery

Two new arcs on the existing stack #420 (`dev ← #417 ← #418 ← #419`):

- **Arc 4** `feat/kdf-v2-passkey-512` (P1–P2) — stacks on `feat/kdf-v2-account-io` (#419).
  `gh stack add feat/kdf-v2-passkey-512` at the boundary; `gh stack submit --draft --auto` early;
  PR title `feat(passkey): 512-bit master reduce + kdf-spec passkey clause + execution canary`.
- **Arc 5** `feat/kdf-v2-dek-isolation` (P3–P6) — stacks on arc 4.
  PR title `feat(profile): credential-rooted imported-keys dek + duplicate-phrase guard + account e2e`.
- Post-impl fixes land on the arc they belong to (`gh stack down`/`up`), then `gh stack sync`
  (cascade rebase, `--force-with-lease` — agent owns every arc branch).
- Independently revertable: arc 4 reverts to the parent stack's passkey behavior; arc 5 reverts to
  master-rooted imported keys with no dup guard.

## Approval

**APPROVED (owner, 2026-08-19)** — verdict: approve, scope as written (arcs 4+5). The KDF-spec
amendment is **RATIFIED** (owner accepted: passkey addresses rotate pre-production; pre-existing
account-export files stop validating — none exist outside e2e; rules text rewritten to "the
in-place redefinition window closes at the first shipped build"). This closes the final audit
pass's third condition — no conditions remain open.

## Seeds (FINAL — post-approval canonical)

**ELI5 companion**: Artifact at https://claude.ai/code/artifact/e976d1bd-101a-44e2-9542-6cb74c5ed5cd
(`eli5_mode: artifact`; source: `implementations-plan/key-model-v2-hardening/eli5.html` — redeploying
the same file from the owning session keeps the URL; other sessions pass the URL as `url`).

**Recommended: /goal** (completion transcript-observable; survives resume):

```
/goal All six phases (P1–P6) marked ✓ in implementations-plan/key-model-v2-hardening/plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate as defined in plan.md reported passing in the transcript — including P4's ten named integration criteria (a)–(j) and the prover-ON passkey execution canary; the crypto adversarial riders executed — after P1, P3, and P4 a focused codex xhigh attack on that phase's implemented diff is quoted in the transcript with its verdict, and no High finding is left unresolved; for each phase the agent printed LESSONS_FILE=implementations-plan/key-model-v2-hardening/lessons/phase-N.md in the transcript; /code-review max --fix complete with fixes committed separately; the codex post-impl fix loop converged (a resumed codex pass reporting no new material findings, quoted in the transcript); arcs 4 and 5 exist on the gh stack as draft PRs (gh stack view output in the transcript showing feat/kdf-v2-passkey-512 and feat/kdf-v2-dek-isolation stacked on #419); bun run audit:vue, bun run test:e2e, and the targeted bun run e2e:agent runs (passkey-execution-canary + frozen-account-canary + profile-reimport-matrix) all report exit 0 in the transcript.
```

**Alternative: /loop 15m** (in the ELI5 companion, kept in sync). Use exactly ONE per session.

## Audit verdicts

- **Round 1 — codex (gpt-5.6-sol, xhigh, fresh)**: `conditional approve` (conditions: DEK-bind the
  envelope MAC; define DEK lifecycle/failure semantics; register the duplicate RPC error; correct
  the inventories, governance claim, and canary assumptions). All adopted → rev 2. Transcript:
  `audit-codex.md`.
- **Round 1 — fable (independent)**: `conditional approve` (conditions C1–C5: sixth row site;
  restore-path error escape; pendingRestoreSecrets DEK; dek-less semantics + no-bearer; MAC info
  bump). All adopted → rev 2. Transcript: `audit-fable.md`.
- **Final fresh-context codex pass (round 1 on rev 2)**: `reject` (blocking: restore-reseals-same-
  DEK lets an allowed backup clone defeat per-profile isolation; plus the degradation state
  machine, dup-check TOCTOU, passkey userHandle hole, deriveKey usage, fact narrowings). ALL
  adopted → rev 3. Both disagreement resolutions endorsed.
- **Final pass re-verdict (resumed, on rev 3)**: `conditional approve` (conditions: (1) define the
  transient source-DEK rewrap handoff/lifetime — HIGH, `restore()` runs before
  `restoreImportedKeys()` so the source DEK must survive in a TTL-bound memory-only context, not
  be zeroized inside restore → ADOPTED (rev 4, §B rewrap context + P4 criterion (j));
  (2) remove contradictory rev-2 instructions (header, file map, P4 body still described the
  rejected designs) → ADOPTED (rev 4 sweep); (3) owner ratifies the KDF-spec amendment → OPEN, it
  IS the approval-gate ask). No other unresolved findings.
