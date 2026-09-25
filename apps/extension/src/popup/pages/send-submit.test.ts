import { JobCancelledError, TermsAcceptanceRequiredError } from "@nulo/extension-messaging/errors"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { TRANSFER_FAILED_COPY, TRANSFER_TERMS_COPY } from "@/popup/utils/transfer-failure-copy"
import { type SubmitDeps, submitTransfer, type TransferSnapshot } from "./send-submit"

const SNAP: TransferSnapshot = {
	networkId: "n1",
	accountAddress: "0xacct",
	tokenId: 7,
	transferType: 0,
	destination: "0xdest",
	amount: 1_500_000n,
	feeSettings: { paymentMethod: { kind: "fj" } },
	precomputedEstimateId: "est-1",
	contract: "0xtoken",
}

function harness() {
	let settle: { resolve: () => void; reject: (err: unknown) => void } = { resolve: () => {}, reject: () => {} }
	const deps: SubmitDeps = {
		executeTransfer: vi.fn(
			() =>
				new Promise<void>((resolve, reject) => {
					settle = { resolve, reject }
				}),
		),
		awaiting: { add: vi.fn(), remove: vi.fn() },
		openToast: vi.fn(),
		onSettled: vi.fn(),
	}
	return { deps, settle: () => settle }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe("send-submit", () => {
	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(console, "debug").mockImplementation(() => {})
	})
	afterEach(() => vi.restoreAllMocks())

	test("posts the awaiting row under a fresh id and fires the transfer with the snapshot, in order", () => {
		const { deps } = harness()
		const id = submitTransfer(deps, SNAP)
		expect(deps.awaiting.add).toHaveBeenCalledWith({ id, account: "0xacct", destination: "0xdest", contract: "0xtoken" })
		expect(deps.executeTransfer).toHaveBeenCalledWith("n1", "0xacct", 7, 0, "0xdest", 1_500_000n, SNAP.feeSettings, "est-1")
		expect(submitTransfer(deps, SNAP)).not.toBe(id)
	})

	test("resolved: the success toast, the row kept, then settled", async () => {
		const { deps, settle } = harness()
		submitTransfer(deps, SNAP)
		expect(deps.onSettled).not.toHaveBeenCalled()
		settle().resolve()
		await flush()
		expect(deps.openToast).toHaveBeenCalledWith({ kind: "success", label: "Transaction submitted" })
		expect(deps.awaiting.remove).not.toHaveBeenCalled()
		expect(deps.onSettled).toHaveBeenCalledTimes(1)
	})

	test("rejected: this row removed, a red toast, logged as an error, then settled", async () => {
		const { deps, settle } = harness()
		const id = submitTransfer(deps, SNAP)
		settle().reject(new Error("boom"))
		await flush()
		expect(deps.awaiting.remove).toHaveBeenCalledWith(id)
		expect(deps.openToast).toHaveBeenCalledWith({ kind: "error", label: TRANSFER_FAILED_COPY })
		expect(console.error).toHaveBeenCalledWith("[send] executeTransfer failed:", expect.any(Error))
		expect(deps.onSettled).toHaveBeenCalledTimes(1)
	})

	test("refused by the terms wall: the terms copy, logged at debug only", async () => {
		const { deps, settle } = harness()
		submitTransfer(deps, SNAP)
		settle().reject(new TermsAcceptanceRequiredError())
		await flush()
		expect(deps.openToast).toHaveBeenCalledWith({ kind: "error", label: TRANSFER_TERMS_COPY })
		expect(console.debug).toHaveBeenCalledWith("[send] executeTransfer refused:", expect.any(TermsAcceptanceRequiredError))
		expect(console.error).not.toHaveBeenCalled()
	})

	test("cancelled by the user: the row removed, no toast, still settled", async () => {
		const { deps, settle } = harness()
		const id = submitTransfer(deps, SNAP)
		settle().reject(new JobCancelledError())
		await flush()
		expect(deps.awaiting.remove).toHaveBeenCalledWith(id)
		expect(deps.openToast).not.toHaveBeenCalled()
		expect(deps.onSettled).toHaveBeenCalledTimes(1)
	})
})
