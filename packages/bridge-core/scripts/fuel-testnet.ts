/**
 * LIVE-testnet fueled bridge validation (plan P5): drives `runSwapBridge` against the LIVE
 * router/pools, then proves the headline claim on Aztec — a fresh account's claim transaction
 * PAYS FOR ITSELF from the Fee Juice it claims in the same tx (`FeeJuicePaymentMethodWithClaim`),
 * for BOTH the public and private token variants. Also calibrates MIN_FUEL_FJ from the real fee.
 *
 * Uses the EXISTING live deployment (testnet-bridge.json + l1.fuel) — nothing is deployed here
 * except the throwaway L2 account (sponsored FPC pays its deployment; fuel pays its claims).
 *
 * Real proofs: expect ~30-60 min end to end.
 * Run: bun run scripts/fuel-testnet.ts   (PRIVATE_KEY + SEPOLIA_RPC_URL in packages/bridge-core/.env)
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadContractArtifact } from "@aztec/aztec.js/abi"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { TxStatus } from "@aztec/aztec.js/tx"
import { FeeJuiceContractArtifact } from "@aztec/noir-contracts.js/FeeJuice"
import { EthAddress } from "@aztec/foundation/eth-address"
import { Gas, type GasFees } from "@aztec/stdlib/gas"
import { resolvePackageAsset } from "@nulo/resolve-asset"
import { privateKeyToAccount } from "viem/accounts"
import { feeJuiceAddress, predictedWorstMinFees, publicFeeJuicePayment } from "../src/fee-juice"
import { runSwapBridge } from "../src/flows"
import {
	PRIVATE_FPC_ADDRESS,
	PRIVATE_FPC_SALT,
	deriveBridgeSecret,
	privateFeeJuicePayment,
	privateMintAndPayFee,
} from "../src/private-fuel"
import { minOutputForSlippage, quoteFuelPath } from "../src/quote"
import { buildFuelRoute } from "../src/route"
import { runFpcGate } from "./check-fpc-version"
import { PLAN_PINNED_L1_SIGNER } from "./live-intent"
import { evmAbi } from "./script-artifacts"
import { deployAccountIfAbsent, freshSchnorrAccount, sponsoredFpcFee } from "./script-l2"
import { createL1Clients, createL2Wallet, createNode, loadManifestFromConfigArg, sepoliaChain, stopwatch } from "./script-bootstrap"
import { bridgeProxyArtifact, tokenBridgeArtifact } from "../src/artifacts"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY required (packages/bridge-core/.env)")

const here = dirname(fileURLToPath(import.meta.url))
const CONFIG = loadManifestFromConfigArg(process.argv, {
	mode: "fallback",
	fallbackPath: join(here, "..", "..", "..", "apps", "faucet", "public", "testnet-bridge.json"),
	// biome-ignore lint/suspicious/noExplicitAny: manifest fields are accessed via dynamic property paths without a formal schema, matching the original untyped JSON.parse.
	parse: (raw) => raw as any,
})
const fuel = CONFIG.l1.fuel
if (!fuel) throw new Error("testnet-bridge.json has no l1.fuel - run the P2 deploy first")
const core = fuel.core
const swap = fuel.swap
if (!swap) throw new Error("testnet-bridge.json has no l1.fuel.swap — this swap-fuel smoke needs the swap stack")

const sepolia = sepoliaChain(SEPOLIA_RPC)

const TOTAL = 10n * 10n ** 18n // 10 AZLO per variant
const FUEL_SLICE = 25n * 10n ** 16n // 0.25 AZLO ≈ ~487 FJ at the live rate (the design fill)
// Headroom on the committed maxFeesPerGas (over predicted-worst) so a single attempt survives base-fee
// drift during its proving window. Matches base_wallet's general 1.5× minFeePadding. The FPC ceiling
// scales with it, but the bridged FJ (~hundreds) dwarfs the few-FJ ceiling, so it never strands the budget.
const RELIABILITY_PAD = Number(process.env.RELIABILITY_PAD ?? 1.5)

/** Everything one fueled-bridge variant needs — bound once in main, threaded explicitly. */
interface VariantCtx {
	pub: ReturnType<typeof createL1Clients>["pub"]
	wallet: ReturnType<typeof createL1Clients>["wallet"]
	account: { address: `0x${string}` }
	node: ReturnType<typeof createNode>
	from: AztecAddress
	azlo: `0x${string}`
	bridge: Contract
	fjBalance: () => Promise<bigint>
	tokenBalance: (kind: "public" | "private") => Promise<bigint>
	mins: () => string
}

