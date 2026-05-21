import { describe, expect, test } from "vitest"
import { CapabilityNotGrantedError, JobCancelledError } from "@nulo/extension-messaging/errors"
import { toWalletResponseError } from "./error-envelope"

describe("toWalletResponseError", () => {
	test("JobCancelledError → {code:4001, walletErrorCode, jobId} (regression for existing behavior)", () => {
		const env = toWalletResponseError(new JobCancelledError("Cancelled", { jobId: "j-1" }))
		expect(env).toEqual({
			code: 4001,
			message: "Cancelled",
			data: { walletErrorCode: JobCancelledError.CODE, jobId: "j-1" },
		})
	})

	test("CapabilityNotGrantedError('accounts') → {code:4100, walletErrorCode, capabilityType}", () => {
		const env = toWalletResponseError(new CapabilityNotGrantedError("accounts"))
		expect(env).toEqual({
			code: 4100,
			message: "accounts capability not granted. Call requestCapabilities() first.",
			data: { walletErrorCode: CapabilityNotGrantedError.CODE, capabilityType: "accounts" },
		})
	})

	test("envelope round-trips through new Error(JSON.stringify(env)) — dApp parse recipe works", () => {
		// Load-bearing contract test for the wallet-bridge README recipe. The
		// `@aztec/wallet-sdk` wrapper wraps `response.error` in
		// `new Error(JSON.stringify(error))`, so dApps that want to discriminate
		// need to `JSON.parse(err.message).code`. If this test fails, the
		// documented recipe stops working and downstream dApps break silently.
		const env = toWalletResponseError(new CapabilityNotGrantedError("accounts"))
		const wrapped = new Error(JSON.stringify(env))
		const parsed = JSON.parse(wrapped.message)
		expect(parsed.code).toBe(4100)
		expect(parsed.data.walletErrorCode).toBe("CAPABILITY_NOT_GRANTED")
		expect(parsed.data.capabilityType).toBe("accounts")
	})

	test("plain Error → string fallback (preserves wire contract for unrecognised throws)", () => {
		const env = toWalletResponseError(new Error("boom"))
		expect(env).toBe("boom")
	})

	test("non-Error throw → String() fallback", () => {
		expect(toWalletResponseError("nope")).toBe("nope")
		expect(toWalletResponseError(42)).toBe("42")
	})
})
