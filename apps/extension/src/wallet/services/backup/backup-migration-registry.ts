/**
 * The backup-import migration registry — the explicit, pinned mapping between
 * full-backup slices (`backup.data[serviceName]`) and the `chrome.storage.local`
 * shapes the numbered migration engine operates on.
 *
 * Pure data transforms: no chrome.*, no service clients, no engine. The
 * BackupMigrator normalizes slices into an in-memory scratch store with these
 * descriptors, runs the REAL `Migrator` over it, then denormalizes back into
 * slices for the unchanged `service.restore()` pipeline.
 *
 * INVARIANT (trust boundary): a backup blob is ATTACKER-CONTROLLED input — its
 * checksum is accidental-integrity detection, not authentication. Every
 * transform here presence-guards every field and fails closed on anything
 * malformed, unknown, or duplicated.
 *
 * INVARIANT (row identity): normalize/denormalize never renumber ids and never
 * change row cardinality. Denormalize re-derives each row's id from its VALUE
 * and rejects when it no longer matches the row's storage key — a migration
 * that mutates an id/anchor field is caught at this seam, fail-closed.
 */
import type { StorageRef } from "@nulo/wallet-core/migration"
import { SCHEMA_RESERVED_PREFIX } from "@nulo/wallet-core/migration"
import type { Account } from "@/wallet/services/account/spec"
import { ACCOUNT_SERVICE_NAME, ACCOUNT_STORAGE_ROOT } from "@/wallet/services/account/spec"
import { ACCOUNT_STATE_SERVICE_NAME } from "@/wallet/services/account-state/spec"
import type { Authwit } from "@/wallet/services/auth-registry/spec"
import {
	AUTH_REGISTRY_ENABLED_STORAGE_ROOT,
	AUTH_REGISTRY_SERVICE_NAME,
	AUTH_REGISTRY_STORAGE_ROOT,
} from "@/wallet/services/auth-registry/spec"
import type { Contact } from "@/wallet/services/contact/spec"
import { CONTACT_SERVICE_NAME, CONTACT_STORAGE_ROOT } from "@/wallet/services/contact/spec"
import type { FpcInfo } from "@/wallet/services/fpc/spec"
import { FPC_SERVICE_NAME, FPC_STORAGE_ROOT } from "@/wallet/services/fpc/spec"
import type { Network } from "@/wallet/services/network/spec"
import { NETWORK_SERVICE_NAME, NETWORK_STORAGE_ROOT } from "@/wallet/services/network/spec"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/spec"
import { PROFILE_STORAGE_ROOT } from "@/wallet/services/profile/repository"
import type { TokenBalanceRaw } from "@/wallet/services/token-balance/spec"
import { TOKEN_BALANCE_SERVICE_NAME, TOKEN_BALANCE_STORAGE_ROOT } from "@/wallet/services/token-balance/spec"
import type { Token } from "@/wallet/services/token/spec"
import { TOKEN_SERVICE_NAME, TOKEN_STORAGE_ROOT } from "@/wallet/services/token/spec"
import type { Tx } from "@/wallet/services/transaction/spec"
import { TRANSACTION_SERVICE_NAME, TRANSACTION_STORAGE_ROOT } from "@/wallet/services/transaction/spec"
import { CONFIG_SERVICE_NAME } from "@/wallet/services/config/spec"
import { CONFIG_STORAGE_KEY } from "@/wallet/config/store"
import { BASELINE_VERSION } from "@/wallet/storage/migrations"

// ── Version metadata (export + import share this single source) ─────────────

/** Top-level field: account-contract generation. NON-migratable — an
 *  unsupported epoch is the only hard version reject. */
export const COMPAT_EPOCH_FIELD = "compat-epoch"

/** Top-level field: the storage schema version the backup's slices were
 *  exported at. Shares the `nulo:schema:version` number space and drives the
 *  scratch-store seed, so the engine migrates the slices exactly as it would
 *  have migrated the live store. */
export const BACKUP_SCHEMA_VERSION_FIELD = "backup-schema-version"

/** The account-contract generation this build produces and accepts. The
 *  legacy conflated `schema-version: 2` really guarded this — the value 2 is
 *  kept so the epoch semantics stay continuous. */
export const CURRENT_COMPAT_EPOCH = 2

const SUPPORTED_COMPAT_EPOCHS: ReadonlySet<number> = new Set([CURRENT_COMPAT_EPOCH])

/** Fail-closed epoch gate: `undefined` (pre-baseline blob), a non-number, or
 *  an unknown generation are all un-importable. */
export function isSupportedCompatEpoch(value: unknown): value is number {
	return typeof value === "number" && SUPPORTED_COMPAT_EPOCHS.has(value)
}

