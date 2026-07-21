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
import { TokenContract } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"

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
 * estimate and inclusion rejects the tx. maxFeesPerGas is only a ceiling and the FPC pays the
 * ACTUAL network fee, so a high cap can't overpay — it just stops spike-rejection flakes.
 * 5.0 raised the sandbox L2 base fee ~4 orders of magnitude (observed inclusion feePerL2Gas
 * ≈9.24e11 vs 4.2.0's ~1.1e8), so the old 1e11 cap fell BELOW the live fee and rejected every
 * setup tx with "maxFeesPerGas.feePerL2Gas must be >= gasFees.feePerL2Gas". 1e13 restores ~10x
 * headroom while staying under the SponsoredFPC fee-juice balance (cap × gasLimit). See lessons/phase-6.md.
 */
const E2E_FEE_GAS = { maxFeesPerGas: new GasFees(10n ** 13n, 10n ** 13n) }

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
		// 5.0.1 standards added a 5th `auth_contract` param to constructor_with_minter — pass ZERO
		// (no transfer-authorization gating) for the plain test token.
		AztecAddress.ZERO,
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
	const token = await TokenContract.at(AztecAddress.fromStringUnsafe(tokenAddress), wallet)
	await token.methods
		.mint_to_public(AztecAddress.fromStringUnsafe(toAddress), amount)
		.send({ fee: { ...feeOptions, gasSettings: E2E_FEE_GAS }, from: AztecAddress.fromStringUnsafe(minterAddress) })

	// Verify the mint is visible by reading the balance from the test wallet's PXE.
	// This ensures the state has settled before the extension tries to read it.
	const to = AztecAddress.fromStringUnsafe(toAddress)
	const balance = await token.methods
		.balance_of_public(to)
		.simulate({ from: AztecAddress.fromStringUnsafe(minterAddress), fee: { gasSettings: E2E_FEE_GAS } })
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
	const addr = AztecAddress.fromStringUnsafe(tokenAddress)
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
	await token.methods.mint_to_private(AztecAddress.fromStringUnsafe(toAddress), amount).send({
		fee: { ...feeOptions, gasSettings: E2E_FEE_GAS },
		from: AztecAddress.fromStringUnsafe(minterAddress),
		wait: { timeout: 120 },
	})
}

/** Private → private transfer between two addresses the test wallet can
 *  act for (sender must hold private balance — see `mintPrivateTokens`).
 *  Same registration + `wait` traps as the private mint above. */
export async function transferPrivateTokens(
	wallet: InstanceType<typeof EmbeddedWallet>,
	node: ReturnType<typeof createAztecNodeClient>,
	tokenAddress: string,
	fromAddress: string,
	toAddress: string,
	amount: bigint,
	feeOptions: { paymentMethod: SponsoredFeePaymentMethod },
): Promise<void> {
	const addr = AztecAddress.fromStringUnsafe(tokenAddress)
	const instance = await node.getContract(addr)
	if (!instance) throw new Error(`Token instance not found at node for ${tokenAddress}`)
	try {
		await wallet.registerContract(instance, TokenContract.artifact)
	} catch {
		// Already registered — ignore.
	}

	const token = await TokenContract.at(addr, wallet)
	await token.methods
		.transfer_private_to_private(AztecAddress.fromStringUnsafe(fromAddress), AztecAddress.fromStringUnsafe(toAddress), amount, 0)
		.send({
			fee: { ...feeOptions, gasSettings: E2E_FEE_GAS },
			from: AztecAddress.fromStringUnsafe(fromAddress),
			wait: { timeout: 120 },
		})
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
	const claim = await portalManager.bridgeTokensPublic(AztecAddress.fromStringUnsafe(toAddress), amount, true)
	console.log(`[bridgeFeeJuice] Bridged ${amount} FJ to ${toAddress}, messageHash: ${claim.messageHash}`)
	return claim
}

/** Wait until a bridged L1→L2 message is CLAIMABLE.
 *
 *  5.0 readiness is NOT "the message is in a checkpoint" — it's "the node/PXE anchor block sits in
 *  a checkpoint >= the message's checkpoint" (the claim builds a membership witness against the
 *  anchor; otherwise `getL1ToL2MessageMembershipWitness` returns nothing and the claim throws
 *  "No L1 to L2 message found"). 5.0 only mints an L2 block when txs are pending (no empty blocks,
 *  and `SEQ_MIN_TX_PER_BLOCK=0` does not change that), so after the bridge the anchor stalls below
 *  the message's checkpoint forever. `forceBlock` submits one cheap tx to advance the chain past
 *  it. Callers without a handy tx fall back to best-effort. See lessons/phase-6.md. */
