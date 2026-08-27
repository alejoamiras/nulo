/**
 * Pure helpers for import.vue / useFullBackupImport.
 * No vue, no chrome.*, no service clients — safe to import anywhere.
 */

import { EncryptionKey } from "@nulo/wallet-crypto"
import { fromBase64 } from "@/wallet/utils"
import { scrubUrls } from "@/utils/scrub-urls"
import { CONFIG_SERVICE_NAME, type ConfigKey, RESTORABLE_CONFIG_KEYS } from "@/wallet/services/config/spec"
import { ACCOUNT_SERVICE_NAME, IMPORTED_KEYS_SERVICE_NAME } from "@/wallet/services/account/spec"
import { AUTH_REGISTRY_SERVICE_NAME } from "@/wallet/services/auth-registry/spec"
import { CONTACT_SERVICE_NAME } from "@/wallet/services/contact/spec"
import { FPC_SERVICE_NAME } from "@/wallet/services/fpc/spec"
import { NETWORK_SERVICE_NAME } from "@/wallet/services/network/spec"
import { TOKEN_BALANCE_SERVICE_NAME } from "@/wallet/services/token-balance/spec"
import { TOKEN_SERVICE_NAME } from "@/wallet/services/token/spec"
import { TRANSACTION_SERVICE_NAME } from "@/wallet/services/transaction/spec"

/**
 * One shared ceiling for backup files, enforced on BOTH sides: the import
 * path refuses larger files before reading them, and the export path refuses
 * to produce a larger artifact — the same constant on both sides is what
 * guarantees an exported backup can never be rejected by its own importer.
 *
 * Calibration: a FRESH test wallet's encrypted artifact measures ~22.4 MiB
 * (base64 ciphertext, dominated by the account-state slice), so 64 MiB gives
 * ~3x growth headroom while still bounding a decompression bomb to a finite
 * inflation. Import-side parse amplification of a worst-case file is
 * ESTIMATED (not proven) at 2-4x transient. Revisit with real-user telemetry.
 */
export const MAX_BACKUP_FILE_BYTES = 64 * 1024 * 1024

export type BackupFileType = "plain" | "encrypted" | "unknown"

export interface BackupSelection {
	name: string
	backup: unknown
	type: BackupFileType
	profileType: string | null
}

export function detectBackupType(text: string): BackupFileType {
	const trimmed = text.trim()
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "plain"
	try {
		const bytes = fromBase64(trimmed)
		if (bytes.length >= 13 && bytes[0] === 0) return "encrypted"
	} catch {
		return "unknown"
	}
	return "unknown"
}

export interface ProcessBackupResult {
	selection: BackupSelection
	parseError?: { title: string; tooltip: string }
}

export async function readBackupFile(file: File): Promise<ProcessBackupResult> {
	// Byte-level bound BEFORE reading — text().length counts UTF-16 code
	// units, so a heavily multi-byte file could otherwise exceed the
	// advertised ceiling before any later check sees it. Belt over the
	// pickFile-side cap: this helper must hold its own even for callers that
	// hand it an arbitrary File.
	if (file.size > MAX_BACKUP_FILE_BYTES) {
		return {
			selection: { name: file.name, backup: null, type: "unknown", profileType: null },
			parseError: {
				title: "Backup File Too Large",
				tooltip: "The backup file is too large to import. Please select a correct backup file.",
			},
		}
	}
	const text = await file.text()
	const detectedType = detectBackupType(text)
	let backup: unknown = null
	let profileType: string | null = null
	let parseError: ProcessBackupResult["parseError"] | undefined

	if (detectedType === "plain") {
		try {
			backup = JSON.parse(text)
			profileType = (backup as { data?: { profile?: { type?: string } } })?.data?.profile?.type ?? null
		} catch {
			parseError = {
				title: "Invalid JSON Format",
				tooltip: "The selected file is not a valid JSON backup. Please select a correct backup file.",
			}
		}
	} else {
		backup = text
	}

	return {
		selection: { name: file.name, backup, type: detectedType, profileType },
		parseError,
	}
}

/** A backup-slice producer: the service's own name constant plus its backup call. */
export type BackupSource = { name: string; backup: () => Promise<unknown> }

/** Thrown when the caller's `onSlice` probe reports the run is no longer current. */
export class AssemblyAbortedError extends Error {
	constructor() {
		super("Backup assembly aborted")
		this.name = "AssemblyAbortedError"
	}
}