/** Register the LIVE L2 contracts (instances rebuilt from deploy metadata) + the PrivateFPC. */
async function registerLiveContracts(ewallet: unknown, mins: () => string) {
	const registerLive = async (
		label: string,
		artifact: unknown,
		meta: { address: string; salt: number; constructorArtifact: string; constructorArgs: unknown[] },
	) => {
		const args = meta.constructorArgs.map((a) =>
			typeof a === "string" && a.startsWith("0x") && a.length === 66 ? AztecAddress.fromStringUnsafe(a) : a,
		)
		const instance = await getContractInstanceFromInstantiationParams(
			artifact as never,
			{
				constructorArgs: args,
				salt: new Fr(meta.salt),
				publicKeys: PublicKeys.default(),
				deployer: AztecAddress.ZERO,
				constructorArtifact: meta.constructorArtifact,
			} as never,
		)
		if (instance.address.toString() !== meta.address) {
			throw new Error(`${label}: rebuilt ${instance.address} != recorded ${meta.address}`)
		}
		try {
			await (ewallet as { registerContract: (i: unknown, a: unknown) => Promise<unknown> }).registerContract(
				instance,
				artifact as never,
			)
		} catch {}
		return Contract.at(instance.address, artifact as never, ewallet as never)
	}
	const l1PortalArg = EthAddress.fromString(CONFIG.l1.portal)
	const bridgeMeta = { ...CONFIG.l2.bridge, constructorArgs: [CONFIG.l2.bridge.constructorArgs[0], l1PortalArg] }
	const token = await registerLive("token", TokenContractArtifact, CONFIG.l2.token)
	const bridge = await registerLive("bridge", tokenBridgeArtifact, bridgeMeta)
	await registerLive("proxy", bridgeProxyArtifact, CONFIG.l2.proxy)
	const feeJuice = await Contract.at(AztecAddress.fromStringUnsafe(feeJuiceAddress), FeeJuiceContractArtifact, ewallet as never)

	// Register the PrivateFPC locally (instance + class). It has no public functions / no init, so 5.0
	// needs NO on-chain deploy (codex 019ee697); the private-kernel oracle DOES need both the instance +
	// class preimages, so registerContract (not just the class). The canonical salt reproduces the pinned
	// PRIVATE_FPC_ADDRESS from the 5.0.0 artifact.
	// The artifact package was RENAMED @alejoamiras/aztec-fee-payment → private-fee-juice
	// (see src/private-fpc-canonical.json); the old hardcoded root-node_modules path was dead
	// code on both counts. Resolved layout-agnostically from this declaring workspace.
	const privateFpcArtifact = loadContractArtifact(
		JSON.parse(
			readFileSync(
				resolvePackageAsset("@alejoamiras/private-fee-juice", "target/private_contract-PrivateFPC.json", {
					from: import.meta.url,
				}),
				"utf8",
			),
		),
	)
	const privateFpcInstance = await getContractInstanceFromInstantiationParams(
		privateFpcArtifact as never,
		{
			// The CANONICAL salt (fixed from 5.0.0 onward — see private-fuel.ts PRIVATE_FPC_SALT).
			salt: Fr.fromHexString(PRIVATE_FPC_SALT),
			publicKeys: PublicKeys.default(),
			deployer: AztecAddress.ZERO,
		} as never,
	)
	if (privateFpcInstance.address.toString() !== PRIVATE_FPC_ADDRESS) {
		throw new Error(`PrivateFPC rebuilt ${privateFpcInstance.address} != pinned ${PRIVATE_FPC_ADDRESS} (artifact/version drift)`)
	}
	try {
		await (ewallet as { registerContract: (i: unknown, a: unknown) => Promise<unknown> }).registerContract(
			privateFpcInstance,
			privateFpcArtifact as never,
		)
	} catch {}
	console.log(`live contracts registered (+ PrivateFPC ${PRIVATE_FPC_ADDRESS.slice(0, 12)}…) (${mins()})`)
	return { token, bridge, feeJuice, privateFpcInstance, privateFpcArtifact }
}

