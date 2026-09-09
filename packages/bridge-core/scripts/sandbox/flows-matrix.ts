/** The matrix cells the original smoke never drove: held-gas claims, the private fuel leg, the
 *  swap floor binding, every gas-only shape, a send that consumes a DISCOVERED route, and the
 *  Outbox refusing an unproven consume. Same contract as `flows.ts`: pure functions of a context. */
import { SetPublicAuthwitContractInteraction } from "@aztec/aztec.js/authorization"
import type { ContractBase } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { OutboxContract } from "@aztec/ethereum/contracts"
import { TestERC20Abi } from "@aztec/l1-artifacts"
import { computeL2ToL1MembershipWitness } from "@aztec/stdlib/messaging"
import type { Address, Hex } from "viem"
import { TOKEN_PORTAL_ABI } from "../../src/factory-abi"
import { consumeWithdrawal, isOutboxMessageConsumed } from "../../src/flows"
import { signedMinFuelOutput } from "../../src/gas-share"
import { exitViaHub, type HubExitParams, preflightHubExit } from "../../src/hub-l2"
import type { JournalTokenBlock } from "../../src/journal"
import type { ManifestToken } from "../../src/manifest-v2"
import { deriveBridgeSecret, PRIVATE_FPC_ADDRESS } from "../../src/private-fuel"
import { discoverFuelRoute } from "../../src/route-discovery"
import { waitForL1ToL2Message } from "../generation"
import { ensureRouterPermit2 } from "../script-l1"
import { MIN_FJ, MOCK_RATE_NUM, MULTICALL3, PERMIT2, SANDBOX_ETH_FJ, SANDBOX_TIER, ZERO_L1 } from "./constants"
import {
	balanceOf,
	claim,
	exitCeiling,
	fpcClaimFee,
	fuelClaimFee,
	mintPrivateGasNote,
	mockRoute,
	privateCreditOf,
	privateFpc,
	send,
	type SmokeContext,
} from "./context"
import { erc20BalanceOf, freshToken, mint, mintFeeAsset, setRoutable } from "./l1"
import { withBlockHeartbeat } from "./l2"

const toWei = (token: ManifestToken, whole: bigint) => whole * 10n ** BigInt(token.decimals)

// ─── Held gas ────────────────────────────────────────────────────────────────

/** Funds the actor's PUBLIC Fee Juice through the portal (the fee asset's identity route). */
export async function fundPublicFeeJuice(s: SmokeContext, amount: bigint): Promise<void> {
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
	await s.feeJuiceL2.methods
		.claim(s.l2.from, amount, Fr.fromHexString(res.fuelSecretHex as string), new Fr(res.fuelLeafIndex as bigint))
		.send(s.l2.sendOpts as never)
}

/** Cell 5: a token-only claim whose fee comes from Fee Juice the account already holds — no fee
 *  method named, so the wallet's own default (its public balance) pays, and the contracts accept it. */
export async function flowTokenOnlyHeldPublicFj(s: SmokeContext, token: ManifestToken, l2Token: ContractBase): Promise<string> {
	const amount = toWei(token, 10n)
	await fundPublicFeeJuice(s, 5n * MIN_FJ)
	const fjBefore = await balanceOf(s.feeJuiceL2, s.l2.from, "public")
	await mint(s.l1, token.erc20 as Address, s.l1.account.address, amount)
	const before = await balanceOf(l2Token, s.l2.from, "public")
	const res = await send(s, s.l1, {
		intent: "token",
		erc20: token.erc20 as Address,
		amount,
		aztecRecipient: s.l2.from.toString() as Hex,
		isPrivate: false,
	})
	// `fee: {}` names no payment method: the embedded wallet falls to PREEXISTING_FEE_JUICE.
	const outcome = await claim(s, res, { amount, isPrivate: false, recipient: s.l2.from, fee: {}, feeMode: "fee-juice" })
	const gained = (await balanceOf(l2Token, s.l2.from, "public")) - before
	const fjSpent = fjBefore - (await balanceOf(s.feeJuiceL2, s.l2.from, "public"))
	if (gained < amount) throw new Error(`balance rose by ${gained}, expected ${amount}`)
	if (fjSpent <= 0n) throw new Error("the claim did not spend the account's held public Fee Juice")
	return `${outcome.path} paid ${fjSpent} FJ-wei from held public Fee Juice`
}

