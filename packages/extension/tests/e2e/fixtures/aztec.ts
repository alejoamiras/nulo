/**
 * Aztec SDK helpers for E2E tests.
 *
 * Uses EmbeddedWallet to deploy contracts and mint tokens on the local Aztec network.
 * Designed to run as a singleton per test file (file-scoped fixture).
 */
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { rmSync } from "node:fs"

import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node"
import { TxHash } from "@aztec/stdlib/tx"
import { GasFees } from "@aztec/stdlib/gas"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { registerInitialLocalNetworkAccountsInWallet } from "@aztec/wallets/testing"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { L1FeeJuicePortalManager } from "@aztec/aztec.js/ethereum"
import { ProtocolContractAddress } from "@aztec/aztec.js/protocol"
import { createExtendedL1Client } from "@aztec/ethereum/client"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import { TokenContract } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"

/**
 * Aztec L2 node URL. Defaults to http://localhost:8080 (the standard sandbox port).
 *
 * Override via `AZTEC_NODE_URL` env var for parallel runs on the same machine
 * — e.g. when another impl is already using 8080, set `AZTEC_NODE_URL=http://localhost:19080`
 * and ensure the spawned `aztec start` listens on that port (see global-setup.ts).
 */
export const LOCAL_NODE_URL = process.env.AZTEC_NODE_URL ?? "http://localhost:8080"
const SPONSORED_FPC_SALT = 0n

export interface AztecTestConfig {
	nodeUrl: string
	tokenAddress: string
	sponsoredFpcAddress: string
	/** Hex-encoded minter account address */
	minterAddress: string
}

/** Check if the local Aztec node is reachable and responding. */
export async function checkNodeHealth(url = LOCAL_NODE_URL): Promise<boolean> {
	try {
		const node = createAztecNodeClient(url)
		await node.getNodeInfo()
		return true
	} catch {
		return false
	}
}

/** Wait for the local node to become healthy (with timeout). */
export async function waitForLocalNode(url = LOCAL_NODE_URL, timeoutMs = 60_000): Promise<void> {
	const node = createAztecNodeClient(url)
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		try {
			await node.getNodeInfo()
			return
		} catch {
			await new Promise((r) => setTimeout(r, 2_000))
		}
	}
	throw new Error(`Local Aztec node at ${url} did not become healthy within ${timeoutMs}ms`)
}

/** Create an EmbeddedWallet connected to the local node. Returns wallet + cleanup function. */
export async function createTestWallet(url = LOCAL_NODE_URL) {
	const node = createAztecNodeClient(url)
	await waitForNode(node)

	const dataDirectory = join(tmpdir(), `nulo-e2e-${randomBytes(8).toString("hex")}`)
	const wallet = await EmbeddedWallet.create(node, {
		pxe: { dataDirectory, proverEnabled: false },
	})

	const accounts = await registerInitialLocalNetworkAccountsInWallet(wallet)

	const cleanup = async () => {
		await wallet.stop()
		try {
			rmSync(dataDirectory, { recursive: true, force: true })
		} catch {
			// ignore cleanup errors
		}
	}

	return { wallet, accounts, node, cleanup }
}

/**
 * Generous `maxFeesPerGas` ceiling for SponsoredFPC-paid setup txs. The SDK otherwise pins
 * maxFeesPerGas to the ESTIMATION-time gas fee with no headroom, so an L2-fee spike between
 * estimate and inclusion rejects the tx (observed in CI: estimate feePerL2Gas=5.5e7 <
 * inclusion 1.1e8). maxFeesPerGas is only a ceiling and the FPC pays the ACTUAL network fee,
 * so a high cap can't overpay — it just stops spike-rejection flakes. See lessons/phase-6.md.
 */
const E2E_FEE_GAS = { maxFeesPerGas: new GasFees(10n ** 11n, 10n ** 11n) }

/** Deploy a Token contract with a minter address. Returns the token contract address. */
export async function deployTestToken(
	wallet: InstanceType<typeof EmbeddedWallet>,
	minterAddress: AztecAddress,
	feeOptions: { paymentMethod: SponsoredFeePaymentMethod },
): Promise<string> {
	const { contract } = await TokenContract.deployWithOpts(
		{ method: "constructor_with_minter", wallet },
		"TestToken",
		"TST",
		18,
		minterAddress,
	).send({ fee: { ...feeOptions, gasSettings: E2E_FEE_GAS }, from: minterAddress })

	return contract.address.toString()
}

