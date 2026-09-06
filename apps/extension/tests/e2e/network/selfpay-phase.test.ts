import { expect, inject } from "vitest"
import { TxHash } from "@aztec/stdlib/tx"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { encodeArguments, FunctionSelector, getFunctionArtifactByName } from "@aztec/stdlib/abi"
import { computeVarArgsHash } from "@aztec/stdlib/hash"
import { TokenContract } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { ProtocolContractAddress } from "@aztec/aztec.js/protocol"
import { clickByTestId, openPopup, test, waitForHash } from "../fixtures/extension"
import { assertPgOk, callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import { readSwLogTrail } from "../fixtures/journal"
import { navigateByHash, PXE_ANCHOR_SYNC_WORKAROUND_MS } from "../fixtures/helpers"
import {
	createTestWallet,
	fundPublicFeeJuice,
	mintPublicTokensForAccount,
	readPublicFeeJuice,
	waitForTxMined,
	type AztecTestConfig,
} from "../fixtures/aztec"
import {
	bridgePrivateFuel,
	claimPrivateFuel,
	deployMinterToken,
	type MinterToken,
	type PrivateFuel,
	readPublicTokenBalance,
} from "../fixtures/selfpay-phase"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/** `apps/playground/src/lib/simulation-summary.ts` */
type PublicCallSummary = { contract: string; msgSender: string; selector: string | null; isStaticCall: boolean }
type FrameSummary = { contract: string; selector: string; argsHash: string; publicCalls: PublicCallSummary[]; nested: FrameSummary[] }
type SimulationSummary = {
	feePayer: string
	setupCalls: PublicCallSummary[]
	appCalls: PublicCallSummary[]
	teardownCall: PublicCallSummary | null
	entrypoint: FrameSummary
}

type FeeRoute = "self-pay" | "fpc-credit" | "fpc-fuel" | "external"
type Ctx = Parameters<Parameters<typeof test>[2]>[0]["dappConnectedExtensionWithFirstTwoAccountsContractsCap"]

const lower = (s: string) => s.toLowerCase()
/** A `wait: "NO_WAIT"` send settles at submission with `{ txHash }`. */
const hashOf = (r: { resultJson?: unknown }): string => {
	const h = (r.resultJson as { txHash?: string } | undefined)?.txHash
	if (typeof h !== "string") throw new Error(`send result carries no txHash: ${JSON.stringify(r.resultJson).slice(0, 200)}`)
	return h
}
const frames = (f: FrameSummary): FrameSummary[] => [f, ...f.nested.flatMap(frames)]
const cell = (name: string) => console.log(`[selfpay-phase] cell: ${name}`)

/** Set playground fields by testid (input, select or textarea), firing the events the page syncs on. */
async function setFields(page: Ctx["playgroundPage"], fields: Record<string, string>): Promise<void> {
	await page.evaluate((entries: [string, string][]) => {
		for (const [testid, value] of entries) {
			const el = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-testid="${testid}"]`)
			if (!el) throw new Error(`missing playground field ${testid}`)
			const proto =
				el instanceof HTMLSelectElement
					? window.HTMLSelectElement.prototype
					: el instanceof HTMLTextAreaElement
						? window.HTMLTextAreaElement.prototype
						: window.HTMLInputElement.prototype
			Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value)
			el.dispatchEvent(new Event("input", { bubbles: true }))
			el.dispatchEvent(new Event("change", { bubbles: true }))
		}
	}, Object.entries(fields))
}

type MintInputs = { token: MinterToken; from: string; route: FeeRoute; feePayer?: string; fpc?: string; fuel?: PrivateFuel }

/** The mint call's identity the kernel output must carry: `mint_to_private(from, 1)`'s
 *  selector and args hash, and the selector of the public finalisation it enqueues. */
async function expectedMintCall(from: string): Promise<{ selector: string; argsHash: string; finalisation: bigint }> {
	const mint = getFunctionArtifactByName(TokenContract.artifact, "mint_to_private")
	// The loaded artifact carries public functions only through `public_dispatch`; the
	// internal finalisation's selector comes from its signature.
	const [selector, finalisationSelector, argsHash] = await Promise.all([
		FunctionSelector.fromNameAndParameters(mint.name, mint.parameters),
		FunctionSelector.fromSignature("increase_total_supply_internal(u128)"),
		computeVarArgsHash(encodeArguments(mint, [AztecAddress.fromStringUnsafe(from), 1n])),
	])
	return { selector: selector.toString(), argsHash: argsHash.toString(), finalisation: finalisationSelector.toField().toBigInt() }
}

function mintFields(i: MintInputs): Record<string, string> {
	return {
		"pg-input-phase-tokenInstance": i.token.instanceJson,
		"pg-input-phase-from": i.from,
		"pg-input-phase-recipient": i.from,
		"pg-input-phase-amount": "1",
		"pg-select-phase-fee": i.route,
		"pg-input-phase-feePayer": i.feePayer ?? "",
		"pg-input-phase-fpc": i.fpc ?? "",
		"pg-input-phase-fuelAmount": i.fuel ? i.fuel.amount.toString() : "",
		"pg-input-phase-fuelSecret": i.fuel?.secret ?? "",
		"pg-input-phase-fuelSalt": i.fuel?.salt ?? "",
		"pg-input-phase-fuelLeaf": i.fuel?.leafIndex ?? "",
	}
}

async function readUtility(ctx: Ctx, btn: string, method: string): Promise<bigint> {
	const result = await callExpectingNoPopup(ctx, ctx.playgroundPage, method, () => clickByTestId(ctx.playgroundPage, btn), 90_000)
	await assertPgOk(ctx.playgroundPage, result, method)
	return BigInt(String(result.resultJson))
}

/** Private token balance of `from` (the mint recipient) as the extension's PXE sees it. */
async function privateBalance(ctx: Ctx, i: MintInputs): Promise<bigint> {
	await setFields(ctx.playgroundPage, mintFields(i))
	return readUtility(ctx, "pg-btn-phase-balance", "phase.balance")
}

/** `from`'s PrivateFPC credit as the extension's PXE sees it. */
async function fpcCredit(ctx: Ctx, from: string, fpc: string): Promise<bigint> {
	await setFields(ctx.playgroundPage, { "pg-input-phase-from": from, "pg-input-phase-fpc": fpc })
	return readUtility(ctx, "pg-btn-phase-credit", "phase.credit")
}

async function registerPhaseContracts(ctx: Ctx, token: MinterToken, fpc: string): Promise<void> {
	await setFields(ctx.playgroundPage, { "pg-input-phase-tokenInstance": token.instanceJson, "pg-input-phase-fpc": fpc })
	const r = await callExpectingNoPopup(
		ctx,
		ctx.playgroundPage,
		"phase.register",
		() => clickByTestId(ctx.playgroundPage, "pg-btn-phase-register"),
		60_000,
	)
	await assertPgOk(ctx.playgroundPage, r, "phase.register")
}

/** A simulate cell: validation ON (the section never skips it), correlated to this click by
 *  the feed's sequence, bound to this cell's account and token, and phase-checked. */
async function simulateCell(
	ctx: Ctx,
	name: string,
	i: MintInputs,
	expected: { deployed: boolean; feePayer: string; setup: string[] },
	probe: () => Promise<string>,
): Promise<SimulationSummary> {
	cell(name)
	const startedAt = Date.now()
	const stateBefore = await probe()
	await setFields(ctx.playgroundPage, mintFields(i))
	const r = await callExpectingNoPopup(
		ctx,
		ctx.playgroundPage,
		"phase.simulate",
		() => clickByTestId(ctx.playgroundPage, "pg-btn-phase-simulate"),
		180_000,
	)
	if (r.status !== "ok") {
		const trail = await swTrail(ctx, "simulateTx failed|fail|error|assert|reject|invalid", startedAt)
		throw new Error(`${name}: simulate failed: ${JSON.stringify(r.errorJson).slice(0, 400)}; sw-trail=${trail}`)
	}
	const s = r.resultJson as SimulationSummary
	expect(lower(s.feePayer), `${name}: fee payer`).toBe(lower(expected.feePayer))
	const contracts = frames(s.entrypoint).map((f) => lower(f.contract))
	expect(contracts, `${name}: the account's frame`).toContain(lower(i.from))
	expect(contracts, `${name}: the token's mint frame`).toContain(lower(i.token.address))
	// A never-sent account is simulated init-wrapped: the root frame is the multicall entrypoint,
	// the account nested under it. A deployed one runs its own entrypoint at the root.
	expect(lower(s.entrypoint.contract) === lower(i.from), `${name}: root frame is the account ⇔ deployed`).toBe(expected.deployed)
	expect(
		s.setupCalls.map((c) => lower(c.contract)),
		`${name}: setup-phase public calls`,
	).toEqual(expected.setup.map(lower))
	expect(
		s.appCalls.map((c) => lower(c.contract)),
		`${name}: app-phase public calls`,
	).toEqual([lower(i.token.address)])
	// THIS cell's call, not any mint: the frame's selector and args hash, and its enqueue.
	const want = await expectedMintCall(i.from)
	const mintFrame = frames(s.entrypoint).find((f) => lower(f.contract) === lower(i.token.address))
	expect(mintFrame?.selector, `${name}: mint selector`).toBe(want.selector)
	expect(mintFrame?.argsHash, `${name}: mint args hash`).toBe(want.argsHash)
	expect(
		mintFrame?.publicCalls.map((c) => BigInt(c.selector ?? "0")),
		`${name}: the mint's public finalisation`,
	).toEqual([want.finalisation])
	expect(BigInt(s.appCalls[0]?.selector ?? "0"), `${name}: app-phase call is the finalisation`).toBe(want.finalisation)
	expect(await probe(), `${name}: a simulation moves no state`).toBe(stateBefore)
	return s
}

/** Click a send button, approve its execute popup, and return the settled feed row. The feed
 *  is raced against the popup: a dApp-side failure before `sendTx` (the section's `safe`
 *  wrapper records it) fails HERE with its message instead of as a blind popup timeout. */
async function sendThroughPopup(ctx: Ctx, method: string, btn: string, approve: Parameters<typeof approveExecute>[1] = {}) {
	const page = ctx.playgroundPage
	const startedAt = Date.now()
	const seq = await snapshotResultSeq(page)
	const resultP = waitForPgResult(page, method, seq, 300_000)
	const popupP = waitForPopup(ctx, "execute", { timeout: 90_000 })
	resultP.catch(() => {})
	popupP.catch(() => {})
	await clickByTestId(page, btn)
	const first = await Promise.race([popupP.then((popup) => ({ popup })), resultP.then((early) => ({ early }))])
	if ("early" in first) {
		const dappError = await page.evaluate(() => document.querySelector('[data-testid="pg-error-text"]')?.textContent ?? "")
		throw new Error(
			`${method} settled before the execute popup opened: ${JSON.stringify(first.early.errorJson ?? first.early.resultJson).slice(0, 600)}; pg-error-text="${dappError}"; sw-trail=${await swTrail(ctx, "sendTx failed|fail|error|reject|denied|invalid", startedAt)}`,
		)
	}
	await waitForExecuteContent(first.popup)
	await approveExecute(first.popup, { approvableTimeoutMs: 120_000, ...approve })
	return resultP
}

/** A send cell: the execute popup approved, the hash polled to a successful receipt, the
 *  recipient's private balance up by the amount; returns the receipt's fee for the caller's
 *  payer-side oracle. */
async function sendCell(ctx: Ctx, name: string, i: MintInputs, approve: Parameters<typeof approveExecute>[1] = {}): Promise<bigint> {
	cell(name)
	const before = await privateBalance(ctx, i)
	await setFields(ctx.playgroundPage, mintFields(i))
	const r = await sendThroughPopup(ctx, "phase.send", "pg-btn-phase-send", approve)
	await assertPgOk(ctx.playgroundPage, r, name)
	const txHash = hashOf(r)
	await waitForTxMined(aztecConfig as AztecTestConfig, txHash, 240_000)
	const receipt = await createAztecNodeClient((aztecConfig as AztecTestConfig).nodeUrl).getTxReceipt(TxHash.fromString(txHash))
	expect(String(receipt.status), `${name}: receipt`).toMatch(/success|finalized|proven/)
	expect(receipt.transactionFee ?? 0n, `${name}: a fee was charged`).toBeGreaterThan(0n)
	await expect.poll(() => privateBalance(ctx, i), { timeout: 90_000, interval: 5_000 }).toBe(before + 1n)
	return receipt.transactionFee as bigint
}

/** The service worker's recent log lines matching `match` (Developer Mode must be on). The
 *  store flushes on a 2s debounce, so the read polls until a line newer than `since` lands. */
async function swTrail(ctx: Ctx, match: string, since = Date.now() - 60_000): Promise<string> {
	const popup = await openPopup(ctx)
	try {
		let trail: unknown[] = []
		for (let i = 0; i < 16; i++) {
			const read = await readSwLogTrail(popup, { match, limit: 8 })
			trail = Array.isArray(read) ? read : []
			if (trail.some((e) => Number((e as { timestamp?: number }).timestamp) >= since)) break
			await new Promise((r) => setTimeout(r, 500))
		}
		return JSON.stringify(trail.filter((e) => Number((e as { timestamp?: number }).timestamp) >= since)).slice(0, 4_000)
	} catch (e) {
		return `<trail read failed: ${e instanceof Error ? e.message : String(e)}>`
	} finally {
		await popup.close()
	}
}

/** Developer + debug mode on, so the service worker's log trail is retained and readable. */
async function enableDeveloperLogs(ctx: Ctx): Promise<void> {
	const popup = await openPopup(ctx)
	await waitForHash(popup, "#/popup/general", 30_000)
	await navigateByHash(popup, "#/popup/settings/advanced")
	const toggle = (key: string) => `[data-testid="settings-toggle-${key}"]`
	try {
		await popup.waitForSelector(toggle("developerMode"), { visible: true, timeout: 30_000 })
	} catch (e) {
		const body = await popup.evaluate(() => ({ hash: window.location.hash, text: (document.body.innerText ?? "").slice(0, 400) }))
		throw new Error(`advanced settings never rendered the developer-mode toggle: ${JSON.stringify(body)} (${(e as Error).message})`)
	}
	await clickByTestId(popup, "settings-toggle-developerMode")
	await popup.waitForSelector(toggle("debugMode"), { visible: true, timeout: 30_000 })
	await clickByTestId(popup, "settings-toggle-debugMode")
	// Both writes land through the config service before the popup goes away.
	await popup.waitForFunction(
		(sel: string) => document.querySelector(sel)?.getAttribute("aria-checked") === "true",
		{ timeout: 10_000, polling: 200 },
		toggle("debugMode"),
	)
	await popup.close()
}

/**
 * The wallet's phase layout and account identity on the node's real rules, with the hub claim's
 * inner call: `Token.mint_to_private` from the token's minter (a private call enqueueing a
 * non-allow-listed public finalisation), simulated and sent as each of two granted accounts,
 * never-sent and deployed, paid from the account's own public Fee Juice and from the
 * PrivateFPC (fuel on a first transaction, credit afterwards). A negative control proves the
 * harness node enforces the setup allow-list with the production error text.
 */
test.skipIf(!hasConfig)(
	"selfpay-phase — mint_to_private lands and simulates as the named account under every fee route, validation on",
	{ timeout: 3_000_000 },
	async ({ dappConnectedExtensionWithFirstTwoAccountsContractsCap }) => {
		const ctx = dappConnectedExtensionWithFirstTwoAccountsContractsCap
		const { playgroundPage: page, accountAddresses } = ctx
		const config = aztecConfig as AztecTestConfig
		expect(accountAddresses).toHaveLength(2)
		const [A, B] = accountAddresses as [string, string]

		// The node enforces its DEFAULT setup allow-list: the harness spawns it with this process's
		// environment, so an override here would be an override there.
		expect(process.env.TX_PUBLIC_SETUP_ALLOWLIST, "TX_PUBLIC_SETUP_ALLOWLIST must be unset").toBeUndefined()
		const node = createAztecNodeClient(config.nodeUrl)
		console.log(`[selfpay-phase] node ${(await node.getNodeInfo()).nodeVersion}`)

		const { wallet, accounts, cleanup } = await createTestWallet(config.nodeUrl)
		try {
			const scriptAccount = accounts[0]
			if (!scriptAccount) throw new Error("expected at least one sandbox-deployed test account")

			// ── setup: a minter token per account, public FJ for both, fuel bridged for both ──
			const tokenA = await deployMinterToken(config, A)
			const tokenB = await deployMinterToken(config, B)
			await fundPublicFeeJuice(wallet, node, scriptAccount, config, A)
			await fundPublicFeeJuice(wallet, node, scriptAccount, config, B)
			const fuelA = await bridgePrivateFuel(config, node, wallet, A)
			const fuelB = await bridgePrivateFuel(config, node, wallet, B)
			const fpc = fuelA.fpc
			await registerPhaseContracts(ctx, tokenA, fpc)
			await registerPhaseContracts(ctx, tokenB, fpc)
			// Retained wallet logs: the negative control reads the node's rejection text from
			// them, and any wallet-side failure of a cell is reported with its real error.
			await enableDeveloperLogs(ctx)
			const fj = (who: string) => readPublicFeeJuice(wallet, scriptAccount, who)
			const stateOf = (i: MintInputs) => async () =>
				JSON.stringify({ fj: String(await fj(i.from)), bal: String(await privateBalance(ctx, i)) })

			// ── never-sent: simulate both accounts under self-pay and fuel ──
			const selfA: MintInputs = { token: tokenA, from: A, route: "self-pay", feePayer: A }
			const selfB: MintInputs = { token: tokenB, from: B, route: "self-pay", feePayer: B }
			const fuelAIn: MintInputs = { token: tokenA, from: A, route: "fpc-fuel", fpc, fuel: fuelA }
			const fuelBIn: MintInputs = { token: tokenB, from: B, route: "fpc-fuel", fpc, fuel: fuelB }
			// FeeJuice.claim enqueues the allow-listed `_increase_public_balance` in setup.
			const FEE_JUICE = ProtocolContractAddress.FeeJuice.toString()
			await simulateCell(
				ctx,
				"never-sent / first / simulate / self-pay",
				selfA,
				{ deployed: false, feePayer: A, setup: [] },
				stateOf(selfA),
			)
			await simulateCell(
				ctx,
				"never-sent / first / simulate / fpc-fuel",
				fuelAIn,
				{
					deployed: false,
					feePayer: fpc,
					setup: [FEE_JUICE],
				},
				stateOf(fuelAIn),
			)
			await simulateCell(
				ctx,
				"never-sent / second / simulate / self-pay",
				selfB,
				{ deployed: false, feePayer: B, setup: [] },
				stateOf(selfB),
			)
			await simulateCell(
				ctx,
				"never-sent / second / simulate / fpc-fuel",
				fuelBIn,
				{
					deployed: false,
					feePayer: fpc,
					setup: [FEE_JUICE],
				},
				stateOf(fuelBIn),
			)

			// ── never-sent: the first send of each account — self-pay on A, fuel on B ──
			const fjA0 = await fj(A)
			const feeA1 = await sendCell(ctx, "never-sent / first / send / self-pay", selfA)
			expect(await fj(A), "A paid its first transaction from its own public Fee Juice").toBe(fjA0 - feeA1)
			await sendCell(ctx, "never-sent / second / send / fpc-fuel", fuelBIn)
			const creditB = await fpcCredit(ctx, B, fpc)
			expect(creditB, "B's fuel remainder is its PrivateFPC credit").toBeGreaterThan(0n)
			expect(creditB, "the fuel paid B's first transaction").toBeLessThan(fuelB.amount)

			// ── deployed: A's credit from its (unspent) fuel, minted through the extension ──
			await claimPrivateFuel(wallet, fuelA)
			// The mint reads the claim's nullifier at the wallet's anchor block; let the PXE sync it.
			await new Promise((r) => setTimeout(r, PXE_ANCHOR_SYNC_WORKAROUND_MS))
			{
				cell("deployed / first / credit mint (PrivateFPC.mint as A)")
				await setFields(page, mintFields(fuelAIn))
				const r = await sendThroughPopup(ctx, "phase.mintCredit", "pg-btn-phase-mintCredit", { feeMethod: "sponsored" })
				await assertPgOk(page, r, "PrivateFPC.mint as A")
				await waitForTxMined(config, hashOf(r), 240_000)
			}
			await expect.poll(() => fpcCredit(ctx, A, fpc), { timeout: 90_000, interval: 5_000 }).toBe(fuelA.amount)

			// ── deployed: the full {first, second} × {simulate, send} × {self-pay, fpc-credit} ──
			const creditA: MintInputs = { token: tokenA, from: A, route: "fpc-credit", fpc }
			const creditBIn: MintInputs = { token: tokenB, from: B, route: "fpc-credit", fpc }
			for (const [who, self, credit] of [
				["first", selfA, creditA],
				["second", selfB, creditBIn],
			] as const) {
				await simulateCell(
					ctx,
					`deployed / ${who} / simulate / self-pay`,
					self,
					{ deployed: true, feePayer: self.from, setup: [] },
					stateOf(self),
				)
				await simulateCell(
					ctx,
					`deployed / ${who} / simulate / fpc-credit`,
					credit,
					{ deployed: true, feePayer: fpc, setup: [] },
					stateOf(credit),
				)
				const fj0 = await fj(self.from)
				const fee = await sendCell(ctx, `deployed / ${who} / send / self-pay`, self)
				expect(await fj(self.from), `${who}: paid from its own public Fee Juice`).toBe(fj0 - fee)
				const credit0 = await fpcCredit(ctx, credit.from, fpc)
				await sendCell(ctx, `deployed / ${who} / send / fpc-credit`, credit)
				expect(await fpcCredit(ctx, credit.from, fpc), `${who}: paid from its PrivateFPC credit`).toBeLessThan(credit0)
			}

			// ── shape (a), the public transfer from the SECOND account: simulate + send, self-paid ──
			cell("deployed / second / transfer / simulate / self-pay")
			await mintPublicTokensForAccount(config, B)
			await setFields(page, {
				"pg-input-tokenAddress": config.tokenAddress,
				"pg-input-recipient": config.minterAddress,
				"pg-input-amount": "1",
				"pg-input-feePayer": B,
				"pg-input-from": B,
				"pg-toggle-skipValidation": "on",
			})
			const sim = await callExpectingNoPopup(
				ctx,
				page,
				"simulateTx",
				() => clickByTestId(page, "pg-btn-simulateTx-transfer"),
				180_000,
			)
			await assertPgOk(page, sim, "transfer simulate as B, self-paid")
			const t = sim.resultJson as SimulationSummary
			expect(lower(t.feePayer)).toBe(lower(B))
			expect(lower(t.entrypoint.contract)).toBe(lower(B))
			expect(t.setupCalls).toEqual([])
			expect(t.appCalls.map((c) => lower(c.contract))).toEqual([lower(config.tokenAddress)])
			{
				cell("deployed / second / transfer / send / self-pay")
				const fjB0 = await fj(B)
				const tokens = async () => ({
					sender: await readPublicTokenBalance(config, config.tokenAddress, B),
					recipient: await readPublicTokenBalance(config, config.tokenAddress, config.minterAddress),
				})
				const tokens0 = await tokens()
				const r = await sendThroughPopup(ctx, "sendTx", "pg-btn-sendTx-feePayer")
				await assertPgOk(page, r, "transfer send as B, self-paid")
				await waitForTxMined(config, hashOf(r), 240_000)
				const receipt = await node.getTxReceipt(TxHash.fromString(hashOf(r)))
				const fee = receipt.transactionFee ?? 0n
				expect(fee, "the transfer was charged a fee").toBeGreaterThan(0n)
				expect(await fj(B), "B paid the transfer from its own public Fee Juice").toBe(fjB0 - fee)
				expect(await tokens(), "the transfer moved one token from B to the minter").toEqual({
					sender: tokens0.sender - 1n,
					recipient: tokens0.recipient + 1n,
				})
			}

			// ── negative control: a public enqueue left in setup is rejected by the node ──
			// `from = B, feePayer = A, no fee call`: the wallet legitimately builds it as externally
			// paid, no call ends setup, and the node's validator refuses the transfer's enqueue with
			// the production error text. The dApp sees the scrubbed envelope; the text is read from
			// the service worker's log trail (retained with Developer Mode on).
			cell("negative control / second / transfer / simulate / external payer")
			await setFields(page, { "pg-input-feePayer": A, "pg-input-from": B, "pg-toggle-skipValidation": "on" })
			const negStartedAt = Date.now()
			const neg = await callExpectingNoPopup(
				ctx,
				page,
				"simulateTx",
				() => clickByTestId(page, "pg-btn-simulateTx-transfer"),
				180_000,
			)
			expect(neg.status, "the node must reject the external-payer transfer in simulation").toBe("error")
			const walletPopup = await openPopup(ctx)
			let rejection: unknown[] = []
			await expect
				.poll(
					async () => {
						const trail = await readSwLogTrail(walletPopup, { match: "Setup function not on allow list", limit: 3 })
						// Only a rejection newer than this call counts, never a retained earlier one.
						rejection = (Array.isArray(trail) ? trail : []).filter(
							(e) => Number((e as { timestamp?: number }).timestamp) >= negStartedAt,
						)
						return rejection.length
					},
					{ timeout: 30_000, interval: 1_000 },
				)
				.toBeGreaterThan(0)
			console.log(`[selfpay-phase] node rejection: ${JSON.stringify(rejection[0]).slice(0, 1_500)}`)
			await walletPopup.close()
		} finally {
			await cleanup()
		}
	},
)
