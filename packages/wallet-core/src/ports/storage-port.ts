/**
 * `chrome.storage` abstracted. Two areas:
 *  - `local`  — persisted across browser restarts
 *  - `session` — cleared on service-worker termination
 *
 * Mirrors the Chrome API shape directly. `EntityStorage` / `ValueStorage` sit
 * on top of this port; they stay unchanged functionally but become injectable.
 */

import type { Unsubscribe } from "./types"

/** One storage slot. Values are arbitrary JSON-serializable. */
export type StorageEntries = Record<string, unknown>

/** Change set shape emitted by `onChange`. Mirrors `chrome.storage.onChanged`. */
export type StorageChanges = Record<string, { newValue?: unknown; oldValue?: unknown }>

export interface StorageArea {
	/**
	 * No-arg or `null` → all entries. String or array → only those keys.
	 * Returns an entries object keyed by the requested keys (or all keys).
	 *
	 * Both `undefined` and `null` mean "everything" — mirrors the
	 * chrome/webext semantic and lets `chrome.storage.local` satisfy
	 * this interface structurally when passed directly.
	 */
	get(keys?: string | string[] | null): Promise<StorageEntries>

	/** Merge `entries` into storage. Existing keys not in `entries` are preserved. */
	set(entries: StorageEntries): Promise<void>

	remove(keys: string | string[]): Promise<void>

	/** Delete everything in this area. */
	clear(): Promise<void>

	/** Subscribe to changes in this area only. */
	onChange(listener: (changes: StorageChanges) => void): Unsubscribe
}

export interface StoragePort {
	local: StorageArea
	session: StorageArea
}