/** New exports stamp the CURRENT storage schema version (baseline until the
 *  first real migration ships). */
export const BACKUP_SCHEMA_BASELINE = BASELINE_VERSION

// ── Slice descriptors ────────────────────────────────────────────────────────

/** Storage row id derived from a row VALUE. Implementations presence-guard
 *  (hostile input) and return `undefined` for a missing/malformed anchor. */
export type SliceRowIdOf = (row: Record<string, unknown>) => string | undefined

export type SliceDescriptor =
	/** The slice element IS the stored row value, keyed `${root}@${idOf(el)}`. */
	| { kind: "root"; root: string; idOf: SliceRowIdOf; optional?: boolean }
	/** ValueStorage-backed, LOSSY: the slice is a projection of the stored
	 *  value. `toStored`/`fromStored` preserve absence (never fabricate
	 *  current-class defaults for keys the slice doesn't carry). */
	| {
			kind: "value-projection"
			key: string
			toStored: (slice: readonly unknown[]) => { ok: true; stored: Record<string, unknown> } | { ok: false; reason: string }
			fromStored: (stored: unknown) => { ok: true; slice: unknown[] } | { ok: false; reason: string }
	  }
	/** Not `chrome.storage.local`-backed (PXE/IndexedDB) — carried through the
	 *  migration untouched. Its wire shape drifts with `aztec-version`, not the
	 *  storage schema. */
	| { kind: "non-storage"; optional?: boolean }
	/** Storage-backed but NOT backup-migratable: the slice is a re-derived
	 *  projection (profile rows are re-encrypted from `master-key` on restore),
	 *  so a migration touching `root` cannot be replayed over a backup — the
	 *  footprint guardrail blocks import instead. Carried through untouched. */
	| { kind: "block-listed"; root: string }

/** Compile-time pin: each `idOf` anchor below must exist on the service's own
 *  slice type — renaming the field in a spec fails HERE, not silently at
 *  import time. */
type AssertAnchor<T, K extends keyof T> = K
type _AccountAnchor = AssertAnchor<Account, "address">
type _NetworkAnchor = AssertAnchor<Network, "id">
type _TokenAnchor = AssertAnchor<Token, "id">
type _TokenBalanceAnchor = AssertAnchor<TokenBalanceRaw, "id">
type _ContactAnchor = AssertAnchor<Contact, "id">
type _TxAnchor = AssertAnchor<Tx, "hash">
type _FpcAnchor = AssertAnchor<FpcInfo, "id">
type _AuthwitAnchor = AssertAnchor<Authwit, "id">

const stringAnchor =
	(field: string): SliceRowIdOf =>
	(row) => {
		const v = row[field]
		return typeof v === "string" && v.length > 0 ? v : undefined
	}

/** Numeric ids are stored under their decimal string (`storage.set(`${id}`)`). */
const numberAnchor =
	(field: string): SliceRowIdOf =>
	(row) => {
		const v = row[field]
		return typeof v === "number" && Number.isFinite(v) ? String(v) : undefined
	}

function configSliceToStored(slice: readonly unknown[]): { ok: true; stored: Record<string, unknown> } | { ok: false; reason: string } {
	const stored: Record<string, unknown> = {}
	for (const el of slice) {
		if (typeof el !== "object" || el === null || Array.isArray(el)) {
			return { ok: false, reason: "config slice element is not an object" }
		}
		const prop = el as Record<string, unknown>
		const key = prop.key
		if (typeof key !== "string" || key.length === 0) return { ok: false, reason: "config slice element has a missing or malformed key" }
		if (!("value" in prop)) return { ok: false, reason: `config slice element "${key}" has no value` }
		if (Object.hasOwn(stored, key)) return { ok: false, reason: `config slice has a duplicate key "${key}"` }
		stored[key] = prop.value
	}
	return { ok: true, stored }
}

function configStoredToSlice(stored: unknown): { ok: true; slice: unknown[] } | { ok: false; reason: string } {
	if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
		return { ok: false, reason: "stored config value is not an object" }
	}
	return { ok: true, slice: Object.entries(stored).map(([key, value]) => ({ key, value })) }
}

/** `serviceName → SliceDescriptor` for every slice a full backup can carry.
 *  A `data` key with no entry here is a tampered/future blob → reject at the
 *  trust boundary (stricter than the restore pipeline's silent-ignore).
 *  `optional` marks slices that are legitimately absent: the aggregated
 *  services return `undefined` with no networks and the export loop drops the
 *  slice — they normalize as an empty root, never a reject. */
