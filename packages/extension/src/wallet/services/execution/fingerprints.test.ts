/**
 * Unit tests for the reuse-cache fingerprint helpers.
 *
 * `fingerprintFeeSettings` was previously
 * `JSON.stringify(fs, Object.keys(fs).sort())` — that uses the second
 * arg as a recursive key allowlist, stripping nested `paymentMethod`
 * fields so `{kind: "fj"}` collided with `{kind: "fpc", fpcId}`.
 * Tests target the regression: distinct payment-method variants must
 * produce distinct fingerprints, equal variants must collide.
 */

import { describe, expect, test } from "vitest"
import type { FeeSettings } from "./spec"
import { fingerprintBaseFee, fingerprintFeeSettings } from "./service"

describe("fingerprintFeeSettings", () => {
	test("distinguishes fj from fpc with same priorityLevel", () => {
		const fj: FeeSettings = { paymentMethod: { kind: "fj" }, priorityLevel: "normal" }
		const fpc: FeeSettings = {
			paymentMethod: { kind: "fpc", fpcId: "abc" },
			priorityLevel: "normal",
		}
		expect(fingerprintFeeSettings(fj)).not.toBe(fingerprintFeeSettings(fpc))
	})

	test("distinguishes fpc by fpcId", () => {
		const a: FeeSettings = { paymentMethod: { kind: "fpc", fpcId: "abc" } }
		const b: FeeSettings = { paymentMethod: { kind: "fpc", fpcId: "xyz" } }
		expect(fingerprintFeeSettings(a)).not.toBe(fingerprintFeeSettings(b))
	})

	test("distinguishes priorityLevel variants for same payment method", () => {
		const normal: FeeSettings = { paymentMethod: { kind: "fj" }, priorityLevel: "normal" }
		const fast: FeeSettings = { paymentMethod: { kind: "fj" }, priorityLevel: "fast" }
		const urgent: FeeSettings = { paymentMethod: { kind: "fj" }, priorityLevel: "urgent" }
		const fps = [fingerprintFeeSettings(normal), fingerprintFeeSettings(fast), fingerprintFeeSettings(urgent)]
		expect(new Set(fps).size).toBe(3)
	})

	test("distinguishes default (no priorityLevel) from explicit normal", () => {
		const noPriority: FeeSettings = { paymentMethod: { kind: "fj" } }
		const normal: FeeSettings = { paymentMethod: { kind: "fj" }, priorityLevel: "normal" }
		expect(fingerprintFeeSettings(noPriority)).not.toBe(fingerprintFeeSettings(normal))
	})

	test("distinguishes fjwc claim fields", () => {
		const a: FeeSettings = {
			paymentMethod: { kind: "fjwc", claimAmount: "100", claimSecret: "secretA", messageLeafIndex: "0" },
		}
		const b: FeeSettings = {
			paymentMethod: { kind: "fjwc", claimAmount: "100", claimSecret: "secretB", messageLeafIndex: "0" },
		}
		const c: FeeSettings = {
			paymentMethod: { kind: "fjwc", claimAmount: "200", claimSecret: "secretA", messageLeafIndex: "0" },
		}
		const d: FeeSettings = {
			paymentMethod: { kind: "fjwc", claimAmount: "100", claimSecret: "secretA", messageLeafIndex: "1" },
		}
		const fps = [fingerprintFeeSettings(a), fingerprintFeeSettings(b), fingerprintFeeSettings(c), fingerprintFeeSettings(d)]
		expect(new Set(fps).size).toBe(4)
	})

	test("equal settings collide", () => {
		const a: FeeSettings = {
			paymentMethod: { kind: "fpc", fpcId: "abc" },
			priorityLevel: "fast",
		}
		const b: FeeSettings = {
			paymentMethod: { kind: "fpc", fpcId: "abc" },
			priorityLevel: "fast",
		}
		expect(fingerprintFeeSettings(a)).toBe(fingerprintFeeSettings(b))
	})
})

describe("fingerprintBaseFee", () => {
	test("produces stable string for the same fees", () => {
		const a = fingerprintBaseFee({ feePerDaGas: 100n, feePerL2Gas: 200n })
		const b = fingerprintBaseFee({ feePerDaGas: 100n, feePerL2Gas: 200n })
		expect(a).toBe(b)
	})

	test("changes when feePerDaGas changes", () => {
		const a = fingerprintBaseFee({ feePerDaGas: 100n, feePerL2Gas: 200n })
		const b = fingerprintBaseFee({ feePerDaGas: 101n, feePerL2Gas: 200n })
		expect(a).not.toBe(b)
	})

	test("changes when feePerL2Gas changes", () => {
		const a = fingerprintBaseFee({ feePerDaGas: 100n, feePerL2Gas: 200n })
		const b = fingerprintBaseFee({ feePerDaGas: 100n, feePerL2Gas: 201n })
		expect(a).not.toBe(b)
	})
})
