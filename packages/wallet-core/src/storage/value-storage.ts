import type { MinimalStorageArea } from "./entity_storage"

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

	public async get(): Promise<T | undefined> {
		const res = await this.storage.get(this.root)
		if (this.root in res) {
			return JSON.parse(res[this.root] as string)
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
