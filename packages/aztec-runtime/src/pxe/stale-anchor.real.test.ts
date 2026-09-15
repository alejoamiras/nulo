// @vitest-environment node
/**
 * The resync-and-retry against a REAL `@aztec/pxe` and a real local network. An L1 reorg deep
 * enough to drop the L1 block that carried the PXE's anchor makes the node prune that L2 block and
 * reject queries by its hash; the helper must resync, retry once and land on a moved anchor. The
 * control case runs the same op WITHOUT the helper and is what proves the sandbox reproduces the
 * failure at all — when it does not, this file cannot verify recovery and says so.
 *
 * The PXE runs with `autoSync: false` on purpose. The production failure is a race: the PXE's
 * pre-op sync saw the old tip, then the node pruned, then the op queried by the old hash. A
 * single-node sandbox cannot land a prune inside that window deterministically, so the test
 * freezes the "synced before the prune" half and issues the "queried after" half itself; the
 * helper's explicit `sync()` is exactly what closes the race either way.
 *
 * Node environment + the server PXE entrypoint (LMDB on real disk): the production factory opens
 * an OPFS store, which only exists in a browser. The helper is store-agnostic.
 *
 * Needs the sandbox the e2e agent boots (`scripts/e2e/agent.sh` exports both URLs):
 *   ANVIL_URL=… AZTEC_NODE_URL=… bun run --cwd packages/aztec-runtime test src/pxe/stale-anchor.real.test.ts
 */
import { mkdirSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { getInitialTestAccountsData } from "@aztec/accounts/testing"
import { SchnorrInitializerlessAccountContract, SchnorrInitializerlessAccountContractArtifact } from "@aztec/accounts/schnorr"
import { computeAuthWitMessageHash } from "@aztec/aztec.js/authorization"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { Fr } from "@aztec/foundation/curves/bn254"
import { getPXEConfig } from "@aztec/pxe/config"
import { createPXE, type PXE } from "@aztec/pxe/server"
import { encodeArguments, FunctionCall, FunctionSelector, FunctionType, getFunctionArtifactByName } from "@aztec/stdlib/abi"
import type { AuthWitness } from "@aztec/stdlib/auth-witness"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import { computePartialAddress, getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { deriveKeys } from "@aztec/stdlib/keys"
import { isStaleAnchorMessage, withStaleAnchorRetry } from "./stale-anchor"

const ANVIL_URL = process.env.ANVIL_URL
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL

async function l1Rpc<T>(method: string, params: unknown[]): Promise<T> {
	const res = await fetch(ANVIL_URL as string, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	})
	const body = (await res.json()) as { result?: T; error?: { message: string } }
	if (body.error) throw new Error(`${method}: ${body.error.message}`)
	return body.result as T
}

const l1BlockNumber = async () => Number.parseInt(await l1Rpc<string>("eth_blockNumber", []), 16)

async function waitFor(what: string, predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		if (await predicate()) return
		await new Promise((r) => setTimeout(r, 1_000))
	}
	throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`)
}

describe.skipIf(!ANVIL_URL || !AZTEC_NODE_URL)("stale-anchor recovery against a real PXE and a reorged local network", () => {
	let node: AztecNode
	let pxe: PXE
	let dataDirectory: string
	let account: AztecAddress
	let rollupAddress: string
	let lookupValidityCall: FunctionCall
	let lookupValidityAuthwit: AuthWitness
	let staleAnchorHash: string

	async function utilityCall(name: string, args: unknown[]): Promise<FunctionCall> {
		const fn = getFunctionArtifactByName(SchnorrInitializerlessAccountContractArtifact, name)
		const selector = await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters)
		return new FunctionCall(fn.name, account, selector, FunctionType.UTILITY, false, true, encodeArguments(fn, args), fn.returnTypes)
	}

	beforeAll(async () => {
		node = createAztecNodeClient(AZTEC_NODE_URL as string)
		rollupAddress = (await node.getL1ContractAddresses()).rollupAddress.toString()
		dataDirectory = join(homedir(), ".cache", "nulo-e2e", `stale-anchor-real-${process.pid}-${Date.now()}`)
		mkdirSync(dataDirectory, { recursive: true })
		pxe = await createPXE(node, { ...getPXEConfig(), dataDirectory, proverEnabled: false, autoSync: false })

		// One of the local network's genesis-funded test accounts: an initializerless schnorr account
		// (no deployment tx; the signing key is committed into the address as the immutables hash),
		// registered the way the SDK's base wallet does it — class, instance, then privacy keys —
		// and materialized through the `constructor` utility the SDK simulates right after.
		const [initial] = await getInitialTestAccountsData()
		if (!initial) throw new Error("the local network ships no initial test accounts")
		const contract = new SchnorrInitializerlessAccountContract(initial.signingKey)
		const keys = await deriveKeys(initial.secret)
		const instance = await getContractInstanceFromInstantiationParams(SchnorrInitializerlessAccountContractArtifact, {
			salt: initial.salt,
			publicKeys: keys.publicKeys,
			immutablesHash: await contract.getImmutablesHash(),
		})
		if (!instance.address.equals(initial.address)) {
			throw new Error(`derived ${instance.address} but the sandbox deployed ${initial.address}`)
		}
		await pxe.registerContractClass(SchnorrInitializerlessAccountContractArtifact)
		await pxe.registerContract(instance)
		const completeAddress = await pxe.registerAccount(
			{
				masterNullifierHidingSecretKey: keys.masterNullifierHidingSecretKey,
				masterIncomingViewingSecretKey: keys.masterIncomingViewingSecretKey,
				masterOutgoingViewingSecretKey: keys.masterOutgoingViewingSecretKey,
				masterTaggingSecretKey: keys.masterTaggingSecretKey,
				masterMessageSigningPublicKey: keys.masterMessageSigningPublicKey,
				masterFallbackPublicKey: keys.masterFallbackPublicKey,
			},
			await computePartialAddress(instance),
		)
		account = instance.address
		await pxe.sync()
		const signingKey = await contract.getSigningPublicKey()
		await pxe.executeUtility(await utilityCall("constructor", [signingKey.x, signingKey.y]), { scopes: [account] })

		// `lookup_validity` is the account utility the SDK itself calls. It checks the private authwit
		// first (so the test hands it one, as a wallet would), then reads the auth registry's public
		// storage at the PXE's anchor — the by-hash node query a prune breaks.
		const innerHash = new Fr(1)
		lookupValidityCall = await utilityCall("lookup_validity", [account, innerHash])
		const info = await node.getNodeInfo()
		const messageHash = await computeAuthWitMessageHash(
			{ consumer: account, innerHash },
			{ chainId: new Fr(info.l1ChainId), version: new Fr(info.rollupVersion) },
		)
		lookupValidityAuthwit = await contract.getAuthWitnessProvider(completeAddress).createAuthWit(messageHash)

		// One prune serves both cases below, in order: the control queries the stale anchor raw, then
		// the helper recovers from the very same state. Each L1 reorg costs the sandbox a block it
		// only regrows on demand, so the file spends exactly one.
		staleAnchorHash = await syncThenReorgPastAnchor()
	}, 300_000)

	afterAll(async () => {
		await pxe?.stop()
		rmSync(dataDirectory, { recursive: true, force: true })
	})

	const runLookupValidity = () => pxe.executeUtility(lookupValidityCall, { authwits: [lookupValidityAuthwit], scopes: [account] })

	/** Anchor the PXE on the node's tip, then reorg L1 past the block that published it. */
	async function syncThenReorgPastAnchor(): Promise<string> {
		await pxe.sync()
		const anchor = await pxe.getSyncedBlockHeader()
		const anchorHash = (await anchor.hash()).toString()
		const anchorNumber = anchor.getBlockNumber()
		if (anchorNumber < 1) throw new Error("the sandbox has no L2 block to prune; boot a fresh one")
		// The rollup's latest L1 log is the publish of the current tip; drop that block and after.
		const logs = await l1Rpc<Array<{ blockNumber: string }>>("eth_getLogs", [
			{ address: rollupAddress, fromBlock: "0x0", toBlock: "latest" },
		])
		const publishedAt = Math.max(...logs.map((l) => Number.parseInt(l.blockNumber, 16)))
		const depth = (await l1BlockNumber()) - publishedAt + 1
		await l1Rpc("anvil_reorg", [depth, []])
		await waitFor(
			`the node to prune L2 block ${anchorNumber}`,
			async () => {
				const data = await node.getBlockData(anchorNumber)
				return !data || (await data.header.hash()).toString() !== anchorHash
			},
			120_000,
		)
		return anchorHash
	}

	test("control: the op queried by the pruned anchor fails with the stale-anchor diagnostic", async () => {
		const err = await runLookupValidity().then(
			() => undefined,
			(e: unknown) => e,
		)
		expect(err, "the sandbox never produced the stale-anchor failure").toBeDefined()
		expect(isStaleAnchorMessage((err as Error).message)).toBe(true)
	}, 300_000)

	test("helper: resync + one retry recovers and the anchor moves", async () => {
		const lines: string[] = []
		await expect(withStaleAnchorRetry("executeUtility", pxe, runLookupValidity, (line) => lines.push(line))).resolves.toBeDefined()
		expect(lines).toEqual(["executeUtility: stale anchor on first attempt — resynced, retrying once"])
		expect((await (await pxe.getSyncedBlockHeader()).hash()).toString()).not.toBe(staleAnchorHash)
	}, 300_000)
})
