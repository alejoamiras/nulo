/**
 * The pre-submission `CONTRACT_NOT_REGISTERED` recovery (Phase 6), end to end against a real wallet:
 *   1. a lazy retry — a send that raises the structured code re-registers the app's contracts once
 *      and resends, and the drip lands with no error surfaced;
 *   2. a setup-pending refusal — while a quiet re-grant is still registering (its `registerContract`
 *      held), a drip is refused with the SETUP_PENDING copy and touches the wallet's `sendTx` zero
 *      times; once the registration completes, a drip proceeds.
 *
 * The fault is injected as the extension's structured envelope: the test wallet rejects with
 * `new Error(JSON.stringify(envelope))`, the iframe transport reduces that to its message string and
 * JSON-encodes it again, so the dApp sees a JSON string — the second decoding level
 * `parseWalletEnvelope` supports.
 */
import { mint, mintPrivateGasNote, privateCreditOf, privateFpc } from "@nulo/bridge-core/sandbox"
import { TESTIDS } from "../../../src/lib/testids"
import { type ActorHandle, expect, test } from "../fixtures/test"
import { connectAztec, tid, walletCalls, walletFrame } from "../pages/connect"
import { walletCeiling } from "../pages/fees"
import { confirmReview, connectL1, openSend, reviewDeposit } from "../pages/send"

test.use({ family: "registration-retry", cells: 4, l1Index: 6 })

const L1 = 31337

const UNREGISTERED = JSON.stringify({
	code: -32602,
	message: "Contract not registered with the wallet. Register it and retry.",
	data: { walletErrorCode: "CONTRACT_NOT_REGISTERED" },
})

/** One credit note sized to a claim ceiling, so the deposit review's fee gate passes cleanly. */
async function fundCredit(actor: ActorHandle, amount: bigint): Promise<void> {
	const fpc = await privateFpc(actor.s)
	await mintPrivateGasNote(actor.s, fpc, amount)
	await privateCreditOf(actor.s, fpc)
}

test("lazy retry: a CONTRACT_NOT_REGISTERED on the drip's send re-registers once and the drip lands", async ({ page, run, actor }) => {
	await page.goto("/")
	await connectAztec(page, { profile: "plain", account: actor.address })
	const before = await walletCalls(page, run, "plain")

	// Arm the next send to reject with the structured code, then run a real drip: the dApp must
	// re-register and resend rather than surface the error.
	await walletFrame(page, run, "plain").evaluate(
		(envelope) => window.__nuloTestWallet!.failNext("sendTx", undefined, envelope),
		UNREGISTERED,
	)

	await page.locator(tid(TESTIDS.tabDrip)).click()
	const card = page.locator(`${tid(TESTIDS.tokenCard)}[data-symbol="NULO"]`)
	await expect(card).toBeVisible()
	await card.locator(tid(TESTIDS.btnDripPublic)).click()
	// The retry path must still land the drip — status reaches ok, never error.
	await expect(card.locator(tid(TESTIDS.dripStatus))).toHaveAttribute("data-drip-status", "ok", { timeout: 180_000 })

	const after = await walletCalls(page, run, "plain")
	expect((after.sendTx ?? 0) - (before.sendTx ?? 0), "the faulted send plus its retry").toBe(2)
	expect((after.registerContract ?? 0) - (before.registerContract ?? 0), "one re-registration ran between the two sends").toBeGreaterThan(
		0,
	)
})

test("setup-pending: a drip issued while a quiet re-grant is still registering is refused, never sent", async ({
	page,
	run,
	actor,
	l1,
	sandbox,
}) => {
	const { usdc } = sandbox.tokens
	const ceiling = await walletCeiling(actor, { isPrivate: false, registers: false })
	await fundCredit(actor, (ceiling * 14n) / 10n)
	await mint(sandbox.clients.l1, usdc.erc20 as `0x${string}`, l1.address, 100n * 10n ** 6n)

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "plain", account: actor.address })
	const baseline = await walletCalls(page, run, "plain")

	// The deposit's token is outside the connect grant, so confirming it drives a quiet re-grant
	// (ensureGranted → retryCapabilities), whose contract re-registration we park by holding the next
	// registerContract. `contractsReady` is false for that whole window.
	await reviewDeposit(page, { l1ChainId: L1, erc20: usdc.erc20, amount: "10", intent: "token", isPrivate: false })
	await walletFrame(page, run, "plain").evaluate(() => window.__nuloTestWallet!.holdNext("registerContract"))
	await confirmReview(page)
	// The wizard sits on its grant, and the re-registration has begun (at least one registerContract asked).
	await expect(page.locator(tid(TESTIDS.sendGrantPending))).toBeVisible({ timeout: 120_000 })
	await expect
		.poll(async () => (await walletCalls(page, run, "plain")).registerContract ?? 0, { timeout: 60_000 })
		.toBeGreaterThan(baseline.registerContract ?? 0)
	const held = await walletCalls(page, run, "plain")

	// A drip in that window is refused with the setup-pending copy and never reaches the wallet.
	await page.locator(tid(TESTIDS.tabDrip)).dispatchEvent("click")
	const card = page.locator(`${tid(TESTIDS.tokenCard)}[data-symbol="NULO"]`)
	await card.locator(tid(TESTIDS.btnDripPublic)).dispatchEvent("click")
	const status = card.locator(tid(TESTIDS.dripStatus))
	await expect(status).toHaveAttribute("data-drip-status", "error", { timeout: 30_000 })
	await expect(status.locator(".status-text")).toContainText("still setting up the app's contracts")
	expect((await walletCalls(page, run, "plain")).sendTx ?? 0, "nothing was sent while contracts were registering").toBe(held.sendTx ?? 0)

	// Release the registration; once contracts are ready a drip proceeds.
	await walletFrame(page, run, "plain").evaluate(() => window.__nuloTestWallet!.release())
	await card.locator(tid(TESTIDS.btnDripPublic)).dispatchEvent("click")
	await expect(status).toHaveAttribute("data-drip-status", "ok", { timeout: 180_000 })
})
