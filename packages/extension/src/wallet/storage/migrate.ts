/**
 * Pre-release storage migration.
 *
 * Bump CURRENT_VERSION whenever the on-disk shape changes. This wallet has
 * no production users, so the migration is a destructive wipe of the
 * affected subtree — `getOrInitNetworks()` (and friends) reseeds defaults
 * on next access.
 *
 * v2 (post-upstream-SchnorrAccount) wiped legacy account addressing.
 * v3 (M4.10 network rework) wipes networks + UI active pointers + journal
 *   so the new nested-aggregate Network shape can re-seed cleanly.
 * v4 (FPC cleanup) drops the deprecated DefaultFpc/Token-FPC enum slot,
 *   removes acceptsPrivate/acceptsPublic/asset from the FpcInfo schema,
 *   and switches `isProtocol` to a runtime-derived flag. Wipes the FPC
 *   storage so the auto-discovery seeds the new schema cleanly, and
 *   wipes the saved per-account fee method so a dangling fpc id from a
 *   pre-v4 selection can't resolve to a stale handler.
 * v5 (PR-10 / AUDIT A12) wipes dApp sessions: schema gained a top-level
 *   `chainId` field so sessions are per-`(origin, chainId, profileId)`
 *   instead of multi-chain via `permissions[].chains[]`. Old sessions
 *   without `chainId` would silently auto-approve cross-network — wipe
 *   them and force re-approval on next dApp connection. Bumped past v4
 *   (rather than re-using it) so anyone who tested the feat/p1-p3 branch
 *   pre-merge gets the FPC wipe applied too on next unlock.
 * v6 (Phase 2 — durable jobs) rewrites `OperationRecord`: 7-stage FSM
 *   replaces the 5-state union, adds carry fields (`origin`, `profileId`,
 *   `terminalAt`, `attempts`), splits `state` into `progress` + `error`.
 *   Existing journal records cannot be migrated — discriminator name and
 *   shape both change. The `nulo:journal@` session wipe (already in this
 *   list since v3) handles it. No production users; clean break.
 * v7 (Phase 2 follow-up v4) adds `amountRaw` + `recipientAddress` to
 *   `OperationRecord` for transfer ops. The fields are optional, so a
 *   v6 record would parse fine — BUT a pre-v7 transfer terminal card
 *   would silently render `0 USDC` via `balanceFormatted(undefined, …)`
 *   which returns "0" (codex audit catch). Wipe to avoid the fake
 *   "0 USDC" ghost. Reuses the existing `nulo:journal@` session-wipe path.
 */
const STORAGE_VERSION_KEY = "nulo:core:storage-version"
const CURRENT_VERSION = 7

const KEYS_TO_WIPE = [
	"nulo:core:accounts",
	"nulo:core:txs",
	"nulo:core:tx-cursors",
	"nulo:core:token-balances",
	"nulo:ui:activeNetwork",
	"nulo:ui:feePaymentMethods",
]

/** Prefix-matched local keys to wipe (entity-storage rows + per-profile UI). */
const KEY_PREFIXES_TO_WIPE_LOCAL = [
	"nulo:core:networks@",
	"nulo:ui:lastActiveNetwork@",
	"nulo:ui:balanceDisplayOption@",
	"nulo:core:active-network@",
	// v4: FPC schema cleanup (dropped Token-FPC enum slot, runtime-derived isProtocol).
	"nulo:core:fpcs@",
	// v5: dApp sessions. EntityStorage rows live under
	// `nulo:core:dappSessions@<id>` so prefix-match wipes every record.
	"nulo:core:dappSessions@",
	// Index entry (the `getValues` namespace probe). Wiping the prefix
	// covers it too — listed explicitly for clarity.
	"nulo:core:dappSessions",
]

/** Prefix-matched session-storage keys to wipe (journal entries reference networkIds). */
const KEY_PREFIXES_TO_WIPE_SESSION = ["nulo:journal@"]

const INDEXEDDB_WIPE_PREFIXES = ["pxe/"]
const INDEXEDDB_WIPE_NAMES = ["keyval-store"]

async function deleteDb(name: string): Promise<void> {
	return new Promise<void>((resolve) => {
		const req = indexedDB.deleteDatabase(name)
		req.onsuccess = () => resolve()
		req.onerror = () => resolve()
		req.onblocked = () => resolve()
	})
}

export async function runStorageMigration(log: (msg: string) => void): Promise<void> {
	const result = await chrome.storage.local.get(STORAGE_VERSION_KEY)
	const version = result[STORAGE_VERSION_KEY] as number | undefined
	if (version === CURRENT_VERSION) {
		return
	}
	log(`Storage version ${version ?? "(none)"} → ${CURRENT_VERSION}; wiping legacy state + PXE DBs.`)

	// Direct keys
	await chrome.storage.local.remove(KEYS_TO_WIPE)

	// Prefix-matched keys (per-profile or per-id rows)
	const allLocal = await chrome.storage.local.get(undefined)
	const prefixMatchesLocal = Object.keys(allLocal).filter((k) => KEY_PREFIXES_TO_WIPE_LOCAL.some((p) => k.startsWith(p)))
	if (prefixMatchesLocal.length) {
		await chrome.storage.local.remove(prefixMatchesLocal)
	}

	// Session storage (journal records carry stale networkIds)
	try {
		const allSession = await chrome.storage.session.get(undefined)
		const prefixMatchesSession = Object.keys(allSession).filter((k) => KEY_PREFIXES_TO_WIPE_SESSION.some((p) => k.startsWith(p)))
		if (prefixMatchesSession.length) {
			await chrome.storage.session.remove(prefixMatchesSession)
		}
	} catch (err) {
		log(`Session storage wipe skipped: ${String(err)}`)
	}

	try {
		const dbs = await indexedDB.databases()
		for (const db of dbs) {
			if (!db.name) continue
			const shouldWipe = INDEXEDDB_WIPE_NAMES.includes(db.name) || INDEXEDDB_WIPE_PREFIXES.some((p) => db.name!.startsWith(p))
			if (shouldWipe) {
				await deleteDb(db.name)
			}
		}
	} catch (err) {
		log(`IndexedDB wipe skipped: ${String(err)}`)
	}

	await chrome.storage.local.set({ [STORAGE_VERSION_KEY]: CURRENT_VERSION })
	log("Storage migration complete.")
}
