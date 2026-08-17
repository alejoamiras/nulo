/**
 * Per-(profileId, chainId) ENCRYPTED SQLite-OPFS stores for the offscreen PXE.
 *
 * Why injection is mandatory (never the upstream default): 5.0.0's default `createStore` ignores
 * `dataDirectory` and opens ONE hardcoded-name store in the default OPFS SAH-pool directory — under
 * this wallet's one-PXE-per-(profile, chain) architecture that would collapse every profile and
 * chain into a single database, WIPE it on every rollup switch (the version stamp is per-store),
 * and deadlock concurrent PXEs on the pool's exclusive directory lock. Each store here gets its own
 * `poolDirectory` (the persisted `chainDataDir` coordinate), so isolation, concurrency, and purge
 * are all per-(profile, chain).
 *
 * Encryption: every store opens with a 32-byte per-profile ChaCha20 key (sqlite3mc via upstream's
 * `encryptionKey` — see `@nulo/wallet-crypto`'s `derivePxeStoreKey`). Fail-closed: no key, no
 * store. Purge is crypto-erase plus unlink.
 *
 * Version/rollup hygiene: against the same `dbVersion` singleton key upstream uses, we REFUSE to
 * open a store whose stamp mismatches the target schema/rollup — matching upstream 5.0.1's
 * refuse-and-preserve flip (5.0.0's `initStoreForRollupAndSchemaVersion` WIPED; 5.0.1 does not) and
 * the D-B2v3 audit decision (the store holds user-owned state; the rollupAddress input is
 * node-derived, so wiping on it would let a lying RPC loop-destroy local stores). A mismatch throws
 * `PxeStoreVersionMismatch` and the caller fails chain-init; pre-production remediation = profile
 * purge. `PXE_DATA_SCHEMA_VERSION_PIN` mirrors upstream's non-exported constant; `opfs-store.test.ts`
 * asserts it against the installed package so a silent upstream bump fails the build.
 * A wrong store key surfaces as `SqliteEncryptionError` from upstream — mapped to a typed
 * `WrongStoreKeyError` (never confused with corruption or absence).
 */
import type { Logger } from "@aztec/foundation/log"
import { EthAddress } from "@aztec/foundation/eth-address"
import { AztecSQLiteOPFSStore } from "@aztec/kv-store/sqlite-opfs"
import { SqliteEncryptionError } from "@aztec/kv-store/sqlite-opfs"
import { DatabaseVersion } from "@aztec/stdlib/database-version/version"
import { chainDataDir, PXE_DATA_DIR_ROOT, type ChainCoordinates } from "./chain-coordinates"

/** The store key did not decrypt the existing store — a wrong/rotated per-profile key, NOT
 *  corruption and NOT absence. Fail-closed and distinct so callers never silently re-create. */
export class WrongStoreKeyError extends Error {
	public readonly isWrongStoreKey = true as const
}

/** Mirror of upstream `@aztec/pxe`'s non-exported `PXE_DATA_SCHEMA_VERSION` (drift-tested). */
export const PXE_DATA_SCHEMA_VERSION_PIN = 13

/** The database name inside each per-chain pool directory (mirrors upstream's default). */
const DB_NAME = "pxe_data"

const OPEN_TIMEOUT_MS = 30_000

/** A prior open for this chain-store dir timed out and its OPFS worker never
 *  released its exclusive SAH-pool lock — OR another open is concurrently in
 *  flight. Either way we refuse to start a SECOND worker (it would deadlock on
 *  that lock). Recoverable only by restarting the offscreen document, which
 *  tears the wedged worker down. Fail-closed + typed. */
export class ChainStoreWedgedError extends Error {
	public readonly isChainStoreWedged = true as const
	public constructor(dir: string) {
		super(
			`openChainStore: an open for ${dir} is already in flight or a prior one wedged (its OPFS worker never released its lock). Refusing to start a second worker — restart the offscreen document to recover.`,
		)
	}
}

/** Internal marker distinguishing a 30s init timeout from the open itself
 *  rejecting (e.g. a wrong store key). Not exported — callers see a plain Error. */
