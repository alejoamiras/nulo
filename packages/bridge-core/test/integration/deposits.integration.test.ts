import { beforeAll, describe, expect, it } from "vitest"
import { flowPrivateDeposit, flowPublicDeposit, flowRelayedPrivateDeposit } from "../../scripts/sandbox/flows"
import { flowDiscoveredRouteSend, flowTokenOnlyHeldPublicFj } from "../../scripts/sandbox/flows-matrix"
import { type ActorContext, freshActor, INTEGRATION, sandbox } from "./sandbox"

describe.skipIf(!INTEGRATION)("deposits", () => {
	let a: ActorContext
	beforeAll(async () => {
		a = await freshActor()
	})

	it("public deposit → claim_public on a registered token (cell 1)", async () => {
		const { usdc } = await sandbox()
		expect(await flowPublicDeposit(a.s, usdc, await a.l2TokenOf(usdc))).toContain("claim, +")
	})

	it("private deposit → claim_private (cell 2)", async () => {
		const { usdc } = await sandbox()
		expect(await flowPrivateDeposit(a.s, usdc, await a.l2TokenOf(usdc))).toContain("privately")
	})

	it("a relayer cannot redirect a private claim, then submits it for the actor", async () => {
		const { usdc } = await sandbox()
		expect(await flowRelayedPrivateDeposit(a.s, usdc, await a.l2TokenOf(usdc))).toContain("wrong recipient rejected")
	})

	it("token-only claim paid from held public Fee Juice (cell 5)", async () => {
		const b = await freshActor()
		const { usdc } = await sandbox()
		expect(await flowTokenOnlyHeldPublicFj(b.s, usdc, await b.l2TokenOf(usdc))).toContain("from held public Fee Juice")
	})

	it("a discovered route feeds the send and the claim pays for itself (cell 23)", async () => {
		const { usdt } = await sandbox()
		expect(await flowDiscoveredRouteSend(a.s, usdt, await a.l2TokenOf(usdt))).toContain("quote")
	})
})
