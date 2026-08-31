/**
 * Storage ownership for `TokenBalanceRaw`.
 *
 * Frozen invariants:
 * - Storage key `nulo:core:token-balances`.
 * - Injected `browserApi.storage.local` (the chrome.storage.local adapter in prod).
 * - IDs are numeric; `allocateId()` delegates to `nextNumericId`, which
 *   allocates max(allocatable ids) + 1 with hostile keys excluded (canonical
 *   round-trip + safe-integer bound; the candidate itself safe and free) —
 *   identical to the old `array_max(map(+)) + 1` on every legitimate store.
 */

import { EntityStorage } from "@/wallet/storage"
import { nextNumericId } from "@/wallet/services/id-allocators"
import { purgeMalformedRows } from "@/wallet/services/purge-rows"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import { TOKEN_BALANCE_STORAGE_ROOT, TokenBalanceRawSchema, type TokenBalanceRaw } from "./spec"

export class BalanceRepository {
	private readonly storage: EntityStorage<TokenBalanceRaw>

	public constructor(browserApi: BrowserApi) {
		this.storage = new EntityStorage<TokenBalanceRaw>(
			TOKEN_BALANCE_STORAGE_ROOT,
			browserApi.storage.local,
			(raw) => TokenBalanceRawSchema.parse(raw),
			// Balance ids are minted `max+1` over the key space and every identity
			// decision downstream trusts the embedded `id`, so a row whose key and
			// `id` disagree must not be served. `keyIdentityMode` is NOT optional
			// here: the default "string" mode requires a string id, which would
			// reject every (numeric) balance row while `getKeys()` still saw their
			// physical keys — a blank assets view plus unbounded reallocation.
			{ requireKeyIdentityMatch: true, keyIdentityMode: "numeric" },
		)
	}

	public async get(id: number): Promise<TokenBalanceRaw | undefined> {
		return this.storage.get(`${id}`)
	}

	public async getAll(): Promise<TokenBalanceRaw[]> {
		return this.storage.getValues()
	}

	public async set(balance: TokenBalanceRaw): Promise<void> {
		await this.storage.set(`${balance.id}`, balance)
	}

	public async delete(id: number): Promise<void> {
		await this.storage.delete(`${id}`)
	}

	/** Allocate a fresh numeric id via the hardened allocator: max(allocatable
	 *  ids) + 1 on every legitimate store, with hostile keys excluded and a
	 *  safe, physically-free candidate guaranteed (downward gap-fill at the
	 *  hostile boundary). */
	public async allocateId(): Promise<number> {
		return nextNumericId(this.storage)
	}

	/** Allocate a fresh id treating `avoid` (fence-invalidated ids) as
	 *  occupied. Blindly incrementing past a fenced id assumed a forward-
	 *  contiguous free space, which the allocator's hostile-boundary gap-fill
	 *  does not guarantee — a step past the fence could land on (and
	 *  overwrite) a physically occupied key. Feeding the fence in as pseudo-
	 *  keys lets the one allocator resolve occupancy, safety, and the fence
	 *  together. */
	public async allocateIdAvoiding(avoid: ReadonlySet<number>): Promise<number> {
		return nextNumericId({
			getKeys: async () => [...(await this.storage.getKeys()), ...[...avoid].map((n) => String(n))],
		})
	}

	/** F-B23 raw second pass over the balance rows — the codec-hidden complement
	 *  of `delete`, kept here so storage stays repository-private. */
	public async purgeMalformed(
		matchesRaw: (raw: Record<string, unknown>, storageId: string) => boolean,
		onPurged?: (storageId: string) => void,
	): Promise<number> {
		return purgeMalformedRows(this.storage, matchesRaw, onPurged)
	}
}
