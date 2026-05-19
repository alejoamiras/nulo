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
const PARSE_FAILURE_PREVIEW_MAX = 200

export class EntityStorage<T> {
	private readonly storage: MinimalStorageArea
	private readonly root: string

	/**
	 * Callers must pass a concrete `MinimalStorageArea` (e.g.
	 * `browserApi.storage.local`, `chrome.storage.session`, or
	 * `FakeBrowserApi`'s fake) explicitly from the composition root. No
	 * legacy enum form is supported.
	 */
	public constructor(root: string, area: MinimalStorageArea) {
		this.root = root
		this.storage = area
	}

	/**
	 * Parse a raw storage value or schedule the row for deletion on failure.
	 *
	 * `chrome.storage` is shared, write-anywhere, and survives across SW
	 * lifetimes — one row that fails `JSON.parse` (whether from a half-written
	 * mutation, a forward-incompatible shape, or genuine corruption) used to
	 * throw inside the read path and poison every other reader of the same
	 * namespace. The wallet has no production users yet, so forensic recovery
	 * is not worth a second persistence surface; we log the bad payload and
	 * drop the row.
	 */
	private parseOrDelete(fullKey: string, raw: unknown): T | undefined {
		try {
			return JSON.parse(raw as string) as T
		} catch (err) {
			const preview = typeof raw === "string" ? raw.slice(0, PARSE_FAILURE_PREVIEW_MAX) : String(raw)
			const msg = err instanceof Error ? err.message : String(err)
			console.error(`EntityStorage[${this.root}]: dropping malformed row "${fullKey}" — ${msg} — payload preview: ${preview}`)
			void this.storage.remove(fullKey).catch((removeErr) => {
				const rmsg = removeErr instanceof Error ? removeErr.message : String(removeErr)
				console.error(`EntityStorage[${this.root}]: failed to delete malformed row "${fullKey}" — ${rmsg}`)
			})
			return undefined
		}
	}

	public async getVersion(): Promise<number> {
		const res = await this.storage.get(this.root)
		if (!(this.root in res)) return 0
		try {
			return JSON.parse(res[this.root] as string) as number
		} catch (err) {
			const raw = res[this.root]
			const preview = typeof raw === "string" ? raw.slice(0, PARSE_FAILURE_PREVIEW_MAX) : String(raw)
			const msg = err instanceof Error ? err.message : String(err)
			console.error(`EntityStorage[${this.root}]: dropping malformed version key — ${msg} — payload preview: ${preview}`)
			void this.storage.remove(this.root).catch((removeErr) => {
				const rmsg = removeErr instanceof Error ? removeErr.message : String(removeErr)
				console.error(`EntityStorage[${this.root}]: failed to delete malformed version key — ${rmsg}`)
			})
			return 0
		}
	}

	public setVersion(version: number): Promise<void> {
		return this.storage.set({ [this.root]: JSON.stringify(version) })
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
		return this.parseOrDelete(key, res[key])
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
			const entity = this.parseOrDelete(k, v)
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
			const entity = this.parseOrDelete(k, v)
			if (entity !== undefined) out.push(entity)
		}
		return out
	}

	public async findByPredicate(predicate: (entity: T) => boolean): Promise<Array<{ key: string; entity: T }>> {
		const allEntities = await this.getAll()
		const foundEntities = allEntities.filter(([, entity]) => predicate(entity)).map(([key, entity]) => ({ key, entity }))

		return foundEntities
	}
}
