/**
 * L2-side helpers shared by the operator scripts: the universal-deploy instance computation
 * (salt + args + deployer=ZERO — the SAME reconstruction the faucet's bridge-deployments
 * runs), manifest-bound contract registration, and the claim-until-synced loop the smoke
 * gates share.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { EthAddress } from "@aztec/foundation/eth-address"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { deriveNuloAccountKeys } from "@nulo/wallet-crypto"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { bridgeProxyArtifact, tokenBridgeArtifact } from "../src/artifacts"
import { type DeployerNetwork, resolveDeployerKeys } from "./deployer-keys"

/** The deterministic universal-deploy instance: salt + args + publicKeys.default +
 *  deployer=ZERO. One source for the deploy conductors (precompute + journal) and the
 *  smokes (recompute + assert against the manifest). */
export async function universalDeployInstance(art: unknown, args: unknown[], ctor: string, saltNum: number) {
	return await getContractInstanceFromInstantiationParams(
		art as never,
		{
			constructorArgs: args,
			salt: new Fr(saltNum),
			publicKeys: PublicKeys.default(),
			deployer: AztecAddress.ZERO,
			constructorArtifact: ctor,
		} as never,
	)
}

/** Register (NOT deploy) one manifest-recorded L2 contract, asserting the recorded address
 *  recomputes from its salt + args — the same reconstruction the faucet's
 *  bridge-deployments does. Registration failures are swallowed (already registered). */
export async function registerManifestContract(
	ewallet: unknown,
	p: { label: string; art: unknown; args: unknown[]; ctor: string; salt: number; address: string },
): Promise<Contract> {
	const instance = await universalDeployInstance(p.art, p.args, p.ctor, p.salt)
	if (instance.address.toString().toLowerCase() !== p.address.toLowerCase()) {
		throw new Error(`manifest ${p.label} mismatch: recomputed ${instance.address.toString()} != recorded ${p.address}`)
	}
	try {
		await (ewallet as { registerContract: (i: unknown, a: unknown) => Promise<unknown> }).registerContract(instance, p.art as never)
	} catch {}
	console.log(`registered ${p.label}: ${p.address}`)
	return await Contract.at(instance.address, p.art as never, ewallet as never)
}

/** Minimal manifest shape the trio registration needs. */
export interface ManifestL2Trio {
	l1: { portal: string }
	l2: {
		proxy: { address: string; salt: number; constructorArtifact: string }
		token: { address: string; salt: number; constructorArtifact: string; constructorArgs: unknown[] }
		bridge: { address: string; salt: number; constructorArtifact: string }
	}
}

/** Register the candidate's proxy → token → bridge from the manifest, in dependency order
 *  (token's minter is the proxy; bridge binds proxy + portal). */
export async function registerManifestTrio(
	ewallet: unknown,
	config: ManifestL2Trio,
): Promise<{ proxy: Contract; token: Contract; bridge: Contract }> {
	const proxy = await registerManifestContract(ewallet, {
		label: "proxy",
		art: bridgeProxyArtifact,
		args: [],
		ctor: config.l2.proxy.constructorArtifact,
		salt: config.l2.proxy.salt,
		address: config.l2.proxy.address,
	})
	const [tName, tSymbol, tDec] = config.l2.token.constructorArgs as [string, string, number, string]
	const token = await registerManifestContract(ewallet, {
		label: "token",
		art: TokenContractArtifact,
		// 5.0.1 standards Token: 5th constructor param auth_contract (ZERO).
		args: [tName, tSymbol, tDec, proxy.address, AztecAddress.ZERO],
		ctor: config.l2.token.constructorArtifact,
		salt: config.l2.token.salt,
		address: config.l2.token.address,
	})
	const bridge = await registerManifestContract(ewallet, {
		label: "bridge",
		art: tokenBridgeArtifact,
		args: [proxy.address, EthAddress.fromString(config.l1.portal)],
		ctor: config.l2.bridge.constructorArtifact,
		salt: config.l2.bridge.salt,
		address: config.l2.bridge.address,
	})
	return { proxy, token, bridge }
}

