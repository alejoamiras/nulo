/**
 * Pure helpers for import.vue / useFullBackupImport.
 * No vue, no chrome.*, no service clients — safe to import anywhere.
 */

import { EncryptionKey } from "@nulo/wallet-crypto"
import { fromBase64 } from "@/wallet/utils"

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
	networkId: string
	contracts: Array<{ restoreError?: unknown } & Record<string, unknown>>
	senders: Array<{ restoreError?: unknown } & Record<string, unknown>>
}

interface GenericRestoreItem {
	restoreError?: unknown
}

/**
 * Filter restored data for items with `restoreError`. Returns `null` when
 * there are no errors to record (caller should skip writing to log).
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
			const failedContracts = (Array.isArray(item.contracts) ? item.contracts : []).filter((c) => c?.restoreError)
			const failedSenders = (Array.isArray(item.senders) ? item.senders : []).filter((s) => s?.restoreError)
			// ITEM-LEVEL errors (whole-network skips, deadline notes, normalizer
			// violations) count too — a top-level restoreError with clean child
			// arrays used to vanish here, letting a skipped registration
			// auto-route past the Continue gate.
			if (!failedContracts.length && !failedSenders.length && !item.restoreError) continue
			out.push({
				networkId: item.networkId,
				contracts: failedContracts,
				senders: failedSenders,
				...(item.restoreError !== undefined ? { restoreError: item.restoreError } : {}),
			})
		}
		if (malformedItems > 0) {
			out.push({ networkId: "(result)", contracts: [], senders: [], restoreError: "malformed account-state restore result" })
		}
		return out.length ? out : null
	}
	const filtered = (data as GenericRestoreItem[]).filter((item) => item?.restoreError)
	return filtered.length ? filtered : null
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
