/** The bridge round trips as pure functions of a context. Each returns the one-line evidence the
 *  smoke prints; each throws on the first assertion it cannot make. None keeps state between calls. */
import { SetPublicAuthwitContractInteraction } from "@aztec/aztec.js/authorization"
import type { ContractBase } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { TestERC20Abi } from "@aztec/l1-artifacts"
import type { Address, Hex } from "viem"
import { TOKEN_PORTAL_ABI } from "../../src/factory-abi"
import { consumeWithdrawal } from "../../src/flows"
import { exitViaHub, type HubExitParams, hubExitsPaused, hubTokenFor, preflightHubExit, simulateHubExit } from "../../src/hub-l2"
import type { JournalTokenBlock } from "../../src/journal"
import type { ManifestToken } from "../../src/manifest-v2"
import { deriveBridgeSecret, PRIVATE_FPC_ADDRESS } from "../../src/private-fuel"
import { discoverFuelRoute } from "../../src/route-discovery"
import type { SendResult } from "../../src/send-flow"
import { waitForL1ToL2Message } from "../generation"
import { ensureRouterPermit2 } from "../script-l1"
import { FAKE_WETH, MIN_FJ, MOCK_RATE_NUM, MULTICALL3, PERMIT2, ZERO_L1 } from "./constants"
import {
	balanceOf,
	claim,
	claimOnce,
	depositFresh,
	ensurePrivateFpc,
	exitCeiling,
	type FeeMode,
	fpcClaimFee,
	fuelClaimFee,
	mintPrivateGasNote,
	mockRoute,
	privateCreditOf,
	privateExitFee,
	privateFpc,
	registerArgsOf,
	sampleExitGas,
	send,
	type SmokeContext,
	tokenBlockOf,
} from "./context"
import { erc20BalanceOf, freshToken, mint, mintFeeAsset } from "./l1"
import { withBlockHeartbeat } from "./l2"

// ─── Deposits ────────────────────────────────────────────────────────────────

export async function flowPublicDeposit(s: SmokeContext, token: ManifestToken, l2Token: ContractBase): Promise<string> {
	const amount = 100n * 10n ** BigInt(token.decimals)
	await mint(s.l1, token.erc20 as Address, s.l1.account.address, amount)
	const before = await balanceOf(l2Token, s.l2.from, "public")
	const res = await send(s, s.l1, {
		intent: "token",
		erc20: token.erc20 as Address,
		amount,
		aztecRecipient: s.l2.from.toString() as Hex,
		isPrivate: false,
	})
	const outcome = await claim(s, res, { amount, isPrivate: false, recipient: s.l2.from })
	const gained = (await balanceOf(l2Token, s.l2.from, "public")) - before
	if (gained < amount) throw new Error(`public balance rose by ${gained}, expected ${amount}`)
	if (outcome.path !== "claim") throw new Error(`expected the plain claim path for a registered token, got ${outcome.path}`)
	return `${outcome.path}, +${gained} ${token.displaySymbol}`
}

export async function flowPrivateDeposit(s: SmokeContext, token: ManifestToken, l2Token: ContractBase): Promise<string> {
	const amount = 50n * 10n ** BigInt(token.decimals)
	await mint(s.l1, token.erc20 as Address, s.l1.account.address, amount)
	const before = await balanceOf(l2Token, s.l2.from, "private")
	const res = await send(s, s.l1, {
		intent: "token",
		erc20: token.erc20 as Address,
		amount,
		aztecRecipient: s.l2.from.toString() as Hex,
		isPrivate: true,
		claimSalt: Fr.random(),
	})
	const outcome = await claim(s, res, { amount, isPrivate: true, recipient: s.l2.from })
	const gained = (await balanceOf(l2Token, s.l2.from, "private")) - before
	if (gained < amount) throw new Error(`private balance rose by ${gained}, expected ${amount}`)
	return `${outcome.path}, +${gained} ${token.displaySymbol} privately`
}

