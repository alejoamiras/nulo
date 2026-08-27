import type { BackgroundConnectionHandler, PendingDiscovery } from "@aztec/wallet-sdk/extension/handlers"
import type { ILogger } from "@nulo/wallet-core/logger"
import { LogLevel } from "@nulo/wallet-core/logger"

// B-16: bound discovery staleness to the SDK's discovery window, not an
// arbitrary 5 minutes. The extension provider's DEFAULT_DISCOVERY_TIMEOUT_MS is
// 60s — the dApp removes its DISCOVERY_RESPONSE listener at t=60s. Approving a
// discovery past that window strands a half-open handshake the dApp can no
// longer complete. 55s leaves a ~5s margin for the DISCOVERY_RESPONSE to be
// scheduled and delivered before t=60s (the subsequent 2s ECDH exchange runs
// over the already-transferred port, so it is not what the 60s bounds). This is
// a policy value: a dApp may pass a shorter custom timeout, which the SDK does
// not surface per-discovery, so it cannot be honored exactly — we align to the
// documented default.
export const DISCOVERY_STALE_MS = 55 * 1000 // 55 seconds — just inside the SDK's 60s discovery timeout

/**
 * True when `discovery` has aged past the SDK's discovery window and must be
 * rejected rather than approved. MUST be re-checked immediately before EVERY
 * approval (and before any durable session write), not only at drain-gate
 * entry: an interactive approval popup can resolve after t=60s.
 */
export function isDiscoveryExpired(discovery: PendingDiscovery, now: number = Date.now()): boolean {
	return now - discovery.timestamp > DISCOVERY_STALE_MS
}

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
	) {
		// F-B16: reconcile the badge at construction (= every SW boot). The badge
		// is Chrome-level state that SURVIVES a service-worker kill, while this
		// queue is in-memory and boots empty — without this, a worker killed with
		// a non-empty queue leaves a permanent ghost count (the empty-queue drain
		// below early-returns without touching the badge, so even unlocking never
		// clears it). The queue is authoritative: paint what it actually holds.
		this.updateBadge()
	}

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
			this.logger.log("wallet-sdk", LogLevel.Info, `Discovery coalesced (already queued) on chain=${chainId}`)
			return false
		}
		if (this.queue.filter((d) => d.origin === origin).length >= PER_ORIGIN_CAP) {
			this.logger.log("wallet-sdk", LogLevel.Warn, `Discovery dropped: one origin exceeded the per-origin cap of ${PER_ORIGIN_CAP}`)
			return false
		}
		if (this.queue.length >= GLOBAL_CAP) {
			this.logger.log("wallet-sdk", LogLevel.Warn, `Discovery dropped: the queue is at its global cap of ${GLOBAL_CAP}`)
			return false
		}
		this.queue.push({ requestId, origin, chainId })
		this.updateBadge()
		this.logger.log("wallet-sdk", LogLevel.Info, `Discovery queued (wallet locked) [queue: ${this.queue.length}]`)
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

			// Re-read the clock per entry: processing an earlier discovery (which
			// can await a popup) may itself push a later one past the window.
			if (isDiscoveryExpired(discovery)) {
				this.handler.rejectDiscovery(discovery.requestId)
				this.logger.log("wallet-sdk", LogLevel.Warn, `Discovery rejected (stale): request ${entry.requestId}`)
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
