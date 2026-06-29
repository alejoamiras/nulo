/**
 * Storage ownership for `TokenBalanceRaw`.
 *
 * Frozen invariants:
 * - Storage key `nulo:core:token-balances`.
 * - Injected `browserApi.storage.local` (the chrome.storage.local adapter in prod).
 * - `TokenBalanceRaw` shape unchanged.
 * - IDs are numeric; `allocateId()` mirrors today's
 *   `array_max((await balances.getKeys()).map((x) => +x)) + 1`.
 */

import { array_max } from "@/wallet/utils"
import { EntityStorage } from "@/wallet/storage"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import type { TokenBalanceRaw } from "./spec"

export class BalanceRepository {
	private readonly storage: EntityStorage<TokenBalanceRaw>

	public constructor(browserApi: BrowserApi) {
		this.storage = new EntityStorage<TokenBalanceRaw>("nulo:core:token-balances", browserApi.storage.local)
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

	/** Allocate a fresh numeric id: `max(existing ids) + 1`. */
	public async allocateId(): Promise<number> {
		return array_max((await this.storage.getKeys()).map((x) => +x)) + 1
	}

	/** Check whether a persisted balance exists for (token, account).
	 *  Used by the projector write loop to guard against writing
	 *  balances for records deleted mid-sync. */
	public async existsByTokenAndAccount(tokenId: number, account: string): Promise<boolean> {
		const all = await this.storage.getValues()
		return all.some((x) => x.token === tokenId && x.account === account)
	}
}
