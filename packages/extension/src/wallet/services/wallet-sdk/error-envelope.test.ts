import { describe, expect, test } from "vitest"
import {
	CapabilityNotGrantedError,
	JobCancelledError,
	RpcDisconnectedError,
	RpcTimeoutError,
	TooManyPendingError,
} from "@nulo/extension-messaging/errors"
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

	test("TooManyPendingError → {code:-32005, walletErrorCode} with no origin/profile detail", () => {
		const env = toWalletResponseError(new TooManyPendingError())
		expect(env).toEqual({
			code: -32005,
			message: "Too many pending transactions; retry after the in-flight ones settle.",
			data: { walletErrorCode: TooManyPendingError.CODE },
		})
		// No oracle: the envelope must not carry a lane/origin/profile field.
		const data = (env as { data: Record<string, unknown> }).data
		expect(Object.keys(data)).toEqual(["walletErrorCode"])
	})

	// D11 dApp-contract: the phase-4 offscreen typed-error flip means a prove/
	// simulate timeout or transport disconnect now reaches the dApp as a typed
	// Rpc* error. These pin the intended, stable response.error — a generic
	// message (NO internal "Offscreen request timed out: <method>" leak) + a
	// discriminable walletErrorCode.
	test("RpcTimeoutError → {code:-32603, walletErrorCode} with a generic, leak-free message", () => {
		const env = toWalletResponseError(
			new RpcTimeoutError("Offscreen request timed out: proveTx", { requestId: 7, methodName: "proveTx" }),
		)
		expect(env).toEqual({
			code: -32603,
			message: "The wallet timed out while processing the request.",
			data: { walletErrorCode: "RPC_TIMEOUT" },
		})
		// No oracle: the internal method name must NOT cross to the dApp.
		expect(JSON.stringify(env)).not.toContain("proveTx")
		expect(JSON.stringify(env)).not.toContain("Offscreen")
	})

	test("RpcDisconnectedError → {code:4900, walletErrorCode} with a generic, leak-free message", () => {
		const env = toWalletResponseError(
			new RpcDisconnectedError("Offscreen send failed: simulateTx", { requestId: 8, methodName: "simulateTx" }),
		)
		expect(env).toEqual({
			code: 4900,
			message: "The wallet was disconnected while processing the request.",
			data: { walletErrorCode: "RPC_DISCONNECTED" },
		})
		expect(JSON.stringify(env)).not.toContain("simulateTx")
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
