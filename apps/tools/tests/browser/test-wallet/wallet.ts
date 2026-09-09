/**
 * An `@aztec/wallets` embedded wallet with the two things tools needs from a wallet-sdk wallet
 * and the base class does not give it: a capability grant, and — per profile — the Nulo-custom
 * RPCs. The profile only DECORATES a standard wallet; every bridge transaction still runs through
 * the stock `BaseWallet` path, which is what the suite is testing tools against.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getContractInstanceFromInstantiationParams, type InteractionWaitOptions, type SendReturn } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import type { SendOptions, SimulateOptions } from "@aztec/aztec.js/wallet"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { ProtocolContractAddress } from "@aztec/protocol-contracts"
import { FunctionSelector } from "@aztec/stdlib/abi"
import { ExecutionPayload } from "@aztec/stdlib/tx"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { deriveNuloAccountKeys } from "@nulo/wallet-crypto"
import { DAPP_SELF_PAY_FEATURE, type Seed, type TestWalletIdentity, type TestWalletProfile } from "./profile"

/** The call `FeeJuicePaymentMethodWithClaim` emits: a self-payer WITH it is a claim in setup. */
const CLAIM_AND_END_SETUP = "claim_and_end_setup((Field),u128,Field,Field)"

const unsupported = (method: string) => new Error(`Unsupported wallet method: ${method}`)

type Manifest = { capabilities: Array<Record<string, unknown> & { type: string }> }

export class TestWallet extends EmbeddedWallet {
	profile: TestWalletProfile = "plain"
	private claimSelector = FunctionSelector.empty()
	private readonly registeredTokens = new Set<string>()
	private imported = 0

	static async createFor(profile: TestWalletProfile, identity: TestWalletIdentity): Promise<TestWallet> {
		// Ephemeral: nothing outlives the page. Proving off: the local network synthesizes proofs.
		const wallet = await TestWallet.create(identity.nodeUrl, { ephemeral: true, pxe: { proverEnabled: false } })
		wallet.profile = profile
		wallet.claimSelector = await FunctionSelector.fromSignature(CLAIM_AND_END_SETUP)
		// A wallet on a network with a sponsor knows the SponsoredFPC — a dApp names it as payer and
		// never registers it (tools: `sponsored-fpc.ts`). The local network pre-deploys it at the
		// protocol salt.
		const sponsor = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
			salt: new Fr(SPONSORED_FPC_SALT),
		})
		await wallet.registerContract(sponsor, SponsoredFPCContract.artifact)
		return wallet
	}

	/** Registers the Nulo-shape Schnorr account a seed derives to; the suite deployed it in Node. */
	async importSeed(seed: Seed): Promise<AztecAddress> {
		const { signingKey, secretKey } = await deriveNuloAccountKeys(Fr.fromHexString(seed.secret))
		const manager = await this.createSchnorrAccount(secretKey, new Fr(BigInt(seed.salt)), signingKey, `actor-${++this.imported}`)
		return manager.address
	}

	/** Armed by the suite: the next grant answers without any contract scope — what a user who
	 *  declines the token prompt leaves the dApp with. One shot. */
	declineNextGrant = false

	/** Grants exactly what was asked, with every imported account — the suite's whole actor pool. */
	// biome-ignore lint/suspicious/noExplicitAny: the SDK's manifest/grant types are zod-inferred and not exported usably.
	override async requestCapabilities(manifest: any): Promise<any> {
		const accounts = await this.getAccounts()
		const declining = this.declineNextGrant
		this.declineNextGrant = false
		const granted = (manifest as Manifest).capabilities
			.filter((c) => !(declining && c.type === "contracts"))
			.map((c) =>
				c.type === "accounts" ? { ...c, canGet: c.canGet ?? true, canCreateAuthWit: c.canCreateAuthWit ?? false, accounts } : c,
			)
		return { version: "1.0", granted, wallet: { name: `Nulo test wallet (${this.profile})`, version: "0.0.0" } }
	}

	// ── Nulo-custom RPCs (reachable only when the schema patch is loaded — never on `plain`) ──

	getWalletFeatures(): Promise<string[]> {
		return Promise.resolve(this.profile === "plain" ? [] : [DAPP_SELF_PAY_FEATURE])
	}

	registerToken(account: AztecAddress, token: AztecAddress): Promise<void> {
		if (this.profile !== "full") throw unsupported("registerToken")
		this.registeredTokens.add(`${account.toString()}:${token.toString()}`)
		return Promise.resolve()
	}

	isTokenRegistered(token: AztecAddress): Promise<boolean> {
		if (this.profile !== "full") throw unsupported("isTokenRegistered")
		const suffix = `:${token.toString()}`
		return Promise.resolve([...this.registeredTokens].some((k) => k.endsWith(suffix)))
	}

	grantPublicAuthwit(): Promise<string> {
		throw unsupported("grantPublicAuthwit")
	}

	// ── Self-pay routing (`selfpay` and `full`) ──

	/** A payload naming its sender as payer with no claim call is tools asking for the account's held
	 *  public Fee Juice; BaseWallet would read that shape as a claim in setup and build an invalid
	 *  transaction, so the payer is dropped and the account's own balance pays. A payload carrying
	 *  `claim_and_end_setup` to the protocol FeeJuice really is a claim and passes through. */
	private routed(payload: ExecutionPayload, from: unknown): ExecutionPayload {
		if (this.profile === "plain" || !(from instanceof AztecAddress) || !payload.feePayer?.equals(from)) return payload
		const claims = payload.calls.some((c) => c.to.equals(ProtocolContractAddress.FeeJuice) && c.selector.equals(this.claimSelector))
		if (claims) return payload
		return new ExecutionPayload(payload.calls, payload.authWitnesses, payload.capsules, payload.extraHashedArgs, undefined)
	}

	override sendTx<W extends InteractionWaitOptions = undefined>(payload: ExecutionPayload, opts: SendOptions<W>): Promise<SendReturn<W>> {
		return super.sendTx(this.routed(payload, opts.from), opts)
	}

	override simulateTx(payload: ExecutionPayload, opts: SimulateOptions) {
		return super.simulateTx(this.routed(payload, opts.from), opts)
	}
}
