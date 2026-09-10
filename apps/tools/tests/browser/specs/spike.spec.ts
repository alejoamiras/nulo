/**
 * The Phase 7 spike as a spec: does an `@aztec/wallets` embedded wallet behind the SDK's iframe
 * handler connect to the production-mode local tools build, and does each `selfpay` branch route
 * as designed? Every check here is one the matrix relies on; the numbers it records go to
 * `lessons/phase-7.md`.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
	actorAddress,
	balanceOf,
	type DripDeploymentRecord,
	freshActorSecret,
	fundPublicFeeJuice,
	mint,
	registerDripFixture,
} from "@nulo/bridge-core/sandbox"
import { expect, test } from "../fixtures/test"
import { connectAztec, grantedAccounts, tid, walletIdOf } from "../pages/connect"
import { drip } from "../pages/drip"
import { PROFILES } from "../test-wallet/profile"
import { confirmReview, connectL1, openSend, reviewDeposit, stepperPhases, waitForReceipt } from "../pages/send"
import { TESTIDS } from "../../../src/lib/testids"

test.use({ family: "spike", cells: 6, l1Index: 1 })

const FJ = 10n ** 18n
const USDC = 10n ** 6n

test("plain: discovery, verification, a whole-pool grant, isolation in both frames, the parked panel", async ({
	page,
	run,
	sandbox,
	pool,
}) => {
	await page.goto("/")
	await connectAztec(page, { profile: "plain" })

	const granted = await grantedAccounts(page)
	for (const a of pool.all) expect(granted.map((x) => x.toLowerCase())).toContain(a.address.toLowerCase())

	expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
	const frame = page
		.frames()
		.find((f) => f.url().startsWith(run.testWalletOrigins.plain) && f.url().includes(walletIdOf("plain").slice(-5)))
	expect(frame, "the session frame for the plain wallet").toBeTruthy()
	expect(await frame!.evaluate(() => crossOriginIsolated)).toBe(true)
	expect(await page.locator("[data-nulo-parked]").count()).toBe(1)

	// The browser derives the same Nulo-shape address Node does for a seed it has never seen.
	const secret = freshActorSecret()
	const expected = (await actorAddress(sandbox.clients.l2.wallet, secret)).toString()
	const added = await frame!.evaluate((s) => window.__nuloTestWallet!.addAccount(s), secret)
	expect(added.toLowerCase()).toBe(expected.toLowerCase())
})

test("a wallet whose frame loads late is still discovered", async ({ page, run }) => {
	// The SDK probes every listed wallet in parallel and tells frames apart by origin; a frame
	// that is slower than its siblings must still be listed, which is why each profile has its
	// own origin. Every response from the full profile's origin is held for 4 s here, well past
	// the others' READY and inside the probe's 10 s budget.
	await page.route(
		(url) => url.origin === run.testWalletOrigins.full,
		async (route) => {
			await new Promise((r) => setTimeout(r, 4_000))
			await route.continue()
		},
	)
	await page.goto("/")
	await openSend(page)
	await page.locator(tid(TESTIDS.bridgeL2Connect)).first().click()
	for (const profile of PROFILES) {
		await expect(page.locator(`${tid(TESTIDS.walletPickerRow)}[data-wallet-id="${walletIdOf(profile)}"]`)).toBeVisible({
			timeout: 15_000,
		})
	}
})

test("plain: a public drip lands on the selected actor", async ({ page, run, sandbox, actor }) => {
	await page.goto("/")
	await connectAztec(page, { profile: "plain", account: actor.address })
	await drip(page, "NULO", "public")

	const record = JSON.parse(readFileSync(join(run.artifactsDir, "deployments.json"), "utf8")) as DripDeploymentRecord
	const { tokens } = await registerDripFixture(sandbox.clients.l2.wallet, record)
	const nulo = tokens.get("NULO")
	expect(nulo).toBeTruthy()
	expect(await balanceOf(nulo!, actor.actor.address, "public")).toBeGreaterThan(0n)
})

test("selfpay: a token-only public deposit is claimed from held public Fee Juice", async ({ page, sandbox, actor, l1 }) => {
	const { usdc } = sandbox.tokens
	await fundPublicFeeJuice(actor.s, 5n * FJ)
	await mint(sandbox.clients.l1, usdc.erc20 as `0x${string}`, l1.address, 100n * USDC)
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")
	const usdcL2 = await actor.l2TokenOf(usdc)
	const usdcBefore = await balanceOf(usdcL2, actor.actor.address, "public")

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "selfpay", account: actor.address })
	await reviewDeposit(page, { l1ChainId: 31337, erc20: usdc.erc20, amount: "10", intent: "token", isPrivate: false })
	await confirmReview(page)
	const receipt = await waitForReceipt(page)
	expect(receipt.hero).toContain("10")
	expect(receipt.gas).toBeNull()

	expect(await balanceOf(usdcL2, actor.actor.address, "public")).toBe(usdcBefore + 10n * USDC)
	const fjAfter = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")
	expect(fjAfter, "the claim's fee came out of the held public Fee Juice").toBeLessThan(fjBefore)
})

test("selfpay: a fueled deposit still routes its claim as a claim (Fee Juice bridged in the same send)", async ({
	page,
	sandbox,
	actor,
	l1,
}) => {
	const { usdt } = sandbox.tokens
	await mint(sandbox.clients.l1, usdt.erc20 as `0x${string}`, l1.address, 200n * USDC)
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")

	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: "selfpay", account: actor.address })
	await reviewDeposit(page, { l1ChainId: 31337, erc20: usdt.erc20, amount: "100", intent: "token+gas", isPrivate: false })
	await confirmReview(page)
	await expect(page.locator(tid(TESTIDS.stepper))).toBeVisible({ timeout: 120_000 })
	const receipt = await waitForReceipt(page)
	expect(receipt.gas, "the receipt carries the gas leg").not.toBeNull()
	const phases: Record<string, string> = await stepperPhases(page).catch(() => ({}))
	expect(phases.claim ?? "done").not.toBe("failed")

	const fjAfter = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")
	expect(fjAfter, "the bridged fuel minus the claim's fee remains").toBeGreaterThan(fjBefore)
})

test("viewports: at 390 px and 1024 px the flow connects and deposits; the activity dock overlays, opens, closes on Escape, and the confirm still lands", async ({
	page,
	sandbox,
	actor,
	pool,
	l1,
}) => {
	const { usdt } = sandbox.tokens
	await mint(sandbox.clients.l1, usdt.erc20 as `0x${string}`, l1.address, 400n * USDC)
	for (const [width, who] of [
		[390, actor],
		[1024, pool.take()],
	] as const) {
		await page.setViewportSize({ width, height: 900 })
		await page.goto("/")
		// Each width starts clean: the first pass remembered its wallet, and a remembered wallet
		// reconnects on its own instead of opening the picker.
		await page.evaluate(() => localStorage.clear())
		await page.reload()
		await openSend(page)
		await connectL1(page)
		await connectAztec(page, { profile: "plain", account: who.address })
		await reviewDeposit(page, { l1ChainId: 31337, erc20: usdt.erc20, amount: "100", intent: "token+gas", isPrivate: false })

		// Under 1100 px the dock floats over the page as a dialog: open it from the strip, then Escape.
		await page.locator(tid(TESTIDS.dockOpen)).click()
		const dock = page.locator(tid(TESTIDS.dock))
		await expect(dock).toBeVisible()
		await expect(dock).toHaveAttribute("aria-modal", "true")
		await page.keyboard.press("Escape")
		await expect(dock).toBeHidden()

		await confirmReview(page)
		await expect(page.locator(tid(TESTIDS.stepper))).toBeVisible({ timeout: 120_000 })
		const receipt = await waitForReceipt(page)
		expect(receipt.hero, `the ${width} px deposit landed`).toContain("USDT")
	}
})
