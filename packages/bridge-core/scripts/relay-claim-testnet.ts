/**
 * Relayer: submit a user's PRIVATE token `claim_private` FOR them, on live testnet.
 *
 * This is the concrete demonstration of the recipient-commitment capability (the DRIVER of the whole
 * change): a dedicated relayer account finishes a stranded/pending private deposit without being able
 * to redirect the funds — the circuit re-derives the consumption secret from `(salt, recipient)`, so a
 * wrong recipient can't consume. The pure key-handling + validation lives in `../src/relay-claim.ts`
 * (unit-tested); this file is only the live wiring (node, sponsored-FPC wallet, the send).
 *
 * LIVE-ONLY. It needs a recipient-committed deployment (`privateClaimMode: "salt-v2"`) — it fail-closes
 * against today's bearer testnet, by design. Runnable only after the Phase 6/7 cutover.
 *
 * Usage:
 *   RELAYER_L2_SECRET_KEY=0x…  bun run scripts/relay-claim-testnet.ts --claim ./claim.json
 * where claim.json is the off-chain hand-off from the user:
 *   { "bridge": "0x…", "recipient": "0x…", "amount": "1000", "salt": "0x…", "leafIndex": 7 }
 *
 * Security: the relayer runs under its OWN dedicated key (RELAYER_L2_SECRET_KEY), never the user's. The
 * `salt` is a linkage-privacy credential the relayer necessarily learns; it is NEVER logged (only a
 * redacted view is printed).
 */
import { readFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxStatus } from "@aztec/aztec.js/tx"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { EthAddress } from "@aztec/foundation/eth-address"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { deriveSigningKey } from "@aztec/stdlib/keys"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { TokenContractArtifact } from "@alejoamiras/aztec-standards/dist/src/artifacts/Token.js"
import { bridgeProxyArtifact, tokenBridgeArtifact } from "../src/artifacts"
import { bridgeAt, submitPrivateClaim } from "../src/l2"
import { assertSaltV2, parseClaimDescriptor, redactDescriptorForLog, requireRelayerSecret } from "../src/relay-claim"

const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"

const here = dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = process.env.BRIDGE_MANIFEST ?? join(here, "..", "..", "..", "apps", "faucet", "public", "testnet-bridge.json")

function claimPathFromArgv(argv: string[]): string {
	const i = argv.indexOf("--claim")
	const path = i >= 0 ? argv[i + 1] : process.env.RELAY_CLAIM_FILE
	if (!path) throw new Error("missing --claim <file> (or RELAY_CLAIM_FILE)")
	return isAbsolute(path) ? path : join(process.cwd(), path)
}