export async function flowRelayedPrivateDeposit(s: SmokeContext, token: ManifestToken, l2Token: ContractBase): Promise<string> {
	const amount = 25n * 10n ** BigInt(token.decimals)
	await mint(s.l1, token.erc20 as Address, s.l1.account.address, amount)
	const res = await send(s, s.l1, {
		intent: "token",
		erc20: token.erc20 as Address,
		amount,
		aztecRecipient: s.l2.from.toString() as Hex,
		isPrivate: true,
		claimSalt: Fr.random(),
	})
	await waitForL1ToL2Message(s.l2.node, res.tokenMessageHashHex as string, { forceBlock: s.l2.forceBlock })
	// The consumption secret is derived from (salt, recipient) in-circuit, so naming the relayer as
	// the recipient derives a secret that consumes nothing.
	let redirected = false
	try {
		await claimOnce(s, res, { amount, isPrivate: true, recipient: s.relayer, submitter: "relayer" })
		redirected = true
	} catch {}
	if (redirected) throw new Error("SECURITY: a relayer redirected a private claim to itself")

	const before = await balanceOf(l2Token, s.l2.from, "private")
	const outcome = await claim(s, res, { amount, isPrivate: true, recipient: s.l2.from, submitter: "relayer" })
	const gained = (await balanceOf(l2Token, s.l2.from, "private")) - before
	if (gained < amount) throw new Error(`relayed claim credited ${gained}, expected ${amount}`)
	return `wrong recipient rejected, then ${outcome.path} submitted by the relayer credited the actor`
}

export async function flowTokenPlusGas(s: SmokeContext, token: ManifestToken, l2Token: ContractBase): Promise<string> {
	const unit = 10n ** BigInt(token.decimals)
	const total = 100n * unit
	// The slice has to buy enough Fee Juice to pay the claim it funds, which the mock's fixed rate
	// makes exact: 40 whole 6-decimal units → 4×10^19 FJ-wei.
	const fuelAmount = 40n * unit
	await mint(s.l1, token.erc20 as Address, s.l1.account.address, total)
	const route = mockRoute(token.erc20 as Address, s.clients.deployment.feeJuice)
	const res = await send(s, s.l1, {
		intent: "token+gas",
		erc20: token.erc20 as Address,
		amount: total,
		aztecRecipient: s.l2.from.toString() as Hex,
		isPrivate: false,
		gas: {
			fuelAmount,
			fuelRecipient: s.l2.from.toString() as Hex,
			// The mock's rate is fixed, so the exact output IS the floor — nothing here is a guess.
			minFuelOutput: fuelAmount * MOCK_RATE_NUM,
			path: route.path,
			zeroForOnes: route.zeroForOnes,
		},
	})
	await waitForL1ToL2Message(s.l2.node, res.fuelMessageHashHex as string, { forceBlock: s.l2.forceBlock })
	const before = await balanceOf(l2Token, s.l2.from, "public")
	const outcome = await claim(s, res, {
		amount: total - fuelAmount,
		isPrivate: false,
		recipient: s.l2.from,
		fee: fuelClaimFee(s, res),
		feeMode: "fee-juice",
	})
	const gained = (await balanceOf(l2Token, s.l2.from, "public")) - before
	if (gained < total - fuelAmount) throw new Error(`token leg credited ${gained}, expected ${total - fuelAmount}`)
	return `${outcome.path} paid for itself with the ${res.fuelReceived} FJ-wei the same send bridged`
}