type VariantResult = {
	tokenLeafIndex: bigint
	fuelLeafIndex: bigint
	fuelReceived: bigint
	tokenSecretHex: string
	fuelSecretHex: string
}

/** Build the self-paying claim fee for one attempt.
 *  PUBLIC fuel: FeeJuicePaymentMethodWithClaim (pays ACTUAL fee, no upfront budget gate) — fee is static.
 *  PRIVATE-FPC fuel: Wonderland mint_and_pay_fee asserts amount >= getFeeLimit (gasLimit × committed
 *  maxFeesPerGas) UPFRONT, AND the protocol rejects the tx if committed maxFeesPerGas < live base fee at
 *  inclusion. The claim builds+proves minutes before it lands, so a build-time cap can fall below the
 *  risen live fee (observed: a 4% rise broke a static cap, and the retry reused it → stranded). So
 *  RE-PRICE per attempt: fresh predictedWorstMinFees × RELIABILITY_PAD. Repricing tracks the rising base
 *  fee across the sync wait; the pad absorbs intra-attempt drift during proving. The bridged FJ
 *  (~hundreds of FJ) dwarfs the few-FJ ceiling, so the larger cap never strands the FPC budget. */
async function buildVariantClaimFee(
	ctx: VariantCtx,
	result: VariantResult,
	fuelViaPrivateFpc: boolean,
	bridgeSalt: Fr | undefined,
): Promise<{ fee: unknown; maxFees?: GasFees }> {
	if (!fuelViaPrivateFpc) {
		return {
			fee: {
				paymentMethod: publicFeeJuicePayment(ctx.from, {
					claimAmount: result.fuelReceived,
					claimSecret: Fr.fromHexString(result.fuelSecretHex),
					messageLeafIndex: result.fuelLeafIndex,
				}),
			},
		}
	}
	const maxFees = (await predictedWorstMinFees(ctx.node)).mul(RELIABILITY_PAD)
	return {
		fee: {
			paymentMethod: privateMintAndPayFee(
				AztecAddress.fromStringUnsafe(PRIVATE_FPC_ADDRESS),
				result.fuelReceived,
				deriveBridgeSecret(bridgeSalt as Fr, ctx.from),
				bridgeSalt as Fr,
				new Fr(result.fuelLeafIndex),
			),
			gasSettings: { teardownGasLimits: Gas.from({ daGas: 0, l2Gas: 0 }), maxFeesPerGas: maxFees },
		},
		maxFees,
	}
}

type ClaimReceipt = { transactionFee?: bigint; gasUsed?: { totalGas?: { daGas: number; l2Gas: number } } }

/** An FPC budget assert is a REAL fail (bridged FJ < committed getFeeLimit) — never a
 *  sync/fee-drift wait to retry through. */
function throwIfFpcBudgetAssert(label: string, fuelReceived: bigint, msg: string): void {
	if (/Amount too low to cover gas cost|max_gas_cost/.test(msg)) {
		throw new Error(`${label}: FPC budget assert — bridged FJ ${fuelReceived} < committed getFeeLimit. ${msg}`)
	}
}

