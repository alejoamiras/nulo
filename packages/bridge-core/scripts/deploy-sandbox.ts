/**
 * Deploys ONE bridge generation onto a private local network and, with `--smoke`, drives every
 * user-visible flow against the manifest it just wrote: deposits (public, private, relayed,
 * token+gas, gas-only, private gas into PrivateFPC credit), exits (public on the sponsor, private
 * paid from that credit — its billed gas is reported, the reading `PRIVATE_HUB_EXIT_GAS` is sized
 * from — both through to the L1 release), the four first-time-token shapes, a rejected
 * registration, and the guardian's exit pause.
 *
 * The network is this run's own (`scripts/sandbox/local-network.ts`) — its ports are claimed, its
 * data lives on real disk, and teardown signals only the process groups this run spawned.
 *
 * Run: bun scripts/deploy-sandbox.ts [--smoke] [--keep]   (from packages/bridge-core)
 *   --smoke  run the flow battery after the deploy
 *   --keep   leave the network up and print the env lines to re-attach to it
 * Env: SANDBOX_L1_RPC + SANDBOX_NODE_URL (both) attach to a running network instead of booting one.
 *      SEPOLIA_RPC_URL sources the Permit2 + Multicall3 bytecode this chain has no deployer for.
 */
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { SetPublicAuthwitContractInteraction } from "@aztec/aztec.js/authorization"
import { Contract, type ContractBase } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { TxHash, TxStatus } from "@aztec/aztec.js/tx"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { EthAddress } from "@aztec/foundation/eth-address"
import { TestERC20Abi } from "@aztec/l1-artifacts"
import { FeeJuiceContractArtifact } from "@aztec/noir-contracts.js/FeeJuice"
import { Gas, GasFees, type GasUsed } from "@aztec/stdlib/gas"
import { PrivateFPCContract } from "@alejoamiras/private-fee-juice/artifacts/private"
import { registerInitialLocalNetworkAccountsInWallet } from "@aztec/wallets/testing"
import { deriveNuloAccountKeys } from "@nulo/wallet-crypto"
import { type Address, defineChain, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { feeJuiceAddress, predictedWorstMinFees, publicFeeJuicePayment } from "../src/fee-juice"
import { consumeWithdrawal, type L1Ctx } from "../src/flows"
import { TOKEN_PORTAL_ABI } from "../src/factory-abi"
import {
	claimViaHub,
	exitViaHub,
	type HubClaimOutcome,
	type HubExitParams,
	hubExitsPaused,
	hubTokenFor,
	preflightHubExit,
	simulateHubExit,
} from "../src/hub-l2"
import type { JournalTokenBlock } from "../src/journal"
import type { BridgeBlock, ManifestToken, ManifestV2 } from "../src/manifest-v2"
import {
	deriveBridgeSecret,
	PRIVATE_FPC_ADDRESS,
	PRIVATE_FPC_SALT,
	PRIVATE_HUB_EXIT_GAS,
	privateFeeJuicePayment,
	privateFpcFeeLimit,
	privateMintAndPayFee,
} from "../src/private-fuel"
import { discoverFuelRoute } from "../src/route-discovery"
import { buildFuelRoute } from "../src/route"
import { runSend, type SendParams, type SendResult } from "../src/send-flow"
import { walletChainIdOf } from "../src/wallet-chain-id"
import { type CalibrationSample, calibrateFuelBudgets } from "./calibration"
import { openDeployJournal, writeCandidateAtomically } from "./deploy-manifest"
import { deployGeneration, type GenerationRecord, type L2Ctx, preCreateToken, waitForL1ToL2Message } from "./generation"
import { startLocalNetwork } from "./sandbox/local-network"
import { evmArtifact } from "./script-artifacts"
import { ensureRouterPermit2 } from "./script-l1"
import { claimTokensUntilSynced, deployAccountIfAbsent, registerHub, registerHubToken, sponsoredFpcFee } from "./script-l2"
import { sendGenerationOf } from "./script-send"
import { createL1Clients, createL1PublicClient, createL2Wallet, createNode, stopwatch } from "./script-bootstrap"

const here = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(here, "..", "sandbox-deploy")

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address
/** Anvil's first two funded keys: account 0 deploys and deposits, account 1 is the second depositor. */
const KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex
const KEY_1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex
const CHAIN_ID = 31337
const ZERO_L1 = "0x0000000000000000000000000000000000000000" as Address
/** Stands in for WETH in the route grammar; the sandbox has no V4, so it is never swapped through. */
const FAKE_WETH = "0x00000000000000000000000000000000000077e7" as Address
/** The mock returns `in × 10^12` FeeJuice-wei, so one whole 6-decimal token buys one whole FeeJuice. */
const MOCK_RATE_NUM = 10n ** 12n
/** 1 FJ — the floor the app refuses to bridge below. */
const MIN_FJ = 10n ** 18n
/** The local sequencer prices L2 gas orders of magnitude above the old default; a lower ceiling
 *  rejects every setup tx with "maxFeesPerGas.feePerL2Gas must be >= gasFees". */
const FEE_CEILING = { maxFeesPerGas: new GasFees(10n ** 13n, 10n ** 13n) }

const rndNonce = () => BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`)
/** Read from the CHAIN, never the wall clock: anvil's timestamp runs far ahead of real time here
 *  (every forced block and every sequencer publication advances it), and a wall-clock deadline is
 *  already in this chain's past — Permit2 answers `SignatureExpired`. */
const deadline = async (l1: L1Ctx): Promise<bigint> => (await l1.pub.getBlock()).timestamp + 3600n
const lc = (v: string) => v.toLowerCase() as Address

interface TokenSpec {
	name: string
	symbol: string
	decimals: number
}

const SPECS = {
	usdc: { name: "Nulo USDC", symbol: "USDC", decimals: 6 },
	usdt: { name: "Nulo USDT", symbol: "USDT", decimals: 6 },
	nort: { name: "No Route Token", symbol: "NORT", decimals: 18 },
	pxo: { name: "Portal Only", symbol: "PXO", decimals: 18 },
} satisfies Record<string, TokenSpec>

// ─── L1 bootstrap ────────────────────────────────────────────────────────────

const sandboxChain = (rpcUrl: string) =>
	defineChain({
		id: CHAIN_ID,
		name: "sandbox",
		nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
		rpcUrls: { default: { http: [rpcUrl] } },
		contracts: { multicall3: { address: MULTICALL3 } },
	})

/** Permit2 and Multicall3 are canonical singletons nobody can redeploy at their real address, so the
 *  sandbox borrows their runtime bytecode from a public chain instead. */
async function copyCanonicalCode(l1: L1Ctx, rpcUrl: string, address: Address, label: string): Promise<void> {
	const code = await createL1PublicClient({ chain: sandboxChain(SEPOLIA_RPC), rpcUrl: SEPOLIA_RPC }).getCode({ address })
	if (!code) throw new Error(`no ${label} bytecode at ${address} on ${SEPOLIA_RPC} — set SEPOLIA_RPC_URL to a working RPC`)
	await l1.pub.request({ method: "anvil_setCode" as never, params: [address, code] as never })
	console.log(`  ${label} code copied to ${address} (from ${rpcUrl === SEPOLIA_RPC ? "sepolia" : rpcUrl})`)
}

async function deployEvm(l1: L1Ctx, name: string, args: unknown[]): Promise<Address> {
	const { abi, bytecode } = evmArtifact(name)
	const hash = await l1.wallet.deployContract({ abi, bytecode, args, account: l1.account, chain: l1.wallet.chain } as never)
	const receipt = await l1.pub.waitForTransactionReceipt({ hash })
	if (!receipt.contractAddress) throw new Error(`${name} deploy produced no address`)
	return lc(receipt.contractAddress)
}

async function writeL1(l1: L1Ctx, address: Address, abi: unknown, functionName: string, args: unknown[]): Promise<Hex> {
	const hash = await l1.wallet.writeContract({
		address,
		abi: abi as never,
		functionName,
		args: args as never,
		account: l1.account,
		chain: l1.wallet.chain,
	} as never)
	await l1.pub.waitForTransactionReceipt({ hash })
	return hash
}

/** The fee asset is a minter-gated TestERC20 whose owner is the L1 deployer; anvil lets us borrow
 *  that owner when this run's key is not it. */
async function ensureFeeAssetMinter(l1: L1Ctx, feeJuice: Address): Promise<void> {
	const isMinter = await l1.pub.readContract({
		address: feeJuice,
		abi: TestERC20Abi,
		functionName: "minters",
		args: [l1.account.address],
	})
	if (isMinter) return
	const owner = lc(String(await l1.pub.readContract({ address: feeJuice, abi: TestERC20Abi, functionName: "owner", args: [] })))
	await l1.pub.request({ method: "anvil_impersonateAccount" as never, params: [owner] as never })
	await l1.pub.request({ method: "anvil_setBalance" as never, params: [owner, "0xde0b6b3a7640000"] as never })
	const hash = await l1.wallet.writeContract({
		address: feeJuice,
		abi: TestERC20Abi,
		functionName: "addMinter",
		args: [l1.account.address],
		account: owner,
		chain: l1.wallet.chain,
	} as never)
	await l1.pub.waitForTransactionReceipt({ hash })
	await l1.pub.request({ method: "anvil_stopImpersonatingAccount" as never, params: [owner] as never })
}

interface L1Deployment {
	feeJuice: Address
	feeJuicePortal: Address
	registry: Address
	swapTarget: Address
	tokens: Record<keyof typeof SPECS, Address>
}

async function deployL1Fixtures(
	l1: L1Ctx,
	addrs: { feeJuice: Address; feeJuicePortal: Address; registry: Address },
): Promise<L1Deployment> {
	const swapTarget = await deployEvm(l1, "MockSwapTarget", [addrs.feeJuice])
	await writeL1(l1, swapTarget, evmArtifact("MockSwapTarget").abi, "setRate", [MOCK_RATE_NUM, 1n])
	await ensureFeeAssetMinter(l1, addrs.feeJuice)
	await writeL1(l1, addrs.feeJuice, TestERC20Abi, "mint", [swapTarget, 10n ** 30n])
	await writeL1(l1, addrs.feeJuice, TestERC20Abi, "mint", [l1.account.address, 10n ** 24n])
	console.log(`  MockSwapTarget: ${swapTarget} (rate 1:${MOCK_RATE_NUM}, funded)`)

	// Sequential on purpose: these share one L1 account, and viem assigns each tx the nonce it reads
	// at build time — issuing them together makes every tx after the first "nonce too low".
	const entries: (readonly [string, Address])[] = []
	for (const [key, spec] of Object.entries(SPECS)) {
		const address = await deployEvm(l1, "MintableERC20", [spec.name, spec.symbol, spec.decimals, 1_000_000n])
		console.log(`  ${spec.symbol}: ${address}`)
		entries.push([key, address])
	}
	return { ...addrs, swapTarget, tokens: Object.fromEntries(entries) as L1Deployment["tokens"] }
}

// ─── L2 bootstrap ────────────────────────────────────────────────────────────

interface Sandbox {
	l1: L1Ctx
	l1b: L1Ctx
	l2: L2Ctx
	relayerOpts: Record<string, unknown>
	a1: AztecAddress
	deployment: L1Deployment
	mins: () => string
}

/** The actor's key material is a fixed sandbox constant of the same kind as anvil's KEY_0 — not a
 *  credential — so a `--keep` re-attach finds the deployer that owns the generation. */
const SANDBOX_ACTOR_SECRET = Fr.fromHexString("0x00000000000000000000000000000000000000000000000000005a5db0c7a0b1")
const SANDBOX_ACTOR_SALT = new Fr(1)

/** The smoke acts as the account shape the extension deploys — a constructor-based Schnorr account
 *  under Nulo's key derivation, deployed through the sponsor — not as a genesis account: those are
 *  initializerless, a different entrypoint, and every gas reading here is taken as the actor. */
async function sandboxActor(wallet: unknown, node: L2Ctx["node"], fee: unknown): Promise<AztecAddress> {
	const { signingKey, secretKey } = await deriveNuloAccountKeys(SANDBOX_ACTOR_SECRET)
	const ewallet = wallet as {
		createSchnorrAccount: (
			secretKey: unknown,
			salt: Fr,
			signingKey: unknown,
		) => Promise<{ getAccount: () => Promise<{ getAddress: () => AztecAddress }> }>
	}
	const manager = await ewallet.createSchnorrAccount(secretKey, SANDBOX_ACTOR_SALT, signingKey)
	const from = (await manager.getAccount()).getAddress()
	await deployAccountIfAbsent({
		node: node as never,
		manager: manager as never,
		from,
		fee,
		log: (stage) => console.log(`  actor account ${stage}: ${from.toString()}`),
	})
	return from
}

async function buildL2(nodeUrl: string): Promise<{ l2: L2Ctx; a1: AztecAddress; relayerOpts: Record<string, unknown> }> {
	const node = createNode(nodeUrl)
	// Proving off: this is a local correctness loop, not a proof-system gate.
	const wallet = await createL2Wallet({ nodeUrl, proverEnabled: false })
	// A local network pre-deploys its funded accounts at genesis; the relayer is one of them.
	const accounts = await registerInitialLocalNetworkAccountsInWallet(wallet as never)
	const relayer = accounts[1]
	if (!relayer) throw new Error("the local network served fewer than two funded accounts")
	const { fee } = await sponsoredFpcFee(wallet)
	const paid = { ...fee, gasSettings: FEE_CEILING }
	const from = await sandboxActor(wallet, node, paid)
	const sendOpts = { from, fee: paid, wait: { waitForStatus: TxStatus.PROPOSED } }
	// This network builds a block only when a transaction arrives, so the L1→L2 anchor stands still
	// between flows. Revoking a random, never-granted public authwit is the cheapest universally
	// available public transaction: it needs no contract of ours and changes nothing.
	const forceBlock = async () => {
		const revoke = await SetPublicAuthwitContractInteraction.create(wallet as never, from, Fr.random(), false)
		return revoke.send(sendOpts as never)
	}
	return {
		l2: {
			wallet: wallet as unknown as Wallet,
			node,
			from,
			deployOpts: { from, fee: paid, wait: { waitForStatus: TxStatus.CHECKPOINTED } },
			sendOpts,
			forceBlock,
		},
		a1: relayer,
		relayerOpts: { from: relayer, fee: paid, wait: { waitForStatus: TxStatus.PROPOSED } },
	}
}

/** Keeps blocks coming while an operation waits on chain PROGRESS rather than on a message. */
async function withBlockHeartbeat<T>(l2: L2Ctx, fn: () => Promise<T>): Promise<T> {
	let beating = true
	const heartbeat = (async () => {
		while (beating) {
			await l2.forceBlock?.().catch(() => {})
			await new Promise((r) => setTimeout(r, 2000))
		}
	})()
	try {
		return await fn()
	} finally {
		beating = false
		await heartbeat
	}
}

// ─── Manifest ────────────────────────────────────────────────────────────────

function buildManifest(gen: GenerationRecord, deployment: L1Deployment, tokens: ManifestToken[], rollupVersion: number): ManifestV2 {
	return {
		schema: 2,
		network: "sandbox",
		l1ChainId: CHAIN_ID,
		walletChainId: walletChainIdOf(CHAIN_ID, rollupVersion),
		// No `swap` block: the sandbox has no Uniswap V4, so every fueled send names its route
		// explicitly against the mock instead of discovering one.
		bridge: { l1: { ...gen.l1, swap: undefined }, l2: gen.l2, tokens } as BridgeBlock,
		feeJuice: { portal: deployment.feeJuicePortal, asset: deployment.feeJuice, minFj: MIN_FJ.toString() },
		privateClaimMode: "salt-v2",
	}
}

// ─── Smoke helpers ───────────────────────────────────────────────────────────

interface Smoke extends Sandbox {
	manifest: ManifestV2
	bridge: BridgeBlock
	hub: ContractBase
	feeJuiceL2: ContractBase
	/** Every fresh token the battery deploys, so a later flow can read its L2 balance. */
	l2TokenOf: (block: JournalTokenBlock) => Promise<ContractBase>
}

const generationOf = (s: Smoke) => sendGenerationOf(s.manifest, s.bridge)

async function balanceOf(contract: ContractBase, from: AztecAddress, kind: "public" | "private"): Promise<bigint> {
	const call = kind === "public" ? contract.methods.balance_of_public(from) : contract.methods.balance_of_private(from)
	const r = (await call.simulate({ from } as never)) as { result?: bigint } | bigint
	return typeof r === "bigint" ? r : (r.result ?? 0n)
}

async function mint(l1: L1Ctx, erc20: Address, to: Address, amount: bigint): Promise<void> {
	await writeL1(l1, erc20, evmArtifact("MintableERC20").abi, "mint", [to, amount])
}

/** The explicit two-hop shape the mock accepts. The mock ignores the pools entirely, but the router
 *  hashes them into the witness and refuses an empty path for anything but the fee asset. */
function mockRoute(erc20: Address, feeJuice: Address) {
	return buildFuelRoute({
		token: erc20,
		weth: FAKE_WETH,
		feeJuice,
		tokenWeth: { fee: 3000, tickSpacing: 60 },
		ethFj: { fee: 3000, tickSpacing: 60 },
	})
}

async function send(s: Smoke, l1: L1Ctx, p: Omit<SendParams, "nonce" | "deadline">): Promise<SendResult> {
	return runSend(l1, generationOf(s), { ...p, nonce: rndNonce(), deadline: await deadline(l1) })
}

interface ClaimPlan {
	amount: bigint
	isPrivate: boolean
	recipient: AztecAddress
	submitter?: "relayer"
	fee?: unknown
	/** Which fee mode paid; a paid claim's landed fee becomes a calibration sample. */
	feeMode?: CalibrationSample["feeMode"]
}

const feeSamples: CalibrationSample[] = []

/** The landed claim's `transactionFee`, kept per shape so the budget the manifest ships is measured. */
async function sampleClaimFee(s: Smoke, outcome: HubClaimOutcome, p: ClaimPlan): Promise<void> {
	const feeMode = p.feeMode ?? "sponsored"
	const hashes: Array<[CalibrationSample["shape"], string]> = []
	if (outcome.registerTxHash) hashes.push(["register_token", outcome.registerTxHash])
	const claimShape: CalibrationSample["shape"] =
		outcome.path === "register+claim" ? "register_and_claim_public" : p.isPrivate ? "claim_private" : "claim_public"
	hashes.push([claimShape, outcome.claimTxHash])
	for (const [shape, hash] of hashes) {
		const receipt = await s.l2.node.getTxReceipt(TxHash.fromString(hash))
		feeSamples.push({ shape, feeMode, transactionFee: receipt.transactionFee ?? 0n })
	}
}

/** The claim's token block always comes from the factory read-back the send returned — the manifest
 *  copy would be missing for a token this run just invented. */
function claimInputs(s: Smoke, res: SendResult, p: ClaimPlan) {
	const sendOpts = p.submitter === "relayer" ? s.relayerOpts : s.l2.sendOpts
	return {
		hub: s.hub,
		claim: {
			token: res.token as JournalTokenBlock,
			recipient: p.recipient.toString(),
			amount: p.amount,
			claimValue: Fr.fromHexString(res.tokenClaimValueHex as string),
			leafIndex: res.tokenLeafIndex as bigint,
			isPrivate: p.isPrivate,
			from: (sendOpts.from as AztecAddress).toString(),
		},
		sendOpts: p.fee ? { ...sendOpts, fee: p.fee } : sendOpts,
	}
}

async function claim(s: Smoke, res: SendResult, p: ClaimPlan) {
	// A first claim registers the token, which enqueues the derived Token's constructor — the wallet
	// has to hold that instance to build the transaction at all.
	await s.l2TokenOf(res.token as JournalTokenBlock)
	// Waiting for the deposit's own message first turns the retry loop into a fallback rather than
	// the normal path, which keeps a genuinely-rejected claim from spending minutes in it.
	await waitForL1ToL2Message(s.l2.node, res.tokenMessageHashHex as string, { forceBlock: s.l2.forceBlock })
	const outcome = await claimTokensUntilSynced({ ...claimInputs(s, res, p), attempts: 60, intervalMs: 3000 })
	await sampleClaimFee(s, outcome, p)
	return outcome
}

/** One attempt, no sync retry — for the claims that are SUPPOSED to fail. */
async function claimOnce(s: Smoke, res: SendResult, p: ClaimPlan) {
	const { hub, claim: params, sendOpts } = claimInputs(s, res, p)
	return claimViaHub(hub, params, sendOpts)
}

/** The fee modes a claim can be driven under here. */
type FeeMode = "sponsored" | "fee-juice-claim" | "private-fpc"

/** Pays the claim's own gas with the Fee Juice the same send bridged. */
function fuelClaimFee(s: Smoke, res: SendResult) {
	return {
		paymentMethod: publicFeeJuicePayment(s.l2.from, {
			claimAmount: res.fuelReceived ?? 0n,
			claimSecret: Fr.fromHexString(res.fuelSecretHex as string),
			messageLeafIndex: res.fuelLeafIndex as bigint,
		}),
		gasSettings: FEE_CEILING,
	}
}

/** Same bridged Fee Juice, but minted straight into the PrivateFPC, which pays as a third party. */
async function fpcClaimFee(s: Smoke, res: SendResult, bridgeSalt: Fr) {
	// The FPC asserts `amount >= gasLimits · maxFeesPerGas` up front, so the committed ceiling has to
	// be a live prediction. The blunt setup ceiling would price a budget no bridged slice can cover.
	const maxFeesPerGas = (await predictedWorstMinFees(s.l2.node)).mul(2)
	return {
		paymentMethod: privateMintAndPayFee(
			AztecAddress.fromStringUnsafe(PRIVATE_FPC_ADDRESS),
			res.fuelReceived ?? 0n,
			deriveBridgeSecret(bridgeSalt, s.l2.from),
			bridgeSalt,
			new Fr(res.fuelLeafIndex as bigint),
		),
		gasSettings: { teardownGasLimits: Gas.from({ daGas: 0, l2Gas: 0 }), maxFeesPerGas },
	}
}

/** The canonical PrivateFPC has no initializer and no owner, so a fresh chain just needs the
 *  universal deploy at its pinned salt before anything can pay through it. */
async function ensurePrivateFpc(s: Smoke): Promise<void> {
	const pinned = AztecAddress.fromStringUnsafe(PRIVATE_FPC_ADDRESS)
	if (await s.l2.node.getContract(pinned)) return
	await PrivateFPCContract.deploy(
		s.l2.wallet as never,
		{
			salt: Fr.fromHexString(PRIVATE_FPC_SALT),
			universalDeploy: true,
		} as never,
	).send(s.l2.deployOpts as never)
	if (!(await s.l2.node.getContract(pinned))) throw new Error(`a deploy at the canonical salt did not land at ${PRIVATE_FPC_ADDRESS}`)
}

async function freshToken(s: Smoke, spec: TokenSpec, mintTo: Address[], amount: bigint): Promise<Address> {
	const erc20 = await deployEvm(s.l1, "MintableERC20", [spec.name, spec.symbol, spec.decimals, 1_000_000n])
	for (const to of mintTo) await mint(s.l1, erc20, to, amount)
	return erc20
}

const flowResults: string[] = []

function record(line: string): void {
	flowResults.push(line)
	console.log(line)
}

async function flow(label: string, fn: () => Promise<string>): Promise<void> {
	try {
		record(`✅ ${label} — ${await fn()}`)
	} catch (e) {
		record(`✗ ${label} — ${e instanceof Error ? e.message : String(e)}`)
		throw e
	}
}

/** A lane this network may simply not support. Its absence is reported, never fatal. */
async function optionalFlow(label: string, fn: () => Promise<string>): Promise<void> {
	try {
		record(`✅ ${label} — ${await fn()}`)
	} catch (e) {
		record(`skipped: ${label} needs ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}`)
	}
}

// ─── Flows ───────────────────────────────────────────────────────────────────

async function flowPublicDeposit(s: Smoke, token: ManifestToken, l2Token: ContractBase): Promise<string> {
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

async function flowPrivateDeposit(s: Smoke, token: ManifestToken, l2Token: ContractBase): Promise<string> {
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

async function flowRelayedPrivateDeposit(s: Smoke, token: ManifestToken, l2Token: ContractBase): Promise<string> {
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
		await claimOnce(s, res, { amount, isPrivate: true, recipient: s.a1, submitter: "relayer" })
		redirected = true
	} catch {}
	if (redirected) throw new Error("SECURITY: a relayer redirected a private claim to itself")

	const before = await balanceOf(l2Token, s.l2.from, "private")
	const outcome = await claim(s, res, { amount, isPrivate: true, recipient: s.l2.from, submitter: "relayer" })
	const gained = (await balanceOf(l2Token, s.l2.from, "private")) - before
	if (gained < amount) throw new Error(`relayed claim credited ${gained}, expected ${amount}`)
	return `wrong recipient rejected, then ${outcome.path} submitted by account[1] credited account[0]`
}

async function flowTokenPlusGas(s: Smoke, token: ManifestToken, l2Token: ContractBase): Promise<string> {
	const unit = 10n ** BigInt(token.decimals)
	const total = 100n * unit
	// The slice has to buy enough Fee Juice to pay the claim it funds, which the mock's fixed rate
	// makes exact: 40 whole 6-decimal units → 4×10^19 FJ-wei.
	const fuelAmount = 40n * unit
	await mint(s.l1, token.erc20 as Address, s.l1.account.address, total)
	const route = mockRoute(token.erc20 as Address, s.deployment.feeJuice)
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

async function flowGasOnly(s: Smoke): Promise<string> {
	const amount = 20n * MIN_FJ
	const feeAsset = s.deployment.feeJuice
	await writeL1(s.l1, feeAsset, TestERC20Abi, "mint", [s.l1.account.address, amount])
	await ensureRouterPermit2(s.l1, {
		usdc: feeAsset,
		usdcAbi: TestERC20Abi,
		permit2: PERMIT2,
		needed: amount,
		mins: s.mins,
	})
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

/** The pinned PrivateFPC as this wallet sees it, deployed at the canonical salt when the chain has none. */
async function privateFpc(s: Smoke): Promise<ContractBase> {
	await ensurePrivateFpc(s)
	const at = await PrivateFPCContract.at(AztecAddress.fromStringUnsafe(PRIVATE_FPC_ADDRESS), s.l2.wallet as never)
	return at as unknown as ContractBase
}

/** The account's credit at the FPC — `balance_of` is a utility, read through the wallet's own PXE. */
async function privateCreditOf(s: Smoke, fpc: ContractBase): Promise<bigint> {
	const r = (await fpc.methods.balance_of(s.l2.from).simulate({ from: s.l2.from } as never)) as { result?: bigint } | bigint
	return typeof r === "bigint" ? r : (r.result ?? 0n)
}

/** One credit note, funded the way a user's is: Fee Juice bridged straight to the PrivateFPC under
 *  a claimer-bound secret, claimed into the FPC's public balance, then minted into the actor's
 *  credit — `mint` proves the claim by reading its nullifier rather than consuming the message
 *  itself (`mint_and_pay_fee` is the one-transaction form). Returns the credit gained. */
async function mintPrivateGasNote(s: Smoke, fpc: ContractBase, amount: bigint): Promise<bigint> {
	const feeAsset = s.deployment.feeJuice
	await writeL1(s.l1, feeAsset, TestERC20Abi, "mint", [s.l1.account.address, amount])
	await ensureRouterPermit2(s.l1, { usdc: feeAsset, usdcAbi: TestERC20Abi, permit2: PERMIT2, needed: amount, mins: s.mins })
	const salt = Fr.random()
	const res = await send(s, s.l1, {
		intent: "gas",
		erc20: feeAsset,
		amount,
		aztecRecipient: s.l2.from.toString() as Hex,
		isPrivate: false,
		gas: {
			fuelAmount: amount,
			fuelRecipient: PRIVATE_FPC_ADDRESS as Hex,
			minFuelOutput: amount,
			path: [],
			zeroForOnes: [],
			// The FPC rebuilds this secret from the claimer inside `mint`; a random one would strand the Fee Juice.
			fuelSecret: deriveBridgeSecret(salt, s.l2.from),
		},
	})
	await waitForL1ToL2Message(s.l2.node, res.fuelMessageHashHex as string, { forceBlock: s.l2.forceBlock })
	const leafIndex = new Fr(res.fuelLeafIndex as bigint)
	const before = await privateCreditOf(s, fpc)
	await s.feeJuiceL2.methods.claim(fpc.address, amount, deriveBridgeSecret(salt, s.l2.from), leafIndex).send(s.l2.sendOpts as never)
	await fpc.methods.mint(amount, salt, leafIndex).send(s.l2.sendOpts as never)
	const gained = (await privateCreditOf(s, fpc)) - before
	if (gained < amount) throw new Error(`private credit rose by ${gained}, expected ${amount}`)
	return gained
}

/** The exit's ceiling at today's predicted worst fees under the app's limits. */
async function exitCeiling(s: Smoke): Promise<bigint> {
	return privateFpcFeeLimit(PRIVATE_HUB_EXIT_GAS, await predictedWorstMinFees(s.l2.node))
}

/** The actor's credit notes as the flows created them. `pay_fee` selects notes largest-first until
 *  the ceiling is covered and returns the remainder as one change note, so this inventory says how
 *  many notes an exit spends — what its gas sample is labelled with, and what the landed
 *  transaction's nullifier count is checked against. */
const creditNotes: bigint[] = []
const byValueDesc = (a: bigint, b: bigint) => (b > a ? 1 : b < a ? -1 : 0)
const sumOf = (notes: bigint[]) => notes.reduce((s, n) => s + n, 0n)

/** How many notes `pay_fee` selects for this ceiling from the inventory. */
function notesSelectedFor(ceiling: bigint): number {
	let sum = 0n
	const sorted = [...creditNotes].sort(byValueDesc)
	for (let i = 0; i < sorted.length; i++) {
		sum += sorted[i] as bigint
		if (sum >= ceiling) return i + 1
	}
	throw new Error(`the held notes (${creditNotes.join(", ")}) do not cover the ceiling ${ceiling}`)
}

/** Replays the selection on the inventory once the exit has landed. */
function spendNotes(count: number, ceiling: bigint): void {
	creditNotes.sort(byValueDesc)
	const spent = sumOf(creditNotes.splice(0, count))
	if (spent > ceiling) creditNotes.push(spent - ceiling)
}

/** One note worth 1.4× the ceiling: the exit that spends it selects exactly one, and the change it
 *  leaves (≈0.4×) is small enough to be one of the three the fragmented exit needs. Starts from
 *  nothing: credit a re-attached run already holds would make the note shape unknowable. */
async function flowPrivateGasOneNote(s: Smoke): Promise<string> {
	const fpc = await privateFpc(s)
	const held = await privateCreditOf(s, fpc)
	if (held !== 0n) throw new Error(`the actor already holds ${held} FJ-wei of private gas; the note inventory cannot be established`)
	const gained = await mintPrivateGasNote(s, fpc, ((await exitCeiling(s)) * 14n) / 10n)
	creditNotes.push(gained)
	return `bridge() to the PrivateFPC, FeeJuice.claim then PrivateFPC.mint credited ${gained} FJ-wei as one note`
}

/** Two more notes of 0.45× the ceiling each. Beside the first exit's change (≈0.4×) no note and no
 *  pair covers a ceiling, so the next exit's `pay_fee` has to select all three — past the two the
 *  FPC reads first, into its recursion — which is the shape an account that keeps bridging leaves.
 *  The send re-checks that shape at its own ceiling before spending anything. */
async function flowPrivateGasFragmented(s: Smoke): Promise<string> {
	const fpc = await privateFpc(s)
	const each = ((await exitCeiling(s)) * 45n) / 100n
	creditNotes.push(await mintPrivateGasNote(s, fpc, each), await mintPrivateGasNote(s, fpc, each))
	const held = await privateCreditOf(s, fpc)
	if (held !== sumOf(creditNotes)) throw new Error(`the credit ${held} is not the inventory's ${sumOf(creditNotes)}`)
	return `notes of ${creditNotes.join(", ")} FJ-wei held (${held} in all); none covers a ceiling, nor does any pair`
}