export async function flowGasOnly(s: SmokeContext): Promise<string> {
	const amount = 20n * MIN_FJ
	const feeAsset = s.clients.deployment.feeJuice
	await mintFeeAsset(s.l1, feeAsset, s.l1.account.address, amount)
	await ensureRouterPermit2(s.l1, { usdc: feeAsset, usdcAbi: TestERC20Abi, permit2: PERMIT2, needed: amount, mins: s.mins })
	const res = await send(s, s.l1, {
		intent: "gas",
		erc20: feeAsset,
		amount,
		aztecRecipient: s.l2.from.toString() as Hex,
		isPrivate: false,
		gas: { fuelAmount: amount, fuelRecipient: s.l2.from.toString() as Hex, minFuelOutput: amount, path: [], zeroForOnes: [] },
	})
	await waitForL1ToL2Message(s.l2.node, res.fuelMessageHashHex as string, { forceBlock: s.l2.forceBlock })
	const before = await balanceOf(s.feeJuiceL2, s.l2.from, "public")
	await s.feeJuiceL2.methods
		.claim(s.l2.from, amount, Fr.fromHexString(res.fuelSecretHex as string), new Fr(res.fuelLeafIndex as bigint))
		.send(s.l2.sendOpts as never)
	const gained = (await balanceOf(s.feeJuiceL2, s.l2.from, "public")) - before
	if (gained < amount) throw new Error(`fee juice balance rose by ${gained}, expected ${amount}`)
	return `bridge() into the FeeJuicePortal, +${gained} FJ-wei claimed as fee juice`
}

// ─── Private gas held at the PrivateFPC ──────────────────────────────────────

/** One note worth 1.4× the ceiling: the exit that spends it selects exactly one, and the change it
 *  leaves (≈0.4×) is small enough to be one of the three the fragmented exit needs. Starts from
 *  nothing: credit a re-attached run already holds would make the note shape unknowable. */
export async function flowPrivateGasOneNote(s: SmokeContext): Promise<string> {
	const fpc = await privateFpc(s)
	const held = await privateCreditOf(s, fpc)
	if (held !== 0n) throw new Error(`the actor already holds ${held} FJ-wei of private gas; the note inventory cannot be established`)
	const gained = await mintPrivateGasNote(s, fpc, ((await exitCeiling(s)) * 14n) / 10n)
	s.credit.notes.push(gained)
	return `bridge() to the PrivateFPC, FeeJuice.claim then PrivateFPC.mint credited ${gained} FJ-wei as one note`
}

/** Two more notes of 0.45× the ceiling each. Beside the first exit's change (≈0.4×) no note and no
 *  pair covers a ceiling, so the next exit's `pay_fee` has to select all three — past the two the
 *  FPC reads first, into its recursion — which is the shape an account that keeps bridging leaves.
 *  The send re-checks that shape at its own ceiling before spending anything. */
export async function flowPrivateGasFragmented(s: SmokeContext): Promise<string> {
	const fpc = await privateFpc(s)
	const each = ((await exitCeiling(s)) * 45n) / 100n
	s.credit.notes.push(await mintPrivateGasNote(s, fpc, each), await mintPrivateGasNote(s, fpc, each))
	const held = await privateCreditOf(s, fpc)
	if (held !== s.credit.total) throw new Error(`the credit ${held} is not the inventory's ${s.credit.total}`)
	return `notes of ${s.credit.notes.join(", ")} FJ-wei held (${held} in all); none covers a ceiling, nor does any pair`
}

// ─── Exits ───────────────────────────────────────────────────────────────────

export interface ExitPlan {
	token: ManifestToken
	l2Token: ContractBase
	amount: bigint
	isPrivate: boolean
	/** Names a private exit's gas sample in the report. */
	label?: string
	/** The credit notes the private exit's `pay_fee` is expected to spend (default 1); the send refuses when the inventory at its ceiling says otherwise. */
	notes?: number
}

async function exitAuthwit(s: SmokeContext, p: ExitPlan, nonce: Fr): Promise<{ authWitnesses?: unknown[] }> {
	const burn = p.isPrivate
		? p.l2Token.methods.burn_private(s.l2.from, p.amount, nonce)
		: p.l2Token.methods.burn_public(s.l2.from, p.amount, nonce)
	const intent = { caller: s.hub.address, action: burn }
	if (!p.isPrivate) {
		const authwit = await SetPublicAuthwitContractInteraction.create(s.l2.wallet as never, s.l2.from, intent as never, true)
		await authwit.send(s.l2.sendOpts as never)
		return {}
	}
	return { authWitnesses: [await s.l2.wallet.createAuthWit(s.l2.from, intent as never)] }
}