/** The live swap route from the manifest's pool config + a fresh quote for the fuel slice. */
async function quoteFuelSlice(ctx: VariantCtx): Promise<{ route: ReturnType<typeof buildFuelRoute>; minOut: bigint }> {
	const route = buildFuelRoute({
		token: ctx.azlo,
		weth: swap.weth,
		feeJuice: swap.feeJuice,
		tokenWeth: swap.pools.tokenWeth ?? swap.pools.azloWeth,
		ethFj: swap.pools.ethFj,
	})
	const quote = await quoteFuelPath(ctx.pub as never, swap.quoter, route, FUEL_SLICE)
	const minOut = minOutputForSlippage(quote, swap.slippageBps)
	console.log(`quote: ${FUEL_SLICE} AZLO-wei → ${quote} FJ-wei (floor ${minOut}) (${ctx.mins()})`)
	return { route, minOut }
}

/** The self-paying claim: ONE tx claims the fuel (fee) AND the tokens, retried on the sync
 *  cadence with per-attempt fee re-pricing. An FPC budget assert is a REAL fail (bridged FJ <
 *  ceiling), not a sync/fee-drift wait; "maxFeesPerGas < gasFees" (base fee rose) self-heals
 *  because the next attempt re-prices. */
async function settleVariantClaim(
	ctx: VariantCtx,
	p: { label: string; isPrivate: boolean; result: VariantResult; fuelViaPrivateFpc: boolean; bridgeSalt: Fr | undefined },
): Promise<{ receipt: ClaimReceipt; committedMaxFees?: GasFees }> {
	const bridgedAmount = TOTAL - FUEL_SLICE
	const tokenSecret = Fr.fromHexString(p.result.tokenSecretHex)
	const claimMethod = () =>
		p.isPrivate
			? ctx.bridge.methods.claim_private(ctx.from, bridgedAmount, tokenSecret, new Fr(p.result.tokenLeafIndex))
			: ctx.bridge.methods.claim_public(ctx.from, bridgedAmount, tokenSecret, new Fr(p.result.tokenLeafIndex))

	let receipt: ClaimReceipt | undefined
	let committedMaxFees: GasFees | undefined
	for (let i = 0; i < 300 && !receipt; i++) {
		try {
			const built = await buildVariantClaimFee(ctx, p.result, p.fuelViaPrivateFpc, p.bridgeSalt)
			committedMaxFees = built.maxFees
			const sent = (await claimMethod().send({
				from: ctx.from,
				fee: built.fee,
				wait: { waitForStatus: TxStatus.PROPOSED },
			} as never)) as {
				receipt?: ClaimReceipt
			}
			receipt = sent.receipt ?? {}
		} catch (e) {
			throwIfFpcBudgetAssert(p.label, p.result.fuelReceived, e instanceof Error ? e.message : String(e))
			if (i % 10 === 0) console.log(`claim not ready / re-pricing… (${ctx.mins()})`)
			await new Promise((r) => setTimeout(r, 6000))
		}
	}
	if (!receipt) throw new Error(`${p.label}: self-paying claim never SETTLED within budget`)
	if (committedMaxFees) {
		console.log(`${p.label}: committed maxFeesPerGas l2=${committedMaxFees.feePerL2Gas} (predicted-worst × ${RELIABILITY_PAD})`)
	}
	console.log(`${p.label}: claim SETTLED - one tx claimed tokens AND gas (${ctx.mins()})`)
	return { receipt, committedMaxFees }
}

