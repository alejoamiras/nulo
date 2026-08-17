/**
 * Minimal storage surface EntityStorage actually uses. Designed as a
 * subset of the chrome/webext StorageArea APIs so that
 * `chrome.storage.local` / `.session` and our port's `StorageArea` (via
 * `FakeBrowserApi` or a real chrome adapter) both satisfy it without
 * casts.
 *
 * Notably, `get(undefined)` is defined to return ALL entries (the
 * chrome/webext semantic when no keys are passed). EntityStorage relies
 * on that for `getAll`/`getKeys`/`getValues`.
 */
export type MinimalStorageArea = {
	get(keys?: string | string[]): Promise<Record<string, unknown>>
	set(items: Record<string, unknown>): Promise<void>
	remove(keys: string | string[]): Promise<void>
}

/** Maximum chars of a malformed payload preserved in the parse-failure log. */
export const PARSE_FAILURE_PREVIEW_MAX = 200

export class EntityStorage<T> {
	private readonly storage: MinimalStorageArea
	private readonly root: string
	private readonly parse?: (raw: unknown) => T

	/**
	 * Callers must pass a concrete `MinimalStorageArea` (e.g.
	 * `browserApi.storage.local`, `chrome.storage.session`, or
	 * `FakeBrowserApi`'s fake) explicitly from the composition root. No
	 * legacy enum form is supported.
	 *
	 * `parse` is an OPTIONAL boundary codec: `(raw: unknown) => T` (e.g. a zod
	 * schema's `parse`). When omitted, reads keep the legacy `JSON.parse(...) as T`
	 * behavior (no validation). When provided, every read validates the parsed
	 * JSON. Both JSON-SYNTAX failure and CODEC-VALIDATION failure KEEP the row
	 * (return undefined; the read path never deletes — see `decodeRow`).
	 * wallet-core carries no zod itself; the schema is injected from the app layer.
	 */
	public constructor(root: string, area: MinimalStorageArea, parse?: (raw: unknown) => T) {
		this.root = root
		this.storage = area
		this.parse = parse
	}

	/**
	 * Decode a raw storage value. Both failure modes KEEP the row (return
	 * undefined = "present but unreadable"); the read path NEVER deletes by id.
	 *
	 *   - JSON-SYNTAX failure (`JSON.parse` throws — half-written mutation,
	 *     genuine corruption): log + KEEP. B-23: the old fire-and-forget `remove`
	 *     here raced a concurrent valid write and could destroy the newer value,
	 *     and the storage API has no atomic compare-and-delete — so deletion of a
	 *     genuinely-dead row is left to an explicitly serialized repair path.
	 *   - CODEC-VALIDATION failure (`parse` throws — the JSON is well-formed but
	 *     doesn't match the schema, e.g. a forward-incompatible shape the app
	 *     itself wrote): log + KEEP. Silently dropping a present-but-unreadable
	 *     row turns a recoverable value into permanent data loss — the opposite of
	 *     what a codec should do; a future migration / repair path can still see
	 *     it. The write→read round-trip corpus tests guard against the codec
	 *     rejecting a shape the app actually produces.
	 */
	private decodeRow(fullKey: string, raw: unknown): T | undefined {
		let parsed: unknown
		try {
			parsed = JSON.parse(raw as string)
		} catch (err) {
			const preview = typeof raw === "string" ? raw.slice(0, PARSE_FAILURE_PREVIEW_MAX) : String(raw)
			const msg = err instanceof Error ? err.message : String(err)
			// B-23: KEEP the malformed row, don't delete-by-id on the read path. The
			// old fire-and-forget `remove(fullKey)` raced a concurrent valid write:
			// a `get()` reads a stale malformed snapshot, a concurrent `set()`
			// overwrites the same key with valid JSON, then this delete lands on the
			// NEW value it never observed — silent data loss. The storage API has no
			// atomic compare-and-delete, so hide the unreadable row (return
			// undefined) and leave deletion to an explicitly serialized repair path,
			// exactly as the validation-failure branch below already does.
			console.error(
				`EntityStorage[${this.root}]: row "${fullKey}" is malformed — KEEPING (not deleting) — ${msg} — payload preview: ${preview}`,
			)
			return undefined
		}
		if (!this.parse) return parsed as T
		try {
			return this.parse(parsed)
		} catch (verr) {
			const vmsg = verr instanceof Error ? verr.message : String(verr)
			console.error(`EntityStorage[${this.root}]: row "${fullKey}" failed validation — KEEPING (not deleting) — ${vmsg}`)
			return undefined
		}
	}

	public async contains(id: string): Promise<boolean> {
		const key = `${this.root}@${id}`
		const res = await this.storage.get(key)
		return key in res
	}

	public async get(id: string): Promise<T | undefined> {
		const key = `${this.root}@${id}`
		const res = await this.storage.get(key)
		if (!(key in res)) return undefined
		return this.decodeRow(key, res[key])
	}

	public set(id: string, entity: T): Promise<void> {
		return this.storage.set({ [`${this.root}@${id}`]: JSON.stringify(entity) })
	}

	public delete(id: string): Promise<void> {
		return this.storage.remove(`${this.root}@${id}`)
	}

	public async getAll(): Promise<Array<[string, T]>> {
		const path = `${this.root}@`
		const res = await this.storage.get()
		const out: Array<[string, T]> = []
		for (const [k, v] of Object.entries(res)) {
			if (!k.startsWith(path)) continue
			const entity = this.decodeRow(k, v)
			if (entity !== undefined) out.push([k.substring(path.length), entity])
		}
		return out
	}

	public async getKeys(): Promise<Array<string>> {
		const path = `${this.root}@`
		const res = await this.storage.get()
		return Object.keys(res)
			.filter((k) => k.startsWith(path))
			.map((k) => k.substring(path.length))
	}

	public async getValues(): Promise<Array<T>> {
		const path = `${this.root}@`
		const res = await this.storage.get()
		const out: T[] = []
		for (const [k, v] of Object.entries(res)) {
			if (!k.startsWith(path)) continue
			const entity = this.decodeRow(k, v)
			if (entity !== undefined) out.push(entity)
		}
		return out
	}

	/**
	 * RAW, codec-free enumeration: `[id, JSON.parse(value)]` for every stored row,
	 * INCLUDING rows the schema/codec would hide (validation-failed but kept). The
	 * `id` is the true storage-key suffix — NOT any id embedded in the value — so a
	 * caller that deletes by it removes the row that actually exists at that key.
	 *
	 * For maintenance paths (e.g. a profile-scoped purge) that MUST act on every
	 * row regardless of validity and cannot trust the row's self-reported id. A row
	 * whose stored value is itself unparseable JSON is skipped (there is nothing to
	 * key a predicate off) — a serialized repair path, not the read path, cleans those.
	 */
	public async rawEntries(): Promise<Array<[string, unknown]>> {
		const path = `${this.root}@`
		const res = await this.storage.get()
		const out: Array<[string, unknown]> = []
		for (const [k, v] of Object.entries(res)) {
			if (!k.startsWith(path)) continue
			try {
				out.push([k.substring(path.length), JSON.parse(v as string)])
			} catch {
				// unparseable value — no readable predicate field; leave it.
			}
		}
		return out
	}
}