type ExitReceipt = { txHash: unknown }

/** Sends the exit the way the app does. A public one runs the preflight (pause assert, portal
 *  read, burn) before any authwit is spent and rides the sponsor; a private one carries its witness
 *  and is paid by the PrivateFPC from held credit — its simulation is read for gas, and the credit
 *  around the send for what the FPC kept. */
async function sendExit(
	s: SmokeContext,
	exit: HubExitParams,
	extra: { authWitnesses?: unknown[] },
	sample: { label: string; notes: number },
): Promise<ExitReceipt> {
	const from = s.l2.from.toString()
	if (!exit.isPrivate) {
		await preflightHubExit(s.hub, exit, from)
		const { receipt } = (await exitViaHub(s.hub, exit, { ...s.l2.sendOpts, ...extra })) as unknown as { receipt: ExitReceipt }
		return receipt
	}
	const fpc = await privateFpc(s)
	const { fee, ceiling, limits } = await privateExitFee(s)
	// The ceiling is priced now, not when the notes were minted: the shape is checked at this price.
	const selecting = s.credit.selectedFor(ceiling)
	if (selecting !== sample.notes) {
		throw new Error(
			`${sample.label}: at the ceiling ${ceiling} pay_fee selects ${selecting} note(s), not ${sample.notes}; the fixture lost its shape`,
		)
	}
	const sim = await simulateHubExit(s.hub, exit, from, { ...extra, fee })
	const before = await privateCreditOf(s, fpc)
	const { receipt } = (await exitViaHub(s.hub, exit, { ...s.l2.sendOpts, ...extra, fee })) as unknown as { receipt: ExitReceipt }
	const after = await privateCreditOf(s, fpc)
	await sampleExitGas(s, sample, String(receipt.txHash), sim, { charged: before - after, ceiling, limits })
	s.credit.spend(selecting, ceiling)
	if (after !== s.credit.total) throw new Error(`${sample.label}: the credit ${after} is not the inventory's ${s.credit.total}`)
	return receipt
}

export async function runExit(s: SmokeContext, p: ExitPlan): Promise<string> {
	const authwitNonce = Fr.random()
	const extra = await exitAuthwit(s, p, authwitNonce)
	const exit: HubExitParams = {
		l2Token: p.token.l2Token,
		recipientL1: s.l1.account.address,
		amount: p.amount,
		callerOnL1: ZERO_L1,
		authwitNonce,
		isPrivate: p.isPrivate,
	}
	const receipt = await sendExit(s, exit, extra, { label: p.label ?? "private", notes: p.notes ?? 1 })
	const before = await erc20BalanceOf(s.l1, p.token.erc20 as Address, s.l1.account.address)
	// The burn's epoch cannot prove while the chain is idle, and the Outbox refuses the consume until
	// it has — so the heartbeat runs for the whole finalization, not just the message wait.
	await withBlockHeartbeat(s.l2, () =>
		consumeWithdrawal(
			s.l1,
			s.l2.node as never,
			receipt,
			{
				recipientL1: s.l1.account.address,
				amount: p.amount,
				portal: p.token.portal as Address,
				portalAbi: TOKEN_PORTAL_ABI as never,
				provenTimeoutSec: 900,
			},
			(stage) => console.log(`    withdraw: ${stage} (${s.mins()})`),
		),
	)
	const released = (await erc20BalanceOf(s.l1, p.token.erc20 as Address, s.l1.account.address)) - before
	if (released < p.amount) throw new Error(`L1 released ${released}, expected ${p.amount}`)
	return `${p.isPrivate ? "private" : "public"} burn → Outbox consume released ${released} ${p.token.displaySymbol}-units on L1`
}

