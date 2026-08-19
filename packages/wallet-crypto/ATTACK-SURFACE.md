# Attack surface — what an attacker gets, and what it costs them

This answers one question directly: **if someone reads everything this wallet writes to disk, can
they recover the 24 words?**

The short answer: **not from the cryptography — only from the password.** Every path to the words
runs through a password guess. The words themselves are behind ~253.6 bits, which is not
brute-forceable by anyone, ever. So the honest headline is uncomfortable but useful:

> **A weak password is the only realistic way to lose a wallet to an attacker who has the disk.
> The crypto does not save a bad password, it only makes each guess expensive.**

Everything below states, for each artifact, exactly what it is and what inverting it takes.

## Threat model

The adversary reads `chrome.storage.local` — a stolen laptop, a backup that syncs, a malicious
extension with storage permission, a forensic image. They do **not** have code execution inside the
extension while it is unlocked; if they did, they would read the unlocked master out of memory and
none of this would matter.

Two attackers are worth separating, because the second one is the reason the imported-keys DEK
exists at all:

- **The disk reader.** Has the ciphertexts, no password.
- **The same-phrase sibling.** Legitimately owns a second profile created from the *same* recovery
  phrase, so they hold the same master, and want to reach the first profile's imported keys.

## What is on disk

| Artifact | Contents | Protected by |
|---|---|---|
| `profiles@<id>.secret` | the 32-byte master | AES-256-GCM under `EncryptionKey(passhash)` |
| `profiles@<id>.entropy` | the BIP-39 entropy — **literally the 24 words** | same |
| `profiles@<id>.guard` | a known constant, used to detect a wrong password | same |
| `profiles@<id>.dekSealed` | the 32-byte imported-keys DEK | same (password) / passkey PRF wrap key |
| `profiles@<id>.envelopeMac` | HMAC-SHA256 over all four slots | keyed `HKDF(master ‖ dek)` |
| `profiles@<id>.walletFingerprint` | `sha256("nulo:wallet-fingerprint:v1" ‖ master)` | **nothing — plaintext by design** |
| `profiles@<id>.credentialId` | WebAuthn credential id (passkey profiles) | nothing — it is a public identifier |
| imported-key rows | an external account's Grumpkin signing key | AES-256-GCM under `HKDF(dek, chainId ‖ address)` |
| `storage.session` bearer | `master ‖ dek` **and** the random token that unwraps it | nothing, jointly — see below |
| full backup file | plaintext master + entropy + DEK, unless encrypted | the backup password, if the user chose one |

## Cost to invert each one

**Recovering the words (or the master) from the profile row.** Both `entropy` and `secret` are
sealed under the same key: `PBKDF2-HMAC-SHA256(SHA-256(password), salt, 600 000)`. There is no
shortcut around the password; the only attack is guessing it, and each guess costs one full
600 000-iteration PBKDF2 run.

Rough rate for a well-equipped attacker: a high-end GPU does on the order of 10⁴ such guesses per
second, so a ten-GPU rig is ~10⁵/s. Taking 10⁵/s as the working number:

| Password | Search space | Time at 10⁵ guesses/s |
|---|---|---|
| in any common wordlist | ~10⁷ | **under two minutes** |
| two dictionary words + digits | ~2³⁵ | ~4 days |
| 8 random alphanumerics | ~2⁴⁷ | ~45 years |
| 4 random dictionary words (diceware) | ~2⁵¹ | ~700 years |
| 12 random alphanumerics | ~2⁷¹ | far beyond any horizon |

Those numbers are estimates to an order of magnitude, not guarantees — GPUs get faster. The shape
is what matters: **the gap between a guessable password and a random one is roughly ten orders of
magnitude, and no amount of cryptographic care closes it.**

**Recovering the master without the password: 2²⁵³·⁶.** Not a large number in the sense of "hard" —
a number with no physical meaning. Brute-forcing it is not a matter of better hardware or more
time. The same applies to inverting `walletFingerprint` to find the master, or inverting the BIP-39
seed step.

