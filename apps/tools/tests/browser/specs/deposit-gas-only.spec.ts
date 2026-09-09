/** Gas-only deposits (cells 18–21): every route shape, public and private, and what it adds to. */
import { balanceOf, fundPublicFeeJuice, mint, mintFeeAsset, privateCreditOf, privateFpc } from "@nulo/bridge-core/sandbox"
import { expect, test } from "../fixtures/test"
import { connectAztec } from "../pages/connect"
import { walletFuelClaimCeiling } from "../pages/fees"
import { fuelConservation } from "../pages/journal"
import { confirmReview, connectL1, openSend, reviewDeposit, waitForReceipt } from "../pages/send"

test.use({ family: "deposit-gas-only", cells: 6, l1Index: 5 })

const USDC = 10n ** 6n
const FJ = 10n ** 18n
const L1 = 31337
/** The mock venue's rate: one base unit of anything buys this many FJ-wei. */
const RATE = 10n ** 12n

async function bridgeGas(
	page: import("@playwright/test").Page,
	o: { profile: "plain" | "selfpay"; account: string; erc20: string; amount: string; isPrivate: boolean; viaLookup?: boolean },
) {
	await page.goto("/")
	await openSend(page)
	await connectL1(page)
	await connectAztec(page, { profile: o.profile, account: o.account })
	await reviewDeposit(page, {
		l1ChainId: L1,
		erc20: o.erc20,
		amount: o.amount,
		intent: "gas",
		isPrivate: o.isPrivate,
		viaLookup: o.viaLookup,
	})
	await confirmReview(page)
	const receipt = await waitForReceipt(page)
	expect(receipt.hero, "a gas-only receipt's hero is the Fee Juice row").toContain("FJ")
}