// ─── First-time token shapes ─────────────────────────────────────────────────

export async function flowRelayerFirstRegister(s: SmokeContext): Promise<string> {
	const amount = 10n ** 18n
	const erc20 = await freshToken(s.l1, { name: "Relayer First", symbol: "RLY", decimals: 18 }, [s.l1.account.address], amount)
	const res = await depositFresh(s, erc20, amount)
	const block = res.token as JournalTokenBlock
	const l2Token = await s.l2TokenOf(block)
	await waitForL1ToL2Message(s.l2.node, block.registerKey as string, { forceBlock: s.l2.forceBlock })
	// The relayer consumes the factory's register leaf; the depositor's claim then has nothing left to
	// register and must succeed as a plain claim.
	await s.hub.methods.register_token(...registerArgsOf(block, block.nameWord)).send(s.relayerOpts as never)
	const outcome = await claim(s, res, { amount, isPrivate: false, recipient: s.l2.from })
	if (outcome.path !== "claim") throw new Error(`expected a plain claim after a relayer registration, got ${outcome.path}`)
	const balance = await balanceOf(l2Token, s.l2.from, "public")
	if (balance < amount) throw new Error(`balance ${balance} < ${amount}`)
	return `the relayer registered RLY first, the depositor's ${outcome.path} landed ${balance}`
}

export async function flowConcurrentFirstClaims(s: SmokeContext): Promise<string> {
	const amount = 10n ** 18n
	const erc20 = await freshToken(
		s.l1,
		{ name: "Race Token", symbol: "RACE", decimals: 18 },
		[s.l1.account.address, s.l1b.account.address],
		amount,
	)
	const first = await depositFresh(s, erc20, amount)
	const second = await depositFresh(s, erc20, amount, s.l1b)
	await waitForL1ToL2Message(s.l2.node, second.tokenMessageHashHex as string, { forceBlock: s.l2.forceBlock })

	const settled = await Promise.allSettled([
		claim(s, first, { amount, isPrivate: false, recipient: s.l2.from }),
		claim(s, second, { amount, isPrivate: false, recipient: s.relayer, submitter: "relayer" }),
	])
	const paths: string[] = []
	for (const [i, outcome] of settled.entries()) {
		if (outcome.status === "fulfilled") {
			paths.push(outcome.value.path)
			continue
		}
		// The loser of the register race retries as a plain claim once the winner's registration lands.
		const retry = await claim(s, i === 0 ? first : second, {
			amount,
			isPrivate: false,
			recipient: i === 0 ? s.l2.from : s.relayer,
			submitter: i === 0 ? undefined : "relayer",
		})
		paths.push(retry.path)
	}
	if (paths.filter((p) => p === "register+claim").length !== 1 || paths.filter((p) => p === "claim").length !== 1) {
		throw new Error(`expected one register+claim and one plain claim, got ${paths.join(" + ")}`)
	}
	return `two first-time deposits from two L1 accounts settled as ${paths.join(" + ")}`
}

export async function flowPortalOnlyToken(s: SmokeContext, pxo: ManifestToken): Promise<string> {
	const amount = 10n ** 18n
	if (await hubTokenFor(s.hub, pxo.erc20, s.l2.from.toString()))
		throw new Error("PXO was already registered — the fixture is not portal-only")
	await mint(s.l1, pxo.erc20 as Address, s.l1.account.address, amount)
	const res = await depositFresh(s, pxo.erc20 as Address, amount)
	const outcome = await claim(s, res, { amount, isPrivate: false, recipient: s.l2.from })
	if (outcome.path !== "register+claim") throw new Error(`expected register+claim for a portal-only token, got ${outcome.path}`)
	const l2Token = await s.l2TokenOf(res.token as JournalTokenBlock)
	const balance = await balanceOf(l2Token, s.l2.from, "public")
	if (balance < amount) throw new Error(`balance ${balance} < ${amount}`)
	return `portal existed, hub did not know it; the claim took ${outcome.path}`
}

