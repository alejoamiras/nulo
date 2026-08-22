# Recon — key-model-v2-hardening

Phase 0.4 codebase recon for the follow-up hardening plan (imported-key DEK isolation +
duplicate-phrase guard + passkey 512-bit reduce + missing account export/import e2e). Four
read-only explorers over the CURRENT working tree of `feat/kdf-v2-account-io` (the top of the
key-model-v2 stack — this plan stacks on it, so recon reads it, not origin/dev). Consolidated
findings; the design-deciding items are marked ★.

## 1. Session credential lifetime (the DEK make-or-break)

- ★ **After unlock, only the master `Fr` survives** — `ActiveSession = {profile, session, secret: Fr}`
  (`profile/spec.ts:101-108`). The passhash is zeroized before `unlockProfile` returns
  (`profile/service.ts:417`); `PasskeyCredential` (PRF base key) goes out of scope uncached —
  `PasskeyService.materializeCredential` constructs a fresh one per call. No credential material of
  any kind is reachable at `loadImportedAccountContract` time. ⇒ the DEK must be unsealed at
  unlock (credential transiently in hand) and threaded through `openSessionVerified →
  SessionManager.open → ActiveSession` — the exact channel the master uses.
- ★ **Silent-restore bearer asymmetry**: password profiles restore the master across MV3 SW
  suspends via the F-11 random-token bearer (`SessionSecretBox`, `session-manager.ts:202-260,
  392-499`); the passhash does NOT survive. A DEK not folded into the bearer dies at every SW
  suspend → imported accounts break until re-unlock while derived accounts keep working. ⇒ the DEK
  joins the bearer wrap. Adversarial check: the bearer lives in the profile's own ephemeral
  `chrome.storage.session`; the threat model (storage.local read + other-profile password) never
  sees it — reading storage.session implies code execution in the extension (game over regardless).
  `SessionSecretBox` is typed/hardcoded to 32-byte `MasterSecretBytes` — needs generalizing
  (wrap `master || dek` or a second wrap call).
- **Passkey profiles are never silently restored** (`session-manager.ts:419-424`) — every unlock
  re-runs the full WebAuthn ceremony, so the PRF-derived wrap key is available at every unlock; no
  bearer problem on that branch.
- ★ **Recon challenged the design** — why credential-gate when `pxe-store-key.ts` proves
  master-derived subkeys need no storage? Resolution (goes in the plan verbatim): master possession
  is precisely what the attack grants (shared phrase ⇒ shared master); any `HKDF(master, …)` root is
  decryptable by profile B by construction. The credential is the only distinguishing input in the
  threat model, so it is the only valid root. `pxe-store-key` is per-profile operational state, not
  external secret material with an isolation promise — different requirement.
- Reuse: `EncryptionKey.fromPasshash + encrypt/decrypt(aad)` (public, general-purpose) seals the
  DEK — do NOT extend the byte-frozen `PasswordSecretBox` 3-field shape; `imported-account-key-box`'s
  `rowKey()` HKDF-per-row-info pattern keeps its shape with `dek` swapped for `master` as IKM;
  `PasskeyRecovery`/coordinator's 4 methods each hold a live credential long enough to piggyback a
  second derivation (`deriveDekWrapKey()` with a NEW info label — never touch the frozen
  `PASSKEY_KDF_LABEL`/`PASSKEY_MASTER_LABEL`); `secret-types.ts` branding for an `ImportedKeysDek`.
- Touch points: `SessionManager.open()` (+8 call sites), `getSecret`-style `getDek` accessor,
  `changeProfilePassword` MUST reseal the DEK (else stranded after password change — the
  easy-to-miss site), the 3 imported-key call sites in `account/service.ts` (320/361/420);
  derived-account paths keep using the master untouched.
- Stale name warning: `restorePasswordSession` does not exist (pre-F-11 docs mention it); current
  mechanism is `SessionManager.restore()` + bearer.

## 2. Profile row + backup surface

- Profile row: hand-written discriminated union (`profile/spec.ts:36-61`) — password variant
  `{guard, secret, entropy, envelopeMac}`, passkey variant `{credentialId}` only. Storage via
  `EntityStorage` at `nulo:core:profiles`; all row construction in `profile/service.ts`
  (createProfile 313-322, importPasswordProfile 1523-1532, importPasskeyProfile 1571-1577, restore
  1685-1696 / 1778-1784, changeProfilePassword 769-774).
