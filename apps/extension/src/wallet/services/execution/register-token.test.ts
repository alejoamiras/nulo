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
	const addTokenAuthorized = vi.fn(async () => ({}) as never)
	const self = {
		profileService: { captureExecutionFence: vi.fn(async () => fence) },
		networkService: { getNetwork: vi.fn(async () => ({ id: "net1", profileId: networkProfileId, chainId: 1 })) },
		tokenService: { addTokenAuthorized, parseTokenInterface: vi.fn() },
		logError: () => {},
	}
	return { self, fence, addTokenAuthorized }
}

const invoke = (self: unknown, authorizedFence?: unknown) =>
	(
		ExecutionService.prototype as unknown as {
			executeRegisterToken: (op: never, origin: LocalTxOrigin, task?: never, fence?: unknown) => Promise<void>
		}
	).executeRegisterToken.call(self, op, origin, undefined, authorizedFence)

describe("executeRegisterToken — F11 identity chain", () => {
	test("the write receives the ENTRY fence and its profileId, not a live re-read", async () => {
		const { self, fence, addTokenAuthorized } = makeSelf("pA")
		await invoke(self)
		expect(addTokenAuthorized).toHaveBeenCalledTimes(1)
		const args = addTokenAuthorized.mock.calls[0] as unknown[]
		// Identity, not equality: the SAME capture must reach the commit — a
		// re-minted fence would carry a post-deletion epoch (the F11 ABA).
		expect(args[0]).toBe(fence)
		expect(args[1]).toBe("pA")
	})

	test("a THREADED authorization fence is consumed verbatim — dispatch never re-captures", async () => {
		// The dApp path's capture happens at the interaction's session
		// re-validation, UPSTREAM of the refreshSession park; a re-capture at
		// dispatch would observe a delete + re-import parked across that gap.
		const { self, addTokenAuthorized } = makeSelf("pA")
		const upstream = { profileId: "pA", epoch: 3 }
		await invoke(self, upstream)
		expect(self.profileService.captureExecutionFence).not.toHaveBeenCalled()
		expect((addTokenAuthorized.mock.calls[0] as unknown[])[0]).toBe(upstream)
	})

	test("a network row owned by another profile fails closed before any write", async () => {
		const { self, addTokenAuthorized } = makeSelf("pB")
		await expect(invoke(self)).rejects.toThrow(/unauthorized profile/)
		expect(addTokenAuthorized).not.toHaveBeenCalled()
	})

	test('the locked gate keeps the pinned "Wallet locked" message', async () => {
		const { self, addTokenAuthorized } = makeSelf("pA")
		self.profileService.captureExecutionFence = vi.fn(async () => {
			throw new Error("profile facade internal")
		})
		await expect(invoke(self)).rejects.toThrow("Wallet locked")
		expect(addTokenAuthorized).not.toHaveBeenCalled()
	})
})