class ChainStoreOpenTimeoutError extends Error {}

type OpenState = "opening" | "abandoned" | "closing"
/**
 * B-07: at most ONE underlying `AztecSQLiteOPFSStore.open()` per chain-store dir
 * at a time. The open's worker cannot be cancelled (there is no handle until it
 * resolves, and no AbortSignal), so a timed-out open is QUARANTINED here rather
 * than abandoned: a same-chain retry fails fast (`ChainStoreWedgedError`)
 * instead of spawning a second worker that would deadlock on the first's
 * exclusive OPFS SAH-pool lock. The abandoned open, if it ever resolves, is
 * closed EXACTLY once and only THEN is the dir freed; a failed close keeps the
 * entry poisoned (only an offscreen restart clears it). Keyed by the persisted
 * `chainDataDir` (`(profileId, chainId)`, URL-independent) — the raw store open
 * is single-flighted, NOT the RPC-derived `initStoreVersionStamp` step.
 */
const inFlightOpens = new Map<string, { state: OpenState }>()

/** Free a dir's in-flight slot only if it still holds THIS entry (identity
 *  guard: an earlier open settling must not clear a later open's slot). */
function releaseOpenSlot(dir: string, entry: { state: OpenState }): void {
	if (inFlightOpens.get(dir) === entry) inFlightOpens.delete(dir)
}

export interface OpenChainStoreOptions {
	network: ChainCoordinates
	/** The chain's rollup address — a redeploy (rollupVersion change) wipes THIS store only. */
	rollupAddress: string | undefined
	/** 32-byte per-profile key. COPIED before open (upstream transfers the buffer to its worker). */
	storeKey: Uint8Array
	log: Logger
}

/** Open (or create) the encrypted per-(profile, chain) store, with the upstream init mirrored. */
export async function openChainStore({ network, rollupAddress, storeKey, log }: OpenChainStoreOptions): Promise<AztecSQLiteOPFSStore> {
	if (storeKey.length !== 32) {
		throw new Error(`openChainStore: storeKey must be 32 bytes (got ${storeKey.length})`)
	}
	const dir = chainDataDir(network)

	// B-07: refuse to start a second worker while any open for this dir is in
	// flight or quarantined. Service callers are already serialized by the chain
	// WRITE guard, but this function is exported — reject concurrent consumers
	// explicitly rather than relying on that contract.
	if (inFlightOpens.has(dir)) {
		throw new ChainStoreWedgedError(dir)
	}

	// Upstream TRANSFERS the key buffer to its worker (detaching it) — always hand over a copy so
	// the provisioned per-profile key survives for the next chain's open.
	const keyCopy = new Uint8Array(storeKey)
	// Bounded open: the store's worker protocol has NO timeout, and a worker that fails to load
	// its wasm hangs SILENTLY on init (no onerror) — which would wedge this open forever while
	// holding the chain guard, and transitively wedge profile deletion. 30s is generous for a
	// worker boot + wasm compile on any hardware; converting the silence into a loud error keeps
	// the failure fail-closed AND recoverable.
	const openPromise = AztecSQLiteOPFSStore.open(log, DB_NAME, false, dir, keyCopy)
	const entry: { state: OpenState } = { state: "opening" }
	inFlightOpens.set(dir, entry)

	let timer: ReturnType<typeof setTimeout> | undefined
	let store: AztecSQLiteOPFSStore
	try {
		store = await Promise.race([
			openPromise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new ChainStoreOpenTimeoutError(`openChainStore: sqlite worker did not answer init within 30s for ${dir}`)),
					OPEN_TIMEOUT_MS,
				)
			}),
		])
	} catch (err) {
		if (err instanceof ChainStoreOpenTimeoutError) {
			// The open may STILL resolve later with a live worker holding the
			// exclusive SAH-pool lock nothing else can release. QUARANTINE the dir
			// (leave the entry in the map) so a retry fails fast instead of spawning
			// a second contending worker. When/if the abandoned open settles, close
			// it EXACTLY once and only then free the dir; a failed close keeps the
			// entry poisoned — recoverable only by an offscreen restart.
			entry.state = "abandoned"
			void openPromise.then(
				(s) => {
					entry.state = "closing"
					void s.close().then(
						() => releaseOpenSlot(dir, entry),
						() => {
							// close failed → keep the poisoned entry; the worker still holds the lock.
						},
					)
				},
				() => releaseOpenSlot(dir, entry), // the abandoned open rejected late → its worker is gone; free the dir
			)
			throw err
		}
		// The open itself rejected (e.g. a wrong key) — upstream terminates its
		// worker, so free the dir immediately for a clean retry.
		releaseOpenSlot(dir, entry)
		// A wrong/rotated store key surfaces as upstream's SqliteEncryptionError — map it to a typed,
		// fail-closed error so callers never mistake it for corruption or an absent store.
		if (err instanceof SqliteEncryptionError) {
			throw new WrongStoreKeyError(`openChainStore: wrong store key for ${dir} (${err.message})`)
		}
		throw err
	} finally {
		clearTimeout(timer)
	}

	// Normal resolution: this caller owns the store — free the dir for the next open.
	releaseOpenSlot(dir, entry)
	try {
		// NOT single-flighted: `rollupAddress` is RPC-derived, so sharing this step
		// across callers could recreate the stale-URL hazard the runtime-level dedup
		// was removed to avoid (chain-runtime.ts).
		await initStoreVersionStamp(store, rollupAddress, log)
	} catch (err) {
		await store.close().catch(() => {})
		throw err
	}
	return store
}