// ─── The fuel leg ────────────────────────────────────────────────────────────

/** Cell 14: a fueled public claim leaves held private credit untouched. */
export async function flowTokenPlusGasWithCreditHeld(s: SmokeContext, token: ManifestToken, l2Token: ContractBase): Promise<string> {
	const fpc = await privateFpc(s)
	await mintPrivateGasNote(s, fpc, (await exitCeiling(s)) * 2n)
	const creditBefore = await privateCreditOf(s, fpc)
	const unit = 10n ** BigInt(token.decimals)
	const total = 100n * unit
	const fuelAmount = 40n * unit
	await mint(s.l1, token.erc20 as Address, s.l1.account.address, total)
	const route = mockRoute(token.erc20 as Address, s.clients.deployment.feeJuice, s.clients.deployment.tokens.weth)
	const res = await send(s, s.l1, {
		intent: "token+gas",
		erc20: token.erc20 as Address,
		amount: total,
		aztecRecipient: s.l2.from.toString() as Hex,
		isPrivate: false,
		gas: {
			fuelAmount,
			fuelRecipient: s.l2.from.toString() as Hex,
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
	const creditAfter = await privateCreditOf(s, fpc)
	if (creditAfter !== creditBefore) throw new Error(`the fueled claim touched the private credit (${creditBefore} → ${creditAfter})`)
	return `${outcome.path} paid by its own fuel; private credit ${creditAfter} untouched`
}

/** Cells 15 + 16: a PRIVATE deposit whose fuel goes to the PrivateFPC, which pays the claim from the
 *  credit that fuel becomes — on a registered token, or a fresh one (registration-then-credit). */
export async function flowTokenPlusGasPrivate(
	s: SmokeContext,
	base: ManifestToken | undefined,
	l2TokenOf: (b: JournalTokenBlock) => Promise<ContractBase>,
): Promise<string> {
	await privateFpc(s)
	const unit = 10n ** 6n
	const total = 100n * unit
	const fuelAmount = 40n * unit
	const bridgeSalt = Fr.random()
	const erc20 = base
		? (base.erc20 as Address)
		: await freshToken(s.l1, { name: "Private Fuel", symbol: "PFUEL", decimals: 6 }, [s.l1.account.address], total)
	if (base) await mint(s.l1, erc20, s.l1.account.address, total)
	else await setRoutable(s.l1, s.clients.deployment.quoter, erc20)
	const route = mockRoute(erc20, s.clients.deployment.feeJuice, s.clients.deployment.tokens.weth)
	const res = await send(s, s.l1, {
		intent: "token+gas",
		erc20,
		amount: total,
		aztecRecipient: s.l2.from.toString() as Hex,
		isPrivate: true,
		claimSalt: Fr.random(),
		gas: {
			fuelAmount,
			fuelRecipient: PRIVATE_FPC_ADDRESS as Hex,
			minFuelOutput: fuelAmount * MOCK_RATE_NUM,
			path: route.path,
			zeroForOnes: route.zeroForOnes,
			fuelSecret: deriveBridgeSecret(bridgeSalt, s.l2.from),
		},
	})
	const block = res.token as JournalTokenBlock
	if (!base) await waitForL1ToL2Message(s.l2.node, block.registerKey as string, { forceBlock: s.l2.forceBlock })
	await waitForL1ToL2Message(s.l2.node, res.fuelMessageHashHex as string, { forceBlock: s.l2.forceBlock })
	const l2Token = await l2TokenOf(block)
	const before = await balanceOf(l2Token, s.l2.from, "private")
	const outcome = await claim(s, res, {
		amount: total - fuelAmount,
		isPrivate: true,
		recipient: s.l2.from,
		fee: await fpcClaimFee(s, res, bridgeSalt),
		feeMode: "private-fpc",
	})
	const gained = (await balanceOf(l2Token, s.l2.from, "private")) - before
	if (gained < total - fuelAmount) throw new Error(`private token leg credited ${gained}, expected ${total - fuelAmount}`)
	const expected = base ? "claim" : "register+claim"
	if (outcome.path !== expected) throw new Error(`expected ${expected}, got ${outcome.path}`)
	return `${outcome.path} privately, its fee paid by the PrivateFPC from the fuel the same send minted`
}

/** Cell 17: a floor above what the venue pays reverts at settlement — the router's slippage bound,
 *  not a silent under-delivery. Nothing lands on L1. */
export async function flowMinFuelFloorBinds(s: SmokeContext, token: ManifestToken): Promise<string> {
	const unit = 10n ** BigInt(token.decimals)
	const total = 100n * unit
	const fuelAmount = 40n * unit
	await mint(s.l1, token.erc20 as Address, s.l1.account.address, total)
	const route = mockRoute(token.erc20 as Address, s.clients.deployment.feeJuice, s.clients.deployment.tokens.weth)
	let refused = ""
	try {
		await send(s, s.l1, {
			intent: "token+gas",
			erc20: token.erc20 as Address,
			amount: total,
			aztecRecipient: s.l2.from.toString() as Hex,
			isPrivate: false,
			gas: {
				fuelAmount,
				fuelRecipient: s.l2.from.toString() as Hex,
				minFuelOutput: fuelAmount * MOCK_RATE_NUM + 1n,
				path: route.path,
				zeroForOnes: route.zeroForOnes,
			},
		})
	} catch (e) {
		refused = e instanceof Error ? e.message : String(e)
	}
	if (!refused) throw new Error("a send whose floor exceeds the venue's output settled")
	return `floor one wei above the venue's output → refused (${refused.slice(0, 60)}…)`
}

// ─── Gas only, every shape ───────────────────────────────────────────────────

/** Cell 19: gas only, private — the fee asset bridged straight into PrivateFPC credit. */
export async function flowGasOnlyPrivate(s: SmokeContext): Promise<string> {
	const fpc = await privateFpc(s)
	const before = await privateCreditOf(s, fpc)
	const gained = await mintPrivateGasNote(s, fpc, 3n * MIN_FJ)
	const after = await privateCreditOf(s, fpc)
	if (after - before !== gained) throw new Error(`credit moved by ${after - before}, minted ${gained}`)
	return `fee asset → PrivateFPC credit, +${gained} FJ-wei private gas`
}

/** Cell 20: gas only through a SWAPPED token (USDC → FJ via the venue), public. */
export async function flowGasOnlySwapped(s: SmokeContext, token: ManifestToken): Promise<string> {
	const amount = toWei(token, 30n)
	await mint(s.l1, token.erc20 as Address, s.l1.account.address, amount)
	const route = mockRoute(token.erc20 as Address, s.clients.deployment.feeJuice, s.clients.deployment.tokens.weth)
	const res = await send(s, s.l1, {
		intent: "gas",
		erc20: token.erc20 as Address,
		amount,
		aztecRecipient: s.l2.from.toString() as Hex,
		isPrivate: false,
		gas: {
			fuelAmount: amount,
			fuelRecipient: s.l2.from.toString() as Hex,
			minFuelOutput: amount * MOCK_RATE_NUM,
			path: route.path,
			zeroForOnes: route.zeroForOnes,
		},
	})
	await waitForL1ToL2Message(s.l2.node, res.fuelMessageHashHex as string, { forceBlock: s.l2.forceBlock })
	const before = await balanceOf(s.feeJuiceL2, s.l2.from, "public")
	await s.feeJuiceL2.methods
		.claim(s.l2.from, res.fuelReceived ?? 0n, Fr.fromHexString(res.fuelSecretHex as string), new Fr(res.fuelLeafIndex as bigint))
		.send(s.l2.sendOpts as never)
	const gained = (await balanceOf(s.feeJuiceL2, s.l2.from, "public")) - before
	if (gained !== amount * MOCK_RATE_NUM) throw new Error(`swapped gas credited ${gained}, expected ${amount * MOCK_RATE_NUM}`)
	return `${amount} ${token.displaySymbol}-units swapped → +${gained} FJ-wei public gas`
}

/** Cell 21: a WETH deposit takes the single-hop route (native → FeeJuice). */
export async function flowGasOnlyWethSingleHop(s: SmokeContext): Promise<string> {
	const weth = s.clients.deployment.tokens.weth
	const amount = 2n * 10n ** 18n
	await mint(s.l1, weth, s.l1.account.address, amount)
	const outcome = await discoverFuelRoute({
		client: s.l1.pub as never,
		quoter: s.clients.deployment.quoter,
		multicall3: MULTICALL3,
		token: weth,
		feeAsset: s.clients.deployment.feeJuice,
		weth,
		feeJuice: s.clients.deployment.feeJuice,
		tiers: [SANDBOX_TIER],
		ethFj: SANDBOX_ETH_FJ,
		probeAmount: amount,
	})
	if (outcome.kind !== "route" || outcome.route.path.length !== 1)
		throw new Error(`expected a single-hop route for WETH, got ${outcome.kind}`)
	const res = await send(s, s.l1, {
		intent: "gas",
		erc20: weth,
		amount,
		aztecRecipient: s.l2.from.toString() as Hex,
		isPrivate: false,
		gas: {
			fuelAmount: amount,
			fuelRecipient: s.l2.from.toString() as Hex,
			minFuelOutput: outcome.quoteOut,
			path: outcome.route.path,
			zeroForOnes: outcome.route.zeroForOnes,
		},
	})
	await waitForL1ToL2Message(s.l2.node, res.fuelMessageHashHex as string, { forceBlock: s.l2.forceBlock })
	const before = await balanceOf(s.feeJuiceL2, s.l2.from, "public")
	await s.feeJuiceL2.methods
		.claim(s.l2.from, res.fuelReceived ?? 0n, Fr.fromHexString(res.fuelSecretHex as string), new Fr(res.fuelLeafIndex as bigint))
		.send(s.l2.sendOpts as never)
	const gained = (await balanceOf(s.feeJuiceL2, s.l2.from, "public")) - before
	if (gained !== outcome.quoteOut) throw new Error(`WETH gas credited ${gained}, quoted ${outcome.quoteOut}`)
	return `single-hop WETH route discovered and settled at exactly its quote (+${gained} FJ-wei)`
}

// ─── The discovered route ────────────────────────────────────────────────────

/** Cell 23: the production shape end to end — discover through the facade, size the floor the way
 *  the app does, send, and claim from the fuel the venue delivered. */
export async function flowDiscoveredRouteSend(s: SmokeContext, token: ManifestToken, l2Token: ContractBase): Promise<string> {
	const swap = s.bridge.l1.swap
	if (!swap) throw new Error("the sandbox manifest has no swap block")
	const unit = 10n ** BigInt(token.decimals)
	const total = 100n * unit
	const fuelAmount = 40n * unit
	const outcome = await discoverFuelRoute({
		client: s.l1.pub as never,
		quoter: swap.quoter as Address,
		multicall3: swap.multicall3 as Address,
		token: token.erc20 as Address,
		feeAsset: s.clients.deployment.feeJuice,
		weth: swap.weth as Address,
		feeJuice: swap.feeJuice as Address,
		tiers: swap.tiers,
		ethFj: swap.ethFj,
		probeAmount: fuelAmount,
	})
	if (outcome.kind !== "route") throw new Error(`discovery returned ${outcome.kind} for ${token.displaySymbol}`)
	const minFuelOutput = signedMinFuelOutput(outcome.quoteOut, swap.slippageBps, BigInt(swap.minFuelFj))
	await mint(s.l1, token.erc20 as Address, s.l1.account.address, total)
	const res = await send(s, s.l1, {
		intent: "token+gas",
		erc20: token.erc20 as Address,
		amount: total,
		aztecRecipient: s.l2.from.toString() as Hex,
		isPrivate: false,
		gas: {
			fuelAmount,
			fuelRecipient: s.l2.from.toString() as Hex,
			minFuelOutput,
			path: outcome.route.path,
			zeroForOnes: outcome.route.zeroForOnes,
		},
	})
	if ((res.fuelReceived ?? 0n) !== outcome.quoteOut)
		throw new Error(`the venue delivered ${res.fuelReceived}, the quote said ${outcome.quoteOut}`)
	await waitForL1ToL2Message(s.l2.node, res.fuelMessageHashHex as string, { forceBlock: s.l2.forceBlock })
	const before = await balanceOf(l2Token, s.l2.from, "public")
	const claimed = await claim(s, res, {
		amount: total - fuelAmount,
		isPrivate: false,
		recipient: s.l2.from,
		fee: fuelClaimFee(s, res),
		feeMode: "fee-juice",
	})
	const gained = (await balanceOf(l2Token, s.l2.from, "public")) - before
	if (gained < total - fuelAmount) throw new Error(`token leg credited ${gained}, expected ${total - fuelAmount}`)
	return `discovered ${outcome.route.path.length}-hop route, quote ${outcome.quoteOut} = delivered, floor ${minFuelOutput}; ${claimed.path}`
}

// ─── The Outbox ──────────────────────────────────────────────────────────────

/** Cell 32: an exit's L2→L1 message is not consumable before its checkpoint is proven — the Outbox
 *  has no root yet — and reads as NOT consumed either way; after finalization the consume lands. */
export async function flowOutboxBeforeProven(s: SmokeContext, token: ManifestToken, l2Token: ContractBase): Promise<string> {
	const amount = toWei(token, 1n)
	const authwitNonce = Fr.random()
	const exit: HubExitParams = {
		l2Token: token.l2Token,
		recipientL1: s.l1.account.address,
		amount,
		callerOnL1: ZERO_L1,
		authwitNonce,
		isPrivate: false,
	}
	const from = s.l2.from.toString()
	// The public burn's authwit, then the exit itself — PROPOSED, not yet proven.
	const burn = l2Token.methods.burn_public(s.l2.from, amount, authwitNonce)
	const authwit = await SetPublicAuthwitContractInteraction.create(
		s.l2.wallet as never,
		s.l2.from,
		{ caller: s.hub.address, action: burn } as never,
		true,
	)
	await authwit.send(s.l2.sendOpts as never)
	await preflightHubExit(s.hub, exit, from)
	const { receipt } = (await exitViaHub(s.hub, exit, s.l2.sendOpts)) as unknown as { receipt: { txHash: unknown } }
	if (await isOutboxMessageConsumed(s.l1, s.l2.node as never, receipt)) throw new Error("a just-proposed exit read as already consumed")
	const eff = await s.l2.node.getTxEffect(receipt.txHash as never)
	const messageHash = eff?.data.l2ToL1Msgs[0]
	if (!messageHash) throw new Error("the exit produced no L2→L1 message")
	const { l1ContractAddresses } = await s.l2.node.getNodeInfo()
	const outbox = new OutboxContract(s.l1.pub as never, l1ContractAddresses.outboxAddress)
	let witnessed = false
	try {
		witnessed =
			(await computeL2ToL1MembershipWitness(s.l2.node as never, outbox, messageHash, receipt.txHash as never, 0)) !== undefined
	} catch {}
	if (witnessed) throw new Error("a witness existed before the checkpoint was proven")
	// Now finish it the normal way: prove, witness, consume.
	const before = await erc20BalanceOf(s.l1, token.erc20 as Address, s.l1.account.address)
	await withBlockHeartbeat(s.l2, () =>
		consumeWithdrawal(s.l1, s.l2.node as never, receipt, {
			recipientL1: s.l1.account.address,
			amount,
			portal: token.portal as Address,
			portalAbi: TOKEN_PORTAL_ABI as never,
			provenTimeoutSec: 900,
		}),
	)
	const released = (await erc20BalanceOf(s.l1, token.erc20 as Address, s.l1.account.address)) - before
	if (released < amount) throw new Error(`L1 released ${released}, expected ${amount}`)
	return `unproven exit: not consumed, no witness; after finalization the consume released ${released}`
}
