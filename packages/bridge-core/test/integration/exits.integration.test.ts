import { beforeAll, describe, expect, it } from "vitest"
import { flowGuardianPause, flowPrivateGasFragmented, flowPrivateGasOneNote, flowPublicDeposit, runExit } from "../../scripts/sandbox/flows"
import { flowOutboxBeforeProven } from "../../scripts/sandbox/flows-matrix"
import { type ActorContext, freshActor, INTEGRATION, sandbox } from "./sandbox"

describe.skipIf(!INTEGRATION)("exits", () => {
	let a: ActorContext
	beforeAll(async () => {
		a = await freshActor()
		// Something to exit: the actor starts empty.
		const { usdc } = await sandbox()
		await flowPublicDeposit(a.s, usdc, await a.l2TokenOf(usdc))
	})

	it("public exit → Outbox consume releases on L1 (cell 27)", async () => {
		const { usdc } = await sandbox()
		const unit = 10n ** BigInt(usdc.decimals)
		expect(await runExit(a.s, { token: usdc, l2Token: await a.l2TokenOf(usdc), amount: 10n * unit, isPrivate: false })).toContain(
			"released",
		)
	})

	it("private exit paid from one credit note, then across three notes (cell 28)", async () => {
		const { usdc } = await sandbox()
		const unit = 10n ** BigInt(usdc.decimals)
		const l2Token = await a.l2TokenOf(usdc)
		expect(await flowPrivateGasOneNote(a.s)).toContain("one note")
		expect(await runExit(a.s, { token: usdc, l2Token, amount: 5n * unit, isPrivate: true, label: "one note", notes: 1 })).toContain(
			"released",
		)
		expect(await flowPrivateGasFragmented(a.s)).toContain("none covers a ceiling")
		expect(await runExit(a.s, { token: usdc, l2Token, amount: 5n * unit, isPrivate: true, label: "three notes", notes: 3 })).toContain(
			"released",
		)
		expect(a.s.samples.exitGas.map((x) => x.notes)).toEqual([1, 3])
	})

	it("the guardian pause blocks exits, not claims, and is always lifted (cell 31)", async () => {
		const { usdc } = await sandbox()
		expect(await flowGuardianPause(a.s, usdc)).toContain("unpaused")
	})

	it("the Outbox refuses an unproven exit and consumes it once finalized (cell 32)", async () => {
		const { usdc } = await sandbox()
		expect(await flowOutboxBeforeProven(a.s, usdc, await a.l2TokenOf(usdc))).toContain("after finalization")
	})
})