/** Get the Sponsored FPC address (deterministic from salt=0). */
export async function getSponsoredFpcAddress(): Promise<string> {
	const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
		salt: new Fr(SPONSORED_FPC_SALT),
	})
	return instance.address.toString()
}

/** Create Sponsored fee payment options. Registers the SponsoredFPC with the wallet's PXE first. */
export async function createSponsoredFeeOptions(wallet: InstanceType<typeof EmbeddedWallet>) {
	const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
		salt: new Fr(SPONSORED_FPC_SALT),
	})

	// Register the SponsoredFPC contract so the wallet can use it for fee payment
	try {
		await wallet.registerContract(instance, SponsoredFPCContractArtifact)
	} catch {
		// Already registered — ignore
	}

	const paymentMethod = new SponsoredFeePaymentMethod(instance.address)
	return { paymentMethod, address: instance.address.toString() }
}

/** Mint public tokens to an address. Waits for the balance to be readable via the test wallet's PXE. */
export async function mintPublicTokens(
	wallet: InstanceType<typeof EmbeddedWallet>,
	tokenAddress: string,
	toAddress: string,
	amount: bigint,
	minterAddress: string,
	feeOptions: { paymentMethod: SponsoredFeePaymentMethod },
): Promise<void> {
	const token = await TokenContract.at(AztecAddress.fromString(tokenAddress), wallet)
	await token.methods
		.mint_to_public(AztecAddress.fromString(toAddress), amount)
		.send({ fee: { ...feeOptions, gasSettings: E2E_FEE_GAS }, from: AztecAddress.fromString(minterAddress) })

	// Verify the mint is visible by reading the balance from the test wallet's PXE.
	// This ensures the state has settled before the extension tries to read it.
	const to = AztecAddress.fromString(toAddress)
	const balance = await token.methods.balance_of_public(to).simulate({ from: AztecAddress.fromString(minterAddress) })
	console.log(`[mintPublicTokens] Verified on-chain public balance: ${balance}`)
	if (balance === 0n) {
		throw new Error(`Mint appeared to succeed but balance_of_public returned 0 for ${toAddress}`)
	}
}

/** Mint private tokens to an address.
 *
 *  `mint_to_private` is a private execution path, so the test wallet's
 *  PXE must know the token contract (instance + artifact) before it can
 *  simulate the call. createTestWallet returns a fresh wallet whose PXE
 *  hasn't been told about the deployed token — `TokenContract.at(...)`
 *  alone doesn't register. Fetch the deployed instance from the node
 *  + register with the wallet's PXE before simulating the mint.
 *  `mintPublicTokens` doesn't need this because `mint_to_public` is a
 *  public call that goes straight to the node.
 */
export async function mintPrivateTokens(
	wallet: InstanceType<typeof EmbeddedWallet>,
	node: ReturnType<typeof createAztecNodeClient>,
	tokenAddress: string,
	toAddress: string,
	amount: bigint,
	minterAddress: string,
	feeOptions: { paymentMethod: SponsoredFeePaymentMethod },
): Promise<void> {
	const addr = AztecAddress.fromString(tokenAddress)
	const instance = await node.getContract(addr)
	if (!instance) throw new Error(`Token instance not found at node for ${tokenAddress}`)
	try {
		await wallet.registerContract(instance, TokenContract.artifact)
	} catch {
		// Already registered — ignore.
	}

	const token = await TokenContract.at(addr, wallet)
	// `wait: { timeout: 120 }` blocks until the tx is mined; without it the
	// returned SentTx isn't a thenable and the outer `await` resolves
	// immediately (mintPublicTokens hides this via a follow-up
	// `balance_of_public.simulate` that implicitly forces a chain query —
	// no such barrier for the private path). Worth fixing here rather than
	// at the call site so future callers don't repeat the trap.
	await token.methods
		.mint_to_private(AztecAddress.fromString(toAddress), amount)
		.send({ fee: { ...feeOptions, gasSettings: E2E_FEE_GAS }, from: AztecAddress.fromString(minterAddress), wait: { timeout: 120 } })
}

