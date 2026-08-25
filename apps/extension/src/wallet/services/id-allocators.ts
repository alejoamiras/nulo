/**
 * The two id-allocation strategies the entity stores hand-rolled, extracted so a
 * store picks one explicitly rather than re-deriving it. Both scan the store's OWN
 * keys (the id space is per-root), so allocation is correct without a shared cursor.
 *
 * `nextNumericId` allocates max(allocatable ids) + 1 over the store's physical
 * keys, where "allocatable" means canonical AND safe-integer (hostile keys are
 * excluded, and the returned candidate itself must be safe and physically
 * free) — the token / token-balance cursor. `nextRandomId` mirrors the
 * `do getRandomHex while contains` collision-avoidance loop — the contact / fpc /
 * network string ids. The structural param types keep these decoupled from
 * `EntityStorage` (any object with the one method works).
 */
import { array_max, getRandomHex } from "@/wallet/utils"
import { canonicalNumericStorageId } from "@/wallet/services/purge-rows"

export async function nextNumericId(storage: { getKeys(): Promise<string[]> }): Promise<number> {
	const keys = await storage.getKeys()
	// Hostile keys must not skew the max: bare `+x` let an alias ("0x10", "01")
	// shift it and a huge junk key pin the allocator onto one forever-colliding
	// float (1e21 + 1 === 1e21). Canonical round-trip PLUS a safe-integer bound
	// (canonical-but-unsafe forms — "1e+21", 2^53 — round-trip String() exactly)
	// keeps only allocatable ids. The bound lives HERE, not in
	// canonicalNumericStorageId, so purge-classification semantics are untouched.
	const allocatable = keys.map((x) => canonicalNumericStorageId(x)).filter((n): n is number => n !== undefined && Number.isSafeInteger(n))
	let candidate = array_max(allocatable) + 1
	// The candidate itself must be safe AND physically free: a hostile
	// MAX_SAFE_INTEGER key would otherwise yield unsafe 2^53, which pins and
	// overwrites. Clamp and walk down into the first free key — gap-fill reuse
	// in that pathological case is deliberate (the contract is uniqueness, not
	// monotonicity). On sane stores the walk never runs: String(max+1) is
	// canonical, so an equal key would have raised the max instead.
	if (!Number.isSafeInteger(candidate)) candidate = Number.MAX_SAFE_INTEGER
	const occupied = new Set(keys)
	while (occupied.has(String(candidate))) candidate -= 1
	return candidate
}

export async function nextRandomId(storage: { contains(id: string): Promise<boolean> }, length = 8): Promise<string> {
	let id: string
	do {
		id = getRandomHex(length)
	} while (await storage.contains(id))
	return id
}

/**
 * The restore variant: keep the source row's own id when it's free, and reroll
 * only on collision — so ids survive a backup round-trip unless they clash. The
 * optional `avoid` set guards against an intra-batch alias (a later row whose
 * source id equals an id we just reallocated to an earlier row); it applies only
 * to a REROLLED id, never to the kept source id (`id !== sourceId`), matching
 * `network`'s hand-rolled guard. `contact`/`fpc` pass no `avoid`.
 */
export async function preferOrReallocId(
	storage: { contains(id: string): Promise<boolean> },
	sourceId: string,
	avoid?: ReadonlySet<string>,
	length = 8,
): Promise<string> {
	let id = sourceId
	while ((await storage.contains(id)) || (avoid !== undefined && id !== sourceId && avoid.has(id))) {
		id = getRandomHex(length)
	}
	return id
}
