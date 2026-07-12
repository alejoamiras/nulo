import type { MinimalStorageArea } from "./entity_storage"

/** In-memory `MinimalStorageArea`. The engine tests' store fake extends this
 *  with fault injection; the backup-import migrator uses it verbatim as the
 *  scratch store the real `Migrator` runs over (values live in the same
 *  JSON-string wire format `chrome.storage.local` holds). */
export class MemoryStorageArea implements MinimalStorageArea {
	readonly data = new Map<string, unknown>()

	async get(keys?: string | string[]): Promise<Record<string, unknown>> {
		if (keys === undefined) return Object.fromEntries(this.data)
		const arr = Array.isArray(keys) ? keys : [keys]
		const out: Record<string, unknown> = {}
		for (const k of arr) if (this.data.has(k)) out[k] = this.data.get(k)
		return out
	}

	async set(items: Record<string, unknown>): Promise<void> {
		for (const [k, v] of Object.entries(items)) this.data.set(k, v)
	}

	async remove(keys: string | string[]): Promise<void> {
		const arr = Array.isArray(keys) ? keys : [keys]
		for (const k of arr) this.data.delete(k)
	}

	seed(entries: Record<string, unknown>): this {
		for (const [k, v] of Object.entries(entries)) this.data.set(k, v)
		return this
	}
}
