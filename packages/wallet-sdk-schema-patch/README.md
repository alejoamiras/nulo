# @nulo/wallet-sdk-schema-patch

Single source of truth for the Nulo-custom extension of `@aztec/wallet-sdk`'s
`WalletSchema`. Adds four methods that upstream doesn't ship — `registerToken`,
`isTokenRegistered`, `grantPublicAuthwit`, `getWalletFeatures` — so the dApp-side `ExtensionWallet`
proxy can route them.

Private, extension-internal. Consumed by the extension, tools, and playground.
It deliberately is **not** an export of `@nulo/wallet-bridge`: wallet-bridge is
extension-internal, and exposing it to the dApp-facing apps would leak its
dispatcher/protocol surface to third-party dApps. A dedicated private package
keeps the patch Nulo-internal while giving all three apps one source. (It
replaced three byte-identical inline copies — the drift risk is gone now.)

## Exports

| Subpath | Kind | Use |
|---|---|---|
| `./register` | side-effect | `import "@nulo/wallet-sdk-schema-patch/register"` as the **first** import in an app entry module. Mutates the `WalletSchema` singleton before any wallet-sdk proxy reads it. |
| `./apply` | helper | `applyNuloSchemaPatch(schema)` — the pure patch body, mutates the passed object in place. Unit-testable without the global singleton. |

There is **no root barrel** — import the specific subpath.

## Why the import must be first

Static imports evaluate before the importing module's body. `./register` runs
`applyNuloSchemaPatch(WalletSchema)` at module-eval, so importing it first in an
entry module guarantees the patch lands before any `@aztec/wallet-sdk` code
constructs a wallet proxy. Do **not** convert a call site to
"import the helper, call it in the body" — that would run after wallet-sdk
modules evaluate.

## Signature-drift guard

If a future `@aztec/wallet-sdk` ships its own `registerToken` (etc.) with a
different signature, `applyNuloSchemaPatch` throws rather than silently no-op.
The guard checks arg types + output type, not just arity. Pinned upstream:
`@aztec/wallet-sdk == 5.0.0-rc.2`.

## Testing

`src/apply.test.ts` drives `applyNuloSchemaPatch` against mock schema objects
(adds-all-three, per-method drift throws, shape-compatible no-op). It runs under
the extension's vitest via that config's include globs. The end-to-end
reachability (the patch actually extends the real `WalletSchema` and the
dispatcher routes the methods) is pinned in
`packages/wallet-bridge/src/dispatcher.test.ts`.
