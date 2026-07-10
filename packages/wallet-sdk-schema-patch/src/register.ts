/**
 * Side-effect activation of the Nulo schema patch.
 *
 * Import this FIRST — before any `@aztec/wallet-sdk` code constructs an
 * `ExtensionWallet` proxy — so `WalletSchema` already carries the Nulo-custom
 * methods when the proxy reads it. Static imports evaluate before the importing
 * module's body, so a bare `import "@nulo/wallet-sdk-schema-patch/register"` as
 * the first import in an entry module guarantees that ordering.
 */

import { WalletSchema } from "@aztec/aztec.js/wallet"
import { applyNuloSchemaPatch } from "./apply"

applyNuloSchemaPatch(WalletSchema)
