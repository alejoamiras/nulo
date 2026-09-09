/** Exits (cells 27–31): who pays the burn, what the credit covers, and what stops one before any authwit. */
import {
	balanceOf,
	erc20BalanceOf,
	flowPrivateDeposit,
	flowPublicDeposit,
	fundPublicFeeJuice,
	mintPrivateGasNote,
	privateCreditOf,
	privateFpc,
	readHandle,
	writeL1,
} from "@nulo/bridge-core/sandbox"
import { parseAbi } from "viem"
import { TESTIDS } from "../../../src/lib/testids"
import { type ActorHandle, expect, test } from "../fixtures/test"
import { connectAztec, tid } from "../pages/connect"
import { reviewExit, startExit } from "../pages/exit"
import { walletExitCeiling } from "../pages/fees"
import { confirmReview, connectL1, openSend, waitForReceipt } from "../pages/send"

test.use({ cells: 6, l1Index: 3 })

const USDC = 10n ** 6n
const FJ = 10n ** 18n
const L1 = 31337
const SET_PAUSED_ABI = parseAbi(["function setPaused(bool deposits, bool withdraws)"])

/** An actor holding USDC on L2, deposited through the harness (the sponsor pays that scaffolding). */
async function holding(
	actor: ActorHandle,
	sandbox: { tokens: { usdc: import("@nulo/bridge-core").ManifestToken } },
	kind: "public" | "private",
) {
	const { usdc } = sandbox.tokens
	const l2Token = await actor.l2TokenOf(usdc)
	if (kind === "public") await flowPublicDeposit(actor.s, usdc, l2Token)
	else await flowPrivateDeposit(actor.s, usdc, l2Token)
	return { usdc, l2Token }
}

async function connect(page: import("@playwright/test").Page, actor: ActorHandle) {
	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
}

test("cell 27 — a public exit: the authwit and the exit are paid by the wallet's default, the actor's public Fee Juice; L1 releases", async ({
	page,
	sandbox,
	actor,
	l1,
}) => {
	const { usdc, l2Token } = await holding(actor, sandbox, "public")
	await fundPublicFeeJuice(actor.s, 5n * FJ)
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")
	const l2Before = await balanceOf(l2Token, actor.actor.address, "public")
	const l1Before = await erc20BalanceOf(sandbox.clients.l1, usdc.erc20 as `0x${string}`, l1.address)

	await connect(page, actor)
	await reviewExit(page, { l1ChainId: L1, erc20: usdc.erc20, amount: "10", isPrivate: false })
	await confirmReview(page)
	const receipt = await waitForReceipt(page, 10 * 60_000)
	expect(receipt.hero).toContain("10")

	expect(await balanceOf(l2Token, actor.actor.address, "public")).toBe(l2Before - 10n * USDC)
	expect(await erc20BalanceOf(sandbox.clients.l1, usdc.erc20 as `0x${string}`, l1.address), "L1 released the burn").toBe(
		l1Before + 10n * USDC,
	)
	const fjAfter = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")
	expect(fjAfter, "two transactions were paid from the held public Fee Juice").toBeLessThan(fjBefore)
	expect(await privateCreditOf(actor.s, await privateFpc(actor.s)), "no credit was involved").toBe(0n)
})

test("cell 28 — a private exit from one credit note, then from three notes none of which covers the ceiling", async ({
	page,
	sandbox,
	actor,
	l1,
}) => {
	const { usdc, l2Token } = await holding(actor, sandbox, "private")
	const fpc = await privateFpc(actor.s)
	const ceiling = await walletExitCeiling(actor)
	await mintPrivateGasNote(actor.s, fpc, (ceiling * 14n) / 10n)
	const creditBefore = await privateCreditOf(actor.s, fpc)
	const l1Before = await erc20BalanceOf(sandbox.clients.l1, usdc.erc20 as `0x${string}`, l1.address)

	await connect(page, actor)
	await reviewExit(page, { l1ChainId: L1, erc20: usdc.erc20, amount: "5", isPrivate: true })
	await confirmReview(page)
	await waitForReceipt(page, 10 * 60_000)
	expect(await privateCreditOf(actor.s, fpc), "the FPC kept the exit's ceiling from the one note").toBe(creditBefore - ceiling)
	expect(await erc20BalanceOf(sandbox.clients.l1, usdc.erc20 as `0x${string}`, l1.address)).toBe(l1Before + 5n * USDC)

	// Two more notes of 0.45× beside the ≈0.4× change: no note and no pair covers, so pay_fee selects all three.
	await mintPrivateGasNote(actor.s, fpc, (ceiling * 45n) / 100n)
	await mintPrivateGasNote(actor.s, fpc, (ceiling * 45n) / 100n)
	const creditMid = await privateCreditOf(actor.s, fpc)
	await page.locator(tid(TESTIDS.receiptNewBridge)).click()
	await reviewExit(page, { l1ChainId: L1, erc20: usdc.erc20, amount: "5", isPrivate: true })
	await confirmReview(page)
	await waitForReceipt(page, 10 * 60_000)
	expect(await privateCreditOf(actor.s, fpc), "three notes paid one ceiling").toBe(creditMid - ceiling)
	expect(await balanceOf(l2Token, actor.actor.address, "private")).toBeGreaterThanOrEqual(0n)
})