/** Decompose the fee: actual (post-inclusion) vs the FPC ceiling (committed gasLimit × maxFeesPerGas). */
async function deriveFeeCeiling(
	ctx: VariantCtx,
	receipt: ClaimReceipt,
	committedMaxFees: GasFees | undefined,
): Promise<bigint | undefined> {
	const actualFee = receipt.transactionFee ?? 0n
	if (committedMaxFees && receipt.gasUsed?.totalGas) {
		const g = receipt.gasUsed.totalGas
		return BigInt(g.daGas) * committedMaxFees.feePerDaGas + BigInt(g.l2Gas) * committedMaxFees.feePerL2Gas
	}
	if (committedMaxFees && actualFee > 0n) {
		// The receipt doesn't expose gasUsed, so derive the FPC ceiling from the fee ratio: actual fee =
		// gasUsed·liveBaseFee, the FPC ceiling = gasLimit·committedMaxFees, and gasLimit≈gasUsed (gasPadding≈1,
		// teardown=0). So ceiling ≈ actualFee · (committedMaxFees / liveBaseFee), using the L2-gas component
		// (it dominates; committed da-fee is 0). Conservative: if predicted-worst > current, the ceiling
		// scales up exactly as the committed cap does.
		const live = await ctx.node.getCurrentMinFees()
		return live.feePerL2Gas > 0n ? (actualFee * committedMaxFees.feePerL2Gas) / live.feePerL2Gas : undefined
	}
	return undefined
}

/** One variant = L1 swap+bridge → self-paying L2 claim. */
async function runVariant(
	ctx: VariantCtx,
	isPrivate: boolean,
	nonce: bigint,
	fuelViaPrivateFpc = false,
): Promise<{ actualFee: bigint; ceiling?: bigint }> {
	const label = `${isPrivate ? "PRIVATE" : "PUBLIC"}${fuelViaPrivateFpc ? "+FPC-fuel" : ""}`
	console.log(`\n=== ${label} fueled bridge ===`)

	// Private-FPC fuel: the FJ is bridged to the FPC with a claimer-bound secret (deriveBridgeSecret),
	// so the FPC can reconstruct it inside mint_and_pay_fee. Public fuel lands at the user (random secret).
	const bridgeSalt = fuelViaPrivateFpc ? Fr.random() : undefined
	const fuelSecret = bridgeSalt ? deriveBridgeSecret(bridgeSalt, ctx.from) : undefined
	// Recipient-committed private token leg: inject the per-deposit claim_salt. runSwapBridge derives
	// the L1-committed secret from (salt, recipient) and echoes the SALT back as tokenSecretHex — which
	// claim_private re-derives from below. Omitting it trips the F2 fail-closed guard (a random token
	// secret would strand the deposit against the recipient-committed claim_private).
	const tokenClaimSalt = isPrivate ? Fr.random() : undefined

	const { route, minOut } = await quoteFuelSlice(ctx)

	const result = (await runSwapBridge(
		{ pub: ctx.pub, wallet: ctx.wallet, account: ctx.account } as never,
		{
			router: core.router,
			routerAbi: evmAbi("SwapBridgeRouter"),
			permit2: core.permit2,
			swapTarget: core.swapTarget,
			tokenPortal: CONFIG.l1.portal,
			bridgeToken: ctx.azlo,
			totalAmount: TOTAL,
			fuelAmount: FUEL_SLICE,
			aztecRecipient: ctx.from.toString() as `0x${string}`,
			fuelRecipient: (fuelViaPrivateFpc ? PRIVATE_FPC_ADDRESS : ctx.from.toString()) as `0x${string}`,
			minFuelOutput: minOut,
			path: route.path,
			zeroForOnes: route.zeroForOnes,
			isPrivate,
			...(fuelSecret ? { fuelSecret } : {}),
			...(tokenClaimSalt ? { tokenClaimSalt } : {}),
			nonce,
			deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
			chainId: 11155111,
		} as never,
		(s) => console.log(`l1: ${s} (${ctx.mins()})`),
		{ onSecrets: () => console.log("secrets persisted (in-memory for the smoke)") },
	)) as VariantResult
	console.log(
		`bridged: tokenLeaf ${result.tokenLeafIndex}, fuelLeaf ${result.fuelLeafIndex}, fuelReceived ${result.fuelReceived} (${ctx.mins()})`,
	)

	const fjBefore = await ctx.fjBalance()
	const { receipt, committedMaxFees } = await settleVariantClaim(ctx, { label, isPrivate, result, fuelViaPrivateFpc, bridgeSalt })
	const actualFee = receipt.transactionFee ?? 0n
	const ceiling = await deriveFeeCeiling(ctx, receipt, committedMaxFees)
	console.log(
		`${label}: actual fee ${actualFee}${ceiling !== undefined ? ` | getFeeLimit (FPC ceiling) ≈ ${ceiling}` : " | getFeeLimit n/a"}`,
	)

	const bridgedAmount = TOTAL - FUEL_SLICE
	const tokenBal = await ctx.tokenBalance(isPrivate ? "private" : "public")
	console.log(`${label}: token balance ${tokenBal}`)
	if (tokenBal < bridgedAmount) throw new Error(`${label}: token balance ${tokenBal} < ${bridgedAmount}`)
	if (!fuelViaPrivateFpc) {
		// PUBLIC fuel credits the user's PUBLIC FJ balance. PRIVATE-FPC fuel credits the remainder as a
		// PRIVATE note (not the public balance), so this assert only applies to the public path.
		const fjAfter = await ctx.fjBalance()
		if (fjAfter <= fjBefore) throw new Error(`${label}: no FJ landed as balance (fee ate everything?)`)
		console.log(`${label}: FJ gained ${fjAfter - fjBefore}`)
	}
	return { actualFee, ceiling }
}

