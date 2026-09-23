/**
 * Pre-extraction pins (codex condition, round-2 plan 5): applying the patch
 * twice is a no-op (the second pass finds our own entries and leaves them by
 * identity), and each signature-drift guard throws its FULL frozen message —
 * the three blocks are about to fold into one helper, and the messages are the
 * operator-facing contract.
 */
import { schemas } from "@aztec/stdlib/schemas"
import { z } from "zod"
import { describe, expect, test } from "vitest"
import { applyNuloSchemaPatch } from "./apply"

// biome-ignore lint/suspicious/noExplicitAny: per-key WalletSchema entry shape is opaque
const entry = (schema: Record<string, unknown>, key: string) => (schema as any)[key]

describe("applyNuloSchemaPatch pins", () => {
	test("idempotent: a second application keeps the SAME four entries by identity", () => {
		const schema: Record<string, unknown> = {}
		applyNuloSchemaPatch(schema)
		const KEYS = ["registerToken", "isTokenRegistered", "grantPublicAuthwit", "getWalletFeatures"]
		const first = KEYS.map((k) => entry(schema, k))
		expect(() => applyNuloSchemaPatch(schema)).not.toThrow()
		const second = KEYS.map((k) => entry(schema, k))
		for (const i of [0, 1, 2, 3]) expect(second[i]).toBe(first[i])
		expect(Object.keys(schema).sort()).toEqual(["getWalletFeatures", "grantPublicAuthwit", "isTokenRegistered", "registerToken"])
	})

	test("registerToken drift message, full text", () => {
		const schema = { registerToken: z.function({ input: z.tuple([schemas.AztecAddress]), output: z.void() }) }
		expect(() => applyNuloSchemaPatch(schema)).toThrow(
			"Nulo schema-patch: upstream WalletSchema.registerToken signature changed (expected (AztecAddress, AztecAddress) => void). Update the patch or remove it if upstream now provides registerToken natively.",
		)
	})

	test("isTokenRegistered drift message, full text", () => {
		const schema = { isTokenRegistered: z.function({ input: z.tuple([schemas.AztecAddress]), output: z.void() }) }
		expect(() => applyNuloSchemaPatch(schema)).toThrow(
			"Nulo schema-patch: upstream WalletSchema.isTokenRegistered signature changed (expected (AztecAddress) => boolean). Update the patch or remove it if upstream now provides isTokenRegistered natively.",
		)
	})

	test("grantPublicAuthwit drift message, full text", () => {
		const schema = {
			grantPublicAuthwit: z.function({ input: z.tuple([schemas.AztecAddress, schemas.AztecAddress]), output: z.string() }),
		}
		expect(() => applyNuloSchemaPatch(schema)).toThrow(
			"Nulo schema-patch: upstream WalletSchema.grantPublicAuthwit signature changed (expected (AztecAddress, content) => string). Update the patch or remove it if upstream now provides grantPublicAuthwit natively.",
		)
	})

	test("a shape-compatible upstream entry for EACH method is kept by identity", () => {
		const registerToken = z.function({ input: z.tuple([schemas.AztecAddress, schemas.AztecAddress]), output: z.void() })
		const isTokenRegistered = z.function({ input: z.tuple([schemas.AztecAddress]), output: z.boolean() })
		const grantPublicAuthwit = z.function({
			input: z.tuple([schemas.AztecAddress, z.object({ caller: z.string() })]),
			output: z.string(),
		})
		const getWalletFeatures = z.function({ input: z.tuple([]), output: z.array(z.string()) })
		const schema = { registerToken, isTokenRegistered, grantPublicAuthwit, getWalletFeatures }
		expect(() => applyNuloSchemaPatch(schema)).not.toThrow()
		expect(entry(schema, "registerToken")).toBe(registerToken)
		expect(entry(schema, "isTokenRegistered")).toBe(isTokenRegistered)
		expect(entry(schema, "grantPublicAuthwit")).toBe(grantPublicAuthwit)
		expect(entry(schema, "getWalletFeatures")).toBe(getWalletFeatures)
	})
})
