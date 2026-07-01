import type { MigrationArea, MinimalStorageArea } from "./types"

/** Accumulates a migration's writes so the engine commits them as ONE batched
 *  diff after `up()` succeeds. Reads overlay staged writes on the live store
 *  (read-your-writes). Malformed rows throw (fail-closed) — never silently
 *  dropped the way `EntityStorage` does on its read path: mid-migration the
 *  backup may be the only other copy of a row. */
export class StagingArea implements MigrationArea {
	private readonly staged = new Map<string, { op: "set"; raw: string } | { op: "remove" }>()

	constructor(private readonly store: MinimalStorageArea) {}

	private static parse(fullKey: string, raw: unknown): unknown {
		try {
			return JSON.parse(raw as string)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			throw new Error(`migration read: malformed row "${fullKey}" — ${msg}`)
		}
	}

	// The `as T` casts below are the interface's documented contract: the type
	// parameter is a call-site assertion over untrusted JSON; the ENGINE deals
	// in unknown and validation stays the migration's job (see MigrationArea).
	async rows<T = unknown>(root: string): Promise<Array<[string, T]>> {
		const prefix = `${root}@`
		const live = await this.store.get()
		const merged = new Map<string, unknown>()
		for (const [k, v] of Object.entries(live)) if (k.startsWith(prefix)) merged.set(k, v)
		for (const [k, s] of this.staged) {
			if (!k.startsWith(prefix)) continue
			if (s.op === "remove") merged.delete(k)
			else merged.set(k, s.raw)
		}
		const out: Array<[string, T]> = []
		for (const [k, raw] of merged) out.push([k.substring(prefix.length), StagingArea.parse(k, raw) as T])
		return out
	}

	async setRows<T = unknown>(root: string, upserts: Array<[string, T]>, deletes: string[] = []): Promise<void> {
		for (const [id, value] of upserts) this.staged.set(`${root}@${id}`, { op: "set", raw: JSON.stringify(value) })
		for (const id of deletes) this.staged.set(`${root}@${id}`, { op: "remove" })
	}

	async value<T = unknown>(key: string): Promise<T | undefined> {
		const s = this.staged.get(key)
		if (s) return s.op === "remove" ? undefined : (StagingArea.parse(key, s.raw) as T)
		const live = await this.store.get(key)
		return key in live ? (StagingArea.parse(key, live[key]) as T) : undefined
	}

	async setValue<T = unknown>(key: string, value: T): Promise<void> {
		this.staged.set(key, { op: "set", raw: JSON.stringify(value) })
	}

	async deleteValue(key: string): Promise<void> {
		this.staged.set(key, { op: "remove" })
	}

	/** The batched diff to commit. */
	diff(): { sets: Record<string, unknown>; removes: string[] } {
		const sets: Record<string, unknown> = {}
		const removes: string[] = []
		for (const [k, s] of this.staged) {
			if (s.op === "set") sets[k] = s.raw
			else removes.push(k)
		}
		return { sets, removes }
	}
}
