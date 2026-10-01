import { describe, expect, test } from "vitest"
import { ScopeViolationError } from "@nulo/extension-messaging/errors"
import type { MethodName } from "./method-descriptors"
import { scopeViolation } from "./scope-violation"

describe("scopeViolation", () => {
	test("builds the typed refusal from a message made of wallet-owned words", () => {
		const method: MethodName = "sendTx"
		const refusal = scopeViolation(`Scope violation: ${method} call not permitted by granted transaction scope`)
		expect(refusal).toBeInstanceOf(ScopeViolationError)
		expect(refusal.message).toBe("Scope violation: sendTx call not permitted by granted transaction scope")
	})

	test("a message carrying a request value does not type-check", () => {
		const refusalNaming = (address: string) =>
			// @ts-expect-error `typecheck:all` fails here the day the message type admits a free string.
			scopeViolation(`Scope violation: sendTx contract ${address} not permitted by granted contracts scope`)
		expect(refusalNaming("0x01")).toBeInstanceOf(ScopeViolationError)
	})
})
