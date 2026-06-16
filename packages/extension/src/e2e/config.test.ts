import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

/**
 * Pins the LOAD-BEARING proverless guard (layer 1, see config.ts): proverless
 * must be OFF by default and arm ONLY when BOTH double-opt-in flags are set;
 * exactly one flag must fail CLOSED by throwing at module evaluation. A
 * regression here risks shipping a wallet that broadcasts UNPROVEN transactions
 * — the production catastrophe the guard exists to prevent.
 *
 * The guard runs at module-evaluation time (top-level `if (...) throw`), so each
 * case stubs `import.meta.env` then re-imports a fresh module instance.
 */
describe("e2e-proverless config (layer-1 fail-closed guard)", () => {
	beforeEach(() => {
		vi.resetModules()
	})
	afterEach(() => {
		vi.unstubAllEnvs()
		vi.resetModules()
	})

	test("default (neither flag) → proverless OFF, no build stamp", async () => {
		vi.stubEnv("VITE_NULO_E2E_PROVERLESS", "")
		vi.stubEnv("VITE_NULO_E2E_PROVERLESS_CONFIRM", "")
		const mod = await import("./config")
		expect(mod.E2E_PROVERLESS).toBe(false)
		expect(mod.E2E_PROVERLESS_BUILD_STAMP).toBeNull()
	})

	test("both flags set → proverless ON, build stamp present", async () => {
		vi.stubEnv("VITE_NULO_E2E_PROVERLESS", "1")
		vi.stubEnv("VITE_NULO_E2E_PROVERLESS_CONFIRM", "1")
		const mod = await import("./config")
		expect(mod.E2E_PROVERLESS).toBe(true)
		expect(mod.E2E_PROVERLESS_BUILD_STAMP).toBe("NULO_E2E_PROVERLESS_BUILD_STAMP")
	})

	test("only the primary flag → throws (fail-closed)", async () => {
		vi.stubEnv("VITE_NULO_E2E_PROVERLESS", "1")
		vi.stubEnv("VITE_NULO_E2E_PROVERLESS_CONFIRM", "")
		await expect(import("./config")).rejects.toThrow(/both are required|double opt-in/i)
	})

	test("only the confirm flag → throws (fail-closed)", async () => {
		vi.stubEnv("VITE_NULO_E2E_PROVERLESS", "")
		vi.stubEnv("VITE_NULO_E2E_PROVERLESS_CONFIRM", "1")
		await expect(import("./config")).rejects.toThrow(/both are required|double opt-in/i)
	})
})
