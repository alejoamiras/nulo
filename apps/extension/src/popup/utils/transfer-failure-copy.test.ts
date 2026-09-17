import { describe, expect, test } from "vitest"
import { OperationNotRecordedError, SessionEndedError, walletErrorFromPayload } from "@nulo/extension-messaging/errors"
import { transferFailureCopy } from "./transfer-failure-copy"

describe("transferFailureCopy", () => {
	test("a refusal that crossed the RPC boundary reads as not started, in the owner-approved words", () => {
		const overTheWire = walletErrorFromPayload(new OperationNotRecordedError().toPayload())
		expect(transferFailureCopy(overTheWire)).toBe("Couldn't start this transaction. Nothing was sent — try again.")
	})

	test("every other failure keeps the generic toast", () => {
		for (const err of [new Error("estimate blew up"), new SessionEndedError(), "boom", undefined]) {
			expect(transferFailureCopy(err)).toBe("Simulation failed, transaction not sent")
		}
	})
})
