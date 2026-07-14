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
 * Version/rollup hygiene: upstream's `initStoreForRollupAndSchemaVersion` (which the default path
 * runs and injection bypasses) is mirrored here VERBATIM against the same singleton key, so a PXE
 * schema bump or a rollup redeploy wipes exactly the affected store — upstream's own reset
 * semantics, correctly scoped. `PXE_DATA_SCHEMA_VERSION_PIN` mirrors upstream's non-exported
 * constant; `opfs-store.test.ts` asserts it against the installed package so a silent upstream
 * bump fails the build instead of stranding stores on a stale stamp.
 */
import type { Logger } from "@aztec/foundation/log"
import { EthAddress } from "@aztec/foundation/eth-address"
import { AztecSQLiteOPFSStore } from "@aztec/kv-store/sqlite-opfs"
import { DatabaseVersion } from "@aztec/stdlib/database-version/version"
import { chainDataDir, PXE_DATA_DIR_ROOT, type ChainCoordinates } from "./chain-coordinates"

/** Mirror of upstream `@aztec/pxe`'s non-exported `PXE_DATA_SCHEMA_VERSION` (drift-tested). */
export const PXE_DATA_SCHEMA_VERSION_PIN = 13

/** The database name inside each per-chain pool directory (mirrors upstream's default). */
const DB_NAME = "pxe_data"

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
	// Upstream TRANSFERS the key buffer to its worker (detaching it) — always hand over a copy so
	// the provisioned per-profile key survives for the next chain's open.
	const keyCopy = new Uint8Array(storeKey)
	const store = await AztecSQLiteOPFSStore.open(log, DB_NAME, false, chainDataDir(network), keyCopy)
	try {
		await initStoreVersionStamp(store, rollupAddress, log)
	} catch (err) {
		await store.close().catch(() => {})
		throw err
	}
	return store
}

/**
 * Verbatim mirror of upstream `initStoreForRollupAndSchemaVersion` (not exported from
 * `@aztec/kv-store`'s public surface): clears the store when the schema version or rollup address
 * differs from the stamp, then (re)stamps. Same `dbVersion` singleton key as upstream.
 */
async function initStoreVersionStamp(store: AztecSQLiteOPFSStore, rollupAddress: string | undefined, log: Logger): Promise<void> {
	const target = new DatabaseVersion(PXE_DATA_SCHEMA_VERSION_PIN, rollupAddress ? EthAddress.fromString(rollupAddress) : EthAddress.ZERO)
	const dbVersion = store.openSingleton<string>("dbVersion")
	const stored = await dbVersion.getAsync()
	if (stored) {
		let needsClear = false
		try {
			const storedVersion = DatabaseVersion.fromBuffer(Buffer.from(stored, "utf-8"))
			const cmp = storedVersion.cmp(target)
			if (cmp === undefined) {
				log.warn("PXE store rollup address changed, clearing this chain's database", {
					stored: storedVersion.rollupAddress.toString(),
					current: target.rollupAddress.toString(),
				})
				needsClear = true
			} else if (cmp !== 0) {
				log.warn("PXE store schema version changed, clearing this chain's database", {
					stored: storedVersion.schemaVersion,
					current: PXE_DATA_SCHEMA_VERSION_PIN,
				})
				needsClear = true
			}
		} catch (err) {
			log.warn("Failed to parse the PXE store version stamp, clearing this chain's database", { err })
			needsClear = true
		}
		if (needsClear) await store.clear()
	}
	await dbVersion.set(target.toBuffer().toString("utf-8"))
}

/** The OPFS root directory name holding every per-chain pool dir ("pxe"). */
const OPFS_ROOT = PXE_DATA_DIR_ROOT.replace(/\/$/, "")

async function opfsRoot(): Promise<FileSystemDirectoryHandle | undefined> {
	// Capability guard: OPFS exists only in browser contexts (the offscreen document). Under
	// node-env unit tests (and any non-OPFS host) the registry is simply empty.
	if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return undefined
	const top = await navigator.storage.getDirectory()
	try {
		return await top.getDirectoryHandle(OPFS_ROOT)
	} catch {
		return undefined
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

/** Remove one chain's OPFS pool directory. Works with NO live runtime. Idempotent. */
export async function removeChainStoreDir({ profileId, chainId }: ChainCoordinates): Promise<void> {
	const root = await opfsRoot()
	if (!root) return
	try {
		const profileHandle = await root.getDirectoryHandle(profileId)
		await profileHandle.removeEntry(String(chainId), { recursive: true })
		// Drop the profile dir too once its last chain is gone (keeps the registry clean).
		let empty = true
		for await (const _ of profileHandle.keys()) {
			empty = false
			break
		}
		if (empty) await root.removeEntry(profileId, { recursive: true })
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
