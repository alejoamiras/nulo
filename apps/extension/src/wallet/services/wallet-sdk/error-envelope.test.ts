import { describe, expect, test } from "vitest"
import {
	AccountAddressInconsistencyError,
	CapabilityNotGrantedError,
	JobCancelledError,
	RpcDisconnectedError,
	RpcTimeoutError,
	TooManyPendingError,
	UserRejectedError,
} from "@nulo/extension-messaging/errors"
import { DuplicateInitializationError, UnsupportedMethodError } from "@nulo/extension-messaging/errors"
import { unwrapOperationResult } from "@nulo/wallet-bridge"
import { classifyOperationCatch } from "@/wallet/services/execution/rpc-cancel"
import { toWalletResponseError, UNCLASSIFIED_ERROR_MESSAGE } from "./error-envelope"

describe("toWalletResponseError", () => {
	test("JobCancelledError → {code:4001, walletErrorCode, jobId} (regression for existing behavior)", () => {
		const env = toWalletResponseError(new JobCancelledError("Cancelled", { jobId: "j-1" }))
		expect(env).toEqual({
			code: 4001,
			message: "Cancelled",
			data: { walletErrorCode: JobCancelledError.CODE, jobId: "j-1" },
		})
	})

	test("UserRejectedError → {code:4001, walletErrorCode USER_REJECTED} (popup Reject, distinct from JOB_CANCELLED)", () => {
		const env = toWalletResponseError(new UserRejectedError("User rejected"))
		expect(env).toEqual({
			code: 4001,
			message: "User rejected",
			data: { walletErrorCode: UserRejectedError.CODE },
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

	test("RpcDisconnectedError → {code:-32603, walletErrorCode} (transient; NOT 4900) with a leak-free message", () => {
		const env = toWalletResponseError(
			new RpcDisconnectedError("Offscreen send failed: simulateTx", { requestId: 8, methodName: "simulateTx" }),
		)
		expect(env).toEqual({
			code: -32603,
			message: "The wallet was disconnected while processing the request.",
			data: { walletErrorCode: "RPC_DISCONNECTED" },
		})
		expect(JSON.stringify(env)).not.toContain("simulateTx")
	})

	test("AccountAddressInconsistencyError → fully generic failure: no detail, no discriminator", () => {
		const env = toWalletResponseError(new AccountAddressInconsistencyError(undefined, { profileId: "p1", chainId: 0 }))
		expect(env).toEqual({ code: -32603, message: "The wallet could not process the request." })
		const wire = JSON.stringify(env)
		expect(wire).not.toContain("inconsistency")
		expect(wire).not.toContain("ACCOUNT_ADDRESS")
		expect(wire).not.toContain("p1")
	})

	test("plain Error → constant string (preserves the string wire contract, not the content)", () => {
		// The SHAPE contract — a plain string for unrecognised throws — is what dApps depend on;
		// the CONTENT was internal text crossing into an untrusted caller.
		const env = toWalletResponseError(new Error("boom"))
		expect(typeof env).toBe("string")
		expect(env).toBe(UNCLASSIFIED_ERROR_MESSAGE)
	})

	test("non-Error throw → the same constant", () => {
		expect(toWalletResponseError("nope")).toBe(UNCLASSIFIED_ERROR_MESSAGE)
		expect(toWalletResponseError(42)).toBe(UNCLASSIFIED_ERROR_MESSAGE)
	})

	test("UnsupportedMethodError → {code:-32601, walletErrorCode} keeping the method name", () => {
		// A dApp's whole response is to fall back to another route, so it must be able to tell this
		// from a wallet fault. Flattening it into the constant is what broke `batch-partial-failure`.
		const env = toWalletResponseError(UnsupportedMethodError.forMethod("thisMethodDoesNotExist"))
		expect(env).toMatchObject({
			code: -32601,
			data: { walletErrorCode: UnsupportedMethodError.CODE },
		})
		expect((env as { message: string }).message).toMatch(/Unsupported wallet method.*thisMethodDoesNotExist/i)
	})

	test("the echoed method name is bounded — it arrives off the wire", () => {
		const env = toWalletResponseError(UnsupportedMethodError.forMethod("X".repeat(5000)))
		const message = (env as { message: string }).message
		expect(message.length).toBeLessThan(120)
		expect(message).toContain("…")
	})
})

describe("duplicate-initialization envelope reachability (N-15)", () => {
	test("the typed error survives the REAL production chain: classify → unwrap → envelope", async () => {
		// The executor's catch flattens results to data; without the `code`
		// ride-along + unwrap re-materialization, the envelope's typed branch
		// is dead code (the max review proved the pre-fix chain delivers a
		// bare string). This composes the three real functions end-to-end.
		const task = { cancel: () => {}, fail: () => {} }
		const result = classifyOperationCatch(new DuplicateInitializationError(), task, (e) => (e instanceof Error ? e.message : String(e)))
		expect(result.status).toBe("failed")
		const thrown = (() => {
			try {
				unwrapOperationResult(result as never)
				return undefined
			} catch (e) {
				return e
			}
		})()
		expect(thrown).toBeInstanceOf(DuplicateInitializationError)
		const envelope = toWalletResponseError(thrown)
		expect(envelope).toMatchObject({
			code: -32603,
			data: { walletErrorCode: "DUPLICATE_INITIALIZATION" },
		})
		expect((envelope as { message: string }).message).toMatch(/wait for network sync, then retry/)
	})

	test("an untyped failure still flattens to the string fall-through (no code, no envelope object)", () => {
		const task = { cancel: () => {}, fail: () => {} }
		const result = classifyOperationCatch(new Error("plain boom"), task, (e) => (e instanceof Error ? e.message : String(e)))
		const thrown = (() => {
			try {
				unwrapOperationResult(result as never)
				return undefined
			} catch (e) {
				return e
			}
		})()
		expect(thrown).not.toBeInstanceOf(DuplicateInitializationError)
		expect(toWalletResponseError(thrown)).toBe(UNCLASSIFIED_ERROR_MESSAGE)
	})

	/**
	 * This value is handed to an ARBITRARY dApp — the only path here that leaves the machine.
	 *
	 * Scrubbing and capping were tried first and rejected: a cap bounds exposure without
	 * sanitizing it, so `new Error("private note: <secret>")` still crossed verbatim. Anything a
	 * dApp is meant to act on is classified above with a `walletErrorCode`, so an unclassified
	 * error's text has no defined meaning to the caller.
	 */
	describe("fall-through carries no internal state", () => {
		test("an endpoint URL with an API key never reaches the dApp", () => {
			const out = toWalletResponseError(new Error("fetch failed: https://eth.example.com/v2/SECRET-KEY-123?apiKey=abc"))

			expect(out).toBe(UNCLASSIFIED_ERROR_MESSAGE)
			expect(out).not.toContain("SECRET-KEY-123")
			expect(out).not.toContain("eth.example.com")
		})

		test("a secret in the message body never reaches the dApp — a cap would not have stopped this", () => {
			const out = toWalletResponseError(new Error("private note: correct-horse-battery-staple"))

			expect(out).toBe(UNCLASSIFIED_ERROR_MESSAGE)
			expect(out).not.toContain("correct-horse")
		})

		test("stays a plain string, which is the actual wire contract", () => {
			expect(typeof toWalletResponseError(new Error("x".repeat(10_000)))).toBe("string")
			expect(typeof toWalletResponseError("not an error")).toBe("string")
		})

		test("classified errors are unaffected — they keep their code and message", () => {
			const env = toWalletResponseError(new RpcTimeoutError("Offscreen request timed out: prove"))

			expect(env).toMatchObject({ code: -32603, data: { walletErrorCode: RpcTimeoutError.CODE } })
		})
	})
})