async function main(): Promise<void> {
	// 1. Validate everything OFFLINE before touching the network (fail-closed, no secret/salt logged).
	const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
	assertSaltV2(manifest)
	const descriptor = parseClaimDescriptor(JSON.parse(readFileSync(claimPathFromArgv(process.argv), "utf8")))
	const relayerSecret = requireRelayerSecret(process.env)
	console.log("relaying claim:", redactDescriptorForLog(descriptor))

	// 2. Relayer wallet (its OWN dedicated key) + sponsored fees (relayer needs no Fee Juice). A FIXED
	//    account salt makes the address deterministic across runs; the account is deployed once, on first
	//    use, via the sponsored FPC (getContract(addr) skips the deploy when it already exists).
	const node = createAztecNodeClient(NODE_URL)
	const ewallet = await EmbeddedWallet.create(NODE_URL, { pxeConfig: { proverEnabled: true } })
	const manager = await ewallet.createSchnorrAccount(relayerSecret, Fr.ZERO, deriveSigningKey(relayerSecret))
	const relayerAddr = (await manager.getAccount()).getAddress()
	const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
		salt: new Fr(SPONSORED_FPC_SALT),
		publicKeys: PublicKeys.default(),
	})
	try {
		await ewallet.registerContract(fpc, SponsoredFPCContract.artifact)
	} catch {}
	const fee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
	if (!(await node.getContract(relayerAddr))) {
		const deployMethod = await manager.getDeployMethod()
		await deployMethod.send({ fee, from: "NO_FROM" as never } as never)
	}

	// 3. Register EVERY L2 contract the private claim touches. claim_private privately calls
	//    TokenMinterProxy.mint_to_private → the Token, so a clean PXE needs the proxy + token + bridge
	//    artifacts to simulate+prove — not just the bridge. Rebuilt from the manifest (same path as
	//    verify-deployments / fuel-testnet).
	const proxy = await getContractInstanceFromInstantiationParams(bridgeProxyArtifact, {
		publicKeys: PublicKeys.default(),
		deployer: AztecAddress.ZERO,
		constructorArgs: [],
		salt: new Fr(BigInt(manifest.l2.proxy.salt)),
		constructorArtifact: manifest.l2.proxy.constructorArtifact,
	})
	const [tokenName, tokenSymbol, tokenDecimals] = manifest.l2.token.constructorArgs
	const token = await getContractInstanceFromInstantiationParams(TokenContractArtifact, {
		publicKeys: PublicKeys.default(),
		deployer: AztecAddress.ZERO,
		constructorArgs: [tokenName, tokenSymbol, tokenDecimals, proxy.address],
		salt: new Fr(BigInt(manifest.l2.token.salt)),
		constructorArtifact: manifest.l2.token.constructorArtifact,
	})
	const bridgeInstance = await getContractInstanceFromInstantiationParams(tokenBridgeArtifact, {
		publicKeys: PublicKeys.default(),
		deployer: AztecAddress.ZERO,
		constructorArgs: [proxy.address, EthAddress.fromString(manifest.l1.portal)],
		salt: new Fr(BigInt(manifest.l2.bridge.salt)),
		constructorArtifact: manifest.l2.bridge.constructorArtifact,
	})
	if (bridgeInstance.address.toString().toLowerCase() !== descriptor.bridge.toLowerCase()) {
		throw new Error(
			`bridge mismatch: descriptor names ${descriptor.bridge} but the manifest rebuilds ${bridgeInstance.address.toString()} — refusing`,
		)
	}
	for (const [inst, art] of [
		[proxy, bridgeProxyArtifact],
		[token, TokenContractArtifact],
		[bridgeInstance, tokenBridgeArtifact],
	] as const) {
		await ewallet.registerContract(inst, art as never)
	}

	// 4. Submit the claim FOR the user, with a bounded retry for the L1→L2 settling window / fee drift
	//    (the message may not be claimable the instant the relayer is handed the descriptor). A wrong
	//    recipient could not have produced this salt→secret, so the relayer cannot redirect; the funds
	//    land at descriptor.recipient. `wait` auto-waits and THROWS if the tx doesn't reach PROPOSED.
	const bridge = bridgeAt(ewallet as never, descriptor.bridge, tokenBridgeArtifact)
	let result: { receipt?: { txHash?: { toString(): string } } } | undefined
	let lastErr: unknown
	for (let attempt = 1; attempt <= 5 && !result; attempt++) {
		try {
			result = (await submitPrivateClaim(
				bridge,
				{
					recipient: descriptor.recipient,
					amount: descriptor.amount,
					secret: descriptor.salt,
					messageLeafIndex: descriptor.leafIndex,
				},
				{ from: relayerAddr, ...fee, wait: { waitForStatus: TxStatus.PROPOSED } },
			)) as { receipt?: { txHash?: { toString(): string } } }
		} catch (e) {
			// A claim error never carries the salt (it's a not-yet-claimable / fee-drift condition), so the
			// message is safe to log; the salt stays out per redactDescriptorForLog + the top-level catch.
			lastErr = e
			console.log(`claim attempt ${attempt}/5 failed: ${e instanceof Error ? e.message : String(e)} — retrying in 15s`)
			await new Promise((r) => setTimeout(r, 15_000))
		}
	}
	if (!result) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
	console.log(
		`✅ relayed claim_private for ${descriptor.recipient} — tx ${result.receipt?.txHash?.toString() ?? "(mined)"} (funds land at the bound recipient)`,
	)
}

main().catch((err: unknown) => {
	// Never let a stack trace carry the salt/secret — print only the message.
	console.error("relay-claim failed:", err instanceof Error ? err.message : String(err))
	process.exit(1)
})
