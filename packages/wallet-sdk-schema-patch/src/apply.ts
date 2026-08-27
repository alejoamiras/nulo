/**
 * Nulo-custom extension of `@aztec/wallet-sdk`'s `WalletSchema` with the
 * `registerToken`, `isTokenRegistered`, and `grantPublicAuthwit` methods.
 *
 * This is the single source of truth — the extension, faucet, and playground all
 * activate it via the sibling `./register` side-effect entry. (It used to be three
 * byte-identical inline copies; the drift risk is gone now that there is one.)
 *
 * ## Why a private package (not a wallet-bridge export)
 *
 * `wallet-bridge` is extension-internal — exposing it to faucet/playground would
 * give third-party dApp surfaces a path to its dispatcher/protocol internals. A
 * dedicated PRIVATE package keeps the patch Nulo-internal while giving all three
 * apps one source.
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
 * we throw rather than silently no-op. The guard checks arg types + output type
 * (not just arity), so a same-arity-but-different-shape upstream method is caught.
 * Pinned upstream version: `@aztec/wallet-sdk == 5.2.0`; revisit on bump.
 */

import { schemas } from "@aztec/stdlib/schemas"
import { z } from "zod"

const PATCHED_SCHEMA = z.function({ input: z.tuple([schemas.AztecAddress, schemas.AztecAddress]), output: z.void() })

const REGISTERED_QUERY_SCHEMA = z.function({ input: z.tuple([schemas.AztecAddress]), output: z.boolean() })

const GRANT_CONTENT_SCHEMA = z.object({
	caller: z.string(),
	contract: z.string(),
	method: z.string(),
	args: z.array(z.unknown()),
})
const GRANT_AUTHWIT_SCHEMA = z.function({ input: z.tuple([schemas.AztecAddress, GRANT_CONTENT_SCHEMA]), output: z.string() })

/**
 * Mutate `schema` (the wallet-sdk `WalletSchema` singleton) in place, adding the
 * three Nulo-custom method entries. Idempotent when the entries already match our
 * shape; throws when an upstream entry of the same name has a different signature.
 */
export function applyNuloSchemaPatch(schema: object): void {
	// biome-ignore lint/suspicious/noExplicitAny: WalletSchema entries are upstream-typed but the per-key shape is internal to @aztec/aztec.js.
	const target = schema as any

	if ("registerToken" in schema) {
		const existing = target.registerToken
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
		target.registerToken = PATCHED_SCHEMA
	}

	if ("isTokenRegistered" in schema) {
		const existing = target.isTokenRegistered
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
		target.isTokenRegistered = REGISTERED_QUERY_SCHEMA
	}

	if ("grantPublicAuthwit" in schema) {
		const existing = target.grantPublicAuthwit
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
		target.grantPublicAuthwit = GRANT_AUTHWIT_SCHEMA
	}
}
