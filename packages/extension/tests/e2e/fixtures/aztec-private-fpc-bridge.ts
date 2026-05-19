/**
 * `bridgeForMint` ported from @wonderland/aztec-fee-payment's test harness
 * (`src/ts/test/harness.ts:140-300`). The function is test-internal in the
 * canonical package (NOT in `dist/.../index.d.ts`) so we maintain a copy here.
 *
 * Bridges FeeJuice from L1 to a PrivateFPC with a claimer-bound `secretHash`.
 * The returned `secret` + `leafIndex` are passed to `FeeJuice.claim(...)` and
 * `PrivateFPC.mint(...)` to materialize the FPC's internal balance for the
 * claimer (where `claimer = msg_sender` of the mint tx).
 *
 * Mirrors `derive_bridge_secret` in `private_contract/src/main.nr`:
 *   secret = poseidon2_hash_with_separator([salt, claimer], DOM_SEP)
 *   secretHash = computeSecretHash(secret)
 */
import { isL1ToL2MessageReady } from "@aztec/aztec.js/messaging"
import type { AztecNode } from "@aztec/aztec.js/node"
import type { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { L1FeeJuicePortalManager } from "@aztec/aztec.js/ethereum"
import { createExtendedL1Client } from "@aztec/ethereum/client"
import { extractEvent } from "@aztec/ethereum/utils"
import { FeeJuicePortalAbi } from "@aztec/l1-artifacts/FeeJuicePortalAbi"
import { computeSecretHash } from "@aztec/stdlib/hash"
import { poseidon2HashBytes, poseidon2HashWithSeparator } from "@aztec/foundation/crypto/sync"
import { createLogger } from "@aztec/foundation/log"
import { getContract } from "@aztec/viem"

/**
 * Domain separator for FPC bridge secret derivation — must match the Noir
 * constant `DOM_SEP__FPC_BRIDGE_SECRET` in `private_contract/src/main.nr`.
 * Computed as: `poseidon2_hash_bytes("az_dom_sep__fpc_bridge_secret") as u32`
 */
const DOM_SEP__FPC_BRIDGE_SECRET = Number(poseidon2HashBytes(Buffer.from("az_dom_sep__fpc_bridge_secret")).toBigInt() & 0xffff_ffffn)

const DEFAULT_L1_RPC_URL = "http://127.0.0.1:8545"
const DEFAULT_L1_MNEMONIC = "test test test test test test test test test test test junk"

export type BridgeForMintResult = {
	secret: Fr
	claimAmount: bigint
	leafIndex: Fr
}

export async function bridgeForMint(
	aztecNode: AztecNode,
	fpcAddress: AztecAddress,
	claimer: AztecAddress,
	salt: Fr,
	requestedAmount: bigint,
	produceL2Block: () => Promise<void>,
	opts?: {
		l1RpcUrls?: string[]
		l1Mnemonic?: string
		messagePollTries?: number
		messagePollIntervalMs?: number
	},
): Promise<BridgeForMintResult> {
	const logger = createLogger("bridge-for-mint")

	const secret = poseidon2HashWithSeparator([salt, claimer], DOM_SEP__FPC_BRIDGE_SECRET)
	const secretHash = await computeSecretHash(secret)

	const l1RpcUrls = opts?.l1RpcUrls ?? [process.env.ANVIL_URL ?? DEFAULT_L1_RPC_URL]
	const nodeInfo = await aztecNode.getNodeInfo()
	const l1Client = createExtendedL1Client(l1RpcUrls, opts?.l1Mnemonic ?? DEFAULT_L1_MNEMONIC, {
		id: nodeInfo.l1ChainId,
		name: "anvil",
	})

	const { feeJuicePortalAddress, feeJuiceAddress, feeAssetHandlerAddress } = nodeInfo.l1ContractAddresses
	const handlerAddress = feeAssetHandlerAddress && !feeAssetHandlerAddress.isZero() ? feeAssetHandlerAddress : undefined

	const feeJuiceManager = new L1FeeJuicePortalManager(feeJuicePortalAddress, feeJuiceAddress, handlerAddress, l1Client, logger)
	const tokenManager = feeJuiceManager.getTokenManager()
	const claimAmount = await tokenManager.getMintAmount()
	if (requestedAmount !== claimAmount) {
		// FeeAssetHandler has a fixed mint amount; can't bridge an arbitrary amount.
		// Caller is responsible for using the canonical claim amount or repeated mints.
		logger.info(
			`Note: requestedAmount=${requestedAmount} differs from FeeAssetHandler claimAmount=${claimAmount}; using ${claimAmount}`,
		)
	}

	await tokenManager.mint(l1Client.account.address)
	await tokenManager.approve(claimAmount, feeJuicePortalAddress.toString(), "FeeJuice Portal")

	const portalContract = getContract({
		address: feeJuicePortalAddress.toString() as `0x${string}`,
		abi: FeeJuicePortalAbi,
		client: l1Client,
	})

	const depositArgs = [fpcAddress.toString(), claimAmount, secretHash.toString()] as const
	logger.info(`Depositing to FeeJuice portal with claimer-bound secret (claimer=${claimer.toString()})`)
	const txHash = await portalContract.write.depositToAztecPublic(depositArgs)
	const txReceipt = await l1Client.waitForTransactionReceipt({ hash: txHash })

	const log = extractEvent(
		txReceipt.logs,
		feeJuicePortalAddress.toString(),
		FeeJuicePortalAbi,
		"DepositToAztecPublic",
		(l) => l.args.amount === claimAmount && l.args.to?.toLowerCase() === fpcAddress.toString().toLowerCase(),
		logger,
	)

	const messageHash = Fr.fromString(log.args.key as string)
	const leafIndex = new Fr(log.args.index as bigint)

	const pollTries = opts?.messagePollTries ?? 400
	const pollIntervalMs = opts?.messagePollIntervalMs ?? 100

	let ready = false
	for (let i = 0; i < pollTries; i++) {
		ready = await isL1ToL2MessageReady(aztecNode, messageHash)
		if (ready) break
		await produceL2Block()
		await new Promise((r) => setTimeout(r, pollIntervalMs))
	}
	if (!ready) {
		throw new Error(`L1→L2 message not yet ingested by node for PrivateFPC deposit: ${messageHash.toString()}`)
	}

	logger.info(`PrivateFPC deposit ready, leafIndex=${leafIndex.toString()}`)
	return { secret, claimAmount, leafIndex }
}