/** Discovery pointed at a contract without the quoter selector makes every candidate hop revert —
 *  exactly the shape a token with no pool produces. */
export async function flowNoRoute(
	s: SmokeContext,
	nort: Address,
	quoterWithoutSelector: Address = s.clients.deployment.swapTarget,
): Promise<string> {
	const outcome = await discoverFuelRoute({
		client: s.l1.pub as never,
		quoter: quoterWithoutSelector,
		multicall3: MULTICALL3,
		token: nort,
		feeAsset: s.clients.deployment.feeJuice,
		weth: FAKE_WETH,
		feeJuice: s.clients.deployment.feeJuice,
		tiers: [{ fee: 3000, tickSpacing: 60 }],
		ethFj: { fee: 3000, tickSpacing: 60 },
		probeAmount: 10n ** 18n,
	})
	if (outcome.kind !== "no-route") throw new Error(`expected no-route for NORT, got ${outcome.kind}`)
	// The refusal is the whole point: nothing was signed, so no Permit2 nonce and no L1 tx exist.
	let refused = ""
	try {
		await send(s, s.l1, {
			intent: "token+gas",
			erc20: nort,
			amount: 2n * 10n ** 18n,
			aztecRecipient: s.l2.from.toString() as Hex,
			isPrivate: false,
			gas: { fuelAmount: 10n ** 18n, fuelRecipient: s.l2.from.toString() as Hex, minFuelOutput: 0n, path: [], zeroForOnes: [] },
		})
	} catch (e) {
		refused = e instanceof Error ? e.message : String(e)
	}
	if (!refused) throw new Error("a routeless token+gas send was signed and broadcast")
	return `discoverFuelRoute → no-route (tried ${outcome.tried}); the send was refused before signing (${refused.slice(0, 60)}…)`
}

// ─── Rejected registration under each fee mode ───────────────────────────────

const FEE_MODE_SYMBOL: Record<FeeMode, string> = { sponsored: "BADS", "fee-juice-claim": "BADF", "private-fpc": "BADP" }

/** The deposit each fee mode's claim is paid from. Only the sponsored lane needs no gas leg. */
async function fundedSendFor(
	s: SmokeContext,
	mode: FeeMode,
	erc20: Address,
	total: bigint,
	fuelAmount: bigint,
	bridgeSalt: Fr,
): Promise<SendResult> {
	if (mode === "sponsored") {
		return send(s, s.l1, { intent: "token", erc20, amount: total, aztecRecipient: s.l2.from.toString() as Hex, isPrivate: false })
	}
	const route = mockRoute(erc20, s.clients.deployment.feeJuice)
	const toFpc = mode === "private-fpc"
	return send(s, s.l1, {
		intent: "token+gas",
		erc20,
		amount: total,
		aztecRecipient: s.l2.from.toString() as Hex,
		isPrivate: false,
		gas: {
			fuelAmount,
			fuelRecipient: (toFpc ? PRIVATE_FPC_ADDRESS : s.l2.from.toString()) as Hex,
			minFuelOutput: fuelAmount * MOCK_RATE_NUM,
			path: route.path,
			zeroForOnes: route.zeroForOnes,
			// The FPC rebuilds this secret from the claimer inside `mint_and_pay_fee`; a random one
			// would strand the Fee Juice at the FPC forever.
			fuelSecret: toFpc ? deriveBridgeSecret(bridgeSalt, s.l2.from) : undefined,
		},
	})
}

/** A tampered word hashes to a message the Inbox never carried, so the consume finds no witness —
 *  and because the consume runs FIRST, the register leaf survives for the corrected attempt. */
async function rejectTamperedRegistration(s: SmokeContext, block: JournalTokenBlock): Promise<string> {
	const tampered = `0x00${"ff".repeat(31)}`
	try {
		await s.hub.methods.register_token(...registerArgsOf(block, tampered)).send(s.l2.sendOpts as never)
	} catch (e) {
		return e instanceof Error ? e.message : String(e)
	}
	throw new Error("a registration with tampered metadata was accepted")
}