type HubGasLimits = { daGas: number; l2Gas: number }

/** What the app names for a private exit: the FPC's `pay_fee` from held credit under the exit's
 *  limits at the predicted worst fee — the ceiling the FPC keeps in full. The limits are clamped to
 *  what this network admits per transaction (a local network caps DA gas far below testnet's
 *  117,668): a no-op at the app's limits, and where it ever binds the report shows the declared
 *  limits beside the constant, since a lower ceiling is a different deduction and note selection. */
async function privateExitFee(s: Smoke): Promise<{ fee: Record<string, unknown>; ceiling: bigint; limits: HubGasLimits }> {
	const [maxFeesPerGas, info] = await Promise.all([predictedWorstMinFees(s.l2.node), s.l2.node.getNodeInfo()])
	const max = info.txsLimits.gas
	const limits = { daGas: Math.min(PRIVATE_HUB_EXIT_GAS.daGas, max.daGas), l2Gas: Math.min(PRIVATE_HUB_EXIT_GAS.l2Gas, max.l2Gas) }
	const fee = {
		paymentMethod: privateFeeJuicePayment(AztecAddress.fromStringUnsafe(PRIVATE_FPC_ADDRESS)),
		gasSettings: { gasLimits: Gas.from(limits), teardownGasLimits: Gas.from({ daGas: 0, l2Gas: 0 }), maxFeesPerGas },
	}
	return { fee, ceiling: privateFpcFeeLimit(limits, maxFeesPerGas), limits }
}

