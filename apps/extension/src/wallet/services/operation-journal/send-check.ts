import { TxHash, type TxReceipt } from "@aztec/stdlib/tx"
import type { SendCheckOutcome } from "@nulo/wallet-core/jobs"
import { LogLevel } from "@nulo/wallet-core/logger"
import type { ClockPort, TimerHandle } from "@nulo/wallet-core/ports"
import type { ILogger } from "@/wallet/logger"
import type { NetworkService } from "@/wallet/services/network/service"
import type { ExecutionFence } from "@/wallet/services/profile/profile-deletion-state"
import type { ProfileService } from "@/wallet/services/profile/service"
import type { TokenBalanceService } from "@/wallet/services/token-balance/service"
import { executionResultFromReceipt, txStatusFromReceipt } from "@/wallet/services/transaction/receipt-status"
import { DROPPED_RECHECK_INTERVAL_MS, DROPPED_RESURRECTION_WINDOW_MS } from "@/wallet/services/transaction/service"
import { TxExecutionResult, TxStatus } from "@/wallet/services/transaction/spec"
import { isSendCheckable, type OperationJournalService, type OperationRecord } from "./service"

export const SEND_CHECK_TICK_MS = 5_000
/** How long after the failure a row is read on every tick; after it, every `DROPPED_RECHECK_INTERVAL_MS`. */
export const SEND_CHECK_FAST_WINDOW_MS = 2 * 60_000

const LOG_SOURCE = "SendCheck"
const MINED: ReadonlySet<TxStatus> = new Set([TxStatus.Proposed, TxStatus.Checkpointed, TxStatus.Proven, TxStatus.Finalized])

export type SendCheckDeps = {
	journal: Pick<OperationJournalService, "getOperation" | "getOperations" | "setSendCheck" | "onOperationUpdated" | "onOperationDeleted">
	network: Pick<NetworkService, "getSingleAttemptNodeForUrl">
	profile: Pick<ProfileService, "captureExecutionFence" | "isFenceLive">
	balances: Pick<TokenBalanceService, "refreshAccountBalances">
	logger: ILogger
	clock: ClockPort
}

type Watch = {
	id: string
	profileId: string
	txHash: string
	url: string | undefined
	terminalAt: number
	nextAt: number
	inFlight: boolean
}

/**
 * Asks the network what became of a failed send that may have reached it, and records the answer
 * on the journal row. A row is read only on the endpoint it was sent through, only while its
 * profile is the unlocked one, and one read at a time; nothing is persisted but the answer, so a
 * restart resumes every unanswered row.
 */
export class SendCheck {
	private readonly deps: SendCheckDeps
	private readonly watches = new Map<string, Watch>()
	/** Bumped by `stop()`: a read begun under an older value writes nothing. */
	private generation = 0
	private timer: TimerHandle | undefined

	public constructor(deps: SendCheckDeps) {
		this.deps = deps
	}

	public async start(): Promise<void> {
		const { journal, clock } = this.deps
		const generation = this.generation
		journal.onOperationUpdated.add(this.onUpdated)
		journal.onOperationDeleted.add(this.onDeleted)
		this.timer = clock.setInterval(() => void this.tick(), SEND_CHECK_TICK_MS)
		const failed = await journal.getOperations({ stage: "failed" })
		if (generation !== this.generation) return
		for (const op of failed) this.watch(op)
	}

	public stop(): void {
		const { journal, clock } = this.deps
		this.generation += 1
		if (this.timer !== undefined) clock.clearInterval(this.timer)
		this.timer = undefined
		journal.onOperationUpdated.remove(this.onUpdated)
		journal.onOperationDeleted.remove(this.onDeleted)
		this.watches.clear()
	}

	private readonly onUpdated = (op: OperationRecord): void => this.watch(op)

	private readonly onDeleted = (op: OperationRecord): void => {
		this.watches.delete(op.id)
	}

	/** Keeps an existing watch, so the guard of a read in flight outlives the row's next update. */
	private watch(op: OperationRecord): void {
		const target = unanswered(op)
		if (!target || this.watches.has(op.id)) return
		const now = this.deps.clock.now()
		this.watches.set(op.id, {
			id: op.id,
			profileId: op.profileId,
			...target,
			terminalAt: op.terminalAt ?? now,
			nextAt: now,
			inFlight: false,
		})
	}

	private unwatch(watch: Watch): void {
		if (this.watches.get(watch.id) === watch) this.watches.delete(watch.id)
	}

