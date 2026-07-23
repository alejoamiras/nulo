/**
 * `PublicEventIndexer` — the injected collaborator that owns the public-`Transfer` RPC paging loop,
 * cross-page cursor validation, the page budget, and the recipient pre-filter (codex #8 hybrid).
 *
 * It NEVER touches storage: it returns decoded+validated events plus a proposed cursor advance, and
 * the `IncomingTransferService` remains the sole writer of records / trust / cursors / outbox. The
 * per-page hostile-response hardening (monotonicity, checkpointed-tip bound, per-item decode
 * isolation) already lives offscreen in `@nulo/aztec-runtime`'s `fetchPublicTokenTransferEvents`;
 * this module adds the cross-page monotonicity guard and stops at the budget.
 *
 * A `referenceBlock`-reorg throw from the reader propagates UNCHANGED — it is the D6 detection
 * signal the service catches to trigger reconciliation.
 */
import type {
	PublicEventCursor,
	PublicScanTips,
	PublicTokenClassStatus,
	PublicTransferEvent,
	PublicTransferFetchArgs,
	PublicTransferPage,
} from "@nulo/aztec-runtime/pxe/public-events"

export type PublicIndexerLogger = (level: "warn" | "debug", msg: string, ...rest: unknown[]) => void

/** The network-resolved RPC transport the indexer drives (the SW-side PxeServiceClient, curried per networkId). */
export interface PublicEventReader {
	fetchTransferPage(networkId: string, contract: string, args: PublicTransferFetchArgs): Promise<PublicTransferPage>
	getScanTips(networkId: string): Promise<PublicScanTips>
	getTokenClassStatus(networkId: string, contract: string): Promise<PublicTokenClassStatus>
}

/** The accumulated result of a bounded, multi-page forward scan. */
export interface PublicScanResult {
	/** ALL decoded transfer events across the scanned pages (every recipient — the service filters). */
	events: PublicTransferEvent[]
	/** The last log position across all scanned pages; `null` when nothing was scanned. */
	scannedThrough: PublicEventCursor | null
	/** True when the budget was exhausted while the final page was still full (more work remains). */
	hasMore: boolean
	/** Block hash of the last decoded event's block — the reorg/pendingPage fork anchor; `null` if no events. */
	topBlockHash: string | null
	/** True when the scan stopped because a page was DROPPED by hostile-response validation (as opposed
	 *  to a genuine empty/EOF page). The reconciliation caller must NOT treat this as "window complete"
	 *  (codex R1 Critical #2). */
	dropped: boolean
}

export const DEFAULT_MAX_PAGES_PER_SCAN = 5

/** Strict lexicographic compare of two cursor positions. */
export function comparePublicPositions(a: PublicEventCursor, b: PublicEventCursor): number {
	if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber
	if (a.txIndexWithinBlock !== b.txIndexWithinBlock) return a.txIndexWithinBlock - b.txIndexWithinBlock
	return a.logIndexWithinTx - b.logIndexWithinTx
}

export class PublicEventIndexer {
	public constructor(
		private readonly reader: PublicEventReader,
		private readonly log: PublicIndexerLogger,
		private readonly maxPages: number = DEFAULT_MAX_PAGES_PER_SCAN,
	) {}

	public getTips(networkId: string): Promise<PublicScanTips> {
		return this.reader.getScanTips(networkId)
	}

	public getClassStatus(networkId: string, contract: string): Promise<PublicTokenClassStatus> {
		return this.reader.getTokenClassStatus(networkId, contract)
	}

	/**
	 * Page forward from `afterCursor` (optionally lower-bounded by `fromBlock`; upper-bounded by a
	 * PINNED `toBlock` when given, else the RPC's live checkpointed tip), up to the page budget.
	 * Passes `toBlock` + `referenceBlock` on EVERY page so the whole multi-page scan reads ONE fixed
	 * tip and a reorg that dropped the anchor throws (and propagates). Stops early on an empty/dropped
	 * page, on a non-advancing cursor (hostile), or on the first non-full page; surfaces `dropped` so
	 * the caller can tell a suspect drop from a genuine EOF.
	 */
	public async scan(
		networkId: string,
		contract: string,
		args: { fromBlock?: number; toBlock?: number; afterCursor?: PublicEventCursor | null; referenceBlock?: string; maxPages?: number },
	): Promise<PublicScanResult> {
		const events: PublicTransferEvent[] = []
		let cursor: PublicEventCursor | null = args.afterCursor ?? null
		let scannedThrough: PublicEventCursor | null = null
		let topBlockHash: string | null = null
		let hasMore = false
		let dropped = false
		// A per-call cap (e.g. 1) lets the caller bound the scan when it can't pin a fork anchor — a
		// single `getPublicLogsByTags` page is atomic against one fork, so it can never splice two
		// (codex R2 #1).
		const limit = Math.min(args.maxPages ?? this.maxPages, this.maxPages)

		for (let page = 0; page < limit; page++) {
			const fetchArgs: PublicTransferFetchArgs = {
				fromBlock: args.fromBlock,
				toBlock: args.toBlock,
				afterCursor: cursor ?? undefined,
				referenceBlock: args.referenceBlock,
			}
			const res = await this.reader.fetchTransferPage(networkId, contract, fetchArgs)
			if (res.scannedThrough === null) {
				// Empty page (EOF) OR a validator-dropped page — surface WHICH so reconciliation can
				// distinguish "window complete" from "suspect page, retry" (codex R1 Critical #2).
				dropped = res.dropped
				hasMore = false
				break
			}
			if (cursor && comparePublicPositions(res.scannedThrough, cursor) <= 0) {
				this.log("warn", "public-indexer: page cursor did not advance — stopping scan", { networkId, contract, cursor })
				hasMore = false
				break
			}
			for (const e of res.events) {
				events.push(e)
				topBlockHash = e.blockHash
			}
			scannedThrough = res.scannedThrough
			cursor = res.scannedThrough
			if (!res.hasMore) {
				hasMore = false
				break
			}
			// Page was full; if this was the last budgeted page, more work remains for the next tick.
			hasMore = page === limit - 1
		}

		return { events, scannedThrough, hasMore, topBlockHash, dropped }
	}

	/** Filter a page's events to those addressed to one of `recipients` (lower-cased compare). */
	public filterToRecipients(events: PublicTransferEvent[], recipients: Map<string, string> | Set<string>): PublicTransferEvent[] {
		return events.filter((e) => recipients.has(e.to.toLowerCase()))
	}

	/**
	 * Fetch a SINGLE page purely to trigger the `referenceBlock` reorg check — throws if the anchor
	 * was reorged out. Events are discarded; used to validate a pending page's fork before proceeding.
	 */
	public async probe(
		networkId: string,
		contract: string,
		args: { afterCursor?: PublicEventCursor | null; referenceBlock?: string; verifyAncestorHash?: string },
	): Promise<void> {
		await this.reader.fetchTransferPage(networkId, contract, {
			afterCursor: args.afterCursor ?? undefined,
			referenceBlock: args.referenceBlock,
			verifyAncestorHash: args.verifyAncestorHash,
		})
	}
}