interface ExitGasSample {
	label: string
	/** Credit notes `pay_fee` spent, per the inventory. */
	notes: number
	/** Nullifiers the landed transaction emitted: each spent note is one, so two samples differ by their note difference. */
	nullifiers: number
	simulated: { l2Gas: number; daGas: number }
	fee: bigint
	feePerL2Gas: bigint
	feePerDaGas: bigint
	charged: bigint
	ceiling: bigint
	limits: HubGasLimits
}

const exitGasSamples: ExitGasSample[] = []

/** The landed exit's bill beside its simulation, and what the FPC took from the credit. Fails the
 *  flow rather than record a hole: missing evidence, a landed fee that is not the simulated gas at
 *  the block's prices, a deduction that is not the ceiling, or a nullifier count that does not move
 *  with the notes spent since the previous sample would each make the reading worthless. */
async function sampleExitGas(
	s: Smoke,
	sample: { label: string; notes: number },
	txHash: string,
	sim: { gasUsed?: GasUsed },
	paid: { charged: bigint; ceiling: bigint; limits: HubGasLimits },
): Promise<void> {
	const { label, notes } = sample
	const receipt = await s.l2.node.getTxReceipt(TxHash.fromString(txHash), { includeTxEffect: true })
	const billed = sim.gasUsed?.billedGas
	if (!billed || receipt.transactionFee === undefined || receipt.blockNumber === undefined || !receipt.txEffect) {
		throw new Error(`${label}: the exit's gas evidence is incomplete (simulated gas, landed fee, block or effects missing)`)
	}
	const fees = (await s.l2.node.getBlockData(receipt.blockNumber))?.header.globalVariables.gasFees
	if (!fees) throw new Error(`${label}: block ${receipt.blockNumber} has no gas prices to bill the exit at`)
	const priced = billed.computeFee(fees).toBigInt()
	if (priced !== receipt.transactionFee) {
		throw new Error(`${label}: landed fee ${receipt.transactionFee} ≠ simulated billed gas at the block's prices ${priced}`)
	}
	if (paid.charged !== paid.ceiling)
		throw new Error(`${label}: the FPC charged ${paid.charged}, not the ceiling ${paid.ceiling} it commits to`)
	const nullifiers = receipt.txEffect.nullifiers.length
	const prev = exitGasSamples.at(-1)
	if (prev && nullifiers - prev.nullifiers !== notes - prev.notes) {
		throw new Error(
			`${label}: ${nullifiers} nullifiers after ${prev.nullifiers} (${prev.label}) is not ${notes - prev.notes} more spent note(s)`,
		)
	}
	exitGasSamples.push({
		label,
		notes,
		nullifiers,
		simulated: { l2Gas: billed.l2Gas, daGas: billed.daGas },
		fee: receipt.transactionFee,
		feePerL2Gas: fees.feePerL2Gas,
		feePerDaGas: fees.feePerDaGas,
		...paid,
	})
}

