/**
 * Nulo-custom extension of `@aztec/wallet-sdk`'s `WalletSchema` with the
 * `registerToken`, `isTokenRegistered`, and `grantPublicAuthwit` methods.
 *
 * This is the single source of truth — the extension, tools, and playground all
 * activate it via the sibling `./register` side-effect entry. (It used to be three
 * byte-identical inline copies; the drift risk is gone now that there is one.)
 *
 * ## Why a private package (not a wallet-bridge export)
 *
 * `wallet-bridge` is extension-internal — exposing it to tools/playground would
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
	patchOrVerifyEntry(schema, "registerToken", PATCHED_SCHEMA, isRegisterTokenShape, "(AztecAddress, AztecAddress) => void")
	patchOrVerifyEntry(schema, "isTokenRegistered", REGISTERED_QUERY_SCHEMA, isTokenRegisteredShape, "(AztecAddress) => boolean")
	patchOrVerifyEntry(schema, "grantPublicAuthwit", GRANT_AUTHWIT_SCHEMA, isGrantAuthwitShape, "(AztecAddress, content) => string")
}

// biome-ignore lint/suspicious/noExplicitAny: WalletSchema entries are upstream-typed but the per-key shape is internal to @aztec/aztec.js.
type SchemaEntry = any

/** Install `patched` under `key` when absent; when present and not ours, accept
 *  it only if `isCompatibleShape` holds — otherwise throw the signature-drift
 *  error. The existing entry is left in place by identity either way. */
function patchOrVerifyEntry(
	schema: object,
	key: "registerToken" | "isTokenRegistered" | "grantPublicAuthwit",
	patched: SchemaEntry,
	isCompatibleShape: (existing: SchemaEntry) => boolean,
	expectedSignature: string,
): void {
	const target = schema as Record<string, SchemaEntry>
	if (!(key in schema)) {
		target[key] = patched
		return
	}
	const existing = target[key]
	if (existing !== patched && !isCompatibleShape(existing)) {
		throw new Error(
			`Nulo schema-patch: upstream WalletSchema.${key} signature changed ` +
				`(expected ${expectedSignature}). Update the patch or ` +
				`remove it if upstream now provides ${key} natively.`,
		)
	}
}

function isRegisterTokenShape(existing: SchemaEntry): boolean {
	const items = existing?.def?.input?.def?.items
	return (
		items?.length === 2 &&
		items[0] === schemas.AztecAddress &&
		items[1] === schemas.AztecAddress &&
		existing?.def?.output?.def?.type === "void"
	)
}

function isTokenRegisteredShape(existing: SchemaEntry): boolean {
	const items = existing?.def?.input?.def?.items
	return items?.length === 1 && items[0] === schemas.AztecAddress && existing?.def?.output?.def?.type === "boolean"
}

function isGrantAuthwitShape(existing: SchemaEntry): boolean {
	const items = existing?.def?.input?.def?.items
	return (
		items?.length === 2 &&
		items[0] === schemas.AztecAddress &&
		items[1]?.def?.type === "object" &&
		existing?.def?.output?.def?.type === "string"
	)
}
