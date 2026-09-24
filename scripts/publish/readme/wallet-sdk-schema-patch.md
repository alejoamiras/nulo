# @alejoamiras/nulo-wallet-sdk-schema-patch

Adds the [Nulo wallet](https://github.com/alejoamiras/nulo)'s custom RPC methods to the `WalletSchema` of `@aztec/aztec.js`, so a dApp's wallet-sdk client can call them:

| Method | Signature |
|---|---|
| `registerToken` | `(AztecAddress, AztecAddress) => void` |
| `isTokenRegistered` | `(AztecAddress) => boolean` |
| `grantPublicAuthwit` | `(AztecAddress, { caller, contract, method, args }) => string` |
| `getWalletFeatures` | `() => string[]` |

Wallets that do not implement them reject the call, so treat every one as optional and fall back when it fails.

## Usage

Import the side-effect entry **first**, in the module that creates the wallet-sdk client, so the schema is patched before any client reads it:

```ts
import "@alejoamiras/nulo-wallet-sdk-schema-patch/register"
```

`./apply` exports `applyNuloSchemaPatch(schema)`, the same patch as a function. Applying it twice is a no-op. It throws if `@aztec/aztec.js` already defines one of these methods with a different signature, instead of silently shadowing it.

## Requirements

- ESM only.
- `@aztec/aztec.js` and `@aztec/stdlib` are exact **peer dependencies**. The patch must mutate the same `WalletSchema` and compare against the same `schemas.AztecAddress` your app loads, so a duplicate copy of either package silently defeats it.
- `zod` is a dependency.

## Provenance

Built from `packages/wallet-sdk-schema-patch` in [alejoamiras/nulo](https://github.com/alejoamiras/nulo) by `.github/workflows/publish-packages.yml` and published with npm provenance. `npm audit signatures` verifies the attestation.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