// ── Fee Juice L1→L2 Bridge ────────────────────────────────────────────

/**
 * L1 Anvil URL. Defaults to http://localhost:8545. Override via `ANVIL_URL` env var
 * for parallel runs (e.g. `ANVIL_URL=http://localhost:18545`).
 */
const ANVIL_URL = process.env.ANVIL_URL ?? "http://localhost:8545"
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk"

/** Bridge FeeJuice from L1 (Anvil) to an L2 address. Mints test FJ on L1, deposits to portal.
 *  Note: the L1 FeeAssetHandler has a fixed mint amount of 1000 FJ per call. */
export async function bridgeFeeJuice(node: ReturnType<typeof createAztecNodeClient>, toAddress: string, amount = 1000n * 10n ** 18n) {
	const nodeInfo = await node.getNodeInfo()
	const l1Client = createExtendedL1Client([ANVIL_URL], ANVIL_MNEMONIC, { id: nodeInfo.l1ChainId, name: "anvil" })
	const logger = {
		info: console.log,
		debug: console.log,
		warn: console.warn,
		error: console.error,
		verbose: console.log,
		trace: () => {},
	}
	const portalManager = await L1FeeJuicePortalManager.new(node, l1Client, logger)
	const claim = await portalManager.bridgeTokensPublic(AztecAddress.fromString(toAddress), amount, true)
	console.log(`[bridgeFeeJuice] Bridged ${amount} FJ to ${toAddress}, messageHash: ${claim.messageHash}`)
	return claim
}

/** Wait for an L1→L2 message to be synced on the Aztec node, then wait 2 more blocks. */
export async function waitForL1ToL2Message(
	node: ReturnType<typeof createAztecNodeClient>,
	messageHash: string,
	timeoutMs = 90_000,
): Promise<void> {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		const synced = await node.isL1ToL2MessageSynced(Fr.fromString(messageHash))
		if (synced) {
			console.log(`[waitForL1ToL2Message] Message synced after ${Date.now() - start}ms`)
			break
		}
		await new Promise((r) => setTimeout(r, 2_000))
	}
	// Wait 2 more L2 blocks for the message tree to update
	const currentBlock = await node.getBlockNumber()
	const target = currentBlock + 2
	while ((await node.getBlockNumber()) < target) {
		await new Promise((r) => setTimeout(r, 2_000))
	}
	console.log("[waitForL1ToL2Message] +2 L2 blocks confirmed")
}

/** Claim bridged FeeJuice on L2. Uses SponsoredFPC to pay for the claim tx itself.
 *  Uses ContractFunctionInteraction directly since FeeJuiceContract.at() may not bind to EmbeddedWallet correctly. */
export async function claimFeeJuice(
	wallet: InstanceType<typeof EmbeddedWallet>,
	toAddress: string,
	fromAddress: AztecAddress,
	claim: { claimAmount: bigint; claimSecret: Fr; messageLeafIndex: bigint },
	feeOptions: { paymentMethod: SponsoredFeePaymentMethod },
): Promise<void> {
	const { Contract } = await import("@aztec/aztec.js/contracts")
	const { FeeJuiceArtifact } = await import("@aztec/protocol-contracts/fee-juice")
	const feeJuice = await Contract.at(ProtocolContractAddress.FeeJuice, FeeJuiceArtifact, wallet)
	await feeJuice.methods
		.claim(AztecAddress.fromString(toAddress), claim.claimAmount, claim.claimSecret, claim.messageLeafIndex)
		.send({ fee: { ...feeOptions, gasSettings: E2E_FEE_GAS }, from: fromAddress })
	console.log(`[claimFeeJuice] Claimed ${claim.claimAmount} FJ for ${toAddress}`)
}

// ── Pre-Funded Account (WS3 — fee-methods test re-enable) ─────────────

/**
 * Result of `setupPreFundedAccount`. The fixture extension imports `masterBase64`
 * via `importPlain` and switches to Local Network — that auto-derives the same
 * `accountAddress` (deterministic via `salt = Fr.ZERO` + matching account-secret
 * derivation). Both public + private FeeJuice balances are pre-funded on-chain.
 */
export interface PreFundedAccount {
	masterBase64: string
	accountAddress: AztecAddress
}