/** MIN_FUEL_FJ calibration: 4× the worst FPC CEILING (getFeeLimit), not the actual fee (codex
 *  019ee66b-01a4) — the FPC asserts amount >= getFeeLimit. Falls back to a conservative
 *  actual×4 proxy only if no receipt exposed gasUsed (so the ceiling couldn't be computed).
 *  4× matches the old V4-era floor's forgiveness (~4× headroom) GROUNDED in the real V5
 *  ceiling — the ceiling already bakes in the 1.5× fee pad, so 4× tolerates a further ~4×
 *  base-fee surge. */
function calibrateMinFuelFj(pubRun: { actualFee: bigint }, privRuns: { actualFee: bigint; ceiling?: bigint }[], mins: () => string): void {
	const ceilings = privRuns.map((r) => r.ceiling).filter((c): c is bigint => c !== undefined)
	const worstCeiling = ceilings.length ? ceilings.reduce((a, b) => (a > b ? a : b)) : undefined
	const worstActual = [pubRun, ...privRuns].map((r) => r.actualFee).reduce((a, b) => (a > b ? a : b), 0n)
	const basis = worstCeiling ?? worstActual * 4n
	const FUEL_FEE_MARGIN = 4n
	const minFuelFj = basis * FUEL_FEE_MARGIN
	console.log(`\n✅ public + ${privRuns.length} private-FPC runs SETTLED in ${mins()}`)
	console.log(`private getFeeLimits : ${privRuns.map((r) => r.ceiling ?? "n/a").join(", ")}`)
	console.log(`private actual fees  : ${privRuns.map((r) => r.actualFee).join(", ")}`)
	console.log(
		`MIN_FUEL_FJ calibration: ${minFuelFj} (${FUEL_FEE_MARGIN}× worst ${worstCeiling !== undefined ? "getFeeLimit" : "actual×4 proxy"}) - update testnet-bridge.json l1.fuel.swap.minFuelFj`,
	)
}

/** Spend existing private FJ: a 1-unit public self-transfer paying via PrivateFPC.pay_fee,
 *  repriced per attempt. A pay_fee insufficiency is a real fail; sync/fee-drift retries. */
