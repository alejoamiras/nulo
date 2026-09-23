# Audit — key-model-v2-hardening (fable leg, independent pass, round 1)

**Verdict: `conditional approve`** (with conditions: (C1) fix the row-construction enumeration —
`createPasskeyProfile` at `profile/service.ts:463-470` is a SIXTH site that must mint the DEK and
fingerprint, covered by an all-creation-paths integration test; (C2) specify how
`DuplicateWalletError` escapes `restore()`'s error-to-`restoreError` flattening — as written the
confirm-retry flow can never fire on the restore path; (C3) name
`pendingRestoreSecrets`/`finalizeRestore` as a DEK-threading site (stash `{secret, dek}`) with a
dedicated test; (C4) write down the unlock-time DEK-unseal failure semantics (fail-soft +
quarantine vs fail-closed) and the dek-less-session bearer rule; (C5) bump the envelope-MAC info
label to `nulo:envelope-mac:v2` with the preimage change.)

## Ranked findings (abridged — full text in the session transcript)

- **HIGH-1** — the "5 row-construction sites" enumeration misses `createPasskeyProfile`
  (service.ts:463-470, master in hand at 474): fresh passkey profiles would ship with no
  `dekSealed` and no `walletFingerprint`. Fix: SIX sites; P4 integration suite asserts both fields
  on every creation path, both profile types.
- **HIGH-2** — `restore()` eats domain errors: the password branch converts everything inside
  `runExclusive` into `{...profile, restoreError}` (1719-1728); the passkey branch wraps the whole
  flow in a catch (1806-1810); `useFullBackupImport` renders `restoreError` as a dead-end string
  (492-497). A pre-persist fingerprint check inside those zones surfaces as "Import failed," never
  the confirm dialog. Passkey retry also re-runs a second WebAuthn ceremony unless the recovery
  secret is stashed. Fix: password branch — check in the throwing zone (after the pairing check
  ~1658, before `runExclusive`); passkey branch — rethrow `DuplicateWalletError` explicitly (or
  stash the recovery for the retry). Also register the error in
  `packages/extension-messaging/src/errors.ts` (code-based reconstruction — file missing from the
  change map).
- **MEDIUM-1** — `finalizeRestore`'s passkey path stashes only `recovery.secret`
  (`pendingRestoreSecrets`, 1801) and opens the session with no ceremony (1914): the first
  post-restore session would be dek-less; every restored imported account quarantines until the
  next full unlock. Fix: stash `{secret, dek}`; integration leg "restore passkey backup carrying an
  imported account → sign before any re-unlock."
- **MEDIUM-2** — unlock-time DEK-unseal failure semantics unspecified. Recommendation: fail-SOFT
  (session opens dek-less; imported accounts quarantine per-account; a hard unlock failure would
  let a storage-writer lock the user out of DERIVED funds via one field) + **no bearer persisted
  for a dek-less session** (next SW suspend forces a password unlock, re-surfacing the failure
  loudly). Pin with a test.
- **MEDIUM-3** — MAC v2 preimage change without a `MAC_INFO` bump reuses the v1 key domain across
  two grammars. Checked: no concrete cross-version collision exists (base64 fields can't contain
  `.`), but the label bump is free on unmerged PRs — do it (`nulo:envelope-mac:v2`).
- **LOW-1** — "zero marginal linkability" overclaimed: same-phrase profiles with disjoint
  `l1ChainId` sets share no plaintext addresses today; the fingerprint links unconditionally and is
  a marginally cheaper equality oracle. Say "negligible," not "zero."
- **LOW-2** — `exportAccount`'s imported branch currently roots in the password-derived master via
  `exportPlain` (fresh service-side auth, session-independent). Wiring it to `SessionManager`
  would add a session dependency and bypass the facade's `deletionState` guards. Fix: unseal
  `dekSealed` under the supplied password directly, or a facade-mediated `getProfileDek`; never
  AccountService→SessionManager direct.
- **LOW-3** — Inference 4 false as worded: virtual-authenticator PRF does NOT survive a browser
  relaunch (credentials die with the browser; no HMAC-seed export). PRF IS deterministic across MV3
  SW restarts within one instance — all the canary needs. Scope legs accordingly.
- **LOW-4** — wording contradiction: "DEK minted at create/import/restore" vs the carriage
  section's (correct) "restore reseals the SAME bytes." Minting at restore would orphan every
  imported-key row in the backup. Tighten; P4 lifecycle test asserts an imported key DECRYPTS
  post-restore.

## Assumption attack

Facts: all verified except the row-construction enumeration (6, not 5 — HIGH-1); the "~8
openSessionVerified" count is ~9 (immaterial). Governance fact-check: origin/dev's freeze record is
`nulo-v5` with `kdf: "nulo-account-kdf-v1"`, NO `kdfDigest`, NO carve-out text — the carve-out
language exists only on this unmerged stack, so the plan's "amending the unshipped baseline"
position is factually grounded; recommend rewording the rules text to "the carve-out window closes
at the first shipped build."

Inferences: (1) PRF boundary hook plausible but fragile; fallback is the right hedge — and note
(a)'s unique value honestly: only (a) catches a consistently mis-wired ceremony input, which V3
(hand-captured from the same code) structurally cannot. (2) SessionSecretBox single-production-
consumer — verified TRUE. (3) Passkey restore re-derives the wrap key — verified TRUE
(recoverFromCredentialData + credentialId assert, 1746-1755); corollary: the row's `dekSealed` and
the backup's sealed blob are interchangeable ciphertexts. (4) FALSE as worded (see LOW-3).

Asks: no OWNER ask open, but C1–C5 are unstated decisions the plan silently delegated to the
implementer — resolve in plan text.

## Implementation critique

Competing DEK-less outline: rejection endorsed; the decisive extra reason — a policy check's
guarantee equals the completeness of its call-site coverage forever (HIGH-2 is a live demo), while
the DEK's guarantee is carried by key material. `master||dek` concat over a second wrap: RIGHT
(atomic restore; no master-restores-but-DEK-doesn't ambiguity; fixed 32+32 split; v1 bearer fails
the version gate → silentClose → re-unlock). Error+retry over check-only RPC: RIGHT (TOCTOU-shaped
API, doubled ceremony cost), conditional on the HIGH-2 fix. Backup carriage: sound, but restate the
invariant as "any backup already carries jointly-sufficient material (master + sealed rows)" —
full.vue permits UNencrypted downloads, so the encryption-centric phrasing is imprecise. Canary in
arc 4: correct. P4 gate should absorb C1/C3/C4 as named pass criteria. Perf note: the DEK adds one
PBKDF2-600k frame per unlock and two per password change (~0.3-1s) — document so nobody "fixes" it
by caching passhashes.

## Verified sound

512-bit change (strictly entropy-positive, blast radius genuinely one literal + the freeze triple;
both production reduce sites end at 64 bytes); the DEK hierarchy against the stated threat model
(sibling-password attacker cannot decrypt/transplant, can at worst DoS, which storage-write always
could); `deriveDekWrapKey` domain separation; fingerprint one-wayness; epoch-4-shape latitude; the
e2e plan's harness facts (testids, `acceptConfirmPopup`, cross-browser two-profile precedent,
same-profile duplicate scoping).

---
_Round 1 (Fable, Plan subagent, independent). All conditions adopted into plan rev 2 — see the
decision ledger._