/** What `PRIVATE_HUB_EXIT_GAS` is sized from: per exit, the simulation's billed gas (the landed fee
 *  equals it at the block's prices — asserted above), and the ceiling the FPC kept in full. */
function reportExitGas(): void {
	if (exitGasSamples.length === 0) {
		record("ℹ private exit gas: no PrivateFPC-paid exit landed — PRIVATE_HUB_EXIT_GAS not measured")
		return
	}
	for (const x of exitGasSamples) {
		record(
			`ℹ private exit (${x.label}: ${x.notes} credit note(s) spent, ${x.nullifiers} nullifiers) via PrivateFPC.pay_fee: ` +
				`simulated billed l2Gas=${x.simulated.l2Gas} daGas=${x.simulated.daGas}; ` +
				`landed fee=${x.fee} FJ-wei = that gas at the block's feePerL2Gas=${x.feePerL2Gas} feePerDaGas=${x.feePerDaGas}; ` +
				`credit charged ${x.charged} = the ceiling under declared limits l2Gas=${x.limits.l2Gas} daGas=${x.limits.daGas} ` +
				`(PRIVATE_HUB_EXIT_GAS l2Gas=${PRIVATE_HUB_EXIT_GAS.l2Gas} daGas=${PRIVATE_HUB_EXIT_GAS.daGas}, or this network's per-tx max where lower)`,
		)
	}
}

