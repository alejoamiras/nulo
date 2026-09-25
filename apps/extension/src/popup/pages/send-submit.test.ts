import { JobCancelledError, TermsAcceptanceRequiredError } from "@nulo/extension-messaging/errors"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ref } from "vue"
import type { ToastState } from "@/composables/toast"
import { createScopeEpochHandlers } from "@/popup/scope-epoch"
import { TRANSFER_FAILED_COPY, TRANSFER_TERMS_COPY } from "@/popup/utils/transfer-failure-copy"
import { type SubmitDeps, submitTransfer, type TransferSnapshot } from "./send-submit"

const DESTINATION = `0x8c02${"a".repeat(56)}41fa`
const HASH = `0x${"f".repeat(64)}`
const SNAP: TransferSnapshot = {
	networkId: "n1",
	accountAddress: "0xacct",
	tokenId: 7,
	transferType: 0,
	destination: DESTINATION,
	amount: 1_500_000_000_000_000_000n,
	feeSettings: { paymentMethod: { kind: "fj" } },
	precomputedEstimateId: "est-1",
	contract: "0xtoken",
	symbol: "USDC",
	decimals: 18,
	epoch: 0,
}

function harness() {
	let settle = { resolve: (_hash: string) => {}, reject: (_err: unknown) => {} }
	const deps: SubmitDeps = {
		executeTransfer: vi.fn(
			() =>
				new Promise<string>((resolve, reject) => {
					settle = { resolve, reject }
				}),
		),
		awaiting: { add: vi.fn(), remove: vi.fn() },
		openToast: vi.fn(),
		isCurrent: vi.fn(() => true),
		viewTransaction: vi.fn(),
		onSettled: vi.fn(),
	}
	return { deps, settle: () => settle }
}

