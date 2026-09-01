/**
 * Public `Transfer` event indexing for the bundled aztec-standards Token.
 *
 * This is the offscreen-side (node-facing) core of the incoming-PUBLIC-transfer
 * feature. It owns:
 *  - the memoized Transfer log tag + bundled Token class id (Poseidon-heavy, computed once),
 *  - a thin decode+validate mapping over `node.getPublicLogsByTags` (D1),
 *  - the checkpointed/finalized tip probe (D6 bounds + watermark),
 *  - the node-direct contract-class gate (D2).
 *
 * We deliberately do NOT use aztec.js's `getPublicEvents` sugar: it discards
 * `txIndexWithinBlock`/`logIndexWithinTx` (needed for the record PK + ordering) and
 * only emits `nextCursor` on exactly-full pages, so a partial tail page would never
 * advance the caller's cursor. This module returns an explicit `scannedThrough`
 * (the LAST log of ANY page, full or partial) so partial pages advance too.
 *
 * The tag is EVENT-TYPE scoped, not recipient-scoped — a scan pages ALL of the
 * contract's `Transfer` events and the caller filters `to == account` client-side.
 * This module never filters by recipient; it only decodes + validates.
 */
import { memoizeAsync } from "./async-memo"
import { DomainSeparator } from "@aztec/constants"
import { BlockNumber } from "@aztec/foundation/branded-types"
import type { Fr } from "@aztec/foundation/curves/bn254"
import { decodeFromAbi } from "@aztec/stdlib/abi"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { BlockHash } from "@aztec/stdlib/block"
import { getContractClassFromArtifact } from "@aztec/stdlib/contract"
import { computeLogTag } from "@aztec/stdlib/hash"
import { MAX_LOGS_PER_TAG } from "@aztec/stdlib/interfaces/api-limit"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { type LogResult, LogCursor, Tag } from "@aztec/stdlib/logs"
// The user-added token is the aztec-standards Token (verified: token/functions/descriptors.ts,
// package pins). The `@aztec/noir-contracts.js/Token` in the artifact catalog is a DIFFERENT
// (protocol test) token, so the class gate + event metadata must come from aztec-standards.
import { TokenContract, TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import z from "zod"

export type PublicEventLogger = (level: "warn" | "debug", msg: string, ...rest: unknown[]) => void

/**
 * The sentinel `to`/`from` address the Token contract emits for the private leg of a public
 * transfer: `Transfer{from: MAGIC}` = came-from-private (private→public), `Transfer{to: MAGIC}` =
 * went-to-private (public→private, never OUR receipt). Derived from the token source constant
 * `AztecAddress::from_field(0x1ea7e015…3264)`; `.toString()` yields the 32-byte-padded hex so it
 * compares equal to a decoded `AztecAddress.toString()`.
 */
export const PRIVATE_ADDRESS_MAGIC_VALUE = AztecAddress.fromBigIntUnsafe(
	BigInt("0x1ea7e01501975545617c2e694d931cb576b691a4a867fed81ebd3264"),
).toString()

/** Wire cursor — round-trips through `LogCursor`'s composite ordering key. */
export interface PublicEventCursor {
	blockNumber: number
	txIndexWithinBlock: number
	logIndexWithinTx: number
}

/** One decoded, validated public `Transfer` receipt (all-JSON wire shape). */
export interface PublicTransferEvent {
	from: string
	to: string
	amountRaw: string
	txHash: string
	l2BlockNumber: number
	blockHash: string
	blockTimestamp: number
	txIndexWithinBlock: number
	logIndexWithinTx: number
}

/**
 * A page of decoded events. `scannedThrough` is the position of the LAST log in the returned
 * node page (full OR partial) — the caller persists THIS, never upstream's full-page-only
 * `nextCursor`. `null` when the page was empty (nothing to advance). `hasMore` mirrors "the node
 * page was exactly full" so the caller can keep paging within its budget.
 */
export interface PublicTransferPage {
	events: PublicTransferEvent[]
	scannedThrough: PublicEventCursor | null
	hasMore: boolean
	/** True when the WHOLE page was rejected by hostile-response validation (a log beyond the pinned
	 *  upper bound, or a non-strictly-increasing position). ALWAYS paired with `scannedThrough:null`,
	 *  but semantically distinct from a genuine empty page (EOF, also `scannedThrough:null`): a drop is
	 *  a SUSPECT/transient signal, not end-of-stream. The reconciliation caller must never treat a
	 *  dropped page as "window fully scanned" — that would delete not-yet-re-seen records on a single
	 *  malicious/glitched RPC page (codex R1 Critical #2). */
	dropped: boolean
}

/** Both reorg-relevant tips resolved in one probe (plain `BlockNumber`s, no `getChainTips` structs). */
export interface PublicScanTips {
	checkpointedBlockNumber: number
	/** Hash of the checkpointed tip block — the D6 reconciliation fork anchor (`upperBoundHash`).
	 *  `null` if the node couldn't resolve the block data (reconciliation then waits a tick). */
	checkpointedBlockHash: string | null
	finalizedBlockNumber: number
}

/**
 * Node-direct class-gate verdict (D2). `unresolved` = transient (node threw / no instance at
 * finalized) → fail closed for this tick but DO NOT cache; `non-standard` = a resolved class that
 * is not the bundled Token (or an upgraded one) → fail closed, cacheable.
 */
export type PublicTokenClassStatus = "standard" | "non-standard" | "unresolved"

export const PublicEventCursorSchema = z.object({
	blockNumber: z.number().int().nonnegative(),
	txIndexWithinBlock: z.number().int().nonnegative(),
	logIndexWithinTx: z.number().int().nonnegative(),
}) satisfies z.ZodType<PublicEventCursor>

export const PublicTransferEventSchema = z.object({
	from: z.string(),
	to: z.string(),
	amountRaw: z.string(),
	txHash: z.string(),
	l2BlockNumber: z.number().int().nonnegative(),
	blockHash: z.string(),
	blockTimestamp: z.number().int().nonnegative(),
	txIndexWithinBlock: z.number().int().nonnegative(),
	logIndexWithinTx: z.number().int().nonnegative(),
}) satisfies z.ZodType<PublicTransferEvent>

export const PublicTransferPageSchema = z.object({
	events: z.array(PublicTransferEventSchema),
	scannedThrough: PublicEventCursorSchema.nullable(),
	hasMore: z.boolean(),
	dropped: z.boolean(),
}) satisfies z.ZodType<PublicTransferPage>

export const PublicScanTipsSchema = z.object({
	checkpointedBlockNumber: z.number().int().nonnegative(),
	checkpointedBlockHash: z.string().nullable(),
	finalizedBlockNumber: z.number().int().nonnegative(),
}) satisfies z.ZodType<PublicScanTips>

export const PublicTokenClassStatusSchema = z.enum(["standard", "non-standard", "unresolved"]) satisfies z.ZodType<PublicTokenClassStatus>

/** Args accepted by {@link fetchPublicTokenTransferEvents} (already-parsed offscreen-side). */
export interface PublicTransferFetchArgs {
	fromBlock?: number
	/** PINNED inclusive upper bound (block number). When set, the page is bounded to THIS block and
	 *  the beyond-bound validation compares against it — NOT a per-call fresh `checkpointed` read — so
	 *  a multi-page forward scan / a staged reconciliation pages against ONE fixed tip instead of a
	 *  moving one (codex R1 Critical #1 / High #3). Omitted (capability probe / tests) → the node's
	 *  current `checkpointed` is read and used. Never read past the node's own checkpointed either way. */
	toBlock?: number
	afterCursor?: PublicEventCursor
	referenceBlock?: string
	/** ANCESTRY probe (codex R3 #1): prove `verifyAncestorHash` is in the archive rooted at
	 *  `referenceBlock` via a SINGLE `getBlockHashMembershipWitness` — atomic, so unlike two
	 *  independent "is X canonical now" probes it establishes that the boundary block is a genuine
	 *  ANCESTOR of the checkpoint we're scanning toward (not merely momentarily canonical on a flapping
	 *  fork). Throws on a non-member. When set, NO logs are fetched — it is a pure verification. */
	verifyAncestorHash?: string
}

export const PublicTransferFetchArgsSchema = z.object({
	fromBlock: z.number().int().nonnegative().optional(),
	toBlock: z.number().int().nonnegative().optional(),
	afterCursor: PublicEventCursorSchema.optional(),
	referenceBlock: z.string().optional(),
	verifyAncestorHash: z.string().optional(),
}) satisfies z.ZodType<PublicTransferFetchArgs>

/** The Transfer event metadata generated by the aztec-standards Token contract. */
const TRANSFER_EVENT = TokenContract.events.Transfer

// A transient hash failure must not poison either memo forever — retry
// semantics live in the shared helper.
const transferTagMemo = memoizeAsync<Tag>(() =>
	computeLogTag(TRANSFER_EVENT.eventSelector.toField(), DomainSeparator.EVENT_LOG_TAG).then((field) => new Tag(field)),
)
/** Memoized Transfer log tag — Poseidon over the event selector + EVENT_LOG_TAG domain separator. */
export function getTransferLogTag(): Promise<Tag> {
	return transferTagMemo.get()
}

const bundledTokenClassIdMemo = memoizeAsync<Fr>(() => getContractClassFromArtifact(TokenContractArtifact).then((c) => c.id))
/** Memoized class id of the bundled aztec-standards Token (Poseidon-heavy, computed once). */
export function getBundledTokenClassId(): Promise<Fr> {
	return bundledTokenClassIdMemo.get()
}

/** Test-only reset of the module-level memos. */
export function _resetPublicEventMemosForTests(): void {
	transferTagMemo.reset()
	bundledTokenClassIdMemo.reset()
}

/** Strict lexicographic compare of two cursor positions. */
function comparePositions(a: PublicEventCursor, b: PublicEventCursor): number {
	if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber
	if (a.txIndexWithinBlock !== b.txIndexWithinBlock) return a.txIndexWithinBlock - b.txIndexWithinBlock
	return a.logIndexWithinTx - b.logIndexWithinTx
}

function positionOf(log: LogResult): PublicEventCursor {
	return {
		blockNumber: Number(log.blockNumber),
		txIndexWithinBlock: log.txIndexWithinBlock,
		logIndexWithinTx: log.logIndexWithinTx,
	}
}

/**
 * Fetch + decode + validate ONE page of public `Transfer` events for `(contract)` after
 * `afterCursor`, bounded to the checkpointed tip (D1/D6). Hostile-response hardening:
 *  - the whole page is DROPPED (empty result, no cursor advance) if its logs are not strictly
 *    increasing in `(blockNumber, txIndexWithinBlock, logIndexWithinTx)`, if any position is
 *    `<= afterCursor`, or if any `blockNumber` exceeds the checkpointed tip;
 *  - an individual log that fails to decode is SKIPPED with a warn (per-item isolation), while the
 *    page's `scannedThrough` still advances past it so a poison log can't livelock the tail.
 *
 * A reorg that dropped `referenceBlock` makes `getPublicLogsByTags` THROW — that propagates to the
 * caller unchanged (it is the D6 reorg-detection signal, not swallowed here).
 */
export async function fetchPublicTokenTransferEvents(
	node: AztecNode,
	contract: string,
	args: PublicTransferFetchArgs,
	log?: PublicEventLogger,
): Promise<PublicTransferPage> {
	const contractAddress = await AztecAddress.schema.parseAsync(contract)

	// Pure ANCESTRY probe (codex R3 #1): prove the boundary block is an ancestor of `referenceBlock`
	// via ONE archive-membership query, atomically, in the checkpoint's frame — then return without
	// fetching logs. A non-member (or a reorged-out `referenceBlock`) means the last-committed block is
	// NOT on the fork we're about to scan → throw so the caller escalates to reconciliation.
	if (args.verifyAncestorHash !== undefined) {
		if (args.referenceBlock === undefined) throw new Error("verifyAncestorHash requires a referenceBlock anchor")
		// Identity short-circuit: the anchor IS the reference block — same hash, same block, same
		// fork by definition. The membership query must not run here: a block is NOT a member of
		// its own archive snapshot (verified against live Alpha), so a caught-up scanner probing a
		// non-advancing checkpoint got a spurious "reorg" → a full reconciliation on EVERY quiet
		// poll tick until the chain moved. Both guards stay CALLER-SIDE (synchronous);
		// only the always-awaited witness probe is tail-returned.
		if (args.verifyAncestorHash === args.referenceBlock) {
			return { events: [], scannedThrough: null, hasMore: false, dropped: false }
		}
		return probeAncestryWitness(node, args.referenceBlock, args.verifyAncestorHash)
	}

	const tag = await getTransferLogTag()
	// A PINNED `toBlock` bounds the whole (multi-page) scan to ONE fixed tip. Without it we fall back
	// to the node's live checkpointed.
	const nodeCheckpointed = Number(await node.getBlockNumber("checkpointed"))
	if (pinnedBoundExceedsCheckpointed(args, nodeCheckpointed, contract, log)) {
		return { events: [], scannedThrough: null, hasMore: false, dropped: true }
	}
	const checkpointed = args.toBlock ?? nodeCheckpointed

	const afterLog =
		args.afterCursor !== undefined
			? await LogCursor.schema.parseAsync({
					blockNumber: args.afterCursor.blockNumber,
					txIndexWithinBlock: args.afterCursor.txIndexWithinBlock,
					logIndexWithinTx: args.afterCursor.logIndexWithinTx,
				})
			: undefined

	const referenceBlock = args.referenceBlock !== undefined ? BlockHash.fromString(args.referenceBlock) : undefined

	// `fromBlock` is inclusive; `toBlock` is EXCLUSIVE, so +1 includes the checkpointed tip block.
	const [logsForTag] = await node.getPublicLogsByTags({
		contractAddress,
		tags: [afterLog !== undefined ? { tag, afterLog } : tag],
		fromBlock: args.fromBlock !== undefined ? BlockNumber(args.fromBlock) : undefined,
		toBlock: BlockNumber(checkpointed + 1),
		referenceBlock,
	})

	if (!logsForTag || logsForTag.length === 0) {
		return { events: [], scannedThrough: null, hasMore: false, dropped: false }
	}

	if (!validatePageOrdering(logsForTag, args.afterCursor, checkpointed, contract, log)) {
		return { events: [], scannedThrough: null, hasMore: false, dropped: true }
	}

	const events = decodeTransferPage(logsForTag, log)

	// `scannedThrough` advances past EVERY examined log — including any skipped-as-malformed —
	// so the tail can never livelock; `hasMore` mirrors an exactly-full node page.
	const scannedThrough = positionOf(logsForTag[logsForTag.length - 1])
	return { events, scannedThrough, hasMore: logsForTag.length === MAX_LOGS_PER_TAG, dropped: false }
}

/** The pinned-window sanity gate (synchronous): the caller pinned a window
 *  extending BEYOND what the node currently reports as checkpointed (a
 *  lagging / regressed / inconsistent backend). Do NOT silently truncate to
 *  `nodeCheckpointed`: for a reconciliation pinned to `[lowerBound..upperBound]`
 *  that would EOF early and let `finishReconciliation` DELETE the canonical
 *  records in the unscanned tail. Signal a suspect DROP so the caller defers
 *  this tick instead of finishing (codex R2 #3). */
function pinnedBoundExceedsCheckpointed(
	args: PublicTransferFetchArgs,
	nodeCheckpointed: number,
	contract: string,
	log?: PublicEventLogger,
): boolean {
	if (args.toBlock === undefined || args.toBlock <= nodeCheckpointed) return false
	log?.("warn", "public-events: pinned toBlock exceeds node checkpointed — deferring", {
		contract,
		toBlock: args.toBlock,
		nodeCheckpointed,
	})
	return true
}

/** Per-item decode over a validated page (synchronous; malformed items skip
 *  with their own warn inside the decoder). */
function decodeTransferPage(logsForTag: LogResult[], log?: PublicEventLogger): PublicTransferEvent[] {
	const events: PublicTransferEvent[] = []
	for (const entry of logsForTag) {
		const decoded = decodePublicTransfer(entry, log)
		if (decoded) events.push(decoded)
	}
	return events
}

/** The always-awaited half of the ancestry probe (the sync guards stay at the
 *  call site): one archive-membership query, atomically, in the checkpoint's
 *  frame. */
async function probeAncestryWitness(node: AztecNode, referenceBlock: string, ancestorHash: string): Promise<PublicTransferPage> {
	const witness = await node.getBlockHashMembershipWitness(BlockHash.fromString(referenceBlock), BlockHash.fromString(ancestorHash))
	if (!witness) throw new Error("public-events: boundary block is not an ancestor of the checkpoint (reorg)")
	return { events: [], scannedThrough: null, hasMore: false, dropped: false }
}

/** Page-level validation (synchronous) — any violation warns and fails the
 *  WHOLE page (the caller drops it with no cursor advance). */
function validatePageOrdering(
	logsForTag: LogResult[],
	afterCursor: PublicEventCursor | undefined,
	checkpointed: number,
	contract: string,
	log?: PublicEventLogger,
): boolean {
	let prev: PublicEventCursor | undefined = afterCursor
	for (const entry of logsForTag) {
		const pos = positionOf(entry)
		if (pos.blockNumber > checkpointed) {
			log?.("warn", "public-events: page contains a log beyond the checkpointed tip — dropping page", {
				contract,
				pos,
				checkpointed,
			})
			return false
		}
		if (prev !== undefined && comparePositions(pos, prev) <= 0) {
			log?.("warn", "public-events: page is not strictly increasing (or precedes cursor) — dropping page", {
				contract,
				prev,
				pos,
			})
			return false
		}
		prev = pos
	}
	return true
}

/** Decode a single `Transfer` log, or `undefined` (with a warn) on any per-item failure. */
function decodePublicTransfer(entry: LogResult, log?: PublicEventLogger): PublicTransferEvent | undefined {
	try {
		const decoded = decodeFromAbi([TRANSFER_EVENT.abiType], entry.logData.slice(1)) as {
			from: AztecAddress
			to: AztecAddress
			amount: bigint
		}
		return {
			from: decoded.from.toString(),
			to: decoded.to.toString(),
			amountRaw: BigInt(decoded.amount).toString(),
			txHash: entry.txHash.toString(),
			l2BlockNumber: Number(entry.blockNumber),
			blockHash: entry.blockHash.toString(),
			blockTimestamp: Number(entry.blockTimestamp),
			txIndexWithinBlock: entry.txIndexWithinBlock,
			logIndexWithinTx: entry.logIndexWithinTx,
		}
	} catch (err) {
		log?.("warn", "public-events: skipping a malformed Transfer log", err instanceof Error ? err.message : String(err))
		return undefined
	}
}

/** Resolve both reorg-relevant tips (D6): the `checkpointed` index bound + fork-anchor hash + the
 *  `finalized` rewind floor. Number + hash come from the SAME checkpointed block data so they can't
 *  skew; a `getBlockData` failure falls back to the plain number with a `null` hash. */
export async function getPublicScanTips(node: AztecNode): Promise<PublicScanTips> {
	const [checkpointedData, finalized] = await Promise.all([
		node.getBlockData("checkpointed").catch(() => undefined),
		node.getBlockNumber("finalized"),
	])
	const checkpointedBlockNumber = checkpointedData
		? Number(checkpointedData.header.getBlockNumber())
		: Number(await node.getBlockNumber("checkpointed"))
	return {
		checkpointedBlockNumber,
		checkpointedBlockHash: checkpointedData ? checkpointedData.blockHash.toString() : null,
		finalizedBlockNumber: Number(finalized),
	}
}

/**
 * Node-direct class gate (D2). Resolves the contract's CURRENT class — NOT the PXE cascade, which
 * short-circuits on a preimage hit and would report the original class for an upgraded registered
 * token — and requires it to be the bundled Token class at BOTH the `finalized` (stable) anchor AND
 * the EXACT checkpoint hash the scan is pinned to. Gating at `finalized` alone left an upgrade window:
 * a contract standard-at-finalized but MALICIOUS-at-checkpointed would have its checkpointed logs
 * indexed as fake receipts impersonating an already-trusted, price-mapped token (codex R3 #7). The
 * checkpoint anchor is the pinned HASH, not the symbolic `"checkpointed"` tag, so the node can't show
 * standard fork A for the class query then serve malicious fork B (matching the pinned hash) for the
 * scan — a TOCTOU (codex R4 #7). `undefined`/throw at EITHER anchor → `unresolved` (transient, fail
 * closed, do NOT cache); a mismatch at either → `non-standard`.
 */
export async function resolveTokenClassStatus(
	node: AztecNode,
	contract: string,
	checkpointHash: string,
	log?: PublicEventLogger,
): Promise<PublicTokenClassStatus> {
	const expected = await getBundledTokenClassId()
	const contractAddress = await AztecAddress.schema.parseAsync(contract)
	const anchors: Array<{ label: string; param: "finalized" | BlockHash }> = [
		{ label: "finalized", param: "finalized" },
		{ label: "checkpointed", param: BlockHash.fromString(checkpointHash) },
	]
	for (const { label, param } of anchors) {
		let instance: Awaited<ReturnType<AztecNode["getContract"]>>
		try {
			instance = await node.getContract(contractAddress, param)
		} catch (err) {
			log?.(
				"debug",
				`public-events: class gate unresolved (node getContract threw at ${label})`,
				err instanceof Error ? err.message : String(err),
			)
			return "unresolved"
		}
		if (!instance) return "unresolved"
		if (!instance.currentContractClassId.equals(expected)) return "non-standard"
	}
	return "standard"
}