/**
 * Build a script-side wallet whose on-chain address matches what Nulo will derive
 * post-import. Pre-funds both public + private FeeJuice for that address.
 *
 * Why same-secret matters: `PrivateFPC.mint` requires `msg_sender == claimer`
 * (private_contract/main.nr:135-148; canonical `private.test.ts:213-242` proves
 * "wrong claimer reverts"). The mint MUST come from a wallet whose address
 * equals the eventual imported account's address. We achieve that by deriving
 * the script wallet via the SAME formula as Nulo's account/service.ts:117 →
 * NuloAccount.new() → SchnorrAccountContractArtifact + salt=Fr.ZERO.
 *
 * Per Codex audit: chainId for Local Network = literal `0` (network/service.ts:85);
 * AccountType.Nulo_v1 = `0` (account/spec.ts:5 — corrected from audit's earlier
 * estimate; the spec.ts comment "SECURITY: NEVER change it" makes it authoritative).
 *
 * Returns `{ masterBase64, accountAddress }`. The fixture imports `masterBase64`
 * into a fresh extension via `importPlain` and switches to Local Network.
 */
export async function setupPreFundedAccount(
	wallet: InstanceType<typeof EmbeddedWallet>,
	node: ReturnType<typeof createAztecNodeClient>,
	feePayerAddress: AztecAddress,
	opts: {
		publicAmount?: bigint
		privateAmount?: bigint
	} = {},
): Promise<PreFundedAccount> {
	// Mirrors Nulo's derivation exactly. Constants verified against source-of-truth:
	const ACCOUNT_TYPE_NULO_V1 = 0 // account/spec.ts:5 — SECURITY: NEVER change
	const LOCAL_NETWORK_CHAIN_ID = 0 // network/service.ts:85 — Local hardcodes 0
	const ACCOUNT_INDEX = 0 // first account
	const publicAmount = opts.publicAmount ?? 1000n * 10n ** 18n
	const privateAmount = opts.privateAmount ?? 1000n * 10n ** 18n

	// Lazy imports: heavy aztec deps + workspace pkg, only needed when fixture runs.
	const { poseidon2Hash } = await import("@aztec/foundation/crypto/sync")
	const { deriveSigningKey } = await import("@aztec/stdlib/keys")
	const { NuloAccount } = await import("@nulo/aztec-runtime/account")
	const { createLogger } = await import("@aztec/foundation/log")
	const logger = createLogger("setup-pre-funded-account")

	// Step 1 — Derive identity (matches Nulo's account/service.ts:117 formula).
	// Use Fr.random for the master so the 32-byte buffer stays within BN254 modulus
	// (Fr.fromBuffer is strict — see session-manager.ts:210).
	const master = Fr.random()
	const accountSecret = poseidon2Hash([master, new Fr(LOCAL_NETWORK_CHAIN_ID), new Fr(ACCOUNT_TYPE_NULO_V1), new Fr(ACCOUNT_INDEX)])
	const signingKey = deriveSigningKey(accountSecret)

	// Sanity check the derived address against NuloAccount's path so the fixture
	// fails fast if the upstream Schnorr / NuloAccount implementations diverge.
	const nuloAccountContract = await NuloAccount.new(accountSecret, logger)
	const expectedAddress = nuloAccountContract.address
	logger.info(`Expected derived address: ${expectedAddress.toString()}`)

	// Step 2 — Create the script-side schnorr account in the wallet's PXE.
	// Matches holonym-aztec-bridge/bridge-script/utils/deploy_account.ts:31.
	// EmbeddedWallet.createSchnorrAccount(secret, salt, signingKey) returns an AccountManager.
	// biome-ignore lint/suspicious/noExplicitAny: EmbeddedWallet's createSchnorrAccount type isn't exposed in the slim Wallet types we import
	const accountManager = await (wallet as any).createSchnorrAccount(accountSecret, Fr.ZERO, signingKey)
	if (accountManager.address.toString() !== expectedAddress.toString()) {
		throw new Error(
			`Address derivation parity broken: NuloAccount=${expectedAddress.toString()} vs createSchnorrAccount=${accountManager.address.toString()}`,
		)
	}
	logger.info(`Script-side account created: ${accountManager.address.toString()}`)

	// Step 3 — Deploy the derived account via SponsoredFPC (so it can sign/send mint later).
	// Use `NO_FROM` sentinel per canonical pattern at @aztec/wallets/testing
	// (deployFundedSchnorrAccounts) — bypasses entrypoint auth for the bootstrap tx
	// since the account doesn't exist on-chain yet. Passing `from: account.address`
	// fails with "Failed to get a note" because the schnorr entrypoint reads a
	// signing-key note that the constructor hasn't created yet.
	const { NO_FROM } = await import("@aztec/aztec.js/account")
	const sponsoredFee = await createSponsoredFeeOptions(wallet)
	const deployMethod = await accountManager.getDeployMethod()
	await deployMethod.send({
		from: NO_FROM,
		fee: { paymentMethod: sponsoredFee.paymentMethod },
		wait: { timeout: 120 },
	})
	logger.info(`Script-side account deployed: ${accountManager.address.toString()}`)
	const derivedWallet = await accountManager.getAccount()

	// Step 4 — Public FJ: bridge + claim. Recipient-bound (sender-agnostic), so we
	// reuse the existing helpers with the test sandbox wallet for fee payment.
	const publicClaim = await bridgeFeeJuice(node, expectedAddress.toString(), publicAmount)
	await waitForL1ToL2Message(node, publicClaim.messageHash.toString())
	await claimFeeJuice(wallet, expectedAddress.toString(), feePayerAddress, publicClaim, sponsoredFee)
	logger.info(`Public FJ claimed: amount=${publicAmount}`)

	// Step 5 — Private FJ via PrivateFPC.
	// Top-level import of @wonderland/aztec-fee-payment fails on
	// `Export named 'DEFAULT_TEARDOWN_DA_GAS_LIMIT'` (Aztec version drift between
	// @wonderland's pinned deps and Nulo's). Sub-path imports work.
	const { PrivateFPCContract } = await import("@wonderland/aztec-fee-payment/artifacts/private")
	const { bridgeForMint } = await import("./aztec-private-fpc-bridge")

	// PrivateFPC instance salt MUST be Fr.zero() to match Nulo's auto-discovery
	// (fpc/service.ts:104-110: salt=Fr.zero(), deployer=AztecAddress.ZERO).
	// Mirrors @wonderland's registerPrivateContract (utils/deploy.ts) inline.
	// `register` calls `wallet.registerContract` which lives on the parent
	// EmbeddedWallet, not on per-account AccountWithSecretKey.
	// biome-ignore lint/suspicious/noExplicitAny: aztec-stdlib instance mismatch between @wonderland's pinned version and Nulo's
	const fpc = await PrivateFPCContract.deploy(wallet as any).register({
		contractAddressSalt: Fr.ZERO,
		skipInitialization: true,
		deployer: AztecAddress.ZERO,
	})
	logger.info(`PrivateFPC registered: ${fpc.address.toString()}`)

	// Bridge salt must be RANDOM per invocation (avoids nullifier collision on reruns).
	const bridgeSalt = Fr.random()
	const { secret: bridgeSecret, leafIndex } = await bridgeForMint(
		node,
		fpc.address,
		expectedAddress,
		bridgeSalt,
		privateAmount,
		// produceL2Block: send a no-op via SponsoredFPC to advance the chain
		async () => {
			const { Contract } = await import("@aztec/aztec.js/contracts")
			const { FeeJuiceArtifact } = await import("@aztec/protocol-contracts/fee-juice")
			const feeJuice = await Contract.at(ProtocolContractAddress.FeeJuice, FeeJuiceArtifact, wallet)
			await feeJuice.methods
				.balance_of_public(expectedAddress)
				.simulate({ from: feePayerAddress })
				.catch(() => undefined)
		},
	)
	logger.info(`PrivateFPC bridge ready: leafIndex=${leafIndex.toString()}`)

	// L2 claim: emits the FeeJuice nullifier. Sender doesn't matter for FJ.claim
	// (claim is recipient-bound via the embedded leaf hash). Use the script's main
	// EmbeddedWallet (sandbox-funded sender) for fees.
	{
		const { Contract } = await import("@aztec/aztec.js/contracts")
		const { FeeJuiceArtifact } = await import("@aztec/protocol-contracts/fee-juice")
		const feeJuice = await Contract.at(ProtocolContractAddress.FeeJuice, FeeJuiceArtifact, wallet)
		await feeJuice.methods.claim(fpc.address, privateAmount, bridgeSecret, leafIndex).send({
			fee: { paymentMethod: sponsoredFee.paymentMethod },
			from: feePayerAddress,
			wait: { timeout: 120 },
		})
		logger.info("FJ.claim emitted FeeJuice nullifier")
	}

	// L2 mint — MUST be from derivedWallet (msg_sender == claimer == accountAddress).
	// `additionalScopes: [fpc.address]` per canonical private.test.ts:103-105.
	await fpc.methods.mint(privateAmount, bridgeSalt, leafIndex).send({
		from: expectedAddress,
		additionalScopes: [fpc.address],
		fee: { paymentMethod: sponsoredFee.paymentMethod },
		wait: { timeout: 120 },
	})
	logger.info("PrivateFPC.mint succeeded")

	// Sanity assertion: balance landed before fixture returns.
	// `balance_of(...).simulate(...)` returns `{ result: bigint }` per @wonderland's
	// canonical pattern (private.test.ts:101-103).
	const { result: privateBal } = await fpc.methods.balance_of(expectedAddress).simulate({ from: expectedAddress })
	if (typeof privateBal !== "bigint" || privateBal === 0n) {
		throw new Error(`PrivateFPC.balance_of returned ${privateBal} after mint — claim/mint flow broken`)
	}
	logger.info(`PrivateFPC.balance_of(account) = ${privateBal}`)

	const masterBase64 = Buffer.from(master.toBuffer()).toString("base64")
	return { masterBase64, accountAddress: expectedAddress }
}

