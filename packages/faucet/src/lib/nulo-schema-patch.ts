/**
 * Runtime extension of `@aztec/wallet-sdk`'s `WalletSchema` with the Nulo-custom
 * `registerToken` method.
 *
 * Mirrored verbatim by:
 *   - packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts
 *   - packages/playground/src/lib/nulo-schema-patch.ts
 *
 * See the extension copy's header for the architectural rationale (inline copies
 * instead of a shared module, side-effect activation, signature-drift guard).
 *
 * Imported once via top-of-file side-effect in `useWalletConnection.ts` so the
 * patch lands before `WalletManager.configure()` constructs the dApp-side
 * `ExtensionWallet` proxy.
 */

import { WalletSchema } from "@aztec/aztec.js/wallet"
import { schemas } from "@aztec/stdlib/schemas"
import { z } from "zod"

const PATCHED_SCHEMA = z.function().args(schemas.AztecAddress, schemas.AztecAddress).returns(z.void())

if ("registerToken" in WalletSchema) {
	// biome-ignore lint/suspicious/noExplicitAny: WalletSchema entries are upstream-typed but the per-key shape is internal to @aztec/aztec.js.
	const existing = (WalletSchema as any).registerToken
	if (existing !== PATCHED_SCHEMA) {
		const existingParamCount = existing?.parameters?.()?.items?.length
		if (existingParamCount !== 2) {
			throw new Error(
				`Nulo schema-patch: upstream WalletSchema.registerToken signature changed ` +
					`(expected 2 params, found ${existingParamCount}). Update the patch or ` +
					`remove it if upstream now provides registerToken natively.`,
			)
		}
	}
} else {
	// biome-ignore lint/suspicious/noExplicitAny: see above
	;(WalletSchema as any).registerToken = PATCHED_SCHEMA
}
