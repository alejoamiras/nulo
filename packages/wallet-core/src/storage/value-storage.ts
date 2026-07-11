import type { MinimalStorageArea } from "./entity_storage"

export class ValueStorage<T> {
	private readonly storage: MinimalStorageArea
	private readonly root: string
	private readonly parse?: (raw: unknown) => T

	/**
	 * Callers must pass a concrete `MinimalStorageArea` (e.g.
	 * `browserApi.storage.local`, `chrome.storage.session`, or
	 * `FakeBrowserApi`'s fake) explicitly from the composition root. No
	 * legacy enum form is supported.
	 *
	 * `parse` is an OPTIONAL boundary codec: `(raw: unknown) => T`. When omitted,
	 * `get` keeps the legacy `JSON.parse(...)` behavior (no validation). Unlike
	 * `EntityStorage`, `ValueStorage.get` THROWS on a malformed value and NEVER
	 * deletes — a single-value store has no "drop one bad row of many" option, so
	 * both JSON-syntax failure and codec-validation failure surface to the caller
	 * (fail-closed, no silent data loss). The schema is injected from the app
	 * layer (wallet-core carries no zod).
	 */
	constructor(root: string, area: MinimalStorageArea, parse?: (raw: unknown) => T) {
		this.root = root
		this.storage = area
		this.parse = parse
	}

	public async get(): Promise<T | undefined> {
		const res = await this.storage.get(this.root)
		if (this.root in res) {
			const parsed = JSON.parse(res[this.root] as string)
			return this.parse ? this.parse(parsed) : (parsed as T)
		}
		return undefined
	}

	public set(value: T): Promise<void> {
		return this.storage.set({ [this.root]: JSON.stringify(value) })
	}

	public delete(): Promise<void> {
		return this.storage.remove(this.root)
	}
}
