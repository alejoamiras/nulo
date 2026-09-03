import type { ContractBase } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { describe, expect, it } from "vitest"
import { claimViaHub, type HubClaimParams, hubExitsPaused, isRegisterRace, preflightHubExit } from "./hub-l2"
import type { JournalTokenBlock } from "./journal"

const token: JournalTokenBlock = {
	erc20: "0x00000000000000000000000000000000000e2c20",
	portal: "0x00000000000000000000000000000000000000a1",
	l2Token: `0x${"11".repeat(32)}`,
	nameWord: `0x00${"4e".repeat(31)}`,
	symbolWord: `0x00${"54".repeat(31)}`,
	decimals: 18,
	displaySymbol: "NTT",
	registerIndex: "5",
}
const USER = `0x${"22".repeat(32)}`

/** A hub whose `token_for` answers as scripted and whose sends record their method name. */
interface FakeHubOpts {
	registered: boolean
	failRegister?: string
	/** Whether a failed registration leaves the hub knowing the token (a lost race) or not (unsynced leaf). */
	registeredAfterFailure?: boolean
	boundTo?: string
	/** A successful registration makes the hub know the token (as the real hub does). */
	registerBinds?: boolean
	paused?: boolean | string
}

function fakeHub(opts: FakeHubOpts) {
	const calls: string[] = []
	let registered = opts.registered
	const views = (): Record<string, unknown> => ({
		token_for: registered ? (opts.boundTo ?? token.l2Token) : `0x${"0".repeat(64)}`,
		exits_paused: opts.paused ?? false,
	})
	const method = (name: string) => {
		return (..._args: unknown[]) => ({
			simulate: async () => {
				const v = views()
				if (name in v) return { result: v[name] }
				if (name.startsWith("exit_")) calls.push(`simulate:${name}`)
				return {}
			},
			send: async () => {
				calls.push(name)
				if (name.startsWith("register") && opts.failRegister) {
					registered = opts.registeredAfterFailure ?? true
					throw new Error(opts.failRegister)
				}
				if (name.startsWith("register") && opts.registerBinds) registered = true
				return { receipt: { txHash: `0x${name}` } }
			},
		})
	}
	const methods = new Proxy({}, { get: (_t, name: string) => method(name) })
	return { hub: { methods } as unknown as ContractBase, calls }
}

const params = (isPrivate: boolean): HubClaimParams => ({
	token,
	recipient: USER,
	amount: 5n,
	claimValue: new Fr(1n),
	leafIndex: 9n,
	isPrivate,
	from: USER,
})

describe("hub L2 claims", () => {
	it("a registered token is a plain claim", async () => {
		const { hub, calls } = fakeHub({ registered: true })
		expect(await claimViaHub(hub, params(false), {})).toEqual({ path: "claim", claimTxHash: "0xclaim_public" })
		expect(await claimViaHub(hub, params(true), {})).toMatchObject({ path: "claim", claimTxHash: "0xclaim_private" })
		expect(calls).toEqual(["claim_public", "claim_private"])
	})

	it("an unregistered token: public registers + claims in one tx, private registers in its own tx first", async () => {
		const { hub, calls } = fakeHub({ registered: false })
		expect(await claimViaHub(hub, params(false), {})).toEqual({ path: "register+claim", claimTxHash: "0xregister_and_claim_public" })
		expect(await claimViaHub(hub, params(true), {})).toEqual({
			path: "register,claim",
			registerTxHash: "0xregister_token",
			claimTxHash: "0xclaim_private",
		})
		expect(calls).toEqual(["register_and_claim_public", "register_token", "claim_private"])
	})

	it("a lost registration race falls back to the plain claim; any other failure propagates", async () => {
		const notFound = "No non-nullified L1 to L2 message found for message hash 0xabc"
		const raced = fakeHub({ registered: false, failRegister: notFound })
		expect(await claimViaHub(raced.hub, params(false), {})).toEqual({ path: "claim", claimTxHash: "0xclaim_public" })
		const racedPrivate = fakeHub({ registered: false, failRegister: notFound })
		expect(await claimViaHub(racedPrivate.hub, params(true), {})).toEqual({ path: "register,claim", claimTxHash: "0xclaim_private" })

		// The same message with the hub still ignorant means the leaf is not consumable yet — the
		// caller's sync retry owns that, not a plain claim that would fail on the unbound token.
		const unsynced = fakeHub({ registered: false, failRegister: notFound, registeredAfterFailure: false })
		await expect(claimViaHub(unsynced.hub, params(false), {})).rejects.toThrow(/non-nullified/)
		expect(unsynced.calls).toEqual(["register_and_claim_public"])

		const broken = fakeHub({ registered: false, failRegister: "Assertion failed: word does not decompose" })
		await expect(claimViaHub(broken.hub, params(false), {})).rejects.toThrow(/decompose/)

		expect(isRegisterRace(new Error("EMITNULLIFIER: Attempted to emit duplicate nullifier 0x1"))).toBe(true)
		expect(isRegisterRace(new Error("Balance too low"))).toBe(false)
	})

	it("a hub that binds the ERC-20 to a different L2 token than the journal refuses the claim", async () => {
		const { hub, calls } = fakeHub({ registered: true, boundTo: `0x${"33".repeat(32)}` })
		await expect(claimViaHub(hub, params(false), {})).rejects.toThrow(/binds .* refusing to claim/)
		expect(calls).toEqual([])
		// A private first claim learns the binding from its own registration, before the claim.
		const tampered = fakeHub({ registered: false, boundTo: `0x${"33".repeat(32)}`, registerBinds: true })
		await expect(claimViaHub(tampered.hub, params(true), {})).rejects.toThrow(/binds .* refusing to claim/)
		expect(tampered.calls).toEqual(["register_token"])
	})

	it("a token block without a registerIndex cannot register", async () => {
		const { hub } = fakeHub({ registered: false })
		await expect(claimViaHub(hub, { ...params(false), token: { ...token, registerIndex: undefined } }, {})).rejects.toThrow(
			/registerIndex/,
		)
	})

	it("the exit preflight simulates the chosen exit and refuses a zero recipient before simulating", async () => {
		const { hub, calls } = fakeHub({ registered: true })
		const base = {
			l2Token: token.l2Token,
			recipientL1: "0x00000000000000000000000000000000000000ee",
			amount: 1n,
			callerOnL1: "0x00000000000000000000000000000000000000ee",
			authwitNonce: new Fr(7n),
		}
		await preflightHubExit(hub, { ...base, isPrivate: false }, USER)
		await preflightHubExit(hub, { ...base, isPrivate: true }, USER)
		expect(calls).toEqual(["simulate:exit_to_l1_public", "simulate:exit_to_l1_private"])
		await expect(preflightHubExit(hub, { ...base, recipientL1: `0x${"0".repeat(40)}`, isPrivate: false }, USER)).rejects.toThrow(
			/zero address/,
		)
	})

	it("the pause view reads the guardian switch without simulating an exit", async () => {
		expect(await hubExitsPaused(fakeHub({ registered: true }).hub, USER)).toBe(false)
		const paused = fakeHub({ registered: true, paused: true })
		expect(await hubExitsPaused(paused.hub, USER)).toBe(true)
		expect(paused.calls).toEqual([])
		await expect(hubExitsPaused(fakeHub({ registered: true, paused: "maybe" }).hub, USER)).rejects.toThrow(/not a boolean/)
	})
})
