import { schemas } from "@aztec/stdlib/schemas"
import { z } from "zod"
import { describe, expect, test } from "vitest"
import { applyNuloSchemaPatch } from "./apply"

// biome-ignore lint/suspicious/noExplicitAny: per-key WalletSchema entry shape is opaque; the tests inspect it the way the proxy does.
const entry = (schema: Record<string, unknown>, key: string) => (schema as any)[key]

describe("applyNuloSchemaPatch", () => {
	test("adds the four Nulo-custom methods with the expected input arity + output type", () => {
		const schema: Record<string, unknown> = {}
		applyNuloSchemaPatch(schema)

		const registerToken = entry(schema, "registerToken")
		expect(registerToken?.def?.input?.def?.items?.length).toBe(2)
		expect(registerToken?.def?.output?.def?.type).toBe("void")

		const isTokenRegistered = entry(schema, "isTokenRegistered")
		expect(isTokenRegistered?.def?.input?.def?.items?.length).toBe(1)
		expect(isTokenRegistered?.def?.output?.def?.type).toBe("boolean")

		const grantPublicAuthwit = entry(schema, "grantPublicAuthwit")
		expect(grantPublicAuthwit?.def?.input?.def?.items?.length).toBe(2)
		expect(grantPublicAuthwit?.def?.output?.def?.type).toBe("string")

		const getWalletFeatures = entry(schema, "getWalletFeatures")
		expect(getWalletFeatures?.def?.input?.def?.items?.length).toBe(0)
		expect(getWalletFeatures?.def?.output?.def?.type).toBe("array")
		expect(getWalletFeatures?.def?.output?.def?.element?.def?.type).toBe("string")
	})

	test("throws when upstream already defines getWalletFeatures with a different signature", () => {
		const schema: Record<string, unknown> = {
			getWalletFeatures: z.function({ input: z.tuple([z.string()]), output: z.array(z.string()) }),
		}
		expect(() => applyNuloSchemaPatch(schema)).toThrow(/getWalletFeatures/)
	})

	test("throws when upstream already defines registerToken with a different signature", () => {
		const schema = { registerToken: z.function({ input: z.tuple([schemas.AztecAddress]), output: z.void() }) }
		expect(() => applyNuloSchemaPatch(schema)).toThrow(/registerToken signature changed/)
	})

	test("throws when upstream already defines isTokenRegistered with a different signature", () => {
		const schema = { isTokenRegistered: z.function({ input: z.tuple([schemas.AztecAddress]), output: z.void() }) }
		expect(() => applyNuloSchemaPatch(schema)).toThrow(/isTokenRegistered signature changed/)
	})

	test("throws when upstream already defines grantPublicAuthwit with a different signature", () => {
		const schema = {
			grantPublicAuthwit: z.function({ input: z.tuple([schemas.AztecAddress, schemas.AztecAddress]), output: z.string() }),
		}
		expect(() => applyNuloSchemaPatch(schema)).toThrow(/grantPublicAuthwit signature changed/)
	})

	test("leaves a shape-compatible existing entry in place without throwing", () => {
		const compatible = z.function({ input: z.tuple([schemas.AztecAddress, schemas.AztecAddress]), output: z.void() })
		const schema = { registerToken: compatible }
		expect(() => applyNuloSchemaPatch(schema)).not.toThrow()
		expect(entry(schema, "registerToken")).toBe(compatible)
	})
})