export const BACKUP_SLICE_REGISTRY: Readonly<Record<string, SliceDescriptor>> = {
	[PROFILE_SERVICE_NAME]: { kind: "block-listed", root: PROFILE_STORAGE_ROOT },
	[ACCOUNT_SERVICE_NAME]: { kind: "root", root: ACCOUNT_STORAGE_ROOT, idOf: stringAnchor("address") },
	[NETWORK_SERVICE_NAME]: { kind: "root", root: NETWORK_STORAGE_ROOT, idOf: stringAnchor("id") },
	[TOKEN_SERVICE_NAME]: { kind: "root", root: TOKEN_STORAGE_ROOT, idOf: numberAnchor("id") },
	[TOKEN_BALANCE_SERVICE_NAME]: { kind: "root", root: TOKEN_BALANCE_STORAGE_ROOT, idOf: numberAnchor("id") },
	[CONTACT_SERVICE_NAME]: { kind: "root", root: CONTACT_STORAGE_ROOT, idOf: stringAnchor("id") },
	[TRANSACTION_SERVICE_NAME]: { kind: "root", root: TRANSACTION_STORAGE_ROOT, idOf: stringAnchor("hash"), optional: true },
	// The stored FPC row already omits the read-time `isProtocol` decoration
	// (`StoredFpc = Omit<FpcInfo, "isProtocol">` and `backup()` strips it), so
	// the slice element IS the on-disk row — a plain root, NOT a projection.
	[FPC_SERVICE_NAME]: { kind: "root", root: FPC_STORAGE_ROOT, idOf: stringAnchor("id") },
	// Per-row the authwit slice IS the stored row; the service-level lossiness
	// (the second `nulo:core:auth-registry-enabled` root is backup-absent by
	// design) lives in BACKUP_BLOCKED_ROOTS below.
	[AUTH_REGISTRY_SERVICE_NAME]: { kind: "root", root: AUTH_REGISTRY_STORAGE_ROOT, idOf: numberAnchor("id"), optional: true },
	[CONFIG_SERVICE_NAME]: {
		kind: "value-projection",
		key: CONFIG_STORAGE_KEY,
		toStored: configSliceToStored,
		fromStored: configStoredToSlice,
	},
	[ACCOUNT_STATE_SERVICE_NAME]: { kind: "non-storage", optional: true },
}

/** Roots that exist in live storage but are NOT representable in a backup —
 *  a migration whose footprint touches one of these cannot be replayed over a
 *  backup, so import is BLOCKED for it (an explicit release decision, never a
 *  silent skip):
 *  - profile rows are re-derived from `master-key` on restore (the slice is a
 *    lossy `ProfileInfo`);
 *  - auth-registry enable flags are backup-absent and DEFAULT `true` when
 *    absent — treating absence as empty would erase disabled states. */
export const BACKUP_BLOCKED_ROOTS: readonly string[] = [PROFILE_STORAGE_ROOT, AUTH_REGISTRY_ENABLED_STORAGE_ROOT]

// ── Normalize: backup slices → scratch-store entries ─────────────────────────

export interface NormalizedBackupData {
	/** Scratch-store seed in the EXACT live format: `${root}@${id}` (or a
	 *  ValueStorage key) → JSON-stringified row/value. */
	entries: Record<string, string>
	/** Slices the migration never sees (non-storage / block-listed), verbatim. */
	passThrough: Record<string, unknown>
	/** Service names present in `data` — drives absent-stays-absent on
	 *  denormalize. */
	present: ReadonlySet<string>
	/** Refs of NON-optional slices absent from the backup. Not a reject by
	 *  itself: the migrator rejects only when a pending migration actually
	 *  reads one (otherwise absence flows through unchanged, as today). */
	absentRequired: StorageRef[]
}

export type NormalizeResult = { ok: true; normalized: NormalizedBackupData } | { ok: false; reason: string }

