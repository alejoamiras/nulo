import { beforeEach, describe, expect, it, vi } from "vitest"

// Each fake env pushes into a shared trace; the mock records the deposit into whichever
// trace the current test wired, so ordering asserts can see approve-vs-deposit.
let activeTrace: string[] = []
vi.mock("../src/flows", () => ({
	runRouterDeposit: vi.fn(async () => {
		activeTrace.push("deposit")
		return { claimValueHex: "0x0abc", leafIndex: 42n }
	}),
}))

import { runRouterDeposit } from "../src/flows"
import { depositViaRouter } from "./script-l1"

const CORE = {
	router: "0xr000000000000000000000000000000000000000" as `0x${string}`,
	permit2: "0xp000000000000000000000000000000000000000" as `0x${string}`,
	swapTarget: "0xs000000000000000000000000000000000000000" as `0x${string}`,
}

function fakeEnv(initialAllowance: bigint, calls: string[]) {
	// The real helper re-reads the allowance after an approve — mirror that statefully.
	let allowance = initialAllowance
	return {
		pub: {
			readContract: async ({ functionName }: { functionName: string }) => {
				calls.push(`read:${functionName}`)
				return allowance
			},
			waitForTransactionReceipt: async () => {
				calls.push("wait")
				return {}
			},
		},
		wallet: {
			writeContract: async ({ functionName }: { functionName: string }) => {
				calls.push(`write:${functionName}`)
				if (functionName === "approve") allowance = (1n << 256n) - 1n
				return "0xhash"
			},
		},
		account: { address: "0xfunder00000000000000000000000000000000000" as `0x${string}` },
	}
}

describe("depositViaRouter", () => {
	beforeEach(() => {
		vi.mocked(runRouterDeposit).mockClear()
	})

	it("threads network params verbatim into the router flow and returns the claim pair", async () => {
		const calls: string[] = []
		activeTrace = calls
		const claimSalt = new (await import("@aztec/aztec.js/fields")).Fr(1234)
		const out = await depositViaRouter(fakeEnv(1n << 200n, calls), {
			usdc: "0xusdc" as `0x${string}`,
			usdcAbi: [],
			core: CORE,
			portal: "0xportal" as `0x${string}`,
			amount: 777n,
			recipient: "0xrecipient",
			isPrivate: true,
			claimSalt,
			chainId: 1,
			mins: () => "0m",
		})
		expect(out.leafIndex).toBe(42n)
		expect(out.claimValue.toString()).toMatch(/abc$/)
		const params = vi.mocked(runRouterDeposit).mock.calls[0][1] as unknown as Record<string, unknown>
		expect(params.chainId).toBe(1)
		expect(params.router).toBe(CORE.router)
		expect(params.permit2).toBe(CORE.permit2)
		expect(params.swapTarget).toBe(CORE.swapTarget)
		expect(params.tokenPortal).toBe("0xportal")
		expect(params.bridgeToken).toBe("0xusdc")
		expect(params.amount).toBe(777n)
		expect(params.aztecRecipient).toBe("0xrecipient")
		expect(params.isPrivate).toBe(true)
		expect(params.claimSalt).toBe(claimSalt)
	})

	it("approves Permit2 BEFORE the deposit when the allowance is short, and skips it when covered", async () => {
		const short: string[] = []
		activeTrace = short
		await depositViaRouter(fakeEnv(0n, short), {
			usdc: "0xusdc" as `0x${string}`,
			usdcAbi: [],
			core: CORE,
			portal: "0xportal" as `0x${string}`,
			amount: 10n,
			recipient: "0xr",
			isPrivate: false,
			chainId: 11155111,
			mins: () => "0m",
		})
		// allowance read → max-approve → receipt wait → post-approve re-read, ALL before the deposit.
		expect(short).toEqual(["read:allowance", "write:approve", "wait", "read:allowance", "deposit"])

		const covered: string[] = []
		activeTrace = covered
		await depositViaRouter(fakeEnv(1n << 200n, covered), {
			usdc: "0xusdc" as `0x${string}`,
			usdcAbi: [],
			core: CORE,
			portal: "0xportal" as `0x${string}`,
			amount: 10n,
			recipient: "0xr",
			isPrivate: false,
			chainId: 11155111,
			mins: () => "0m",
		})
		expect(covered).toEqual(["read:allowance", "deposit"])
	})
})