export interface AssembledBackup {
	compact: string
	pretty: string
	checksum: string
}

/**
 * Assembles a full-backup artifact from an envelope and slice sources, sealed
 * from ONE serialization: the checksum hashes exactly `JSON.stringify(draft)`
 * with `checksum` the only absent key, and both output strings derive from a
 * parse of those same bytes — so caller-side mutation of the envelope or slice
 * object graphs after the awaits cannot skew the artifact, and the import
 * side's strip-checksum → compact-restringify recompute reproduces the hashed
 * string exactly (key insertion order survives parse → stringify).
 *
 * `onSlice` is a currency probe: consulted before every slice and before
 * sealing; returning false aborts with `AssemblyAbortedError`.
 */
export async function assembleFullBackup(
	envelope: Record<string, unknown>,
	sources: BackupSource[],
	onSlice?: () => boolean,
): Promise<AssembledBackup> {
	if ("checksum" in envelope) throw new Error("Backup envelope must not carry a checksum")
	const data: Record<string, unknown> = {}
	const draft: Record<string, unknown> = { ...envelope, data }
	for (const { name, backup } of sources) {
		if (onSlice && !onSlice()) throw new AssemblyAbortedError()
		const slice = await backup()
		if (slice === null || slice === undefined) continue
		data[name] = slice
	}
	if (onSlice && !onSlice()) throw new AssemblyAbortedError()
	const unsigned = JSON.stringify(draft)
	const checksum = await EncryptionKey.getHashHex(unsigned)
	// Re-probe after the hash await too: the parse + two stringifies below are
	// the most expensive steps at large sizes — don't spend them for an
	// abandoned run.
	if (onSlice && !onSlice()) throw new AssemblyAbortedError()
	const sealed = JSON.parse(unsigned) as Record<string, unknown>
	sealed.checksum = checksum
	return { compact: JSON.stringify(sealed), pretty: JSON.stringify(sealed, null, 2), checksum }
}

interface AccountStateRestoreItem {
	// `unknown`, not `string`: this is attacker-controlled slice content, and typing it as a string
	// was what let the item level skip the sanitizing its children already got.
	networkId: unknown
	contracts: Array<{ restoreError?: unknown } & Record<string, unknown>>
	senders: Array<{ restoreError?: unknown } & Record<string, unknown>>
}

interface GenericRestoreItem {
	restoreError?: unknown
}

/**
 * Fields that identify WHICH row failed without describing what it held.
 *
 * Deliberately excludes `address` and `name`: the generic branch covers contacts (a counterparty
 * address and a user-chosen label), network endpoints (`rpcUrl`, which routinely carries a
 * provider API key) and imported keys (`encryptedSigningKey`). The row id is what a developer
 * needs to find the row again; the rest is what leaks.
 *
 * Each field carries its EXPECTED TYPE, and `key` is scoped to the one service it means anything
 * for. A name-and-length allowlist is not enough on its own: `restoreRows` preserves the raw failed
 * row, so a crafted token row can ship `chainId: "SECRET"` or `key: "SECRET"` — short strings that
 * pass a length check while being neither a chain id nor a config key.
 */
type RestoreErrorField = { name: string; kind: "identifier" | "number" | "configKey" }

const ID: RestoreErrorField = { name: "id", kind: "identifier" }
const PROFILE_ID: RestoreErrorField = { name: "profileId", kind: "identifier" }
const NETWORK_ID: RestoreErrorField = { name: "networkId", kind: "identifier" }
/** Chain ids are numeric everywhere in this codebase; a string one is not a chain id. */
const CHAIN_ID: RestoreErrorField = { name: "chainId", kind: "number" }
/** Only meaningful for config rows, and only when it is genuinely a restorable key. */
const CONFIG_KEY: RestoreErrorField = { name: "key", kind: "configKey" }

/**
 * Which fields each service may emit — declared PER SERVICE, not globally.
 *
 * A shared field list is still a name allowlist: `restoreRows` returns the raw failed row, and
 * backup migration preserves unknown properties, so a crafted `token` row can carry a
 * `networkId` — a field a token does not have — and a global list emits it. Naming the fields a
 * given row type actually has is what closes that.
 *
 * Fail-closed: a service absent from this map emits nothing but its ordinal and error.
 */