async function spendFpcBalanceOnce(ctx: VariantCtx, token: Contract, before: bigint): Promise<void> {
	let settled = false
	for (let a = 0; a < 100 && !settled; a++) {
		try {
			const maxFees = (await predictedWorstMinFees(ctx.node)).mul(RELIABILITY_PAD)
			await token.methods.transfer_public_to_public(ctx.from, ctx.from, 1n, 0).send({
				from: ctx.from,
				fee: {
					paymentMethod: privateFeeJuicePayment(AztecAddress.fromStringUnsafe(PRIVATE_FPC_ADDRESS)),
					gasSettings: { teardownGasLimits: Gas.from({ daGas: 0, l2Gas: 0 }), maxFeesPerGas: maxFees },
				},
				wait: { waitForStatus: TxStatus.PROPOSED },
			} as never)
			settled = true
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			if (/Amount too low to cover gas cost|max_gas_cost|insufficient/i.test(msg)) {
				throw new Error(`NO-FUEL-SPEND: pay_fee insufficiency - FPC balance ${before} < reserved cost. ${msg}`)
			}
			if (a % 10 === 0) console.log(`no-fuel-spend re-pricing... (${ctx.mins()})`)
			await new Promise((r) => setTimeout(r, 6000))
		}
	}
	if (!settled) throw new Error("NO-FUEL-SPEND: pay_fee tx never SETTLED within budget")
}

/** Phase 3: NO-FUEL-SPEND proof - a tx self-pays from EXISTING private FJ at the FPC via pay_fee. */
async function runNoFuelSpendProof(
	ctx: VariantCtx,
	p: { ewallet: unknown; token: Contract; privateFpcInstance: { address: AztecAddress }; privateFpcArtifact: unknown; runs: number },
): Promise<void> {
	const fpcContract = await Contract.at(p.privateFpcInstance.address, p.privateFpcArtifact as never, p.ewallet as never)
	const readFpcBalance = async (): Promise<bigint> => {
		const r = (await fpcContract.methods.balance_of(ctx.from).simulate({ from: ctx.from })) as { result?: bigint } | bigint
		return typeof r === "bigint" ? r : (r.result ?? 0n)
	}
	for (let i = 0; i < p.runs; i++) {
		console.log(`\n--- no-fuel-spend run ${i + 1}/${p.runs} ---`)
		// Seed: a PUBLIC-token + private-FPC-fuel bridge credits the FPC with private FJ AND gives `from`
		// public tokens to move. The remainder mint_and_pay_fee credits is exactly what pay_fee then spends.
		await runVariant(ctx, false, rndNonce(), true)
		const before = await readFpcBalance()
		console.log(`NO-FUEL-SPEND: FPC private FJ before = ${before}`)
		if (before <= 0n) throw new Error("NO-FUEL-SPEND: FPC balance 0 after a private fuel run - nothing to spend")
		await spendFpcBalanceOnce(ctx, p.token, before)
		const after = await readFpcBalance()
		if (after >= before) throw new Error(`NO-FUEL-SPEND: FPC balance did not drop (${before} -> ${after}) - pay_fee did not charge`)
		console.log(
			`OK NO-FUEL-SPEND run ${i + 1}: tx self-paid from EXISTING private FJ via pay_fee on V5 (FPC ${before} -> ${after}, spent ${before - after}) (${ctx.mins()})`,
		)
	}
}

