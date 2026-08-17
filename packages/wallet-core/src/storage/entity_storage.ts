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
	 * JSON — see `decodeRow` for the deliberate split between JSON-SYNTAX failure
	 * (compare-and-delete: drop only if still the same unreadable bytes) and
	 * CODEC-VALIDATION failure (KEEP, never drop). wallet-core carries no zod
	 * itself; the schema is injected from the app layer.
	 */
	public constructor(root: string, area: MinimalStorageArea, parse?: (raw: unknown) => T) {
		this.root = root
		this.storage = area
		this.parse = parse
	}

	/**
	 * Decode a raw storage value. Two failure modes, DELIBERATELY different:
	 *
	 *   - JSON-SYNTAX failure (`JSON.parse` throws — half-written mutation,
	 *     genuine corruption): the byte is unrecoverable, so drop it — but via a
	 *     COMPARE-AND-DELETE (B-23), re-reading the key and removing only if it is
	 *     still this same unreadable value, so a concurrent `set()` that replaced
	 *     it with valid JSON isn't destroyed. Returns undefined.
	 *   - CODEC-VALIDATION failure (`parse` throws — the JSON is well-formed but
	 *     doesn't match the schema, e.g. a forward-incompatible shape the app
	 *     itself wrote): we must NEVER delete. Silently dropping a present-but-
	 *     unreadable row turns a recoverable value into permanent data loss — the
	 *     opposite of what a codec should do. Log, KEEP the row, return undefined
	 *     ("present but unreadable"); a future migration / repair path can still
	 *     see it. The write→read round-trip corpus tests guard against the codec
	 *     rejecting a shape the app actually produces.
	 */
	private decodeRow(fullKey: string, raw: unknown): T | undefined {
		let parsed: unknown
		try {
			parsed = JSON.parse(raw as string)
		} catch (err) {
			const preview = typeof raw === "string" ? raw.slice(0, PARSE_FAILURE_PREVIEW_MAX) : String(raw)
			const msg = err instanceof Error ? err.message : String(err)
			console.error(`EntityStorage[${this.root}]: dropping malformed row "${fullKey}" — ${msg} — payload preview: ${preview}`)
			// B-23: compare-and-delete. The old blind `remove(fullKey)` raced a
			// concurrent valid write — get() reads a stale malformed snapshot, a
			// concurrent set() overwrites the key with valid JSON, then the delete
			// lands on the NEW value it never observed (silent data loss). Re-read
			// the key immediately before removing and delete ONLY if it is STILL
			// this same unreadable value; a set() that replaced it is left intact.
			// This keeps the incidental cleanup that profile purges rely on (their
			// liveRows()/getAll() reads used to drop malformed rows) while shrinking
			// the delete window to the re-read→remove gap. The storage API has no
			// atomic compare-and-delete, so a vanishingly-small residual TOCTOU
			// remains — acceptable versus the prior full-snapshot-span blind delete.
			void this.storage
				.get(fullKey)
				.then((fresh) => {
					if (fresh[fullKey] !== raw) return // replaced (or already gone) — leave it
					return this.storage.remove(fullKey)
				})
				.catch((removeErr) => {
					const rmsg = removeErr instanceof Error ? removeErr.message : String(removeErr)
					console.error(`EntityStorage[${this.root}]: failed to delete malformed row "${fullKey}" — ${rmsg}`)
				})
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
	 * key a predicate off) — those are handled by the compare-and-delete path on normal reads.
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
