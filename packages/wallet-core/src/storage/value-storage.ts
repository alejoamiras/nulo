import { PARSE_FAILURE_PREVIEW_MAX, type MinimalStorageArea } from "./entity_storage"

export class ValueStorage<T> {
	private readonly storage: MinimalStorageArea
	private readonly root: string

	/**
	 * Callers must pass a concrete `MinimalStorageArea` (e.g.
	 * `browserApi.storage.local`, `chrome.storage.session`, or
	 * `FakeBrowserApi`'s fake) explicitly from the composition root. No
	 * legacy enum form is supported.
	 */
	constructor(root: string, area: MinimalStorageArea) {
		this.root = root
		this.storage = area
	}

	/**
	 * A single malformed value must not throw inside the read path and poison
	 * wallet startup/restore (`chrome.storage` is shared + write-anywhere).
	 * Mirrors `EntityStorage.parseOrDelete`: log a bounded preview, drop the
	 * bad row, return `undefined` (the caller's default).
	 */
	public async get(): Promise<T | undefined> {
		const res = await this.storage.get(this.root)
		if (!(this.root in res)) {
			return undefined
		}
		const raw = res[this.root]
		try {
			return JSON.parse(raw as string) as T
		} catch (err) {
			const preview = typeof raw === "string" ? raw.slice(0, PARSE_FAILURE_PREVIEW_MAX) : String(raw)
			const msg = err instanceof Error ? err.message : String(err)
			console.error(`ValueStorage[${this.root}]: dropping malformed value — ${msg} — payload preview: ${preview}`)
			void this.storage.remove(this.root).catch((removeErr) => {
				const rmsg = removeErr instanceof Error ? removeErr.message : String(removeErr)
				console.error(`ValueStorage[${this.root}]: failed to delete malformed value — ${rmsg}`)
			})
			return undefined
		}
	}

	public set(value: T): Promise<void> {
		return this.storage.set({ [this.root]: JSON.stringify(value) })
	}

	public delete(): Promise<void> {
		return this.storage.remove(this.root)
	}
}