test("cell 29 — a private exit with no credit is refused on the amount step, before any authwit", async ({ page, sandbox, actor, l1 }) => {
	const { usdc } = await holding(actor, sandbox, "private")
	await connect(page, actor)
	await startExit(page, { l1ChainId: L1, erc20: usdc.erc20, amount: "5", isPrivate: true })
	const blocked = page.locator(tid(TESTIDS.sendAmountBlocked))
	await expect(blocked).toBeVisible({ timeout: 60_000 })
	await expect(blocked).toContainText("holds none at the fee contract")
	await expect(page.locator(tid(TESTIDS.sendAmountNext))).toBeDisabled()
	expect(l1.signatures).toBe(0)
})

test("cell 30 — fees that rise between the review and the confirm stand the private exit down; nothing authorized", async ({
	page,
	context,
	run,
	sandbox,
	actor,
	l1,
}) => {
	const { usdc } = await holding(actor, sandbox, "private")
	const fpc = await privateFpc(actor.s)
	await mintPrivateGasNote(actor.s, fpc, (await walletExitCeiling(actor)) * 4n)
	const creditBefore = await privateCreditOf(actor.s, fpc)

	await connect(page, actor)
	await reviewExit(page, { l1ChainId: L1, erc20: usdc.erc20, amount: "5", isPrivate: true })

	// From here the node's prediction triples: the wallet's next quote — the confirm's re-read — moves
	// the ceiling. The node client namespaces the method (`aztec_…`) and batches calls into arrays,
	// so the patch follows the request ids.
	type Rpc = { id?: unknown; method?: string }
	type Fees = { feePerDaGas: string; feePerL2Gas: string }
	type Reply = { id?: unknown; result?: Fees[] }
	const tripled = (f: Fees): Fees => ({
		feePerDaGas: (BigInt(f.feePerDaGas) * 3n).toString(),
		feePerL2Gas: (BigInt(f.feePerL2Gas) * 3n).toString(),
	})
	await context.route(`${readHandle(run.artifactsDir).nodeUrl}/**`, async (route) => {
		const body = route.request().postDataJSON() as Rpc | Rpc[] | null
		const calls = Array.isArray(body) ? body : body ? [body] : []
		const ids = new Set(calls.filter((c) => /^(aztec_|node_)?getPredictedMinFees$/.test(c.method ?? "")).map((c) => c.id))
		if (ids.size === 0) return route.fallback()
		const json = (await (await route.fetch()).json()) as Reply | Reply[]
		const patch = (r: Reply): Reply => (ids.has(r.id) && Array.isArray(r.result) ? { ...r, result: r.result.map(tripled) } : r)
		const patched = Array.isArray(json) ? json.map(patch) : patch(json)
		return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(patched) })
	})
	const confirm = page.locator(tid(TESTIDS.sendReviewConfirm))
	await expect(confirm).toBeEnabled({ timeout: 60_000 })
	await confirm.click()
	const stale = page.locator(tid(TESTIDS.sendReviewStale))
	await expect(stale).toBeVisible({ timeout: 60_000 })
	await expect(stale).toContainText(/fees moved|sets aside more/)
	expect(await privateCreditOf(actor.s, fpc), "nothing was spent").toBe(creditBefore)
	expect(l1.signatures).toBe(0)
})

test("cell 31 — a paused hub (L2) and paused withdrawals (L1) each stop the exit at confirm with a notice; nothing burned", async ({
	page,
	sandbox,
	actor,
	l1,
}) => {
	const { usdc, l2Token } = await holding(actor, sandbox, "public")
	await fundPublicFeeJuice(actor.s, 5n * FJ)
	const l2Before = await balanceOf(l2Token, actor.actor.address, "public")
	const factory = sandbox.manifest.bridge?.l1.factory as `0x${string}`

	await connect(page, actor)
	await actor.s.hub.methods.set_exits_paused(true).send(actor.s.guardianOpts as never)
	try {
		await reviewExit(page, { l1ChainId: L1, erc20: usdc.erc20, amount: "1", isPrivate: false })
		await page.locator(tid(TESTIDS.sendReviewConfirm)).click()
		const notice = page.locator(tid(TESTIDS.sendPausedNotice))
		await expect(notice).toBeVisible({ timeout: 60_000 })
		await expect(notice).toContainText("Exits from Aztec are paused")
	} finally {
		await actor.s.hub.methods.set_exits_paused(false).send(actor.s.guardianOpts as never)
	}

	await writeL1(sandbox.clients.l1, factory, SET_PAUSED_ABI, "setPaused", [false, true])
	try {
		await page.locator(tid(TESTIDS.sendReviewConfirm)).click()
		const notice = page.locator(tid(TESTIDS.sendPausedNotice))
		await expect(notice).toBeVisible({ timeout: 60_000 })
		await expect(notice).toContainText("Withdrawals to Ethereum are paused")
	} finally {
		await writeL1(sandbox.clients.l1, factory, SET_PAUSED_ABI, "setPaused", [false, false])
	}
	expect(await balanceOf(l2Token, actor.actor.address, "public"), "nothing was burned").toBe(l2Before)
	expect(l1.signatures).toBe(0)
})