export function normalizeBackupData(data: unknown): NormalizeResult {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return { ok: false, reason: "backup data is not an object" }
	}
	const record = data as Record<string, unknown>

	for (const key of Object.keys(record)) {
		if (!Object.hasOwn(BACKUP_SLICE_REGISTRY, key)) {
			return { ok: false, reason: `unknown backup slice "${key}"` }
		}
	}

	const entries: Record<string, string> = {}
	const passThrough: Record<string, unknown> = {}
	const present = new Set<string>()
	const absentRequired: StorageRef[] = []

	for (const [name, desc] of Object.entries(BACKUP_SLICE_REGISTRY)) {
		const slice = Object.hasOwn(record, name) ? record[name] : undefined
		if (slice !== undefined) present.add(name)

		switch (desc.kind) {
			case "root": {
				if (slice === undefined) {
					if (!desc.optional) absentRequired.push({ kind: "root", root: desc.root })
					break
				}
				if (!Array.isArray(slice)) return { ok: false, reason: `slice "${name}" is not an array` }
				for (let i = 0; i < slice.length; i++) {
					const row = slice[i]
					if (typeof row !== "object" || row === null || Array.isArray(row)) {
						return { ok: false, reason: `slice "${name}" row ${i} is not an object` }
					}
					const id = desc.idOf(row as Record<string, unknown>)
					if (id === undefined) return { ok: false, reason: `slice "${name}" row ${i} has a missing or malformed id` }
					const key = `${desc.root}@${id}`
					if (Object.hasOwn(entries, key)) return { ok: false, reason: `slice "${name}" has a duplicate row id "${id}"` }
					entries[key] = JSON.stringify(row)
				}
				break
			}
			case "value-projection": {
				if (slice === undefined) {
					absentRequired.push({ kind: "value", key: desc.key })
					break
				}
				if (!Array.isArray(slice)) return { ok: false, reason: `slice "${name}" is not an array` }
				const stored = desc.toStored(slice)
				if (!stored.ok) return { ok: false, reason: stored.reason }
				entries[desc.key] = JSON.stringify(stored.stored)
				break
			}
			case "non-storage":
			case "block-listed": {
				if (slice !== undefined) passThrough[name] = slice
				break
			}
		}
	}

	return { ok: true, normalized: { entries, passThrough, present, absentRequired } }
}

// ── Denormalize: post-migration scratch entries → backup slices ──────────────

export type DenormalizeResult = { ok: true; data: Record<string, unknown> } | { ok: false; reason: string }

export function denormalizeBackupData(
	scratchEntries: Record<string, unknown>,
	normalized: Pick<NormalizedBackupData, "passThrough" | "present">,
): DenormalizeResult {
	const rowsByService = new Map<string, unknown[]>()
	const valueByService = new Map<string, unknown>()

	for (const [key, raw] of Object.entries(scratchEntries)) {
		// The engine's own journal/version keys are scratch bookkeeping, never
		// backup payload.
		if (key.startsWith(SCHEMA_RESERVED_PREFIX)) continue

		const owner = ownerOf(key)
		if (!owner) return { ok: false, reason: `scratch store holds a key outside every registered root: "${key}"` }
		if (typeof raw !== "string") return { ok: false, reason: `scratch value for "${key}" is not a serialized string` }
		let parsed: unknown
		try {
			parsed = JSON.parse(raw)
		} catch {
			return { ok: false, reason: `scratch value for "${key}" is not valid JSON` }
		}

		if (owner.desc.kind === "value-projection") {
			valueByService.set(owner.name, parsed)
			continue
		}
		if (owner.desc.kind !== "root") return { ok: false, reason: `scratch key "${key}" maps to a non-migratable slice` }
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return { ok: false, reason: `scratch row "${key}" is not an object` }
		}
		// Row-identity check at the seam: a migration must never mutate the
		// anchor field its root is keyed by.
		const id = owner.desc.idOf(parsed as Record<string, unknown>)
		if (id !== owner.id) {
			return { ok: false, reason: `scratch row "${key}" no longer matches its id anchor (got ${JSON.stringify(id)})` }
		}
		let rows = rowsByService.get(owner.name)
		if (!rows) {
			rows = []
			rowsByService.set(owner.name, rows)
		}
		rows.push(parsed)
	}

	const data: Record<string, unknown> = {}
	for (const [name, desc] of Object.entries(BACKUP_SLICE_REGISTRY)) {
		switch (desc.kind) {
			case "root": {
				const rows = rowsByService.get(name) ?? []
				if (normalized.present.has(name) || rows.length > 0) data[name] = rows
				break
			}
			case "value-projection": {
				if (!valueByService.has(name) && !normalized.present.has(name)) break
				if (!valueByService.has(name)) return { ok: false, reason: `slice "${name}" vanished from the scratch store` }
				const slice = desc.fromStored(valueByService.get(name))
				if (!slice.ok) return { ok: false, reason: slice.reason }
				data[name] = slice.slice
				break
			}
			case "non-storage":
			case "block-listed": {
				if (Object.hasOwn(normalized.passThrough, name)) data[name] = normalized.passThrough[name]
				break
			}
		}
	}

	return { ok: true, data }
}

type ScratchKeyOwner = { name: string; desc: SliceDescriptor; id?: string }

/** Longest-match is unnecessary: `${root}@` prefixes cannot collide (a root
 *  never contains another root followed by `@`), and value keys are exact. */
function ownerOf(key: string): ScratchKeyOwner | undefined {
	for (const [name, desc] of Object.entries(BACKUP_SLICE_REGISTRY)) {
		if (desc.kind === "root" && key.startsWith(`${desc.root}@`)) {
			return { name, desc, id: key.slice(desc.root.length + 1) }
		}
		if (desc.kind === "value-projection" && key === desc.key) return { name, desc }
	}
	return undefined
}
