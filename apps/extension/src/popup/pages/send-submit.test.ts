import {
	JobCancelledError,
	OperationNotRecordedError,
	remoteErrorFromResponseContent,
	TermsAcceptanceRequiredError,
	WalletError,
} from "@nulo/extension-messaging/errors"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ref } from "vue"
import type { ToastState } from "@/composables/toast"
import { createScopeEpochHandlers } from "@/popup/scope-epoch"
import { TRANSFER_FAILED_COPY, TRANSFER_NOT_STARTED_COPY, TRANSFER_TERMS_COPY } from "@/popup/utils/transfer-failure-copy"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
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
const JOURNAL_ID = "0123456789abcdef"

/** What the popup's client rejects with: the wire's fields rebuilt, with a record named beside them. */
function fromWire(error: Error, journalId?: string): Error {
	const errorPayload = error instanceof WalletError ? error.toPayload() : undefined
	return remoteErrorFromResponseContent({ error: error.message, errorPayload, journalId })
}

/** The record a failed send leaves: a terminal failed transfer in the snapshot's scope. */
function failedRecord(overrides: Partial<OperationRecord> = {}): OperationRecord {
	return {
		id: JOURNAL_ID,
		kind: "transfer",
		origin: "popup",
		profileId: "p1",
		progress: { stage: "failed" },
		error: null,
		terminalAt: 2,
		attempts: 0,
		createdAt: 1,
		updatedAt: 2,
		accountAddress: SNAP.accountAddress,
		networkId: SNAP.networkId,
		...overrides,
	}
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
		readJournal: vi.fn(async () => undefined),
		viewJournal: vi.fn(),
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
	return { store, isCurrent, toast, ...handlers }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const snack = (deps: SubmitDeps) => vi.mocked(deps.openToast).mock.calls[0]?.[0]

/** Scope changes that end on the same ids under a new epoch. */
const ROUND_TRIPS = [
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
] as const

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

	test.each(ROUND_TRIPS)(
		"%s during the send ends on the same ids under a new epoch, and the result opens nothing",
		async (_name, roundTrip) => {
			const s = shell()
			const { deps, settle } = harness()
			deps.isCurrent = s.isCurrent
			submitTransfer(deps, { ...SNAP, epoch: s.store.scopeEpoch })
			roundTrip(s)
			settle().resolve(HASH)
			await flush()
			expect(s.store.isLogined).toBe(true)
			expect(deps.openToast).not.toHaveBeenCalled()
		},
	)

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

describe("send-submit: Details on a failed send", () => {
	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(console, "debug").mockImplementation(() => {})
	})
	afterEach(() => vi.restoreAllMocks())

	test("a record named beside the failure and read back as this send's failed transfer: Details opens its page", async () => {
		const { deps, settle } = harness()
		vi.mocked(deps.readJournal).mockResolvedValue(failedRecord())
		submitTransfer(deps, SNAP)
		settle().reject(fromWire(new Error("boom"), JOURNAL_ID))
		await flush()
		expect(deps.readJournal).toHaveBeenCalledWith(JOURNAL_ID)
		expect(deps.openToast).toHaveBeenCalledWith({
			kind: "error",
			label: "Send failed",
			sub: TRANSFER_FAILED_COPY,
			action: { label: "Details", onSelect: expect.any(Function) },
		})
		snack(deps)?.action?.onSelect()
		expect(deps.viewJournal).toHaveBeenCalledWith(JOURNAL_ID)
		expect(deps.onSettled).toHaveBeenCalledTimes(1)
	})

	test("a Terms refusal after the record exists keeps the Terms copy and its debug level, and offers its own record", async () => {
		const { deps, settle } = harness()
		vi.mocked(deps.readJournal).mockResolvedValue(failedRecord())
		submitTransfer(deps, SNAP)
		settle().reject(fromWire(new TermsAcceptanceRequiredError(), JOURNAL_ID))
		await flush()
		expect(snack(deps)).toMatchObject({ sub: TRANSFER_TERMS_COPY, action: { label: "Details" } })
		expect(console.debug).toHaveBeenCalledWith("[send] executeTransfer refused:", expect.any(TermsAcceptanceRequiredError))
		expect(console.error).not.toHaveBeenCalled()
	})

	test.each([
		["a plain failure", () => new Error("boom"), TRANSFER_FAILED_COPY, "error"],
		["a Terms refusal", () => new TermsAcceptanceRequiredError(), TRANSFER_TERMS_COPY, "debug"],
		["a refusal before any record", () => new OperationNotRecordedError(), TRANSFER_NOT_STARTED_COPY, "error"],
	] as const)("%s keeps its copy and log level with or without a record named beside it", async (_name, make, copy, level) => {
		for (const journalId of [undefined, JOURNAL_ID]) {
			vi.mocked(console.error).mockClear()
			vi.mocked(console.debug).mockClear()
			const { deps, settle } = harness()
			submitTransfer(deps, SNAP)
			settle().reject(fromWire(make(), journalId))
			await flush()
			expect(snack(deps)).toEqual({ kind: "error", label: "Send failed", sub: copy })
			expect(vi.mocked(level === "error" ? console.error : console.debug)).toHaveBeenCalledTimes(1)
			expect(vi.mocked(level === "error" ? console.debug : console.error)).not.toHaveBeenCalled()
		}
	})

	test("a cancel stays silent with or without a record named beside it", async () => {
		for (const journalId of [undefined, JOURNAL_ID]) {
			const { deps, settle } = harness()
			vi.mocked(deps.readJournal).mockResolvedValue(failedRecord())
			submitTransfer(deps, SNAP)
			settle().reject(fromWire(new JobCancelledError(), journalId))
			await flush()
			expect(deps.openToast).not.toHaveBeenCalled()
			expect(deps.readJournal).not.toHaveBeenCalled()
		}
	})

	test.each([
		["no record named", () => fromWire(new Error("boom"))],
		["a short id", () => fromWire(new Error("boom"), "0123")],
		["an id of the right length that is a path", () => fromWire(new Error("boom"), "../settings/abcd")],
		["an uppercase id", () => fromWire(new Error("boom"), "0123456789ABCDEF")],
		["an id the error carries itself", () => Object.assign(new Error("boom"), { journalId: JOURNAL_ID })],
	])("%s: no Details, and nothing is read", async (_name, make) => {
		const { deps, settle } = harness()
		vi.mocked(deps.readJournal).mockResolvedValue(failedRecord())
		submitTransfer(deps, SNAP)
		settle().reject(make())
		await flush()
		expect(deps.readJournal).not.toHaveBeenCalled()
		expect(snack(deps)).toEqual({ kind: "error", label: "Send failed", sub: TRANSFER_FAILED_COPY })
	})

	const reads: Array<[string, () => Promise<OperationRecord | undefined>]> = [
		["no record by that id, missing or purged", async () => undefined],
		[
			"a read that fails",
			async () => {
				throw new Error("port gone")
			},
		],
		["a record whose failure never landed", async () => failedRecord({ progress: { stage: "simulating" }, terminalAt: null })],
		["a record that ended cancelled", async () => failedRecord({ progress: { stage: "cancelled" } })],
		["a failed record with no terminal time, which its page refuses", async () => failedRecord({ terminalAt: null })],
		["a dApp record", async () => failedRecord({ kind: "dapp_execute" })],
		["another account's record", async () => failedRecord({ accountAddress: "0xother" })],
		["another network's record", async () => failedRecord({ networkId: "n2" })],
	]
	test.each(reads)("%s: no Details, and the failure's snack alone", async (_name, read) => {
		const { deps, settle } = harness()
		vi.mocked(deps.readJournal).mockImplementation(read)
		submitTransfer(deps, SNAP)
		settle().reject(fromWire(new Error("boom"), JOURNAL_ID))
		await flush()
		expect(deps.openToast).toHaveBeenCalledTimes(1)
		expect(snack(deps)).toEqual({ kind: "error", label: "Send failed", sub: TRANSFER_FAILED_COPY })
		expect(console.error).toHaveBeenCalledTimes(1)
	})

	test.each(ROUND_TRIPS)("%s during the journal read opens nothing", async (_name, roundTrip) => {
		const s = shell()
		const { deps, settle } = harness()
		deps.isCurrent = s.isCurrent
		let answer: (record: OperationRecord | undefined) => void = () => {}
		vi.mocked(deps.readJournal).mockImplementation(
			() =>
				new Promise((resolve) => {
					answer = resolve
				}),
		)
		submitTransfer(deps, { ...SNAP, epoch: s.store.scopeEpoch })
		settle().reject(fromWire(new Error("boom"), JOURNAL_ID))
		await flush()
		expect(deps.readJournal).toHaveBeenCalledTimes(1)
		roundTrip(s)
		answer(failedRecord())
		await flush()
		expect(deps.openToast).not.toHaveBeenCalled()
	})

	test("the Details snack closes when the scope changes", async () => {
		const s = shell()
		const { deps, settle } = harness()
		deps.isCurrent = s.isCurrent
		deps.openToast = (toast) => {
			s.toast.value = { ...toast, id: 1 }
		}
		vi.mocked(deps.readJournal).mockResolvedValue(failedRecord())
		submitTransfer(deps, { ...SNAP, epoch: s.store.scopeEpoch })
		settle().reject(fromWire(new Error("boom"), JOURNAL_ID))
		await flush()
		expect(s.toast.value?.action?.label).toBe("Details")
		s.onScopeChanged()
		expect(s.toast.value).toBeNull()
	})

	test("two identical sends failing in reverse order each offer only their own record; one without a record offers none", async () => {
		const rejects: Array<(err: unknown) => void> = []
		const { deps } = harness()
		deps.executeTransfer = vi.fn(
			() =>
				new Promise<string>((_resolve, reject) => {
					rejects.push(reject)
				}),
		)
		vi.mocked(deps.readJournal).mockImplementation(async (id) => failedRecord({ id }))
		for (let i = 0; i < 3; i++) submitTransfer(deps, SNAP)

		rejects[1]?.(fromWire(new Error("the second fails first"), "bbbbbbbbbbbbbbbb"))
		await flush()
		rejects[0]?.(fromWire(new Error("the first fails last"), "aaaaaaaaaaaaaaaa"))
		await flush()
		rejects[2]?.(fromWire(new Error("refused before its record")))
		await flush()

		const snacks = vi.mocked(deps.openToast).mock.calls.map(([toast]) => toast)
		for (const toast of snacks) toast.action?.onSelect()
		expect(vi.mocked(deps.viewJournal).mock.calls).toEqual([["bbbbbbbbbbbbbbbb"], ["aaaaaaaaaaaaaaaa"]])
		expect(snacks[2]?.action).toBeUndefined()
	})
})