export async function waitForL1ToL2Message(
	node: ReturnType<typeof createAztecNodeClient>,
	messageHash: string,
	forceBlock?: () => Promise<unknown>,
	timeoutMs = 90_000,
): Promise<void> {
	const hash = Fr.fromString(messageHash)
	const start = Date.now()
	let msgCheckpoint: bigint | undefined
	while (Date.now() - start < timeoutMs) {
		const cp = await node.getL1ToL2MessageCheckpoint(hash)
		if (cp !== undefined) {
			msgCheckpoint = BigInt(cp)
			console.log(`[waitForL1ToL2Message] message in checkpoint ${msgCheckpoint} after ${Date.now() - start}ms`)
			break
		}
		await new Promise((r) => setTimeout(r, 2_000))
	}
	if (msgCheckpoint === undefined) throw new Error(`[waitForL1ToL2Message] ${messageHash} not checkpointed within ${timeoutMs}ms`)

	// 5.0 mints no empty L2 blocks (SEQ_MIN_TX_PER_BLOCK=0 does not change that), so after the
	// bridge the node/PXE anchor stalls below the message's checkpoint and the claim's membership
	// witness can't be built ("No L1 to L2 message found"). The node-admin `mineBlock` is not
	// RPC-exposed, so callers pass `forceBlock` — a cheap sponsored tx — which we run until the
	// anchor's checkpoint covers the message (the real claimability condition).
	while (Date.now() - start < timeoutMs) {
		const latest = await node.getBlockData("latest")
		if (latest && BigInt(latest.checkpointNumber) >= msgCheckpoint) {
			console.log(
				`[waitForL1ToL2Message] claimable after ${Date.now() - start}ms: anchor checkpoint ${latest.checkpointNumber} >= ${msgCheckpoint}`,
			)
			return
		}
		if (forceBlock) await forceBlock().catch((err) => console.warn(`[waitForL1ToL2Message] forceBlock failed: ${err}`))
		await new Promise((r) => setTimeout(r, 1_500))
	}
	console.warn(`[waitForL1ToL2Message] anchor did not reach checkpoint ${msgCheckpoint} within ${timeoutMs}ms — proceeding best-effort`)
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
		.claim(AztecAddress.fromStringUnsafe(toAddress), claim.claimAmount, claim.claimSecret, claim.messageLeafIndex)
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
		/** A cheap sponsored state-changing tx that mints one L2 block. 5.0 mints no empty blocks,
		 *  so FJ-claim readiness (anchor checkpoint >= message checkpoint) only advances when a real
		 *  tx is sent. Provided by callers that have a token to transfer/mint. */
		forceBlock?: () => Promise<unknown>
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
	const { deriveNuloAccountKeys } = await import("@nulo/wallet-crypto")
	const { NuloAccount } = await import("@nulo/aztec-runtime/account")
	const { createLogger } = await import("@aztec/foundation/log")
	const logger = createLogger("setup-pre-funded-account")

	// Step 1 — Derive identity (matches Nulo's account/service.ts:117 formula).
	// Use Fr.random for the master so the 32-byte buffer stays within BN254 modulus
	// (Fr.fromBuffer is strict — see session-manager.ts:210).
	const master = Fr.random()
	const accountSeed = poseidon2Hash([master, new Fr(LOCAL_NETWORK_CHAIN_ID), new Fr(ACCOUNT_TYPE_NULO_V1), new Fr(ACCOUNT_INDEX)])
	// Signing-key-root model (NULO-ACCOUNT-KDF v1): seed → signing key (root) → privacy secret.
	const { signingKey, secretKey } = await deriveNuloAccountKeys(accountSeed)

	// Sanity check the derived address against NuloAccount's path so the fixture
	// fails fast if the upstream Schnorr / NuloAccount implementations diverge.
	const nuloAccountContract = await NuloAccount.new(accountSeed, logger)
	const expectedAddress = nuloAccountContract.address
	logger.info(`Expected derived address: ${expectedAddress.toString()}`)

	// Step 2 — Create the script-side schnorr account in the wallet's PXE.
	// EmbeddedWallet.createSchnorrAccount(secretKey, salt, signingKey) returns an AccountManager —
	// called WITHOUT a cast so the compiler checks the argument order against upstream.
	const accountManager = await wallet.createSchnorrAccount(secretKey, Fr.ZERO, signingKey)
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
		fee: { paymentMethod: sponsoredFee.paymentMethod, gasSettings: E2E_FEE_GAS },
		wait: { timeout: 120 },
	})
	logger.info(`Script-side account deployed: ${accountManager.address.toString()}`)
	// getAccount() registers the derived account in the wallet (side effect); the value itself
	// is unused — the subsequent mint targets `expectedAddress` (== the derived account address).
	const _derivedWallet = await accountManager.getAccount()

	// Step 4 — Public FJ: bridge + claim. Recipient-bound (sender-agnostic), so we
	// reuse the existing helpers with the test sandbox wallet for fee payment.
	const publicClaim = await bridgeFeeJuice(node, expectedAddress.toString(), publicAmount)
	await waitForL1ToL2Message(node, publicClaim.messageHash.toString(), opts.forceBlock)
	await claimFeeJuice(wallet, expectedAddress.toString(), feePayerAddress, publicClaim, sponsoredFee)
	logger.info(`Public FJ claimed: amount=${publicAmount}`)

	// Step 5 — Private FJ via PrivateFPC.
	// Top-level import of @alejoamiras/private-fee-juice fails on
	// `Export named 'DEFAULT_TEARDOWN_DA_GAS_LIMIT'` (Aztec version drift between
	// @wonderland's pinned deps and Nulo's). Sub-path imports work.
	const { PrivateFPCContract } = await import("@alejoamiras/private-fee-juice/artifacts/private")
	const { bridgeForMint } = await import("./aztec-private-fpc-bridge")

	// PrivateFPC instance salt MUST match Nulo's auto-discovery (fpc/service.ts: the CANONICAL
	// salt 0x…01 from 5.0.0 onward + deployer=AztecAddress.ZERO — see bridge-core's
	// private-fpc-canonical.json). 5.0 rejects the old `deploy().register()` path here
	// ("deployer is not yet locked" — a ZERO deployer isn't locked, and 5.0 moved salt/deployer
	// to construction-time options). Compute + register the instance the SAME way the wallet
	// does, which both sidesteps that and guarantees the address matches the auto-discovery.
	// biome-ignore lint/suspicious/noExplicitAny: aztec-stdlib instance mismatch between @wonderland's pinned version and Nulo's
	const fpcArtifact = (PrivateFPCContract as any).artifact
	const fpcInstance = await getContractInstanceFromInstantiationParams(fpcArtifact, {
		salt: new Fr(1n),
		deployer: AztecAddress.ZERO,
	})
	// biome-ignore lint/suspicious/noExplicitAny: see above
	await (wallet as any).registerContract(fpcInstance, fpcArtifact)
	// biome-ignore lint/suspicious/noExplicitAny: see above
	const fpc = await PrivateFPCContract.at(fpcInstance.address, wallet as any)
	logger.info(`PrivateFPC registered: ${fpc.address.toString()}`)

	// Bridge salt must be RANDOM per invocation (avoids nullifier collision on reruns).
	const bridgeSalt = Fr.random()
	const { secret: bridgeSecret, leafIndex } = await bridgeForMint(
		node,
		fpc.address,
		expectedAddress,
		bridgeSalt,
		privateAmount,
		// produceL2Block: a REAL state-changing tx to advance the chain. The predecessor used
		// `.simulate()` (read-only — mines nothing), which never advanced the anchor on 5.0.
		opts.forceBlock ?? (async () => {}),
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
			fee: { paymentMethod: sponsoredFee.paymentMethod, gasSettings: E2E_FEE_GAS },
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
		fee: { paymentMethod: sponsoredFee.paymentMethod, gasSettings: E2E_FEE_GAS },
		wait: { timeout: 120 },
	})
	logger.info("PrivateFPC.mint succeeded")

	// Sanity assertion: balance landed before fixture returns.
	// `balance_of(...).simulate(...)` returns `{ result: bigint }` per @wonderland's
	// canonical pattern (private.test.ts:101-103).
	const { result: privateBal } = await fpc.methods
		.balance_of(expectedAddress)
		.simulate({ from: expectedAddress, fee: { gasSettings: E2E_FEE_GAS } })
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
