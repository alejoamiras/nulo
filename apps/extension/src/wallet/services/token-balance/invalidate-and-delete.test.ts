import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { describe, expect, test, vi } from "vitest"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { TokenBalanceService } from "./service"

type Internals = {
	invalidateAndDelete(id: number): Promise<void>
	invalidatedBalanceIds: Set<number>
	repo: { delete(id: number): Promise<void> }
}

describe("TokenBalanceService.invalidateAndDelete", () => {
	test("fences the id before the delete and hands back the repo's own promise", () => {
		const api = new FakeBrowserApi()
		api.reset()
		const svc = new TokenBalanceService(new LoggerStore(new ConfigStore()), api) as unknown as Internals
		const repoPromise = Promise.resolve()
		let fencedWhenDeleting: boolean | undefined
		vi.spyOn(svc.repo, "delete").mockImplementation(() => {
			fencedWhenDeleting = svc.invalidatedBalanceIds.has(7)
			return repoPromise
		})

		const returned = svc.invalidateAndDelete(7)

		expect(fencedWhenDeleting).toBe(true)
		expect(returned).toBe(repoPromise)
	})
})