// ─── Exits ───────────────────────────────────────────────────────────────────

interface ExitPlan {
	token: ManifestToken
	l2Token: ContractBase
	amount: bigint
	isPrivate: boolean
	/** Names a private exit's gas sample in the report. */
	label?: string
	/** The credit notes the private exit's `pay_fee` is expected to spend (default 1); the send refuses when the inventory at its ceiling says otherwise. */
	notes?: number
}

async function exitAuthwit(s: Smoke, p: ExitPlan, nonce: Fr): Promise<{ authWitnesses?: unknown[] }> {
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
	s: Smoke,
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
	const selecting = notesSelectedFor(ceiling)
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
	spendNotes(selecting, ceiling)
	if (after !== sumOf(creditNotes)) throw new Error(`${sample.label}: the credit ${after} is not the inventory's ${sumOf(creditNotes)}`)
	return receipt
}

async function runExit(s: Smoke, p: ExitPlan): Promise<string> {
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

	const erc20Balance = async () =>
		(await s.l1.pub.readContract({
			address: p.token.erc20 as Address,
			abi: evmArtifact("MintableERC20").abi,
			functionName: "balanceOf",
			args: [s.l1.account.address],
		})) as bigint
	const before = await erc20Balance()
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
	const released = (await erc20Balance()) - before
	if (released < p.amount) throw new Error(`L1 released ${released}, expected ${p.amount}`)
	return `${p.isPrivate ? "private" : "public"} burn → Outbox consume released ${released} ${p.token.displaySymbol}-units on L1`
}

