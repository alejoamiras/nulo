import { describe, expect, test } from "vitest"
import { OperationNotRecordedError, TermsAcceptanceRequiredError, walletErrorFromPayload } from "@nulo/extension-messaging/errors"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import { transferFailureLogLevel, transferFailureSnack } from "./transfer-failure-copy"

const MAYBE_SENT: OperationRecord["progress"] = {
	stage: "failed",
	from: "submitting",
	txHash: `0x${"f".repeat(64)}`,
	submittedEndpointUrl: "https://rpc.example",
}

function failed(progress: OperationRecord["progress"]): OperationRecord {
	return {
		id: "0123456789abcdef",
		kind: "transfer",
		origin: "popup",
		profileId: "p1",
		progress,
		error: { kind: "transfer", message: "boom", normalizedRaw: null },
		terminalAt: 2,
		attempts: 0,
		createdAt: 1,
		updatedAt: 2,
		accountAddress: "0xacct",
		networkId: "n1",
	}
}

describe("transferFailureSnack", () => {
	test("a refusal that crossed the RPC boundary reads as not started, in the owner-approved words", () => {
		const overTheWire = walletErrorFromPayload(new OperationNotRecordedError().toPayload())
		expect(transferFailureSnack(overTheWire, undefined)).toMatchObject({
			label: "Send failed",
			sub: "Couldn't start this transaction. Nothing was sent. Try again.",
		})
	})

	test("a Terms refusal says what the Send banner says whatever its record holds, and is not an error-level event", () => {
		const overTheWire = walletErrorFromPayload(new TermsAcceptanceRequiredError().toPayload())
		expect(transferFailureSnack(overTheWire, failed(MAYBE_SENT))).toEqual({
			label: "Send failed",
			sub: "Accept the Terms to send",
			details: true,
		})
		expect(transferFailureLogLevel(overTheWire)).toBe("debug")
		expect(transferFailureLogLevel(new Error("estimate blew up"))).toBe("error")
	})

	test.each([
		[
			"a send that may have reached the node",
			failed(MAYBE_SENT),
			"Send not confirmed",
			"Checking whether it reached the network. Don't send it again yet.",
			true,
		],
		[
			"a send that failed before broadcast",
			failed({ stage: "failed", from: "simulating" }),
			"Send failed",
			"Nothing was sent. You can try again.",
			true,
		],
		[
			"a record with no recorded stage",
			failed({ stage: "failed" }),
			"Send status unknown",
			"Check History before sending it again.",
			false,
		],
		["no record", undefined, "Send status unknown", "Check History before sending it again.", false],
	])("any other failure reads from its record: %s", (_name, record, label, sub, details) => {
		expect(transferFailureSnack(new Error("boom"), record)).toEqual({ label, sub, details })
	})
})
