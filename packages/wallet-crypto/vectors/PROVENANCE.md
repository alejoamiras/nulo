# `bip39-official-english.json` — provenance

The **official BIP-39 English test vectors**, vendored verbatim. These are the external oracle for
the first step of NULO-ACCOUNT-KDF v2 (`deriveBip39Seed`): the reference implementation's authors
published both the input and the exact 64-byte seed it must produce, so a passing row cannot share
a misreading of the spec with the code under test. Values here are **never** regenerated from this
repository's own output — that would make the answer key a copy of the answer.

- **Source**: <https://github.com/trezor/python-mnemonic> — `vectors.json` on `master`, the vector
  file referenced by BIP-39 itself (`bips/bip-0039.mediawiki`, "Test vectors").
- **Retrieved**: 2026-08-19 via
  `curl -sSfL https://raw.githubusercontent.com/trezor/python-mnemonic/master/vectors.json`
- **Upstream file sha256**: `fa3b937b7cff9c9b8ecd3aa011faeb8d6dd67993174b72326e83f4de8fdb30f8`
  (152400 bytes; 12 language keys × 24 rows)
- **Extraction**: the `english` array only, each upstream row `[entropy, mnemonic, seed, xprv]`
  reshaped to `{entropy, mnemonic, seedTrezor}`. The `xprv` column is dropped — it is BIP-32
  extended-key output, and this wallet does not derive BIP-32 keys.
- **Vendored file sha256 at vendor time**:
  `9d57196a0cf668e421026bfdf99139567461258ebbc9a6922b3dcbc669b70e07`
  (informational — the file is JSON, so a formatter may re-indent it without changing any value;
  the structural assertions in the paired test are what actually guard the contents.)

## What the rows cover

All 24 rows: 12-, 18-, and 24-word mnemonics; entropies from all-zero bytes through all-`0xff`,
plus pseudo-random ones. Every `seedTrezor` is the seed for passphrase **`"TREZOR"`**, which is the
passphrase the published vectors use — production derives at passphrase `""`, so the KAT exercises
the passphrase path and the production path is covered separately by the cross-implementation rows
in `implementations-plan/key-model-v2/reference/vectors.json`.

## Why this file earns its place

A green row proves, simultaneously and with no partial credit, that PBKDF2 is correct, that
HMAC-SHA512 is the right PRF, that the iteration count is exactly 2048, that the salt is
`"mnemonic" ‖ NFKD(passphrase)`, that the sentence is NFKD-normalized, and that whitespace and case
canonicalization do not alter the derivation. Any one of those being wrong changes the seed
completely.

The failure this guards against is not an attack: it is shipping a recovery phrase that looks
correct, restores nothing anywhere else, and is discovered only when someone needs it.

Pinned by [`../src/bip39-official-kat.test.ts`](../src/bip39-official-kat.test.ts).
