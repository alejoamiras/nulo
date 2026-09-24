# @alejoamiras/nulo-wallet-crypto

Account-key derivation and password-based encryption from the [Nulo wallet](https://github.com/alejoamiras/nulo), published so other projects derive the same signing and account secret keys and read the same ciphertexts as the wallet.

Keys are not addresses. A Nulo account's address also depends on the wallet's frozen Schnorr account artifact and its instantiation descriptor, which this package does not ship. The artifact in the `@aztec/accounts` peer has a different contract class id, so an account built from these keys with it gets a different address from the wallet's.

## Exports

| Export | Contract |
|---|---|
| `deriveSigningKeyFromSeed(seed: Fr): GrumpkinScalar` | The account's Schnorr signing key: `sha512ToGrumpkinScalar([seed, NULO_SIGNING_ROOT_SEP])`. |
| `deriveNuloAccountKeys(seed: Fr): Promise<{ signingKey, secretKey }>` | The signing key plus the account secret key `deriveSecretKeyFromSigningKey` derives from it. |
| `EncryptionKey` | Password-based AES-256-GCM. `fromPassword(password)` and `fromPasshash(hash)` only import SHA-256(password) as the PBKDF2 input, which is cheap. Every `encrypt` and `decrypt` then derives a fresh AES key with PBKDF2-SHA256 at 600,000 iterations, with salt = SHA-256(IV) and a fresh 12-byte IV per message, so each call pays the full KDF cost. `encrypt(bytes, aad?)` / `decrypt(bytes, aad?)`: the frame is `0x00 ‖ iv ‖ ciphertext`, the AAD is not stored, and decrypting under different AAD fails authentication. `getPasshash(password)` and `getHashHex(input)` are SHA-256 helpers. |
| `type Passhash` | The branded SHA-256 of a password that `fromPasshash` accepts. |

Nothing else from the wallet's crypto layer is published.

## Requirements

- ESM only.
- The `@aztec/*` packages are exact **peer dependencies**. Install the same versions, and make sure a single copy of each is installed: `Fr` and `GrumpkinScalar` values are only interchangeable within one copy.
- WebCrypto (`globalThis.crypto.subtle`): current browsers, Node 20 or later, and Bun.
- TypeScript 5.7 or later for the declarations.

## Provenance

Built from `packages/wallet-crypto` in [alejoamiras/nulo](https://github.com/alejoamiras/nulo) by `.github/workflows/publish-packages.yml` and published with npm provenance. `npm audit signatures` verifies the attestation.

## License

Apache-2.0. `EncryptionKey` is modified from [Azguard Wallet](https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., licensed under Apache-2.0. See `NOTICE`.