const RESTORE_ERROR_FIELDS_BY_SERVICE: Readonly<Record<string, ReadonlyArray<RestoreErrorField>>> = {
	[NETWORK_SERVICE_NAME]: [ID, PROFILE_ID, CHAIN_ID],
	// Accounts and imported keys are keyed by address and carry no `id`.
	[ACCOUNT_SERVICE_NAME]: [PROFILE_ID, CHAIN_ID],
	[IMPORTED_KEYS_SERVICE_NAME]: [PROFILE_ID, CHAIN_ID],
	[TOKEN_SERVICE_NAME]: [ID, PROFILE_ID, CHAIN_ID],
	[TOKEN_BALANCE_SERVICE_NAME]: [ID],
	// A Tx is keyed by hash, which is a private-activity link — the ordinal locates it instead.
	[TRANSACTION_SERVICE_NAME]: [PROFILE_ID, NETWORK_ID, CHAIN_ID],
	[AUTH_REGISTRY_SERVICE_NAME]: [ID],
	[FPC_SERVICE_NAME]: [ID, PROFILE_ID, CHAIN_ID],
	[CONTACT_SERVICE_NAME]: [ID, PROFILE_ID],
	[CONFIG_SERVICE_NAME]: [CONFIG_KEY],
}

/**
 * Upper bound on recorded failures. Nothing else bounds this: the viewer renders the whole log
 * and offers to copy it, and a hostile backup can carry tens of thousands of malformed rows.
 */
const MAX_RECORDED_RESTORE_ERRORS = 200

/** Longest allowlisted identifier kept verbatim. Real ids are far shorter; anything longer is a
 *  payload wearing an id's name. */
const MAX_ID_CHARS = 64

/** Longest `restoreError` kept. Matches the account-state normalizer's own cap. */
const MAX_RESTORE_ERROR_CHARS = 200

/**
 * An allowlisted field, constrained by TYPE as well as name.
 *
 * Allowlisting names alone is not enough against a crafted backup: nothing stops it from shipping
 * `chainId: { rpcUrl: "https://…/SECRET" }`, and a name-only filter copies that object through
 * intact. Only bounded scalars survive; anything else is reduced to its type.
 */
function boundedScalar(value: unknown): unknown {
	if (typeof value === "number") return Number.isFinite(value) ? value : "[number]"
	if (typeof value === "boolean") return value
	if (typeof value !== "string") return `[${typeof value}]`
	return value.length <= MAX_ID_CHARS ? value : `[string:${value.length}]`
}

/**
 * The failure text, scrubbed and bounded.
 *
 * `restoreError` is a runtime message, not backup content — but a fetch failure interpolates the
 * whole credential-bearing endpoint URL into it, so it is neither trusted nor unbounded.
 */
function describeRestoreError(value: unknown): unknown {
	if (typeof value !== "string") return `[${typeof value}]`
	const scrubbed = scrubUrls(value)
	return scrubbed.length > MAX_RESTORE_ERROR_CHARS ? `${scrubbed.slice(0, MAX_RESTORE_ERROR_CHARS - 1)}…` : scrubbed
}

/**
 * Keep the identifying fields and the error; drop the row's payload.
 *
 * The ordinal is what makes this diagnosable at all: accounts and imported keys carry no `id`,
 * transactions are keyed by `hash` and config by `key`, none of which are kept — so without a
 * position two failures in the same slice would be indistinguishable.
 */
function projectRestoreErrorRow(row: Record<string, unknown>, index: number, serviceName: string): Record<string, unknown> {
	const out: Record<string, unknown> = { row: index }
	for (const field of RESTORE_ERROR_FIELDS_BY_SERVICE[serviceName] ?? []) {
		const value = row[field.name]
		if (value === undefined) continue
		if (field.kind === "number") {
			// A string here is not a chain id, whatever it claims to be.
			if (typeof value === "number" && Number.isFinite(value)) out[field.name] = value
			continue
		}
		if (field.kind === "configKey") {
			// Safe by construction, not by filtering — but only for the service whose restore path
			// actually enforces that construction, and only for a value that really is in the set.
			if (serviceName === CONFIG_SERVICE_NAME && typeof value === "string" && RESTORABLE_CONFIG_KEYS.has(value as ConfigKey)) {
				out[field.name] = value
			}
			continue
		}
		out[field.name] = boundedScalar(value)
	}
	out.restoreError = describeRestoreError(row.restoreError)
	return out
}