	private async tick(): Promise<void> {
		const generation = this.generation
		let fence: ExecutionFence
		try {
			fence = await this.deps.profile.captureExecutionFence()
		} catch {
			return
		}
		const now = this.deps.clock.now()
		for (const watch of this.watches.values()) {
			if (watch.inFlight || now < watch.nextAt || watch.profileId !== fence.profileId) continue
			void this.read(watch, fence, generation, now)
		}
	}

	private async read(watch: Watch, fence: ExecutionFence, generation: number, now: number): Promise<void> {
		// The one guard on every dial and write. A lock, a switch, a begun deletion, `stop()` or the
		// row's deletion makes it false for good, so a check before each step is enough.
		const live = () => this.deps.profile.isFenceLive(fence) && generation === this.generation && this.watches.get(watch.id) === watch
		watch.inFlight = true
		try {
			await this.readOnce(watch, live, now)
		} catch {
			watch.nextAt = nextReadAt(watch.terminalAt, now)
			this.deps.logger.log(LOG_SOURCE, LogLevel.Debug, "send check read failed", { journalId: watch.id, stage: "read-error" })
		} finally {
			watch.inFlight = false
		}
	}

	private async readOnce(watch: Watch, live: () => boolean, now: number): Promise<void> {
		const op = await this.deps.journal.getOperation(watch.id)
		if (!op || unanswered(op)?.txHash !== watch.txHash) {
			this.unwatch(watch)
			return
		}
		const verdict = watch.url === undefined ? undefined : await this.minedVerdict(watch, watch.url, live)
		if (!live()) return
		const last = watch.url === undefined || now - watch.terminalAt >= DROPPED_RESURRECTION_WINDOW_MS
		const check = verdict ?? (last ? "unconfirmed" : undefined)
		if (check === undefined) {
			watch.nextAt = nextReadAt(watch.terminalAt, now)
			return
		}
		await this.record(watch, op, check, live)
	}

	/** `sent` or `reverted` once the node reports the transaction in a block; `undefined` otherwise.
	 *  One attempt per read: a transport retry would dial after `live()` turned false. */
	private async minedVerdict(watch: Watch, url: string, live: () => boolean): Promise<SendCheckOutcome | undefined> {
		if (!live()) return undefined
		const node = await this.deps.network.getSingleAttemptNodeForUrl(url)
		if (!live()) return undefined
		try {
			return verdictOf(await node.getTxReceipt(TxHash.fromString(watch.txHash)))
		} catch {
			this.deps.logger.log(LOG_SOURCE, LogLevel.Debug, "send check receipt failed", { journalId: watch.id, stage: "receipt-error" })
			return undefined
		}
	}

	/** A refused write keeps the row watched and due: the next tick's re-read decides again. */
	private async record(watch: Watch, op: OperationRecord, check: SendCheckOutcome, live: () => boolean): Promise<void> {
		if (!(await this.deps.journal.setSendCheck(watch.id, watch.txHash, check, live))) return
		const refresh = check !== "unconfirmed" && live() ? op.accountAddress : undefined
		this.unwatch(watch)
		this.deps.logger.log(LOG_SOURCE, LogLevel.Debug, "send check answered", { journalId: watch.id, outcome: check })
		if (refresh !== undefined) await this.deps.balances.refreshAccountBalances(refresh)
	}
}

/** The hash and endpoint of a row that may have reached the network and has no answer yet. */
function unanswered(op: OperationRecord): { txHash: string; url: string | undefined } | undefined {
	const { progress } = op
	if (progress.stage !== "failed" || progress.check !== undefined || !progress.txHash || !isSendCheckable(op)) return undefined
	return { txHash: progress.txHash, url: progress.submittedEndpointUrl }
}

function verdictOf(receipt: Pick<TxReceipt, "status" | "executionResult">): SendCheckOutcome | undefined {
	let status: TxStatus
	try {
		status = txStatusFromReceipt(receipt.status)
	} catch {
		return undefined
	}
	if (!MINED.has(status)) return undefined
	// Decided at inclusion, as `waitForTx` decides a send: a block pruned later is not caught.
	return executionResultFromReceipt(receipt.executionResult) === TxExecutionResult.Success ? "sent" : "reverted"
}

function nextReadAt(terminalAt: number, now: number): number {
	return now + (now - terminalAt < SEND_CHECK_FAST_WINDOW_MS ? SEND_CHECK_TICK_MS : DROPPED_RECHECK_INTERVAL_MS)
}
