/**
 * F11 pins: `executeRegisterToken` binds the token write to ONE identity chain —
 * the fence captured at dispatch entry, tied to the ownership-checked network
 * row, threaded into `addToken` (no fresh mint at the commit). Prototype-call
 * with a minimal `this`: the method's surface is three service calls, so the
 * full ExecutionService init graph is deliberately not constructed.
 */
import { describe, expect, test, vi } from "vitest"
import { ExecutionService } from "./service"
import { OriginType, type LocalTxOrigin } from "@/wallet/services/transaction/service"

const previewed = {
	contract: "0xabc",
	chainId: 1,
	getNameFn: { name: "get_name" },
	getSymbolFn: { name: "get_symbol" },
	getDecimalsFn: { name: "get_decimals" },
	balanceOfPublicFn: { name: "balance_of_public" },
}
const op = { networkId: "net1", address: "0xabc", accountAddress: "0xacc", previewedInterface: previewed } as never
const origin = { type: OriginType.DAPP, name: "https://dapp.x" } as LocalTxOrigin

function makeSelf(networkProfileId: string) {
	const fence = { profileId: "pA", epoch: 7 }
	const addToken = vi.fn(async () => ({}) as never)
	const self = {
		profileService: { captureExecutionFence: vi.fn(async () => fence) },
		networkService: { getNetwork: vi.fn(async () => ({ id: "net1", profileId: networkProfileId, chainId: 1 })) },
		tokenService: { addToken, parseTokenInterface: vi.fn() },
		logError: () => {},
	}
	return { self, fence, addToken }
}

const invoke = (self: unknown) =>
	(
		ExecutionService.prototype as unknown as {
			executeRegisterToken: (op: never, origin: LocalTxOrigin) => Promise<void>
		}
	).executeRegisterToken.call(self, op, origin)

describe("executeRegisterToken — F11 identity chain", () => {
	test("the write receives the ENTRY fence and its profileId, not a live re-read", async () => {
		const { self, fence, addToken } = makeSelf("pA")
		await invoke(self)
		expect(addToken).toHaveBeenCalledTimes(1)
		const args = addToken.mock.calls[0] as unknown[]
		expect(args[0]).toBe("pA")
		// Identity, not equality: the SAME capture must reach the commit — a
		// re-minted fence would carry a post-deletion epoch (the F11 ABA).
		expect(args[5]).toBe(fence)
	})

	test("a network row owned by another profile fails closed before any write", async () => {
		const { self, addToken } = makeSelf("pB")
		await expect(invoke(self)).rejects.toThrow(/unauthorized profile/)
		expect(addToken).not.toHaveBeenCalled()
	})

	test('the locked gate keeps the pinned "Wallet locked" message', async () => {
		const { self, addToken } = makeSelf("pA")
		self.profileService.captureExecutionFence = vi.fn(async () => {
			throw new Error("profile facade internal")
		})
		await expect(invoke(self)).rejects.toThrow("Wallet locked")
		expect(addToken).not.toHaveBeenCalled()
	})
})