/**
 * account-state children are identified by POSITION, not address.
 *
 * The addresses here are registered contracts and tagging senders — the service's own code calls
 * the set of contracts a wallet has registered a privacy signal, and senders are address-book
 * data behind a capability gate. The ordinal says which child failed without naming it; the
 * `instance`/`artifact` blobs beside it are dropped as the bulk.
 */
function projectAccountStateChild(child: Record<string, unknown>, index: number): Record<string, unknown> {
	return { child: index, restoreError: describeRestoreError(child.restoreError) }
}

/** Project the failed entries of a child array, numbering them by SOURCE position. */
function projectFailedChildren(children: unknown): Array<Record<string, unknown>> {
	// Presence-guarded: the result shape is built from an attacker-controlled slice.
	if (!Array.isArray(children)) return []
	return children
		.map((child, index) => ({ child, index }))
		.filter(({ child }) => (child as { restoreError?: unknown } | null)?.restoreError)
		.map(({ child, index }) => projectAccountStateChild(child as Record<string, unknown>, index))
}

/** Trim to the cap, replacing the tail with one constant marker rather than silently dropping. */
function capRecords(records: unknown[]): unknown[] {
	if (records.length <= MAX_RECORDED_RESTORE_ERRORS) return records
	return [
		...records.slice(0, MAX_RECORDED_RESTORE_ERRORS),
		{ restoreError: `${records.length - MAX_RECORDED_RESTORE_ERRORS} further error(s) not recorded` },
	]
}

/**
 * Filter restored data for items with `restoreError`. Returns `null` when
 * there are no errors to record (caller should skip writing to log).
 *
 * Every returned row is REBUILT from an allowlist rather than filtered: these records reach the
 * "View Errors" viewer (which offers a one-click copy of the whole log) and a `console.warn`,
 * which the hijacked console feeds into the log store. Passing rows through whole put
 * `encryptedSigningKey`, `rpcUrl` and contact PII on both paths.
 */
export function collectRestoreErrors(serviceName: string, data: unknown): unknown[] | null {
	if (!Array.isArray(data) || !data.length || !serviceName) return null
	if (serviceName === "account-state") {
		const out: Array<AccountStateRestoreItem & { restoreError?: unknown }> = []
		let malformedItems = 0
		for (const item of data as Array<AccountStateRestoreItem & { restoreError?: unknown }>) {
			// A non-object result entry (hostile/degenerate restore output) must
			// not throw post-finalize — collapse into ONE constant record below.
			if (typeof item !== "object" || item === null) {
				malformedItems++
				continue
			}
			// Presence-guard the child arrays: the result shape is built from an
			// attacker-controlled slice, and this collector runs post-finalize
			// where a throw would strand the import on a false "Import failed".
			// The ordinal is captured BEFORE filtering, so it points at the child's position in the
			// SOURCE array. Numbering after the filter would just re-derive the error array's own
			// index — information the array already carries, and useless for locating the row.
			const failedContracts = projectFailedChildren(item.contracts)
			const failedSenders = projectFailedChildren(item.senders)
			// ITEM-LEVEL errors (whole-network skips, deadline notes, normalizer
			// violations) count too — a top-level restoreError with clean child
			// arrays used to vanish here, letting a skipped registration
			// auto-route past the Continue gate.
			if (!failedContracts.length && !failedSenders.length && !item.restoreError) continue
			out.push({
				// Sanitized like every other field: `networkId` comes from the same attacker-controlled
				// slice, and the normalizer admits ids up to 100 chars that then reach "Network not
				// found" — so the item level is not a trusted layer above its children.
				networkId: boundedScalar(item.networkId),
				contracts: failedContracts,
				senders: failedSenders,
				...(item.restoreError !== undefined ? { restoreError: describeRestoreError(item.restoreError) } : {}),
			})
		}
		if (malformedItems > 0) {
			out.push({ networkId: "(result)", contracts: [], senders: [], restoreError: "malformed account-state restore result" })
		}
		return out.length ? capRecords(out) : null
	}
	// Index BEFORE filtering — see the account-state branch above for why.
	const filtered = (data as GenericRestoreItem[])
		.map((item, index) => ({ item, index }))
		.filter(({ item }) => item?.restoreError)
		.map(({ item, index }) => projectRestoreErrorRow(item as Record<string, unknown>, index, serviceName))
	return filtered.length ? capRecords(filtered) : null
}

