import { describe, expect, test } from "vitest"
import {
	OperationNotRecordedError,
	SessionEndedError,
	TermsAcceptanceRequiredError,
	walletErrorFromPayload,
} from "@nulo/extension-messaging/errors"
import { transferFailureCopy, transferFailureLogLevel } from "./transfer-failure-copy"

describe("transferFailureCopy", () => {
	test("a refusal that crossed the RPC boundary reads as not started, in the owner-approved words", () => {
		const overTheWire = walletErrorFromPayload(new OperationNotRecordedError().toPayload())
		expect(transferFailureCopy(overTheWire)).toBe("Couldn't start this transaction. Nothing was sent — try again.")
	})

	test("a Terms refusal that crossed the RPC boundary says what the Send banner says, and is not an error-level event", () => {
		const overTheWire = walletErrorFromPayload(new TermsAcceptanceRequiredError().toPayload())
		expect(transferFailureCopy(overTheWire)).toBe("Accept the Terms to send")
		expect(transferFailureLogLevel(overTheWire)).toBe("debug")
		expect(transferFailureLogLevel(new Error("estimate blew up"))).toBe("error")
	})

	test("every other failure keeps the generic toast", () => {
		for (const err of [new Error("estimate blew up"), new SessionEndedError(), "boom", undefined]) {
			expect(transferFailureCopy(err)).toBe("Simulation failed, transaction not sent")
		}
	})
})