test("cell 18 — plain, the fee asset's identity route, public: Fee Juice arrives one for one, minus its claim's fee", async ({
	page,
	sandbox,
	actor,
	l1,
}) => {
	const feeAsset = sandbox.clients.deployment.feeJuice
	await mintFeeAsset(sandbox.clients.l1, feeAsset, l1.address, 5n * FJ)
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")
	await bridgeGas(page, { profile: "plain", account: actor.address, erc20: feeAsset, amount: "5", isPrivate: false, viaLookup: true })
	const { received, fee } = await fuelConservation(page, actor.s.l2.node)
	expect(received).toBe(5n * FJ)
	expect(await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")).toBe(fjBefore + received - fee)
})

test("cell 18b — selfpay, identity route, public FJ already held: it adds to it", async ({ page, sandbox, actor, l1 }) => {
	const feeAsset = sandbox.clients.deployment.feeJuice
	await fundPublicFeeJuice(actor.s, 2n * FJ)
	await mintFeeAsset(sandbox.clients.l1, feeAsset, l1.address, 5n * FJ)
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")
	expect(fjBefore).toBeGreaterThan(0n)
	await bridgeGas(page, { profile: "selfpay", account: actor.address, erc20: feeAsset, amount: "5", isPrivate: false, viaLookup: true })
	const { received, fee } = await fuelConservation(page, actor.s.l2.node)
	expect(await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")).toBe(fjBefore + received - fee)
})

test("cell 19 — plain, identity route, private: the Fee Juice becomes credit at the FPC", async ({ page, sandbox, actor, l1 }) => {
	const feeAsset = sandbox.clients.deployment.feeJuice
	await mintFeeAsset(sandbox.clients.l1, feeAsset, l1.address, 5n * FJ)
	const fpc = await privateFpc(actor.s)
	const creditBefore = await privateCreditOf(actor.s, fpc)
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")
	const kept = await walletFuelClaimCeiling(actor)
	await bridgeGas(page, { profile: "plain", account: actor.address, erc20: feeAsset, amount: "5", isPrivate: true, viaLookup: true })
	expect(await privateCreditOf(actor.s, fpc), "credit = the fuel minus exactly the claim's ceiling").toBe(creditBefore + 5n * FJ - kept)
	expect(await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public"), "nothing public was touched").toBe(fjBefore)
})

test("cell 20p — plain, a swapped token, private: the venue's Fee Juice becomes credit, minus the claim's ceiling", async ({
	page,
	sandbox,
	actor,
	l1,
}) => {
	const { usdt } = sandbox.tokens
	await mint(sandbox.clients.l1, usdt.erc20 as `0x${string}`, l1.address, 30n * USDC)
	const fpc = await privateFpc(actor.s)
	const creditBefore = await privateCreditOf(actor.s, fpc)
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")
	const kept = await walletFuelClaimCeiling(actor)
	await bridgeGas(page, { profile: "plain", account: actor.address, erc20: usdt.erc20, amount: "30", isPrivate: true })
	const { received } = await fuelConservation(page, actor.s.l2.node)
	expect(received, "the mock venue's fixed rate makes the fuel exact").toBe(30n * USDC * RATE)
	expect(await privateCreditOf(actor.s, fpc)).toBe(creditBefore + received - kept)
	expect(await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public"), "nothing public was touched").toBe(fjBefore)
})

test("cell 21p — plain, WETH, private: the single-hop route's Fee Juice becomes credit, minus the claim's ceiling", async ({
	page,
	sandbox,
	actor,
	l1,
}) => {
	const weth = sandbox.clients.deployment.tokens.weth
	const units = 2n * 10n ** 6n
	await mint(sandbox.clients.l1, weth, l1.address, units)
	const fpc = await privateFpc(actor.s)
	const creditBefore = await privateCreditOf(actor.s, fpc)
	const kept = await walletFuelClaimCeiling(actor)
	await bridgeGas(page, {
		profile: "plain",
		account: actor.address,
		erc20: weth,
		amount: "0.000000000002",
		isPrivate: true,
		viaLookup: true,
	})
	const { received } = await fuelConservation(page, actor.s.l2.node)
	expect(received).toBe(units * RATE)
	expect(await privateCreditOf(actor.s, fpc)).toBe(creditBefore + received - kept)
})

test("cell 20 — plain, a swapped token, public: the venue's Fee Juice lands, minus the claim's fee", async ({
	page,
	sandbox,
	actor,
	l1,
}) => {
	const { usdt } = sandbox.tokens
	await mint(sandbox.clients.l1, usdt.erc20 as `0x${string}`, l1.address, 30n * USDC)
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")
	await bridgeGas(page, { profile: "plain", account: actor.address, erc20: usdt.erc20, amount: "30", isPrivate: false })
	const { received, fee } = await fuelConservation(page, actor.s.l2.node)
	expect(received, "the mock venue's fixed rate makes the fuel exact").toBe(30n * USDC * RATE)
	expect(await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")).toBe(fjBefore + received - fee)
})

test("cell 20b — selfpay, swapped, public FJ held: conservation, after = before + claimed − fees", async ({ page, sandbox, actor, l1 }) => {
	const { usdt } = sandbox.tokens
	await fundPublicFeeJuice(actor.s, 2n * FJ)
	await mint(sandbox.clients.l1, usdt.erc20 as `0x${string}`, l1.address, 30n * USDC)
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")
	await bridgeGas(page, { profile: "selfpay", account: actor.address, erc20: usdt.erc20, amount: "30", isPrivate: false })
	const { received, fee } = await fuelConservation(page, actor.s.l2.node)
	expect(await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")).toBe(fjBefore + received - fee)
})

test("cell 21 — plain, WETH, public: the single-hop route is discovered and settled", async ({ page, sandbox, actor, l1 }) => {
	const weth = sandbox.clients.deployment.tokens.weth
	// The venue sells one base unit of anything for RATE FJ-wei, decimals ignored: an 18-decimal input is sized in units.
	const units = 2n * 10n ** 6n
	await mint(sandbox.clients.l1, weth, l1.address, units)
	const fjBefore = await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")
	await bridgeGas(page, {
		profile: "plain",
		account: actor.address,
		erc20: weth,
		amount: "0.000000000002",
		isPrivate: false,
		viaLookup: true,
	})
	const { received, fee } = await fuelConservation(page, actor.s.l2.node)
	expect(received).toBe(units * RATE)
	expect(await balanceOf(actor.s.feeJuiceL2, actor.actor.address, "public")).toBe(fjBefore + received - fee)
})
