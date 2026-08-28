import { UnsupportedMethodError } from "@nulo/extension-messaging/errors"
import { describe, expect, test } from "vitest"
import { METHOD_REGISTRY, assertKnownMethod } from "./method-descriptors"

/**
 * The typed dispatch-entry choke point. `assertKnownMethod` is the
 * single fail-closed guard the dispatcher routes through: it narrows the wire
 * `methodName: string` to `MethodName` (the literal key union of METHOD_REGISTRY)
 * or throws. Lives in its OWN file — NOT `method-descriptors.test.ts` (the frozen
 * authz oracle, which stays byte-UNEDITED).
 */
describe("assertKnownMethod — typed dispatch-entry choke point", () => {
	test("passes (narrows) for every registered method", () => {
		for (const name of Object.keys(METHOD_REGISTRY)) {
			expect(() => assertKnownMethod(name)).not.toThrow()
		}
	})

	test("throws the TYPED error, so the dApp-facing envelope can classify it", () => {
		// A bare `Error` here reaches `toWalletResponseError`'s unclassified fall-through and is
		// replaced by a constant — which left dApps unable to distinguish an unsupported method
		// from a wallet fault, and reds the `batch-partial-failure` network e2e.
		expect(() => assertKnownMethod("aztec_notARealMethod")).toThrow(UnsupportedMethodError)
	})

	test("throws the frozen 'Unsupported wallet method' string for an unknown method", () => {
		expect(() => assertKnownMethod("aztec_notARealMethod")).toThrow(/Unsupported wallet method/)
	})

	test("rejects prototype names via Object.hasOwn (not a truthy index)", () => {
		for (const proto of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
			expect(() => assertKnownMethod(proto)).toThrow(/Unsupported wallet method/)
		}
	})

	test("fail-closed: an empty method name throws", () => {
		expect(() => assertKnownMethod("")).toThrow(/Unsupported wallet method/)
	})
})