export async function flowRejectedRegistration(s: SmokeContext, mode: FeeMode): Promise<string> {
	if (mode === "private-fpc") await ensurePrivateFpc(s)
	const unit = 10n ** 6n
	const total = 100n * unit
	const fuelAmount = mode === "sponsored" ? 0n : 40n * unit
	const bridgeSalt = Fr.random()
	const erc20 = await freshToken(
		s.l1,
		{ name: `Bad Register ${mode}`, symbol: FEE_MODE_SYMBOL[mode], decimals: 6 },
		[s.l1.account.address],
		total,
	)
	const res = await fundedSendFor(s, mode, erc20, total, fuelAmount, bridgeSalt)

	const block = res.token as JournalTokenBlock
	await waitForL1ToL2Message(s.l2.node, block.registerKey as string, { forceBlock: s.l2.forceBlock })
	if (fuelAmount > 0n) await waitForL1ToL2Message(s.l2.node, res.fuelMessageHashHex as string, { forceBlock: s.l2.forceBlock })
	const rejection = await rejectTamperedRegistration(s, block)

	const amount = total - fuelAmount
	const fee =
		mode === "private-fpc" ? await fpcClaimFee(s, res, bridgeSalt) : mode === "fee-juice-claim" ? fuelClaimFee(s, res) : undefined
	const feeMode = mode === "sponsored" ? "sponsored" : mode === "private-fpc" ? "private-fpc" : "fee-juice"
	const outcome = await claim(s, res, { amount, isPrivate: false, recipient: s.l2.from, fee, feeMode })
	if (outcome.path !== "register+claim") throw new Error(`expected register+claim after the rejected attempt, got ${outcome.path}`)
	const balance = await balanceOf(await s.l2TokenOf(block), s.l2.from, "public")
	if (balance < amount) throw new Error(`balance ${balance} < ${amount}`)
	return `tampered register rejected ("${rejection.slice(0, 70)}"), corrected ${outcome.path} landed ${balance} under ${mode}`
}

// ─── Guardian pause ──────────────────────────────────────────────────────────

/** Pauses, proves the refusal, proves a claim still lands, and ALWAYS unpauses — a paused hub left
 *  behind would fail every later exit for reasons unrelated to them. */
export async function flowGuardianPause(s: SmokeContext, token: ManifestToken): Promise<string> {
	const exit = {
		l2Token: token.l2Token,
		recipientL1: s.l1.account.address,
		amount: 1n,
		callerOnL1: ZERO_L1,
		authwitNonce: Fr.random(),
		isPrivate: false,
	}
	await s.hub.methods.set_exits_paused(true).send(s.l2.sendOpts as never)
	let claimed: string
	try {
		if (!(await hubExitsPaused(s.hub, s.l2.from.toString()))) throw new Error("exits_paused() stayed false after the pause")
		let refusal = ""
		try {
			await preflightHubExit(s.hub, exit, s.l2.from.toString())
		} catch (e) {
			refusal = e instanceof Error ? e.message : String(e)
		}
		if (!/exits paused/i.test(refusal))
			throw new Error(`a paused exit preflight failed with "${refusal.slice(0, 120)}" instead of "exits paused"`)
		// Claims are deliberately NOT pausable: a deposit already made must always be claimable.
		claimed = await flowPublicDeposit(s, token, await s.l2TokenOf(tokenBlockOf(token)))
	} finally {
		await s.hub.methods.set_exits_paused(false).send(s.l2.sendOpts as never)
	}
	if (await hubExitsPaused(s.hub, s.l2.from.toString())) throw new Error("exits_paused() stayed true after the unpause")
	return `exit preflight refused with "exits paused" while a claim still landed (${claimed}); unpaused`
}
