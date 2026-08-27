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

export class EntityStorage<T> {
	private readonly storage: MinimalStorageArea
	private readonly root: string
	private readonly parse?: (raw: unknown) => T
	private readonly requireKeyIdentityMatch: boolean
	private readonly keyIdentityMode: "string" | "numeric"

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
	 *
	 * `requireKeyIdentityMatch` opts a root into the id/key consistency guard: a row whose
	 * embedded `id` disagrees with the storage-key suffix reads as undefined. Only roots whose
	 * SECURITY decisions trust the embedded id enable this — several roots legitimately key rows
	 * by something other than the entity id (e.g. dapp sessions keyed per context).
	 *
	 * `keyIdentityMode` picks how the embedded id must match the suffix:
	 *   - `"string"` (default): embedded id must be a STRING byte-equal to the suffix. For roots
	 *     whose ids are hex strings (profiles).
	 *   - `"numeric"`: the embedded id must be a POSITIVE SAFE INTEGER whose canonical decimal
	 *     form equals the suffix (`Number.isSafeInteger(embedded) && embedded >= 1`). For roots
	 *     minting sequence ids via `array_max(existing) + 1`, whose smallest honest id is 1 —
	 *     negative/fractional/exponential hostiles would otherwise alias (`-0` → "0",
	 *     `1e21` poisons future id allocation).
	 */
	public constructor(
		root: string,
		area: MinimalStorageArea,
		parse?: (raw: unknown) => T,
		options?: { requireKeyIdentityMatch?: boolean; keyIdentityMode?: "string" | "numeric" },
	) {
		this.root = root
		this.storage = area
		this.parse = parse
		this.requireKeyIdentityMatch = options?.requireKeyIdentityMatch === true
		this.keyIdentityMode = options?.keyIdentityMode ?? "string"
	}

	/**
	 * A storage key, safe to log.
	 *
	 * Row ids are not opaque — an account row is keyed by its address — so the full key is
	 * identifying. The root is not sensitive and is the useful half; the id keeps a short prefix,
	 * which locates the row among the handful under a root without writing the whole value down.
	 */
	private describeKey(fullKey: string): string {
		const id = fullKey.slice(this.root.length + 1)
		return `${this.root}@${id.length > 10 ? `${id.slice(0, 10)}…` : id}`
	}

	/**
	 * Decode a raw storage value. Both failure modes KEEP the row (return
	 * undefined = "present but unreadable"); the read path NEVER deletes by id.
	 *
	 *   - JSON-SYNTAX failure (`JSON.parse` throws — half-written mutation,
	 *     genuine corruption): log + KEEP. B-23: the old fire-and-forget `remove`
	 *     raced a concurrent valid write and could destroy the newer value; the
	 *     storage API has no atomic compare-and-delete, so deletion of a
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
			// The row is whatever was stored under this root — profile ciphertext, contact PII,
			// transaction detail, or attacker-supplied backup content — and this message is a
			// pre-formatted string, which the logger's redaction cannot reach inside.
			//
			// The parse ERROR is withheld too, not just the payload: V8 quotes an excerpt of the
			// offending input inside its own message (`Unexpected token 'S', "SECRET..." is not
			// valid JSON`), so interpolating `err.message` re-introduces exactly what dropping the
			// explicit preview removed. Size and type diagnose the real failure modes here — a
			// truncated write, a non-string value — and the error's NAME distinguishes a syntax
			// error from anything else.
			const shape = typeof raw === "string" ? `string(${raw.length} chars)` : `[${typeof raw}]`
			const failure = err instanceof Error ? err.name : typeof err
			// B-23: KEEP the malformed row — the read path never deletes by id. The
			// old fire-and-forget `remove(fullKey)` raced a concurrent valid write: a
			// get() reads a stale malformed snapshot, a concurrent set() overwrites
			// the key with valid JSON, then the delete lands on the NEW value it
			// never observed — silent data loss. The storage API has no atomic
			// compare-and-delete, and a non-atomic re-read-then-delete only shrinks
			// the window (a set() can still land between them). So hide the
			// unreadable row (return undefined) and leave deletion to an explicitly
			// serialized repair path — see the purge-hardening follow-up — exactly as
			// the validation-failure branch below already does.
			console.error(
				`EntityStorage[${this.root}]: row ${this.describeKey(fullKey)} is malformed — KEEPING (not deleting) — ${failure} — payload ${shape}`,
			)
			return undefined
		}
		if (!this.parse) {
			return this.requireIdMatch(fullKey, parsed as T)
		}
		let validated: T
		try {
			validated = this.parse(parsed)
		} catch (verr) {
			// Same reasoning as the syntax branch: a codec's exception text is arbitrary and
			// routinely quotes the value it rejected.
			const failure = verr instanceof Error ? verr.name : typeof verr
			console.error(
				`EntityStorage[${this.root}]: row ${this.describeKey(fullKey)} failed validation — KEEPING (not deleting) — ${failure}`,
			)
			return undefined
		}
		return this.requireIdMatch(fullKey, validated)
	}

	/**
	 * A row whose embedded `id` disagrees with the storage-key suffix is treated exactly like a
	 * malformed row: hidden (undefined), never deleted. Honest writers always agree — `set(id,
	 * entity)` writes under the id it was given — so a disagreement means a raw storage writer
	 * moved or duplicated a row's payload across keys. Serving such a row under the requested id
	 * would let an attacker transplant another profile's ENTIRE record (id field included) and
	 * have every downstream identity check pass against the forged embedded value.
	 */
	private requireIdMatch(fullKey: string, entity: T): T | undefined {
		if (!this.requireKeyIdentityMatch) return entity
		const suffix = fullKey.substring(this.root.length + 1)
		const embedded = (entity as { id?: unknown }).id
		// Strict: opt-in roots trust the embedded id for security decisions. A missing or
		// wrongly-typed id is just as hostile as a wrong one.
		const ok =
			this.keyIdentityMode === "numeric"
				? typeof embedded === "number" && Number.isSafeInteger(embedded) && embedded >= 1 && String(embedded) === suffix
				: typeof embedded === "string" && embedded === suffix
		if (!ok) {
			// Both halves are identifying — the key suffix and the embedded id are addresses for
			// several roots — and the security-relevant fact is only that they DISAGREE.
			console.error(
				`EntityStorage[${this.root}]: row ${this.describeKey(fullKey)} embeds a mismatched id (${typeof embedded}) — KEEPING (not deleting)`,
			)
			return undefined
		}
		return entity
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

	/** Raw STRING values by id, no parsing — the snapshot surface for the purge
	 *  second pass (F-B23): a guarded delete re-reads `rawValue` and refuses
	 *  unless the bytes still equal this snapshot. The re-read is NOT atomic
	 *  with the delete (the storage API has no compare-and-delete) — it shrinks
	 *  the race window; exclusion comes from the caller's key-attribution or
	 *  lock. Non-string values skipped. */
	public async rawStringEntries(): Promise<Array<[string, string]>> {
		const path = `${this.root}@`
		const res = await this.storage.get()
		const out: Array<[string, string]> = []
		for (const [k, v] of Object.entries(res)) {
			if (!k.startsWith(path)) continue
			if (typeof v !== "string") continue
			out.push([k.substring(path.length), v])
		}
		return out
	}

	/** The raw stored string for one id (undefined when absent or non-string). */
	public async rawValue(id: string): Promise<string | undefined> {
		const key = `${this.root}@${id}`
		const res = await this.storage.get(key)
		const v = res[key]
		return typeof v === "string" ? v : undefined
	}
}