/**
 * Rewrite `*.{idKey}` references inside `backup.data` to `newId`, after
 * profile/network restore returns a different id than the source backup.
 *
 * `oldId` SCOPES the rewrite: only rows whose `idKey` currently equals `oldId`
 * are rewritten (required when a key is multi-valued across the backup —
 * `networkId`, where each of N networks maps to its OWN new id; an all-rows
 * rewrite would graft every child onto the LAST network). Omit `oldId` for a
 * single-valued key (`profileId` — exactly one profile per backup): all rows
 * are rewritten, which also NORMALIZES any hostile row whose `profileId` ≠ the
 * real one, so a crafted backup cannot smuggle a foreign owner.
 */
/**
 * Rewrite EVERY row's `idKey` to `newId`, ignoring its current value. For a
 * single-valued key like `profileId`: a full backup is exactly one profile's
 * data, so every child row must bind to the created profile — this normalizes
 * any hostile foreign `profileId` a crafted backup smuggled onto a child row.
 */
export function normalizeAllIds(data: Record<string, unknown>, idKey: string, newId: string): void {
	for (const key of Object.keys(data)) {
		const value = data[key]
		if (!Array.isArray(value)) continue
		data[key] = value.map((item) =>
			item && typeof item === "object" && idKey in item ? { ...(item as Record<string, unknown>), [idKey]: newId } : item,
		)
	}
}

/**
 * Rewrite each row's `idKey` via `oldToNew`, looking up each row's ORIGINAL value
 * exactly once in a single pass. This is REQUIRED (over sequential per-id remaps)
 * to avoid cascade-aliasing: a per-id `A→R` pass followed by an `R→S` pass would
 * rewrite the already-remapped `A→R` rows a second time when it processes a later
 * source id that equals the freshly-random `R`. Building the complete map first
 * and looking up the original value guarantees one rewrite per row.
 */
export function remapByMap(data: Record<string, unknown>, idKey: string, oldToNew: Map<string, string>): void {
	if (oldToNew.size === 0) return
	for (const key of Object.keys(data)) {
		const value = data[key]
		if (!Array.isArray(value)) continue
		data[key] = value.map((item) => {
			if (item && typeof item === "object" && idKey in item) {
				const cur = (item as Record<string, unknown>)[idKey]
				const next = typeof cur === "string" ? oldToNew.get(cur) : undefined
				if (next !== undefined) return { ...(item as Record<string, unknown>), [idKey]: next }
			}
			return item
		})
	}
}

/**
 * Resolve a backup's exported active-network id (a RAW old network id) to the restored NEW network
 * id, for item 1b (preserve the user's active-network selection across import).
 *
 * Uses a COMPLETE source→successful-result pairing by RESULT INDEX — including IDENTITY mappings for
 * networks whose id didn't change (the `remapByMap` `oldToNew` map above deliberately SKIPS those,
 * so it can't be reused here). Attacker-safe by construction: the exported id must pair, by index,
 * with a network that RESTORED SUCCESSFULLY and whose source id isn't duplicated; anything absent,
 * non-string, failed, duplicated, or unmatched returns `undefined`, and the caller then leaves the
 * active pointer unset so the bootstrap primary fallback applies. NEVER a global-by-value lookup.
 */
export function resolveRestoredActiveNetworkId(
	exportedActiveId: unknown,
	newNetworks: ReadonlyArray<{ id: string; restoreError?: unknown }>,
	oldNetworks: ReadonlyArray<{ id: string }>,
): string | undefined {
	if (typeof exportedActiveId !== "string") return undefined
	const sourceIdCounts = new Map<string, number>()
	for (const n of oldNetworks) sourceIdCounts.set(n.id, (sourceIdCounts.get(n.id) ?? 0) + 1)
	const complete = new Map<string, string>()
	for (let i = 0; i < newNetworks.length; i++) {
		const restored = newNetworks[i]
		const old = oldNetworks[i]
		if (!restored || restored.restoreError || !old || (sourceIdCounts.get(old.id) ?? 0) > 1) continue
		complete.set(old.id, restored.id)
	}
	return complete.get(exportedActiveId)
}