/** The shell's side of the epoch: what a scope change and a lock do to a store and a snack. */
function shell() {
	const store = { isLogined: true, scopeEpoch: 0 }
	const toast = ref<ToastState | null>(null)
	const handlers = createScopeEpochHandlers({
		bumpEpoch: () => {
			store.scopeEpoch++
		},
		toast,
		closeToast: () => {
			toast.value = null
		},
	})
	const isCurrent = (epoch: number) => store.isLogined && store.scopeEpoch === epoch
	return { store, isCurrent, ...handlers }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const snack = (deps: SubmitDeps) => vi.mocked(deps.openToast).mock.calls[0]?.[0]

describe("send-submit", () => {
	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(console, "debug").mockImplementation(() => {})
	})
	afterEach(() => vi.restoreAllMocks())

	test("posts the awaiting row under a fresh id and fires the transfer with the snapshot, in order", () => {
		const { deps } = harness()
		const id = submitTransfer(deps, SNAP)
		expect(deps.awaiting.add).toHaveBeenCalledWith({ id, account: "0xacct", destination: DESTINATION, contract: "0xtoken" })
		expect(deps.executeTransfer).toHaveBeenCalledWith("n1", "0xacct", 7, 0, DESTINATION, SNAP.amount, SNAP.feeSettings, "est-1")
		expect(submitTransfer(deps, SNAP)).not.toBe(id)
	})

	test("resolved with a wire hash: the success snack names the amount, symbol and recipient, View opens the transaction, the row stays, then settled", async () => {
		const { deps, settle } = harness()
		submitTransfer(deps, SNAP)
		expect(deps.onSettled).not.toHaveBeenCalled()
		settle().resolve(HASH)
		await flush()
		expect(deps.openToast).toHaveBeenCalledWith({
			kind: "success",
			label: "Transaction submitted",
			sub: "1.5 USDC to 0x8c02…41fa",
			action: { label: "View", onSelect: expect.any(Function) },
		})
		snack(deps)?.action?.onSelect()
		expect(deps.viewTransaction).toHaveBeenCalledWith(HASH)
		expect(deps.awaiting.remove).not.toHaveBeenCalled()
		expect(deps.onSettled).toHaveBeenCalledTimes(1)
	})

	test("a 9-digit whole amount keeps every whole digit; a hostile symbol loses its bidi mark and is cut at 32", async () => {
		const { deps, settle } = harness()
		submitTransfer(deps, { ...SNAP, amount: 123_456_789n * 10n ** 18n, symbol: `‮${"A".repeat(40)}` })
		settle().resolve(HASH)
		await flush()
		expect(snack(deps)?.sub).toBe(`123,456,789 ${"A".repeat(32)}… to 0x8c02…41fa`)
	})

	test("a malformed hash gets no View", async () => {
		const { deps, settle } = harness()
		submitTransfer(deps, SNAP)
		settle().resolve("0x1234")
		await flush()
		expect(snack(deps)).toEqual({ kind: "success", label: "Transaction submitted", sub: "1.5 USDC to 0x8c02…41fa" })
		expect(snack(deps)?.action).toBeUndefined()
	})

	test("rejected: this row removed, a red snack with the failure sentence, logged as an error, then settled", async () => {
		const { deps, settle } = harness()
		const id = submitTransfer(deps, SNAP)
		settle().reject(new Error("boom"))
		await flush()
		expect(deps.awaiting.remove).toHaveBeenCalledWith(id)
		expect(deps.openToast).toHaveBeenCalledWith({ kind: "error", label: "Send failed", sub: TRANSFER_FAILED_COPY })
		expect(console.error).toHaveBeenCalledWith("[send] executeTransfer failed:", expect.any(Error))
		expect(deps.onSettled).toHaveBeenCalledTimes(1)
	})

	test("refused by the terms wall: the terms copy, logged at debug only", async () => {
		const { deps, settle } = harness()
		submitTransfer(deps, SNAP)
		settle().reject(new TermsAcceptanceRequiredError())
		await flush()
		expect(deps.openToast).toHaveBeenCalledWith({ kind: "error", label: "Send failed", sub: TRANSFER_TERMS_COPY })
		expect(console.debug).toHaveBeenCalledWith("[send] executeTransfer refused:", expect.any(TermsAcceptanceRequiredError))
		expect(console.error).not.toHaveBeenCalled()
	})

	test("cancelled by the user: the row removed, no snack, still settled", async () => {
		const { deps, settle } = harness()
		const id = submitTransfer(deps, SNAP)
		settle().reject(new JobCancelledError())
		await flush()
		expect(deps.awaiting.remove).toHaveBeenCalledWith(id)
		expect(deps.openToast).not.toHaveBeenCalled()
		expect(deps.onSettled).toHaveBeenCalledTimes(1)
	})

	test("settling after a lock or a scope change opens nothing, success or failure, and still settles", async () => {
		const ok = harness()
		submitTransfer(ok.deps, SNAP)
		vi.mocked(ok.deps.isCurrent).mockReturnValue(false)
		ok.settle().resolve(HASH)
		await flush()
		expect(ok.deps.isCurrent).toHaveBeenCalledWith(SNAP.epoch)
		expect(ok.deps.openToast).not.toHaveBeenCalled()
		expect(ok.deps.onSettled).toHaveBeenCalledTimes(1)

		const failed = harness()
		const id = submitTransfer(failed.deps, SNAP)
		vi.mocked(failed.deps.isCurrent).mockReturnValue(false)
		failed.settle().reject(new Error("boom"))
		await flush()
		expect(failed.deps.awaiting.remove).toHaveBeenCalledWith(id)
		expect(failed.deps.openToast).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledTimes(1)
		expect(failed.deps.onSettled).toHaveBeenCalledTimes(1)
	})

	test.each([
		[
			"A → B → A",
			(s: ReturnType<typeof shell>) => {
				s.onScopeChanged()
				s.onScopeChanged()
			},
		],
		[
			"lock → unlock",
			(s: ReturnType<typeof shell>) => {
				s.onLocked()
				s.store.isLogined = true
			},
		],
	])("%s during the send ends on the same ids under a new epoch, and the result opens nothing", async (_name, roundTrip) => {
		const s = shell()
		const { deps, settle } = harness()
		deps.isCurrent = s.isCurrent
		submitTransfer(deps, { ...SNAP, epoch: s.store.scopeEpoch })
		roundTrip(s)
		settle().resolve(HASH)
		await flush()
		expect(s.store.isLogined).toBe(true)
		expect(deps.openToast).not.toHaveBeenCalled()
	})

	test("an unchanged scope announces the result", async () => {
		const s = shell()
		const { deps, settle } = harness()
		deps.isCurrent = s.isCurrent
		submitTransfer(deps, { ...SNAP, epoch: s.store.scopeEpoch })
		settle().resolve(HASH)
		await flush()
		expect(deps.openToast).toHaveBeenCalledTimes(1)
	})
})
