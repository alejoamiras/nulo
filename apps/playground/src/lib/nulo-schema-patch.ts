/**
 * Runtime extension of `@aztec/wallet-sdk`'s `WalletSchema` with the Nulo-custom
 * `registerToken`, `isTokenRegistered`, and `grantPublicAuthwit` methods.
 *
 * Mirrored verbatim by:
 *   - apps/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts
 *   - apps/faucet/src/lib/nulo-schema-patch.ts
 *
 * See the extension copy's header for the architectural rationale (inline copies
 * instead of a shared module, side-effect activation, signature-drift guard, and
 * the zod v4 `z.function({ input, output })` entry shape read via `schema.def`).
 *
 * Imported once at the top of `lib/wallet.ts` so the patch lands before
 * `WalletManager.configure()` constructs the dApp-side `ExtensionWallet` proxy.
 */

import { WalletSchema } from "@aztec/aztec.js/wallet"
import { schemas } from "@aztec/stdlib/schemas"
import { z } from "zod"

const PATCHED_SCHEMA = z.function({ input: z.tuple([schemas.AztecAddress, schemas.AztecAddress]), output: z.void() })

if ("registerToken" in WalletSchema) {
	// biome-ignore lint/suspicious/noExplicitAny: WalletSchema entries are upstream-typed but the per-key shape is internal to @aztec/aztec.js.
	const existing = (WalletSchema as any).registerToken
	if (existing !== PATCHED_SCHEMA) {
		const items = existing?.def?.input?.def?.items
		if (
			items?.length !== 2 ||
			items[0] !== schemas.AztecAddress ||
			items[1] !== schemas.AztecAddress ||
			existing?.def?.output?.def?.type !== "void"
		) {
			throw new Error(
				`Nulo schema-patch: upstream WalletSchema.registerToken signature changed ` +
					`(expected (AztecAddress, AztecAddress) => void). Update the patch or ` +
					`remove it if upstream now provides registerToken natively.`,
			)
		}
	}
} else {
	// biome-ignore lint/suspicious/noExplicitAny: see above
	;(WalletSchema as any).registerToken = PATCHED_SCHEMA
}

const REGISTERED_QUERY_SCHEMA = z.function({ input: z.tuple([schemas.AztecAddress]), output: z.boolean() })

if ("isTokenRegistered" in WalletSchema) {
	// biome-ignore lint/suspicious/noExplicitAny: see above
	const existing = (WalletSchema as any).isTokenRegistered
	if (existing !== REGISTERED_QUERY_SCHEMA) {
		const items = existing?.def?.input?.def?.items
		if (items?.length !== 1 || items[0] !== schemas.AztecAddress || existing?.def?.output?.def?.type !== "boolean") {
			throw new Error(
				`Nulo schema-patch: upstream WalletSchema.isTokenRegistered signature changed ` +
					`(expected (AztecAddress) => boolean). Update the patch or ` +
					`remove it if upstream now provides isTokenRegistered natively.`,
			)
		}
	}
} else {
	// biome-ignore lint/suspicious/noExplicitAny: see above
	;(WalletSchema as any).isTokenRegistered = REGISTERED_QUERY_SCHEMA
}

const GRANT_CONTENT_SCHEMA = z.object({
	caller: z.string(),
	contract: z.string(),
	method: z.string(),
	args: z.array(z.unknown()),
})
const GRANT_AUTHWIT_SCHEMA = z.function({ input: z.tuple([schemas.AztecAddress, GRANT_CONTENT_SCHEMA]), output: z.string() })

if ("grantPublicAuthwit" in WalletSchema) {
	// biome-ignore lint/suspicious/noExplicitAny: see above
	const existing = (WalletSchema as any).grantPublicAuthwit
	if (existing !== GRANT_AUTHWIT_SCHEMA) {
		const items = existing?.def?.input?.def?.items
		if (
			items?.length !== 2 ||
			items[0] !== schemas.AztecAddress ||
			items[1]?.def?.type !== "object" ||
			existing?.def?.output?.def?.type !== "string"
		) {
			throw new Error(
				`Nulo schema-patch: upstream WalletSchema.grantPublicAuthwit signature changed ` +
					`(expected (AztecAddress, content) => string). Update the patch or ` +
					`remove it if upstream now provides grantPublicAuthwit natively.`,
			)
		}
	}
} else {
	// biome-ignore lint/suspicious/noExplicitAny: see above
	;(WalletSchema as any).grantPublicAuthwit = GRANT_AUTHWIT_SCHEMA
}