/** Claim the bridged tokens once the L1→L2 message syncs: retry claim_private/claim_public
 *  on the smoke cadence until it lands or the attempt budget runs out. */
export async function claimTokensUntilSynced(p: {
	bridge: Contract
	isPrivate: boolean
	recipient: unknown
	amount: bigint
	claimValue: Fr
	leafIndex: bigint
	sendOpts: unknown
	attempts?: number
}): Promise<void> {
	const attempts = p.attempts ?? 300
	let claimed = false
	for (let i = 0; i < attempts && !claimed; i++) {
		try {
			// PRIVATE: pass the SALT (claimValue); claim_private re-derives the secret from (salt, recipient).
			await (p.isPrivate
				? p.bridge.methods.claim_private(p.recipient, p.amount, p.claimValue, new Fr(p.leafIndex))
				: p.bridge.methods.claim_public(p.recipient, p.amount, p.claimValue, new Fr(p.leafIndex))
			).send(p.sendOpts as never)
			claimed = true
		} catch {
			await new Promise((r) => setTimeout(r, 6000))
		}
	}
	if (!claimed) throw new Error(`claim_${p.isPrivate ? "private" : "public"} never succeeded (L1→L2 message not synced within budget)`)
}

/** A throwaway Schnorr account from fresh randomness — the smoke/canary recipient shape. */
export async function freshSchnorrAccount(ewallet: {
	createSchnorrAccount: (
		secretKey: unknown,
		salt: Fr,
		signingKey: unknown,
	) => Promise<{ getAccount: () => Promise<{ getAddress: () => AztecAddress }> }>
}) {
	const { signingKey, secretKey } = await deriveNuloAccountKeys(Fr.random())
	const manager = await ewallet.createSchnorrAccount(secretKey, Fr.random(), signingKey)
	const from = (await manager.getAccount()).getAddress()
	return { manager, from }
}

/** The STABLE deployer account (never Fr.random()): derived from the network's
 *  BRIDGE_DEPLOYER_SECRET so a crash mid-generation keeps control of the account (and any
 *  funds) — a re-run with the same env resumes. */
export async function deployerSchnorrAccount(
	ewallet: {
		createSchnorrAccount: (
			secretKey: unknown,
			salt: Fr,
			signingKey: unknown,
		) => Promise<{ getAccount: () => Promise<{ getAddress: () => AztecAddress }> }>
	},
	network: DeployerNetwork,
) {
	const { secret, salt } = resolveDeployerKeys(network)
	const { signingKey, secretKey } = await deriveNuloAccountKeys(secret)
	const manager = await ewallet.createSchnorrAccount(secretKey, salt, signingKey)
	const from = (await manager.getAccount()).getAddress()
	return { manager, from, secret }
}

/** Register the canonical SponsoredFPC and build its fee payment — the testnet scripts'
 *  standard gas sponsor. Registration failures are swallowed (already registered). */
export async function sponsoredFpcFee(ewallet: unknown) {
	const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT) })
	try {
		await (ewallet as { registerContract: (i: unknown, a: unknown) => Promise<unknown> }).registerContract(
			fpc,
			SponsoredFPCContract.artifact,
		)
	} catch {}
	return { fpc, fee: { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) } }
}

/** First-account bootstrap: deploy the Schnorr account when the node doesn't serve it yet.
 *  NO_FROM — the first deploy can't route through its own (not-yet-deployed) entrypoint.
 *  `log` fires with "deploying" before the (minutes-long real proof) send and "deployed"
 *  after; a caller that never logged one of the stages passes a filter. */
export async function deployAccountIfAbsent(p: {
	node: { getContract: (a: AztecAddress) => Promise<unknown> }
	manager: { getDeployMethod: () => Promise<{ send: (o: never) => Promise<unknown> }> }
	from: AztecAddress
	fee: unknown
	log: (stage: "deploying" | "deployed") => void
}): Promise<void> {
	if (await p.node.getContract(p.from)) return
	p.log("deploying")
	const deployMethod = await p.manager.getDeployMethod()
	await deployMethod.send({ fee: p.fee, from: "NO_FROM" as never } as never)
	p.log("deployed")
}
