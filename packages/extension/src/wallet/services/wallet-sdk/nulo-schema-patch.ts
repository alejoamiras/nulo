/**
 * Runtime extension of `@aztec/wallet-sdk`'s `WalletSchema` with the Nulo-custom
 * `registerToken`, `isTokenRegistered`, and `grantPublicAuthwit` methods.
 *
 * Mirrored verbatim by:
 *   - packages/faucet/src/lib/nulo-schema-patch.ts
 *   - packages/playground/src/lib/nulo-schema-patch.ts
 *
 * ## Why three inline copies (not a shared @nulo/wallet-bridge export)
 *
 * `wallet-bridge` is extension-internal — it depends on `wallet-core` and
 * `extension-messaging`, both of which would acquire third-party dApp consumers
 * if we exposed wallet-bridge to faucet/playground. The drift surface here is
 * one Zod entry; cheaper to keep three identical copies than to widen
 * wallet-bridge's public contract. Drift is pinned by the reachability test
 * in `packages/wallet-bridge/src/dispatcher.test.ts`.
 *
 * ## Why side-effect only
 *
 * `WalletSchema` is read by `@aztec/wallet-sdk`'s `ExtensionWallet` Proxy when
 * the dApp calls `wallet.<method>`. Mutating it before any such call (i.e.
 * importing this file before any wallet-sdk code constructs a wallet) makes
 * the patched method routable.
 *
 * ## zod v4 entry shape (5.0)
 *
 * Upstream emits `WalletSchema` entries as `z.function({ input: z.tuple([...]),
 * output })` (plain `ZodFunction`); the proxy routes via `schema.def.input` /
 * `schema.def.output` (no `.parameters()`/`.returnType()` anymore). The patch
 * mirrors that exact shape so our custom methods route identically.
 *
 * ## Signature-drift guard
 *
 * If a future upstream `@aztec/wallet-sdk` ships its own `registerToken` (etc.),
 * we throw at SW init rather than silently no-op. The guard checks arg types +
 * output type (not just arity), so a same-arity-but-different-shape upstream
 * method is caught. Pinned upstream version: `@aztec/wallet-sdk == 5.0.0-rc.1`;
 * revisit on bump.
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