/** A store whose on-disk stamp (schema version / rollup address) mismatches the current target. The
 *  caller must NOT wipe — the encrypted store holds user-owned state (added senders, registered
 *  contracts) whose backup is optional, and the mismatch's `rollupAddress` input is node-derived, so
 *  wiping on it would let a lying/misconfigured RPC loop-destroy local stores. Surface it instead. */
export class PxeStoreVersionMismatch extends Error {
	public readonly isPxeStoreVersionMismatch = true as const
}

/**
 * 5.0.1-aligned version guard for OUR injected store. Upstream 5.0.1 moved from wipe-on-mismatch to
 * REFUSE-and-preserve (`initStoreForRollupAndSchemaVersion` no longer clears), and two audit facts
 * (audit-{codex,fable}-r1, D-B2v3) confirmed the flip is right here: the store holds user state whose
 * backup is optional, and the rollupAddress input is node-derived (a lying RPC could wipe-loop). So
 * on a schema/rollup/parse mismatch we THROW `PxeStoreVersionMismatch` (the caller closes the store
 * and fails chain-init; pre-production remediation = profile purge) — NEVER `store.clear()`.
 */
export async function initStoreVersionStamp(store: AztecSQLiteOPFSStore, rollupAddress: string | undefined, log: Logger): Promise<void> {
	const target = new DatabaseVersion(PXE_DATA_SCHEMA_VERSION_PIN, rollupAddress ? EthAddress.fromString(rollupAddress) : EthAddress.ZERO)
	const dbVersion = store.openSingleton<string>("dbVersion")
	const stored = await dbVersion.getAsync()
	if (stored) {
		let mismatch: string | undefined
		try {
			const storedVersion = DatabaseVersion.fromBuffer(Buffer.from(stored, "utf-8"))
			const cmp = storedVersion.cmp(target)
			if (cmp === undefined) {
				mismatch = `rollup address changed (stored ${storedVersion.rollupAddress.toString()} != current ${target.rollupAddress.toString()})`
			} else if (cmp !== 0) {
				mismatch = `schema version changed (stored ${storedVersion.schemaVersion} != current ${PXE_DATA_SCHEMA_VERSION_PIN})`
			}
		} catch (err) {
			mismatch = `stamp failed to parse (${err instanceof Error ? err.message : String(err)})`
		}
		if (mismatch) {
			// REFUSE, do not wipe (D-B2v3). The store's bytes are preserved for the operator.
			log.warn("PXE store version mismatch — refusing to open (preserving data)", { detail: mismatch })
			throw new PxeStoreVersionMismatch(`PXE store version mismatch — refusing to open (preserving data): ${mismatch}`)
		}
	}
	await dbVersion.set(target.toBuffer().toString("utf-8"))
}

