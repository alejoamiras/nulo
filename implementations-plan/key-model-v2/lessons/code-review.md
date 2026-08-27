# Post-implementation code review (`/code-review max --fix`)

Whole-diff adversarial review of the 24-commit / 113-file branch vs `dev`. Run as **five parallel
subsystem reviewers** (crypto primitives · profile entropy · account export/import ·
backup+migration · UI/composables/e2e) **plus a resumed codex `gpt-5.6-sol` xhigh crypto pass** on the
implemented code. Every finding was verified against the source before any fix; each reviewer was
told the owner-accepted tradeoffs so it hunted real bugs, not settled decisions.

## Headline verdicts (the owner's core worry)

- **Codex, verbatim:** *"NO — for 24-word mnemonic-derived accounts, v2 does not materially downgrade
  derivation security versus BIP-39/BIP-32."* Its independent "looks correct" list: PBKDF2 emits the
  full 64 bytes and only 64-byte reductions occur in the mnemonic/signing chain; the two Nulo
  separators recompute from their sha256-of-label provenance, are mutually distinct, and collide with
  **none of the 68** installed Aztec `DomainSeparator`s; `(l1ChainId,type,index)` packing is
  injective; purpose-AAD blocks slot swaps and every password-box decrypt supplies it; the envelope
  MAC verifies via WebCrypto (constant-time).
- **Profile reviewer:** the same-password **cross-profile transplant defenses hold** — could not break
  them on any path (entropy-slot, secret-slot, guard-slot, full-envelope each rejected before a secret
  is used).
- **Backup/migration reviewer:** CLEAN across all six focus areas, including the catastrophic-bug check
  — the integrity coordinator's PRODUCTION default deriver uses the one shared `deriveAccountSeed` with
  the row-carried `l1ChainId` (the `coordinator.default-deriver.test.ts` proves it).
- **Account-export reviewer:** core threat vectors genuinely closed — `Fq.fromString` **throws** on any
  scalar ≥ the Grumpkin modulus (no silent coercion of an L1/EVM key), the service enforces address⇔key
  self-consistency regardless of popup honesty, quarantine is single-account, HKDF transplant fails
  AES-GCM auth.
- **UI reviewer:** e2e **formula parity CLEAN** (the drivers call the real production derivation
  functions, no re-implementation drift).

## Fixed (committed separately: `d2dc1d0b` UI, `7efae549` crypto/service)

- AccountExportPopup copied the plaintext signing key with no clipboard scrub → routed through
  `useSecretClipboardCopy` (F-14 60s clear), matching the recovery-phrase page.
- Zeroization gaps (all confirmed against source; codex LOW): `password-secret-box.unsealInternal`
  leaked the decrypted **master** on a throw from a malformed/hostile `entropy` slot (`Buffer.from`)
  after decryption; `imported-account-key-box.unseal` skipped the envelope wipe on the common
  wrong-master throw; `account/service.ts` never wiped the inline `master.toBuffer()` copies (seal +
  load); `getEntropy` never wiped `concatBits` and leaked reconstructed entropy on the checksum-fail
  throw. All now `finally`-wiped with a hand-off flag so returned buffers stay caller-owned.
- `getRandomHex` truncated on odd length (latent; all callers even today) → `Math.ceil` + slice.
- `exportPlain` was the one entropy-reveal site missing the entropy↔master pairing check (it feeds real
  signing-key derivation) → added.
- `accountSetDigest` omitted `l1ChainId` — a derivation input distinct from the composite `chainId` —
  so an in-place `l1ChainId` tamper holding `address` constant could skip boot re-derivation → added.
- `importAccount` resolved the row `l1ChainId` AFTER writing the sealed key row (orphan-on-throw) →
  resolved before the write.
- Copy sweep finished: onboarding import subtitle no longer advertises a removed "key" import; seed
  toast + appearance copy renamed; dead `export/key.vue` doc-comments dropped from four `Secret*`
  composites; import-preview invalidated on any body/password edit.

## Surfaced to owner (NOT autonomously changed — see the handoff)

1. **Profile-identity binding in at-rest sealing** (codex MEDIUM ×2; profile reviewer says contained).
   Codex's residual: a full-envelope transplant into a same-password profile with **zero** derived
   accounts escapes the integrity-delegate containment. The fix (bind profile id into AAD/MAC + HKDF
   info) **reverses a deliberate, documented decision** — profileId was excluded so restore's id-remap
   keeps sealed material decryptable. Reconciliation exists (rewrap-on-restore) but changes the on-disk
   envelope format and reverses a plan decision → owner adjudication. Codex loop resumed on this.
2. **Frozen passkey master uses a 256-bit reduce** (`passkey-credential.ts`, NOT in this diff) →
   ~253.4-bit master, ~0.18-bit min-entropy loss, ~3.89% statistical distance. The mnemonic path (this
   diff) correctly does the 512-bit reduce. Frozen (V3/V10 address vectors) ⇒ changing it is a V6/regime
   event, not a patch. Owner: accept-and-document vs defer-to-V6. Same file's `self.crypto` (safe, but
   frozen-adjacent + out of this diff's scope).
3. **Quarantine failure-mode is `type`-selectable** (account reviewer, fail-closed): a hostile backup
   labelling an imported account as a derived type triggers a profile-wide integrity block (safer, not
   weaker) instead of single-account quarantine, scoped to the just-imported profile. Document the
   tradeoff.