/**
 * Convenience wrapper for pre-minting public tokens to a dApp-granted account
 * before exercising the wallet's sendTx flow in popup-shape tests. Without this,
 * the wallet's simulate step fails ("not enough balance"), the journal advances
 * straight to `failed`, and the `tx-awaiting-card` never reaches an active
 * stage — which breaks waitForDappExecuteWorked(). cancel-mid-prove.test.ts
 * uses an identical inline block; this helper consolidates it for the 6 tests
 * restructured in implementations-plan/journal-stage-restructure/.
 */
export async function mintPublicTokensForAccount(
	aztecConfig: AztecTestConfig,
	accountAddress: string,
	amount = 100n * 10n ** 18n,
): Promise<void> {
	const { wallet, cleanup } = await createTestWallet(aztecConfig.nodeUrl)
	try {
		const feeOptions = await createSponsoredFeeOptions(wallet)
		await mintPublicTokens(wallet, aztecConfig.tokenAddress, accountAddress, amount, aztecConfig.minterAddress, feeOptions)
	} finally {
		await cleanup()
	}
}

/** Poll the node until a tx (by hash string, as returned to the dApp) is
 *  MINED successfully. Needed when a flow's NEXT step reads on-chain state
 *  the tx wrote (e.g. a public-authwit grant's `set_authorized` must be
 *  mined before a consume's public simulation can see it) — the wallet's
 *  `send_transaction` path resolves the dApp promise at SUBMIT, not at
 *  mine. Throws on revert/drop so failures attribute to the right tx. */
export async function waitForTxMined(aztecConfig: AztecTestConfig, txHash: string, timeoutMs = 120_000): Promise<void> {
	const node = createAztecNodeClient(aztecConfig.nodeUrl)
	const deadline = Date.now() + timeoutMs
	for (;;) {
		const receipt = await node.getTxReceipt(TxHash.fromString(txHash)).catch(() => undefined)
		const status = receipt ? String(receipt.status) : undefined
		// Aztec terminal-success statuses: "success" (mined) and "finalized"
		// / "proven" (block settled). Any of them means the tx's public
		// effects (e.g. a set_authorized write) are live and readable.
		if (status === "success" || status === "finalized" || status === "proven") return
		if (status === "app_logic_reverted" || status === "teardown_reverted" || status === "dropped" || status === "reverted") {
			throw new Error(`waitForTxMined: tx ${txHash} terminal as "${status}"`)
		}
		if (Date.now() > deadline) {
			throw new Error(`waitForTxMined: timeout waiting for ${txHash} (last status: ${status ?? "pending"})`)
		}
		await new Promise((r) => setTimeout(r, 1_000))
	}
}