const rndNonce = () => BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`)

async function main() {
	const mins = stopwatch()

	// FUND-MOVING PREFLIGHT (codex ultra-audit HIGH): this canary deposits Fee Juice
	// and pays fees THROUGH the PrivateFPC at PRIVATE_FPC_ADDRESS — an unrecoverable
	// loss if that address isn't the deployed, class-correct, version-compatible
	// contract. The gate runs INLINE here (not as a separate operator command) so it
	// can never be skipped before the first broadcast.
	await runFpcGate("require-deployed")

	// ─── L1 (live contracts, viem) ───────────────────────────────────
	const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
	if (account.address.toLowerCase() !== PLAN_PINNED_L1_SIGNER.toLowerCase()) {
		throw new Error(`L1 sender ${account.address} != plan-pinned signer ${PLAN_PINNED_L1_SIGNER} — wrong key; STOP`)
	}
	const { wallet, pub } = createL1Clients({ chain: sepolia, rpcUrl: SEPOLIA_RPC, account })
	const azlo = CONFIG.l1.usdc as `0x${string}`
	console.log("L1 sender", account.address, "| AZLO", azlo, "| router", core.router)

	// Mint enough AZLO for both variants (permissionless, Permit2 pre-approved by the token).
	const PRIVATE_RUNS = Number(process.env.PRIVATE_RUNS ?? 3) // ≥3 for calibration stability; env-tunable
	const NOFUEL_SPEND_RUNS = Number(process.env.NOFUEL_SPEND_RUNS ?? 0) // Phase-3 pay_fee proof; each seeds one FPC-fuel run
	// 1 public sanity + PRIVATE_RUNS calibration + NOFUEL_SPEND_RUNS seed runs + 1 TOTAL headroom.
	const MINT = BigInt(2 + PRIVATE_RUNS + NOFUEL_SPEND_RUNS) * TOTAL
	await pub.waitForTransactionReceipt({
		hash: await wallet.writeContract({
			address: azlo,
			abi: evmAbi("MintableERC20") as never,
			functionName: "mint",
			args: [account.address, MINT] as never,
		}),
	})
	console.log(`minted ${MINT / 10n ** 18n} AZLO (${mins()})`)

	// ─── L2 (fresh account, real proofs; sponsored pays ONLY the account deploy) ──
	const node = createNode(NODE_URL)
	const ewallet = await createL2Wallet({ nodeUrl: NODE_URL, proverEnabled: true })
	const { manager, from } = await freshSchnorrAccount(ewallet as never)
	console.log("L2 recipient", from.toString())
	const { fee: sponsoredFee } = await sponsoredFpcFee(ewallet)
	await deployAccountIfAbsent({
		node,
		manager: manager as never,
		from,
		fee: sponsoredFee,
		log: (stage) =>
			console.log(
				stage === "deploying"
					? `deploying L2 account via sponsored FPC (real proof)… (${mins()})`
					: `L2 account deployed (${mins()})`,
			),
	})

	const { token, bridge, feeJuice, privateFpcInstance, privateFpcArtifact } = await registerLiveContracts(ewallet, mins)

	const fjBalance = async (): Promise<bigint> =>
		((await feeJuice.methods.balance_of_public(from).simulate({ from })) as { result?: bigint }).result ??
		((await feeJuice.methods.balance_of_public(from).simulate({ from })) as unknown as bigint)
	const tokenBalance = async (kind: "public" | "private"): Promise<bigint> => {
		const m = kind === "public" ? token.methods.balance_of_public(from) : token.methods.balance_of_private(from)
		const r = (await m.simulate({ from })) as { result?: bigint }
		return r.result ?? (r as unknown as bigint)
	}

	const ctx: VariantCtx = { pub, wallet, account, node, from, azlo, bridge, fjBalance, tokenBalance, mins }

	// Public fuel = sanity (works pre-fix); the PRIVATE-FPC path is what regressed — run it ≥3× for a
	// stable getFeeLimit/minFuelFj across fee conditions.
	const pubRun = await runVariant(ctx, false, rndNonce())
	const privRuns: { actualFee: bigint; ceiling?: bigint }[] = []
	for (let i = 0; i < PRIVATE_RUNS; i++) {
		console.log(`\n--- private-FPC run ${i + 1}/${PRIVATE_RUNS} ---`)
		privRuns.push(await runVariant(ctx, true, rndNonce(), true))
	}

	calibrateMinFuelFj(pubRun, privRuns, mins)

	if (NOFUEL_SPEND_RUNS > 0) {
		await runNoFuelSpendProof(ctx, { ewallet, token, privateFpcInstance, privateFpcArtifact, runs: NOFUEL_SPEND_RUNS })
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
