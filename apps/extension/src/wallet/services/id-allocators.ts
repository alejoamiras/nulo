/**
 * The two id-allocation strategies the entity stores hand-rolled, extracted so a
 * store picks one explicitly rather than re-deriving it. Both scan the store's OWN
 * keys (the id space is per-root), so allocation is correct without a shared cursor.
 *
 * `nextNumericId` mirrors `array_max((getKeys).map(+)) + 1` — the token /
 * token-balance / auth-registry cursor. `nextRandomId` mirrors the
 * `do getRandomHex while contains` collision-avoidance loop — the contact / fpc /
 * network string ids. The structural param types keep these decoupled from
 * `EntityStorage` (any object with the one method works).
 */
import { array_max, getRandomHex } from "@/wallet/utils"

export async function nextNumericId(storage: { getKeys(): Promise<string[]> }): Promise<number> {
	return array_max((await storage.getKeys()).map((x) => +x)) + 1
}

export async function nextRandomId(storage: { contains(id: string): Promise<boolean> }, length = 8): Promise<string> {
	let id: string
	do {
		id = getRandomHex(length)
	} while (await storage.contains(id))
	return id
}
