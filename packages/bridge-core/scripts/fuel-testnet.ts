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
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxStatus } from "@aztec/aztec.js/tx"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { EthAddress } from "@aztec/foundation/eth-address"
import { FeeJuiceContractArtifact } from "@aztec/noir-contracts.js/FeeJuice"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { deriveSigningKey } from "@aztec/stdlib/keys"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"
import { type Abi, createPublicClient, createWalletClient, defineChain, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { loadContractArtifact } from "@aztec/aztec.js/abi"
import { Gas, type GasFees } from "@aztec/stdlib/gas"
import { bridgeProxyArtifact, tokenBridgeArtifact } from "../src/artifacts"
import { feeJuiceAddress, predictedWorstMinFees, publicFeeJuicePayment } from "../src/fee-juice"
import { runSwapBridge } from "../src/flows"
import { PRIVATE_FPC_ADDRESS, deriveBridgeSecret, privateFeeJuicePayment, privateMintAndPayFee } from "../src/private-fuel"
import { minOutputForSlippage, quoteFuelPath } from "../src/quote"
import { buildFuelRoute } from "../src/route"

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY required (packages/bridge-core/.env)")

const here = dirname(fileURLToPath(import.meta.url))
const configArg = process.argv.indexOf("--config")
const CONFIG_PATH =
	configArg !== -1
		? (process.argv[configArg + 1] as string)
		: join(here, "..", "..", "..", "apps", "faucet", "public", "testnet-bridge.json")
const CONFIG = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
const OUT = join(here, "..", "..", "..", "contracts", "bridge", "evm", "out")
const fuel = CONFIG.l1.fuel
if (!fuel) throw new Error("testnet-bridge.json has no l1.fuel - run the P2 deploy first")

const sepolia = defineChain({
	id: 11155111,
	name: "sepolia",
	nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
	rpcUrls: { default: { http: [SEPOLIA_RPC] } },
})

function evmAbi(name: string): Abi {
	return JSON.parse(readFileSync(join(OUT, `${name}.sol`, `${name}.json`), "utf8")).abi as Abi
}

const TOTAL = 10n * 10n ** 18n // 10 AZLO per variant
const FUEL_SLICE = 25n * 10n ** 16n // 0.25 AZLO ≈ ~487 FJ at the live rate (the design fill)
// Headroom on the committed maxFeesPerGas (over predicted-worst) so a single attempt survives base-fee
// drift during its proving window. Matches base_wallet's general 1.5× minFeePadding. The FPC ceiling
// scales with it, but the bridged FJ (~hundreds) dwarfs the few-FJ ceiling, so it never strands the budget.
const RELIABILITY_PAD = Number(process.env.RELIABILITY_PAD ?? 1.5)

async function main() {
	const t0 = Date.now()
	const mins = () => `${((Date.now() - t0) / 60000).toFixed(1)}m`

	// ─── L1 (live contracts, viem) ───────────────────────────────────
	const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
	const wallet = createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC) })
	const pub = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })
	const azlo = CONFIG.l1.usdc as `0x${string}`
	const erc20 = evmAbi("MintableERC20")
	console.log("L1 sender", account.address, "| AZLO", azlo, "| router", fuel.router)

	// Mint enough AZLO for both variants (permissionless, Permit2 pre-approved by the token).
	const PRIVATE_RUNS = Number(process.env.PRIVATE_RUNS ?? 3) // ≥3 for calibration stability; env-tunable
	const NOFUEL_SPEND_RUNS = Number(process.env.NOFUEL_SPEND_RUNS ?? 0) // Phase-3 pay_fee proof; each seeds one FPC-fuel run
	// 1 public sanity + PRIVATE_RUNS calibration + NOFUEL_SPEND_RUNS seed runs + 1 TOTAL headroom.
	const MINT = BigInt(2 + PRIVATE_RUNS + NOFUEL_SPEND_RUNS) * TOTAL
	await pub.waitForTransactionReceipt({
		hash: await wallet.writeContract({
			address: azlo,
			abi: erc20 as never,
			functionName: "mint",
			args: [account.address, MINT] as never,
		}),
	})
	console.log(`minted ${MINT / 10n ** 18n} AZLO (${mins()})`)

	const route = buildFuelRoute({
		token: azlo,
		weth: fuel.weth,
		feeJuice: fuel.feeJuice,
		tokenWeth: fuel.pools.azloWeth,
		ethFj: fuel.pools.ethFj,
	})

	// ─── L2 (fresh account, real proofs; sponsored pays ONLY the account deploy) ──
	const node = createAztecNodeClient(NODE_URL)
	const ewallet = await EmbeddedWallet.create(NODE_URL, { pxeConfig: { proverEnabled: true } })
	const secret = Fr.random()
	const manager = await ewallet.createSchnorrAccount(secret, Fr.random(), deriveSigningKey(secret))
	const l2account = await manager.getAccount()
	const from = l2account.getAddress()
	console.log("L2 recipient", from.toString())

	const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
		salt: new Fr(SPONSORED_FPC_SALT),
	})
	try {
		await ewallet.registerContract(fpc, SponsoredFPCContract.artifact)
	} catch {}
	const sponsoredFee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }

	if (!(await node.getContract(from))) {
		console.log(`deploying L2 account via sponsored FPC (real proof)… (${mins()})`)
		const deployMethod = await manager.getDeployMethod()
		await deployMethod.send({ fee: sponsoredFee, from: "NO_FROM" as never } as never)
		console.log(`L2 account deployed (${mins()})`)
	}

	// Register the LIVE L2 contracts (instances rebuilt from deploy metadata).
	const registerLive = async (
		label: string,
		artifact: unknown,
		meta: { address: string; salt: number; constructorArtifact: string; constructorArgs: unknown[] },
	) => {
		const args = meta.constructorArgs.map((a) =>
			typeof a === "string" && a.startsWith("0x") && a.length === 66 ? AztecAddress.fromString(a) : a,
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
			await ewallet.registerContract(instance, artifact as never)
		} catch {}
		return Contract.at(instance.address, artifact as never, ewallet as never)
	}
	const l1PortalArg = EthAddress.fromString(CONFIG.l1.portal)
	const bridgeMeta = { ...CONFIG.l2.bridge, constructorArgs: [CONFIG.l2.bridge.constructorArgs[0], l1PortalArg] }
	const token = await registerLive("token", TokenContractArtifact, CONFIG.l2.token)
	const bridge = await registerLive("bridge", tokenBridgeArtifact, bridgeMeta)
	await registerLive("proxy", bridgeProxyArtifact, CONFIG.l2.proxy)
	const feeJuice = await Contract.at(AztecAddress.fromString(feeJuiceAddress), FeeJuiceContractArtifact, ewallet as never)

	// Register the Wonderland PrivateFPC locally (instance + class). It has no public functions / no
	// init, so 5.0 needs NO on-chain deploy (codex 019ee697); the private-kernel oracle DOES need both
	// the instance + class preimages, so registerContract (not just the class). Salt 0 reproduces the
	// pinned PRIVATE_FPC_ADDRESS from the 5.0 artifact.
	const privateFpcArtifact = loadContractArtifact(
		JSON.parse(
			readFileSync(
				join(
					here,
					"..",
					"..",
					"..",
					"node_modules",
					"@wonderland",
					"aztec-fee-payment",
					"target",
					"private_contract-PrivateFPC.json",
				),
				"utf8",
			),
		),
	)
	const privateFpcInstance = await getContractInstanceFromInstantiationParams(
		privateFpcArtifact as never,
		{
			salt: new Fr(0),
			publicKeys: PublicKeys.default(),
			deployer: AztecAddress.ZERO,
		} as never,
	)
	if (privateFpcInstance.address.toString() !== PRIVATE_FPC_ADDRESS) {
		throw new Error(`PrivateFPC rebuilt ${privateFpcInstance.address} != pinned ${PRIVATE_FPC_ADDRESS} (artifact/version drift)`)
	}
	try {
		await ewallet.registerContract(privateFpcInstance, privateFpcArtifact as never)
	} catch {}
	console.log(`live contracts registered (+ PrivateFPC ${PRIVATE_FPC_ADDRESS.slice(0, 12)}…) (${mins()})`)

	const fjBalance = async (): Promise<bigint> =>
		((await feeJuice.methods.balance_of_public(from).simulate({ from })) as { result?: bigint }).result ??
		((await feeJuice.methods.balance_of_public(from).simulate({ from })) as unknown as bigint)
	const tokenBalance = async (kind: "public" | "private"): Promise<bigint> => {
		const m = kind === "public" ? token.methods.balance_of_public(from) : token.methods.balance_of_private(from)
		const r = (await m.simulate({ from })) as { result?: bigint }
		return r.result ?? (r as unknown as bigint)
	}

	// ─── One variant = L1 swap+bridge → self-paying L2 claim ─────────
	const runVariant = async (isPrivate: boolean, nonce: bigint, fuelViaPrivateFpc = false) => {
		const label = `${isPrivate ? "PRIVATE" : "PUBLIC"}${fuelViaPrivateFpc ? "+FPC-fuel" : ""}`
		console.log(`\n=== ${label} fueled bridge ===`)

		// Private-FPC fuel: the FJ is bridged to the FPC with a claimer-bound secret (deriveBridgeSecret),
		// so the FPC can reconstruct it inside mint_and_pay_fee. Public fuel lands at the user (random secret).
		const bridgeSalt = fuelViaPrivateFpc ? Fr.random() : undefined
		const fuelSecret = bridgeSalt ? deriveBridgeSecret(bridgeSalt, from) : undefined

		const quote = await quoteFuelPath(pub as never, fuel.quoter, route, FUEL_SLICE)
		const minOut = minOutputForSlippage(quote, fuel.slippageBps)
		console.log(`quote: ${FUEL_SLICE} AZLO-wei → ${quote} FJ-wei (floor ${minOut}) (${mins()})`)

		const result = await runSwapBridge(
			{ pub, wallet, account } as never,
			{
				router: fuel.router,
				routerAbi: evmAbi("SwapBridgeRouter"),
				permit2: fuel.permit2,
				swapTarget: fuel.swapTarget,
				tokenPortal: CONFIG.l1.portal,
				bridgeToken: azlo,
				totalAmount: TOTAL,
				fuelAmount: FUEL_SLICE,
				aztecRecipient: from.toString() as `0x${string}`,
				fuelRecipient: (fuelViaPrivateFpc ? PRIVATE_FPC_ADDRESS : from.toString()) as `0x${string}`,
				minFuelOutput: minOut,
				path: route.path,
				zeroForOnes: route.zeroForOnes,
				isPrivate,
				...(fuelSecret ? { fuelSecret } : {}),
				nonce,
				deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
				chainId: 11155111,
			} as never,
			(s) => console.log(`l1: ${s} (${mins()})`),
			{ onSecrets: () => console.log("secrets persisted (in-memory for the smoke)") },
		)
		console.log(
			`bridged: tokenLeaf ${result.tokenLeafIndex}, fuelLeaf ${result.fuelLeafIndex}, fuelReceived ${result.fuelReceived} (${mins()})`,
		)

		// The self-paying claim: ONE tx claims the fuel (fee) AND the tokens.
		// PUBLIC fuel: FeeJuicePaymentMethodWithClaim (pays ACTUAL fee, no upfront budget gate) — fee is static.
		// PRIVATE-FPC fuel: Wonderland mint_and_pay_fee asserts amount >= getFeeLimit (gasLimit × committed
		// maxFeesPerGas) UPFRONT, AND the protocol rejects the tx if committed maxFeesPerGas < live base fee at
		// inclusion. The claim builds+proves minutes before it lands, so a build-time cap can fall below the
		// risen live fee (observed: a 4% rise broke a static cap, and the retry reused it → stranded). So
		// RE-PRICE per attempt: fresh predictedWorstMinFees × RELIABILITY_PAD. Repricing tracks the rising base
		// fee across the sync wait; the pad absorbs intra-attempt drift during proving. The bridged FJ
		// (~hundreds of FJ) dwarfs the few-FJ ceiling, so the larger cap never strands the FPC budget.
		const bridgedAmount = TOTAL - FUEL_SLICE
		const tokenSecret = Fr.fromHexString(result.tokenSecretHex)
		const claimMethod = () =>
			isPrivate
				? bridge.methods.claim_private(from, bridgedAmount, tokenSecret, new Fr(result.tokenLeafIndex))
				: bridge.methods.claim_public(from, bridgedAmount, tokenSecret, new Fr(result.tokenLeafIndex))

		const buildClaimFee = async (): Promise<{ fee: unknown; maxFees?: GasFees }> => {
			if (!fuelViaPrivateFpc) {
				return {
					fee: {
						paymentMethod: publicFeeJuicePayment(from, {
							claimAmount: result.fuelReceived,
							claimSecret: Fr.fromHexString(result.fuelSecretHex),
							messageLeafIndex: result.fuelLeafIndex,
						}),
					},
				}
			}
			const maxFees = (await predictedWorstMinFees(node)).mul(RELIABILITY_PAD)
			return {
				fee: {
					paymentMethod: privateMintAndPayFee(
						AztecAddress.fromString(PRIVATE_FPC_ADDRESS),
						result.fuelReceived,
						deriveBridgeSecret(bridgeSalt as Fr, from),
						bridgeSalt as Fr,
						new Fr(result.fuelLeafIndex),
					),
					gasSettings: { teardownGasLimits: Gas.from({ daGas: 0, l2Gas: 0 }), maxFeesPerGas: maxFees },
				},
				maxFees,
			}
		}

		const fjBefore = await fjBalance()
		type ClaimReceipt = { transactionFee?: bigint; gasUsed?: { totalGas?: { daGas: number; l2Gas: number } } }
		let receipt: ClaimReceipt | undefined
		let committedMaxFees: GasFees | undefined
		for (let i = 0; i < 300 && !receipt; i++) {
			try {
				const built = await buildClaimFee() // RE-PRICE each attempt: tracks the rising live base fee over the wait
				committedMaxFees = built.maxFees
				const sent = (await claimMethod().send({ from, fee: built.fee, wait: { waitForStatus: TxStatus.PROPOSED } } as never)) as {
					receipt?: ClaimReceipt
				}
				receipt = sent.receipt ?? {}
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e)
				// FPC budget assert = a real fail (bridged FJ < ceiling), NOT a sync/fee-drift wait.
				if (/Amount too low to cover gas cost|max_gas_cost/.test(msg)) {
					throw new Error(`${label}: FPC budget assert — bridged FJ ${result.fuelReceived} < committed getFeeLimit. ${msg}`)
				}
				// "maxFeesPerGas < gasFees" (base fee rose) is now self-healing: the next attempt re-prices.
				if (i % 10 === 0) console.log(`claim not ready / re-pricing… (${mins()})`)
				await new Promise((r) => setTimeout(r, 6000))
			}
		}
		if (!receipt) throw new Error(`${label}: self-paying claim never SETTLED within budget`)
		if (committedMaxFees) {
			console.log(`${label}: committed maxFeesPerGas l2=${committedMaxFees.feePerL2Gas} (predicted-worst × ${RELIABILITY_PAD})`)
		}
		console.log(`${label}: claim SETTLED - one tx claimed tokens AND gas (${mins()})`)

		// Decompose the fee: actual (post-inclusion) vs the FPC ceiling (committed gasLimit × maxFeesPerGas).
		const actualFee = receipt.transactionFee ?? 0n
		let ceiling: bigint | undefined
		if (committedMaxFees && receipt.gasUsed?.totalGas) {
			const g = receipt.gasUsed.totalGas
			ceiling = BigInt(g.daGas) * committedMaxFees.feePerDaGas + BigInt(g.l2Gas) * committedMaxFees.feePerL2Gas
		} else if (committedMaxFees && actualFee > 0n) {
			// The receipt doesn't expose gasUsed, so derive the FPC ceiling from the fee ratio: actual fee =
			// gasUsed·liveBaseFee, the FPC ceiling = gasLimit·committedMaxFees, and gasLimit≈gasUsed (gasPadding≈1,
			// teardown=0). So ceiling ≈ actualFee · (committedMaxFees / liveBaseFee), using the L2-gas component
			// (it dominates; committed da-fee is 0). Conservative: if predicted-worst > current, the ceiling
			// scales up exactly as the committed cap does.
			const live = await node.getCurrentMinFees()
			ceiling = live.feePerL2Gas > 0n ? (actualFee * committedMaxFees.feePerL2Gas) / live.feePerL2Gas : undefined
		}
		console.log(
			`${label}: actual fee ${actualFee}${ceiling !== undefined ? ` | getFeeLimit (FPC ceiling) ≈ ${ceiling}` : " | getFeeLimit n/a"}`,
		)

		const tokenBal = await tokenBalance(isPrivate ? "private" : "public")
		console.log(`${label}: token balance ${tokenBal}`)
		if (tokenBal < bridgedAmount) throw new Error(`${label}: token balance ${tokenBal} < ${bridgedAmount}`)
		if (!fuelViaPrivateFpc) {
			// PUBLIC fuel credits the user's PUBLIC FJ balance. PRIVATE-FPC fuel credits the remainder as a
			// PRIVATE note (not the public balance), so this assert only applies to the public path.
			const fjAfter = await fjBalance()
			if (fjAfter <= fjBefore) throw new Error(`${label}: no FJ landed as balance (fee ate everything?)`)
			console.log(`${label}: FJ gained ${fjAfter - fjBefore}`)
		}
		return { actualFee, ceiling }
	}

	const rndNonce = () => BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`)

	// Public fuel = sanity (works pre-fix); the PRIVATE-FPC path is what regressed — run it ≥3× for a
	// stable getFeeLimit/minFuelFj across fee conditions.
	const pubRun = await runVariant(false, rndNonce())
	const privRuns: { actualFee: bigint; ceiling?: bigint }[] = []
	for (let i = 0; i < PRIVATE_RUNS; i++) {
		console.log(`\n--- private-FPC run ${i + 1}/${PRIVATE_RUNS} ---`)
		privRuns.push(await runVariant(true, rndNonce(), true))
	}

	// ─── MIN_FUEL_FJ calibration: 2× the worst FPC CEILING (getFeeLimit), not the actual fee (codex
	// 019ee66b-01a4) — the FPC asserts amount >= getFeeLimit. Fall back to a conservative actual×4 proxy
	// only if no receipt exposed gasUsed (so the ceiling couldn't be computed). ──
	const ceilings = privRuns.map((r) => r.ceiling).filter((c): c is bigint => c !== undefined)
	const worstCeiling = ceilings.length ? ceilings.reduce((a, b) => (a > b ? a : b)) : undefined
	const worstActual = [pubRun, ...privRuns].map((r) => r.actualFee).reduce((a, b) => (a > b ? a : b), 0n)
	const basis = worstCeiling ?? worstActual * 4n
	// 4× the worst measured ceiling — matches the old V4-era floor's forgiveness (~4× headroom) but now
	// GROUNDED in the real V5 ceiling, rather than 2× which codex flagged as a conservatism regression
	// (the ceiling already bakes in the 1.5× fee pad, so 4× tolerates a further ~4× base-fee surge).
	const FUEL_FEE_MARGIN = 4n
	const minFuelFj = basis * FUEL_FEE_MARGIN
	console.log(`\n✅ public + ${PRIVATE_RUNS} private-FPC runs SETTLED in ${mins()}`)
	console.log(`private getFeeLimits : ${privRuns.map((r) => r.ceiling ?? "n/a").join(", ")}`)
	console.log(`private actual fees  : ${privRuns.map((r) => r.actualFee).join(", ")}`)
	console.log(
		`MIN_FUEL_FJ calibration: ${minFuelFj} (${FUEL_FEE_MARGIN}× worst ${worstCeiling !== undefined ? "getFeeLimit" : "actual×4 proxy"}) - update testnet-bridge.json l1.fuel.minFuelFj`,
	)

	// --- Phase 3: NO-FUEL-SPEND proof - a tx self-pays from EXISTING private FJ at the FPC via pay_fee. ---
	if (NOFUEL_SPEND_RUNS > 0) {
		const fpcContract = await Contract.at(privateFpcInstance.address, privateFpcArtifact as never, ewallet as never)
		const readFpcBalance = async (): Promise<bigint> => {
			const r = (await fpcContract.methods.balance_of(from).simulate({ from })) as { result?: bigint } | bigint
			return typeof r === "bigint" ? r : (r.result ?? 0n)
		}
		for (let i = 0; i < NOFUEL_SPEND_RUNS; i++) {
			console.log(`\n--- no-fuel-spend run ${i + 1}/${NOFUEL_SPEND_RUNS} ---`)
			// Seed: a PUBLIC-token + private-FPC-fuel bridge credits the FPC with private FJ AND gives `from`
			// public tokens to move. The remainder mint_and_pay_fee credits is exactly what pay_fee then spends.
			await runVariant(false, rndNonce(), true)
			const before = await readFpcBalance()
			console.log(`NO-FUEL-SPEND: FPC private FJ before = ${before}`)
			if (before <= 0n) throw new Error("NO-FUEL-SPEND: FPC balance 0 after a private fuel run - nothing to spend")
			// Spend it: a 1-unit public self-transfer paying via PrivateFPC.pay_fee, repriced per attempt.
			let settled = false
			for (let a = 0; a < 100 && !settled; a++) {
				try {
					const maxFees = (await predictedWorstMinFees(node)).mul(RELIABILITY_PAD)
					await token.methods.transfer_public_to_public(from, from, 1n, 0).send({
						from,
						fee: {
							paymentMethod: privateFeeJuicePayment(AztecAddress.fromString(PRIVATE_FPC_ADDRESS)),
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
					if (a % 10 === 0) console.log(`no-fuel-spend re-pricing... (${mins()})`)
					await new Promise((r) => setTimeout(r, 6000))
				}
			}
			if (!settled) throw new Error("NO-FUEL-SPEND: pay_fee tx never SETTLED within budget")
			const after = await readFpcBalance()
			if (after >= before) throw new Error(`NO-FUEL-SPEND: FPC balance did not drop (${before} -> ${after}) - pay_fee did not charge`)
			console.log(
				`OK NO-FUEL-SPEND run ${i + 1}: tx self-paid from EXISTING private FJ via pay_fee on V5 (FPC ${before} -> ${after}, spent ${before - after}) (${mins()})`,
			)
		}
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