**Confirming a guessed phrase via `walletFingerprint`: one SHA-256.** This value is deliberately
plaintext (the duplicate-phrase check must compare across profiles that are still locked, so it can
only use inputs derivable from a candidate master). It reveals nothing on its own, but it *confirms*
a candidate instantly. The sharp case: someone holding 23 of the 24 words faces exactly 8
checksum-valid completions, and this picks the right one immediately. Accepted — see the reasoning
in `src/wallet-fingerprint.ts`. Note that 23 known words is already a catastrophic compromise: the
same 8 candidates can be tested against public chain state without any help from us.

**Recovering imported account keys: the password again, then the DEK.** Imported keys root in a
per-profile random DEK, which is itself sealed under the credential. The same-phrase sibling holds
the master and still cannot reach them: the master is not an input to that key. This is the
property the DEK exists for, and it is the one place this design goes beyond what a standard wallet
does.

**The passkey path has no offline attack at all.** The master comes from the authenticator's PRF
output, which never leaves the device and requires user verification to produce. A disk reader gets
`credentialId` (a public identifier) and ciphertext they cannot key. There is no password to guess.
This is strictly the strongest profile type on offer.

**The session bearer is not an attack surface, it is an admission.** `storage.session` holds the
random token *and* the ciphertext it opens, side by side — so reading it yields the master with no
work. That is inherent to silent restore: the service worker must recover the session after a
restart without the user. It costs nothing extra, because reading `storage.session` requires code
execution inside the extension, and at that point the unlocked master is already in memory.

**An unencrypted backup file is plaintext.** Master, entropy, and DEK, in the clear. Encrypting the
backup moves it to the same footing as the profile row — i.e. onto the strength of the backup
password.

## Known limitations, stated rather than buried

- **PBKDF2, not Argon2id.** 600 000 iterations meets the OWASP minimum for PBKDF2-HMAC-SHA256, but
  PBKDF2 is cheap to parallelise on GPUs in a way that memory-hard KDFs are not. Argon2id would
  raise the per-guess cost by orders of magnitude against exactly the attacker modelled above.
  Switching is not a migration this wallet can perform in place — the migrator runs pre-unlock with
  no password to re-encrypt under — so it is a re-encrypt-on-next-unlock change, deliberately not
  taken yet.
- **`passhash` is an unsalted `SHA-256(password)`.** It is only ever an *input* to the salted
  600k-iteration PBKDF2, so it does not lower the guessing cost. It would be password-equivalent if
  it ever leaked; that is why it is no longer persisted anywhere (the session bearer used to store
  it and no longer does).
- **A full backup carries the long-lived profile DEK**, so a backup holder who later regains read
  access to the source profile can open imported-key rows created *after* the export. Narrower than
  what the same file already gives up (the plaintext master), and tracked as a follow-up.
- **This is a custom derivation scheme.** It is built entirely from standard primitives — PBKDF2,
  HMAC-SHA512, HKDF, AES-256-GCM, SHA-256 — with no hand-rolled cryptography, and the primitives
  are pinned against published test vectors (all 24 official BIP-39 vectors, RFC 5869 A.1 for
  HKDF). But the *composition* is ours. It has been through four planning audits, three
  implementation-time crypto reviews, and three adversarial review rounds; it has **not** been
  reviewed by a human cryptographer. Before this holds meaningful funds, it should be.

## Where each claim is enforced

| Claim | Test |
|---|---|
| BIP-39 step is spec-correct | `src/bip39-official-kat.test.ts` (24/24 official vectors) |
| HKDF is spec-correct | `apps/extension/src/wallet/crypto/key-vectors.test.ts` (RFC 5869 A.1) |
| The field reduction loses no entropy | `src/reduction-entropy.test.ts` (computed, not asserted) |
| No AES-GCM nonce is ever reused | `src/nonce-uniqueness.test.ts` |
| Derived addresses never drift | `packages/aztec-runtime/src/account/derivation-vectors.test.ts` |
| Secrets are wiped after use | `src/zeroize.test.ts` |
| A sibling profile cannot reach imported keys | `src/imported-account-key-box.test.ts`, `src/entropy-mac.test.ts` |