// ─── First-time token shapes ─────────────────────────────────────────────────

/** The ManifestToken shape for a token this run invented — the factory read-back is the authority. */
function tokenFromBlock(block: JournalTokenBlock, decimals: number): ManifestToken {
	return {
		erc20: block.erc20,
		portal: block.portal,
		l2Token: block.l2Token,
		nameWord: block.nameWord,
		symbolWord: block.symbolWord,
		decimals,
		displayName: block.displaySymbol,
		displaySymbol: block.displaySymbol,
		source: "permissionless-mint",
		sourceContract: "MintableERC20",
	}
}

async function depositFresh(s: Smoke, erc20: Address, amount: bigint, l1: L1Ctx = s.l1): Promise<SendResult> {
	return send(s, l1, {
		intent: "token",
		erc20,
		amount,
		aztecRecipient: (l1 === s.l1 ? s.l2.from : s.a1).toString() as Hex,
		isPrivate: false,
	})
}

const registerArgsOf = (block: JournalTokenBlock, nameWord: string) =>
	[
		EthAddress.fromString(block.erc20),
		EthAddress.fromString(block.portal),
		Fr.fromHexString(nameWord),
		Fr.fromHexString(block.symbolWord),
		block.decimals,
		new Fr(BigInt(block.registerIndex as string)),
	] as const

async function flowRelayerFirstRegister(s: Smoke): Promise<string> {
	const amount = 10n ** 18n
	const erc20 = await freshToken(s, { name: "Relayer First", symbol: "RLY", decimals: 18 }, [s.l1.account.address], amount)
	const res = await depositFresh(s, erc20, amount)
	const block = res.token as JournalTokenBlock
	const l2Token = await s.l2TokenOf(block)
	await waitForL1ToL2Message(s.l2.node, block.registerKey as string, { forceBlock: s.l2.forceBlock })
	// account[1] consumes the factory's register leaf; the depositor's claim then has nothing left to
	// register and must succeed as a plain claim.
	await s.hub.methods.register_token(...registerArgsOf(block, block.nameWord)).send(s.relayerOpts as never)
	const outcome = await claim(s, res, { amount, isPrivate: false, recipient: s.l2.from })
	if (outcome.path !== "claim") throw new Error(`expected a plain claim after a relayer registration, got ${outcome.path}`)
	const balance = await balanceOf(l2Token, s.l2.from, "public")
	if (balance < amount) throw new Error(`balance ${balance} < ${amount}`)
	return `account[1] registered RLY first, the depositor's ${outcome.path} landed ${balance}`
}

