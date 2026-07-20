import type { BackgroundConnectionHandler, PendingDiscovery } from "@aztec/wallet-sdk/extension/handlers"
import type { ILogger } from "@nulo/wallet-core/logger"
import { LogLevel } from "@nulo/wallet-core/logger"

const STALE_MS = 5 * 60 * 1000 // 5 minutes

// F-04: bound the locked-wallet discovery queue so a flooding dApp cannot grow
// it without limit. A legitimate dApp needs at most a handful of concurrent
// discoveries; anything past these caps is dropped (the dApp re-discovers on
// its next broadcast). Reject-new, never evict — evicting could drop a
// legitimate earlier discovery the user was about to approve.
const GLOBAL_CAP = 32
const PER_ORIGIN_CAP = 4

interface QueuedDiscovery {
	requestId: string
	origin: string
	chainId: string
}

export class DiscoveryQueue {
	private queue: QueuedDiscovery[] = []

	constructor(
		private handler: BackgroundConnectionHandler,
		private logger: ILogger,
	) {}

	get size(): number {
		return this.queue.length
	}

	/**
	 * Queue a discovery while the wallet is locked. Returns `false` when the
	 * request is dropped — either it **coalesces** with an already-queued
	 * `(origin,chainId)`, or a **per-origin / global cap** is hit (F-04).
	 * Returns `true` when it was queued.
	 */
	enqueue(requestId: string, origin: string, chainId: string): boolean {
		if (this.queue.some((d) => d.origin === origin && d.chainId === chainId)) {
			this.logger.log("wallet-sdk", LogLevel.Info, `Discovery coalesced (already queued): ${origin} chain=${chainId}`)
			return false
		}
		if (this.queue.filter((d) => d.origin === origin).length >= PER_ORIGIN_CAP) {
			this.logger.log("wallet-sdk", LogLevel.Warn, `Discovery dropped (per-origin cap ${PER_ORIGIN_CAP}): ${origin}`)
			return false
		}
		if (this.queue.length >= GLOBAL_CAP) {
			this.logger.log("wallet-sdk", LogLevel.Warn, `Discovery dropped (global cap ${GLOBAL_CAP}): ${origin}`)
			return false
		}
		this.queue.push({ requestId, origin, chainId })
		this.updateBadge()
		this.logger.log("wallet-sdk", LogLevel.Info, `Discovery queued (wallet locked): ${origin} [queue: ${this.queue.length}]`)
		return true
	}

	/**
	 * Drain the queue. Calls `processFn` for each valid, non-stale discovery.
	 * If `processFn` returns false, remaining items are re-queued (wallet locked mid-drain).
	 */
	async drain(processFn: (discovery: PendingDiscovery) => Promise<boolean>): Promise<void> {
		if (this.queue.length === 0) return

		this.logger.log("wallet-sdk", LogLevel.Info, `Draining discovery queue: ${this.queue.length} item(s)`)

		const snapshot = [...this.queue]
		this.queue.length = 0
		this.updateBadge()

		const now = Date.now()
		for (let i = 0; i < snapshot.length; i++) {
			const entry = snapshot[i]
			const discovery = this.handler.getPendingDiscovery(entry.requestId)

			if (!discovery || discovery.status !== "pending") {
				this.logger.log(
					"wallet-sdk",
					LogLevel.Info,
					`Discovery skipped (${!discovery ? "gone" : discovery.status}): ${entry.requestId}`,
				)
				continue
			}

			if (now - discovery.timestamp > STALE_MS) {
				this.handler.rejectDiscovery(discovery.requestId)
				this.logger.log("wallet-sdk", LogLevel.Warn, `Discovery rejected (stale): ${discovery.origin}`)
				continue
			}

			const ok = await processFn(discovery)
			if (!ok) {
				// Wallet locked mid-drain — re-queue this + remaining
				this.queue.push(...snapshot.slice(i))
				this.updateBadge()
				this.logger.log("wallet-sdk", LogLevel.Warn, `Wallet locked during drain, re-queued ${this.queue.length} item(s)`)
				return
			}
		}

		this.logger.log("wallet-sdk", LogLevel.Info, "Discovery queue drain complete")
	}

	private updateBadge(): void {
		const text = this.queue.length > 0 ? String(this.queue.length) : ""
		chrome.action.setBadgeText({ text })
		if (this.queue.length > 0) {
			chrome.action.setBadgeBackgroundColor({ color: "#FF6B00" })
		}
	}
}