- Envelope MAC: preimage `` `${guard}.${secret}.${entropy}` `` keyed by
  `HKDF(master, "nulo:envelope-mac:v1")`. 5 call sites touch the preimage (compute: service.ts 309,
  773, 1522, 1675-1678; verify: session-manager.ts 462-466 — the bearer path's only tamper check).
  Adding the DEK slot ⇒ MacEnvelope v2 4-field preimage, all 5 sites + `macEnvelope()` helper.
  Legal: the MAC shape itself only exists on these unmerged PRs.
- `PROFILE_AAD` gains a 4th purpose tag (`dek: "nulo:profile-imported-dek:v1"`). The DEK is sealed
  as an INDEPENDENT field via `EncryptionKey` — the `EncryptedProfileSecret` triple stays frozen.
  `reseal`'s "always all fields atomically" invariant (audit H2) extends to the DEK.
- ★ **Profile rows are BLOCK-LISTED from backups** (`backup-migration-registry.ts:198,233`) —
  backups carry top-level `master-key` + `entropy` only; `restore()` reconstructs the row from
  scratch. **A random DEK sealed only on the row is LOST at restore, orphaning every imported
  account's signing key.** ⇒ the DEK must travel as a NEW top-level backup field beside
  `master-key`/`entropy` (`exportBackupMaterial` + `RestoreSecret` + `full.vue:163-178`), restored
  and resealed under the restoring credential in `restore()`. Isolation survives: a backup file is
  a different trust domain than storage.local; A's backup carries A's DEK under A's backup
  protection — the storage-reader + B's-password attacker never holds it.
- **No epoch bump**: `CURRENT_COMPAT_EPOCH = 4` was created in this same unmerged stack; the DEK
  field joins epoch 4's required shape (password blobs) pre-launch, same latitude as A2. Passkey
  blobs: DEK travels on that branch too (uniform).
- `walletFingerprint`: purely additive Profile field, no backup carriage (recomputed from the
  master at restore), no registry touch, no migration (and none possible — the migrator never has a
  master; pre-production anyway).
- ★ **Duplicate check must be service-side**: the popup NEVER holds a derived master
  (`useProfileImportFlow` sends raw words over RPC; passkey masters never reach the popup;
  `deriveMasterFromMnemonic` has zero client-side call sites). Insertion points where the candidate
  master is in hand pre-persist: `importMnemonic` (service.ts:1241-1242 → importPasswordProfile),
  `importPasskeyProfile` (param), `restore()` both branches (password ~1648, passkey ~1746), all
  before `repo.set`. Shape: typed `DuplicateWalletError` + `allowDuplicate` retry param (UI
  catches → warn+confirm → re-call), mirroring existing error-driven flows.
- ★ **Fingerprint privacy is a non-issue**: two same-phrase profiles already carry IDENTICAL
  account addresses in plaintext rows — a storage reader already sees the linkage; the fingerprint
  adds zero new information.
- No existing hash-of-secret precedent — new pattern; follow the `nulo:<purpose>:v<n>` label
  convention (`sha256("nulo:wallet-fingerprint:v1" || master)`), uniform across profile types
  (passkey profiles have a master but no entropy — fingerprint the MASTER).
- Passkey duplicate-credential import is already HARD-blocked ("Passkey profile already exists",
  service.ts:1557-1559/1767-1769) — structural (userHandle == profile id), unchanged by this plan.
- Test shapes: wallet-crypto = pure vitest with REAL WebCrypto (round-trip / wrong-key /
  corrupt-fails-closed / separator-unambiguity); profile lifecycle =
  `service.integration.test.ts` (real crypto, FakeBrowserApi storage).

## 3. Passkey KDF + vector surface

- Current: `deriveMasterSecret()` = HKDF `deriveBits(…, 256)` → `Fr.fromBufferReduce(32B)`
  (`passkey-credential.ts:68-85`). The 512-bit change is a structural copy of the shipped mnemonic
  pattern (`mnemonic-master.ts:50-62`). Labels untouched. `MasterSecretBytes` is size-agnostic;
  `Fr.toBuffer()` stays 32B — no downstream type changes.
- ★ **Blast radius: exactly ONE pinned literal** — V3's hex at
  `apps/extension/src/wallet/crypto/key-vectors.test.ts:153`. Full V1–V11+P1 enumeration: only V3
  is passkey-reduce-sensitive. V10 (passkey→address chain) was documented but NEVER implemented
  (bb.js WASM crashes under jsdom). No fixture files, no mocked tests, no e2e hardcode passkey
  values (passkey e2e captures addresses dynamically). Regeneration ritual: hand-run the new
  `deriveMasterSecret()`, pin, per the file's own header protocol. No reference generator covers
  passkey (deliberate — independent chain); none needed.
- `NULO_KDF_SPEC` (address-freeze.ts:53-59) covers ONLY the mnemonic chain today. Extension:
  append a passkey clause, recompute `NULO_KDF_DIGEST`, update `address-freeze.test.ts`'s
  independent literals (`EXPECTED_KDF_DIGEST` + `EXPECTED_REGIMES` incl. the hand-typed `ack`) +
  new substring assertions — three files, one commit, per the freeze module's own rule.
- ★ **Governance**: the rules text calls the in-place redefine a "one-time pre-launch carve-out…
  exercised once." Position taken (for audit attack): the nulo-v5 regime record itself still lives
  on unmerged draft PRs — amending `NULO_KDF_SPEC` before the stack lands is amending the
  not-yet-shipped baseline, not a second exercise. The rules text gets updated in the same commit
  either way.
- Consequence: rotating the passkey master rotates `derivePxeStoreKey(master, profileId)` for
  passkey profiles — self-documented as safe crypto-erase + PXE re-sync (`pxe-store-key.ts:9-13`).
  Deliberate, called out.
- Consumers: the ONLY production `.deriveMasterSecret()` call sites are the 4
  `PasskeyRecoveryCoordinator` methods (lines 57/71/84/104); everything downstream is pure
  re-derivation from the master's byte value — no persisted format keyed by it besides addresses +
  PXE store (both rotate, both accepted).
- ★ **Passkey execution canary**: the harness drives REAL WebAuthn PRF (virtual authenticator
  `hasPrf: true`, Chrome 130+/puppeteer 24.40, `fixtures/passkey.ts:52`); scoping is
  per-FrameTreeNode (in-page Path-A ceremonies work; cross-window doesn't). The mnemonic canary's
  entire tx-execution machinery (playground bridge, nullifier witness, SW-restart flow,
  `mintPublicTokensForAccount`) is reusable. NOT reusable: the independent formula cross-check —
  PRF secrets can't be read back via CDP (`WebAuthn.getCredentials` has no HMAC-seed field,
  PRF-NON-PORTABLE.md). Design fork for the plan: (a) capture PRF bytes at the
  `navigator.credentials` boundary in-page, re-derive master+address independently node-side
  (true cross-check, slightly fragile hook) vs (b) execution-only canary (register → real proven
  tx), formula pinned by V3. Net-new either way: a passkey-flavored dApp-connected fixture
  (registration + capability grant never combined in existing fixtures).

## 4. E2E harness (account export/import smoke + dup-guard UI)

- Suite membership: smoke = `tests/e2e/*.test.ts` flat (network suite is the nested dir). New
  files just land there; no build-time arming needed for this feature (neither popup reads a
  `VITE_NULO_E2E_*` flag).
- ★ **Two-profile pattern**: no in-session second-profile fixture exists; the in-browser
  SelectProfilePopup→/popup/profile/new path is UNPROVEN (auth-flows.test.ts only asserts the
  route). The PROVEN pattern is `backup-roundtrip.test.ts:87-90` — a second independent
  `launchExtension({userDataDir}) + registerProfile(ctx2)` in the same test. Use it for the
  round-trip test.
- Export side: `AccountExportPopup` does NOT download — it reveals inline via `SecretRevealCard
  testId="export-account-reveal"`; read `scope.querySelector("input").value` per the
  `security-backup.test.ts` idiom. The password field is the PROFILE password (also the file
  password when the encrypt toggle is on, default on); plaintext export needs no import password
  (`decodeAccountExport` sniffs JSON vs base64).
- Import side: paste path (`replaceInputValue` into `import-account-body-input`) is the simple
  route; the file-chooser idiom (`page.waitForFileChooser` + `clickByTestId` +
  `chooser.accept([path])`, from `importFullBackup`) is proven if the pick-file button needs
  coverage. `writeBackupToTemp` reusable; callers `rmSync` in `finally` (plaintext exports carry a
  real signing key — clean up).
- Test 3 (duplicate) is a SAME-profile scenario (`importAccount` dup check is
  `(profileId, chainId)`-scoped) — one profile, import twice, assert
  `import-account-error` = "This account is already in your wallet".
- ★ Traps: `account-export-btn`/`account-edit-btn` are SHARED testids across rows — scope through
  the row's `data-account-name` (accounts.test.ts:94-98 idiom); bare `clickByTestId` picks the
  LAST visible match → silent wrong-target on multi-account pages.
- testid discipline is documented convention (fixtures/popups.ts:5-19 header), not tool-enforced;
  `waitForToast` is the sanctioned text exception. (The generic e2e-testing skill's "use text/
  selectors" note contradicts the repo convention — repo wins.)
- Dup-guard confirm UI: the generic `cacheStore.confirm` + `popupStore.open("confirm")` machinery
  (~10 existing consumers) + `ConfirmPopup` testids (`confirm-submit`/`confirm-cancel`) + the
  existing `acceptConfirmPopup(page)` e2e driver are all reusable as-is. The detection itself is
  new product work; `useProfileImportFlow` (shared by popup + onboarding import shells) is the
  catch-and-confirm layer; no existing cacheStore.confirm consumer touches profile import.
- Existing "duplicate" rejections nearby are same-profile hard errors ("Duplicate account",
  "This account is already in your wallet") — different scenario from the new cross-profile
  phrase guard; don't conflate.