async function flowConcurrentFirstClaims(s: Smoke): Promise<string> {
	const amount = 10n ** 18n
	const erc20 = await freshToken(
		s,
		{ name: "Race Token", symbol: "RACE", decimals: 18 },
		[s.l1.account.address, s.l1b.account.address],
		amount,
	)
	const first = await depositFresh(s, erc20, amount)
	const second = await depositFresh(s, erc20, amount, s.l1b)
	await waitForL1ToL2Message(s.l2.node, second.tokenMessageHashHex as string, { forceBlock: s.l2.forceBlock })

	const settled = await Promise.allSettled([
		claim(s, first, { amount, isPrivate: false, recipient: s.l2.from }),
		claim(s, second, { amount, isPrivate: false, recipient: s.a1, submitter: "relayer" }),
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
			recipient: i === 0 ? s.l2.from : s.a1,
			submitter: i === 0 ? undefined : "relayer",
		})
		paths.push(retry.path)
	}
	if (paths.filter((p) => p === "register+claim").length !== 1 || paths.filter((p) => p === "claim").length !== 1) {
		throw new Error(`expected one register+claim and one plain claim, got ${paths.join(" + ")}`)
	}
	return `two first-time deposits from two L1 accounts settled as ${paths.join(" + ")}`
}

async function flowPortalOnlyToken(s: Smoke, pxo: ManifestToken): Promise<string> {
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

async function flowNoRoute(s: Smoke, nort: Address): Promise<string> {
	const outcome = await discoverFuelRoute({
		client: s.l1.pub as never,
		// The sandbox has no V4 Quoter; pointing discovery at a contract without that selector makes
		// every candidate hop revert, which is exactly the shape a token with no pool produces.
		quoter: s.deployment.swapTarget,
		multicall3: MULTICALL3,
		token: nort,
		feeAsset: s.deployment.feeJuice,
		weth: FAKE_WETH,
		feeJuice: s.deployment.feeJuice,
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
async function fundedSendFor(s: Smoke, mode: FeeMode, erc20: Address, total: bigint, fuelAmount: bigint, bridgeSalt: Fr) {
	if (mode === "sponsored") {
		return send(s, s.l1, { intent: "token", erc20, amount: total, aztecRecipient: s.l2.from.toString() as Hex, isPrivate: false })
	}
	const route = mockRoute(erc20, s.deployment.feeJuice)
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
async function rejectTamperedRegistration(s: Smoke, block: JournalTokenBlock): Promise<string> {
	const tampered = `0x00${"ff".repeat(31)}`
	try {
		await s.hub.methods.register_token(...registerArgsOf(block, tampered)).send(s.l2.sendOpts as never)
	} catch (e) {
		return e instanceof Error ? e.message : String(e)
	}
	throw new Error("a registration with tampered metadata was accepted")
}

async function flowRejectedRegistration(s: Smoke, mode: FeeMode): Promise<string> {
	if (mode === "private-fpc") await ensurePrivateFpc(s)
	const unit = 10n ** 6n
	const total = 100n * unit
	const fuelAmount = mode === "sponsored" ? 0n : 40n * unit
	const bridgeSalt = Fr.random()
	const erc20 = await freshToken(
		s,
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

async function flowGuardianPause(s: Smoke, token: ManifestToken): Promise<string> {
	const exit = {
		l2Token: token.l2Token,
		recipientL1: s.l1.account.address,
		amount: 1n,
		callerOnL1: ZERO_L1,
		authwitNonce: Fr.random(),
		isPrivate: false,
	}
	await s.hub.methods.set_exits_paused(true).send(s.l2.sendOpts as never)
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
	const claimed = await flowPublicDeposit(s, token, await s.l2TokenOf(tokenBlockOf(token)))
	await s.hub.methods.set_exits_paused(false).send(s.l2.sendOpts as never)
	if (await hubExitsPaused(s.hub, s.l2.from.toString())) throw new Error("exits_paused() stayed true after the unpause")
	return `exit preflight refused with "exits paused" while a claim still landed (${claimed}); unpaused`
}

const tokenBlockOf = (t: ManifestToken): JournalTokenBlock => ({
	erc20: t.erc20,
	portal: t.portal,
	l2Token: t.l2Token,
	nameWord: t.nameWord,
	symbolWord: t.symbolWord,
	decimals: t.decimals,
	displaySymbol: t.displaySymbol,
})

// ─── Smoke conductor ─────────────────────────────────────────────────────────

async function buildSmoke(base: Sandbox, manifest: ManifestV2): Promise<Smoke> {
	const bridge = manifest.bridge as BridgeBlock
	const hub = await registerHub(base.l2.wallet, bridge.l2.hub)
	const hubAddress = AztecAddress.fromStringUnsafe(bridge.l2.hub.address)
	const known = new Map<string, ContractBase>()
	const smoke: Smoke = {
		...base,
		manifest,
		bridge,
		hub,
		feeJuiceL2: Contract.at(AztecAddress.fromStringUnsafe(feeJuiceAddress), FeeJuiceContractArtifact, base.l2.wallet),
		l2TokenOf: async (block) => {
			const cached = known.get(block.erc20.toLowerCase())
			if (cached) return cached
			const contract = await registerHubToken(
				base.l2.wallet,
				hubAddress,
				tokenFromBlock(block, block.decimals),
				bridge.l2.tokenClassId,
			)
			known.set(block.erc20.toLowerCase(), contract)
			return contract
		},
	}
	return smoke
}

async function runSmoke(base: Sandbox, manifest: ManifestV2): Promise<void> {
	const s = await buildSmoke(base, manifest)
	const [usdc, usdt, pxo] = s.bridge.tokens
	const usdcL2 = await s.l2TokenOf(tokenBlockOf(usdc))
	const nort = s.deployment.tokens.nort

	console.log("\n=== smoke ===")
	await flow("(a) public deposit → claim_public", () => flowPublicDeposit(s, usdc, usdcL2))
	await flow("(b) private deposit → claim_private", () => flowPrivateDeposit(s, usdc, usdcL2))
	await flow("(b) relayed private claim + wrong-recipient rejection", () => flowRelayedPrivateDeposit(s, usdc, usdcL2))
	const usdtL2 = await s.l2TokenOf(tokenBlockOf(usdt))
	await flow("(c) token+gas, self-paying claim", () => flowTokenPlusGas(s, usdt, usdtL2))
	await flow("(d) gas-only with the fee asset", () => flowGasOnly(s))
	await flow("(d) private gas → one PrivateFPC credit note", () => flowPrivateGasOneNote(s))
	const unit = 10n ** BigInt(usdc.decimals)
	await flow("(e) public exit → L1 withdraw", () => runExit(s, { token: usdc, l2Token: usdcL2, amount: 10n * unit, isPrivate: false }))
	await flow("(e) private exit paid from one credit note → L1 withdraw", () =>
		runExit(s, { token: usdc, l2Token: usdcL2, amount: 5n * unit, isPrivate: true, label: "one note", notes: 1 }),
	)
	await flow("(d) private gas → two more notes, none covering a ceiling", () => flowPrivateGasFragmented(s))
	await flow("(e) private exit paid across three credit notes → L1 withdraw", () =>
		runExit(s, { token: usdc, l2Token: usdcL2, amount: 5n * unit, isPrivate: true, label: "three notes", notes: 3 }),
	)
	await flow("(f1) relayer registers before the depositor claims", () => flowRelayerFirstRegister(s))
	await flow("(f2) two concurrent first-time deposits", () => flowConcurrentFirstClaims(s))
	await flow("(f3) portal-only token registers on its first claim", () => flowPortalOnlyToken(s, pxo))
	await flow("(f4) routeless token refused before signing", () => flowNoRoute(s, nort))
	await flow("(g) rejected registration, sponsored FPC", () => flowRejectedRegistration(s, "sponsored"))
	await flow("(g) rejected registration, fee-juice-with-claim", () => flowRejectedRegistration(s, "fee-juice-claim"))
	await optionalFlow("(g) rejected registration, private FPC", () => flowRejectedRegistration(s, "private-fpc"))
	await flow("(h) guardian pause blocks exits, not claims", () => flowGuardianPause(s, usdc))
	reportFuelBudgets()
	reportExitGas()
}

/** What an operator copies into `bridge.l1.swap.{fjPerTx,fjRegister}` for a network whose fees these were. */
function reportFuelBudgets(): void {
	const paid = feeSamples.filter((f) => f.feeMode !== "sponsored")
	if (paid.length === 0) {
		record("ℹ calibration: no paid claim landed — fjPerTx/fjRegister not measured")
		return
	}
	const budgets = calibrateFuelBudgets(feeSamples)
	const worst = paid.map((f) => `${f.shape}/${f.feeMode}=${f.transactionFee}`).join(", ")
	record(`ℹ calibration over ${paid.length} paid claims (${worst}) → fjPerTx=${budgets.fjPerTx} fjRegister=${budgets.fjRegister}`)
}

// ─── Conductor ───────────────────────────────────────────────────────────────

async function deployEverything(
	net: { anvilUrl: string; nodeUrl: string },
	mins: () => string,
): Promise<{ base: Sandbox; manifest: ManifestV2 }> {
	const chain = sandboxChain(net.anvilUrl)
	const account = privateKeyToAccount(KEY_0)
	const second = privateKeyToAccount(KEY_1)
	const l1: L1Ctx = { ...createL1Clients({ chain, rpcUrl: net.anvilUrl, account }), account }
	const l1b: L1Ctx = { ...createL1Clients({ chain, rpcUrl: net.anvilUrl, account: second }), account: second }

	await copyCanonicalCode(l1, net.anvilUrl, PERMIT2, "Permit2")
	await copyCanonicalCode(l1, net.anvilUrl, MULTICALL3, "Multicall3")

	const { l2, a1, relayerOpts } = await buildL2(net.nodeUrl)
	const info = await l2.node.getNodeInfo()
	const addrs = {
		feeJuice: lc(info.l1ContractAddresses.feeJuiceAddress.toString()),
		feeJuicePortal: lc(info.l1ContractAddresses.feeJuicePortalAddress.toString()),
		registry: lc(info.l1ContractAddresses.registryAddress.toString()),
	}
	console.log(`  node L1: registry ${addrs.registry}, feeJuice ${addrs.feeJuice}, feeJuicePortal ${addrs.feeJuicePortal}`)
	const deployment = await deployL1Fixtures(l1, addrs)

	mkdirSync(OUT_DIR, { recursive: true })
	// Keyed by the L1 genesis hash — anvil stamps its boot time into genesis, so a freshly booted
	// chain gets a fresh journal (its predecessor's addresses exist nowhere) while re-attaching to a
	// kept one resumes that history. The rollup address is NOT an identity: a fresh boot replays the
	// same deployer nonces and lands the rollup at the same address every time.
	const genesis = await l1.pub.getBlock({ blockNumber: 0n })
	const journal = openDeployJournal(join(OUT_DIR, `journal-${genesis.hash.slice(2, 18)}.jsonl`), {
		l1ChainId: CHAIN_ID,
		rollupVersion: Number(info.rollupVersion),
		deployer: lc(l1.account.address),
		registry: addrs.registry,
		feeJuicePortal: addrs.feeJuicePortal,
	})
	console.log(`\n=== generation (${mins()}) ===`)
	const gen = await deployGeneration(
		l1,
		l2,
		{
			registry: addrs.registry,
			permit2: PERMIT2,
			feeJuicePortal: addrs.feeJuicePortal,
			feeJuice: addrs.feeJuice,
			guardianL1: l1.account.address,
			guardianL2: l2.from.toString(),
			swapTarget: deployment.swapTarget,
		},
		journal,
	)

	console.log(`\n=== tokens (${mins()}) ===`)
	const tokens = [
		await preCreateToken(l1, l2, gen, deployment.tokens.usdc, journal, { maxWholePerTx: 1_000_000 }),
		await preCreateToken(l1, l2, gen, deployment.tokens.usdt, journal, { maxWholePerTx: 1_000_000 }),
		await preCreateToken(l1, l2, gen, deployment.tokens.pxo, journal, { register: false, maxWholePerTx: 1_000_000 }),
	]
	const manifest = buildManifest(gen, deployment, tokens, Number(info.rollupVersion))
	const manifestPath = join(OUT_DIR, "sandbox.json")
	writeCandidateAtomically(manifestPath, manifest)
	journal.append({ kind: "candidate-written", path: manifestPath })
	console.log(`\nwrote ${manifestPath} (${mins()})`)

	return { base: { l1, l1b, l2, relayerOpts, a1, deployment, mins }, manifest }
}

async function main(): Promise<void> {
	const mins = stopwatch()
	const runId = `bridge-sandbox-${process.pid}-${Date.now().toString(36)}`
	const net = await startLocalNetwork({ runId })
	let failure: unknown
	try {
		const { base, manifest } = await deployEverything(net, mins)
		if (process.argv.includes("--smoke")) await runSmoke(base, manifest)
	} catch (e) {
		failure = e
	}
	if (flowResults.length > 0) console.log(`\n=== flows (${mins()}) ===\n${flowResults.join("\n")}`)
	if (process.argv.includes("--keep")) {
		console.log(`\nnetwork kept — re-attach with:\n  SANDBOX_L1_RPC=${net.anvilUrl} SANDBOX_NODE_URL=${net.nodeUrl}`)
	} else {
		await net.stop()
	}
	if (failure) throw failure
	console.log(`\n✅ sandbox deploy${process.argv.includes("--smoke") ? " + smoke" : ""} OK (${mins()})`)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