/** The OPFS root directory name holding every per-chain pool dir ("pxe"). */
const OPFS_ROOT = PXE_DATA_DIR_ROOT.replace(/\/$/, "")

async function opfsRoot(): Promise<FileSystemDirectoryHandle | undefined> {
	// Capability guard: OPFS exists only in browser contexts (the offscreen document). Under
	// node-env unit tests (and any non-OPFS host) the API is simply ABSENT → empty registry.
	if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return undefined
	// A rejecting `getDirectory()` (API present but denied — e.g. a SecurityError) is NOT absence,
	// so it propagates. `getOrCreate` is intentionally not used: absence of the pxe root is the
	// only benign case, and it surfaces below as NotFoundError.
	const top = await navigator.storage.getDirectory()
	try {
		return await top.getDirectoryHandle(OPFS_ROOT)
	} catch (err) {
		// The ONLY swallowed case is "the pxe root dir doesn't exist yet" — a legitimately empty
		// registry (no store ever created). EVERY other failure (SecurityError, quota, corruption)
		// is REAL and MUST propagate: masking it as "no stores" would let a purge falsely report
		// success or an enumerate silently miss live stores (D-audit: opfsRoot narrowing).
		if ((err as DOMException)?.name === "NotFoundError") return undefined
		throw err
	}
}

/**
 * Enumerate every persisted chain-store coordinate from the OPFS tree itself (`pxe/<profileId>/
 * <chainId>`). This IS the store registry: independently derivable with NO live runtime, so
 * orphan cleanup and purge-without-boot never depend on in-memory state.
 */
export async function listChainStoreDirs(): Promise<ChainCoordinates[]> {
	const root = await opfsRoot()
	if (!root) return []
	const out: ChainCoordinates[] = []
	for await (const [profileId, profileHandle] of root.entries()) {
		if (profileHandle.kind !== "directory") continue
		for await (const [chainName, chainHandle] of (profileHandle as FileSystemDirectoryHandle).entries()) {
			if (chainHandle.kind !== "directory") continue
			const chainId = Number(chainName)
			if (Number.isFinite(chainId)) out.push({ profileId, chainId })
		}
	}
	return out
}

/** Remove one chain's OPFS pool directory. Works with NO live runtime. Idempotent.
 *
 *  Deliberately leaves the profile dir in place even when this was its last chain:
 *  the old "drop the profile dir once empty" sweep TOCTOU-raced a concurrent
 *  sibling-chain open on the SAME live profile — the emptiness probe passed, the
 *  sibling created its dir, and the recursive profile removal deleted the brand-new
 *  sibling store (or tripped over its SAH lock). Profile dirs are removed ONLY by
 *  `removeProfileStoreDirs`, whose callers hold a positive profile-absence or
 *  profile-write guarantee, so no sibling open can race them. An empty profile dir
 *  is inert: `listChainStoreDirs` yields nothing for it. */
export async function removeChainStoreDir({ profileId, chainId }: ChainCoordinates): Promise<void> {
	const root = await opfsRoot()
	if (!root) return
	try {
		const profileHandle = await root.getDirectoryHandle(profileId)
		await profileHandle.removeEntry(String(chainId), { recursive: true })
	} catch (err) {
		if ((err as DOMException)?.name === "NotFoundError") return
		throw err
	}
}

/** Remove EVERY chain store belonging to `profileId`. Works with NO live runtime. Idempotent. */
export async function removeProfileStoreDirs(profileId: string): Promise<void> {
	const root = await opfsRoot()
	if (!root) return
	try {
		await root.removeEntry(profileId, { recursive: true })
	} catch (err) {
		if ((err as DOMException)?.name === "NotFoundError") return
		throw err
	}
}
