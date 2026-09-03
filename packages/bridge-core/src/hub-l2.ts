/**
 * The L2 leg through the hub. A claim is decided at CLAIM time by the hub's own `token_for`: zero
 * means this claim also registers the token (one transaction for a public claim; a separate
 * `register_token` first for a private one); otherwise it is a plain claim. If another claimant
 * registers between the read and the send, the registration path fails on the already-consumed
 * register leaf and the claim is retried as a plain one — the deposit is never stranded on a race.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, type ContractBase } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { EthAddress } from "@aztec/foundation/eth-address"
import { deriveStorageSlotInMap } from "@aztec/stdlib/hash"
import { tokenBridgeHubArtifact } from "./artifacts"
import type { JournalTokenBlock } from "./journal"

export function hubAt(wallet: Wallet, hub: string): ContractBase {
	return Contract.at(AztecAddress.fromStringUnsafe(hub), tokenBridgeHubArtifact, wallet)
}

const ZERO_FIELD = `0x${"0".repeat(64)}`

/** The one node read the binding needs; the full node client satisfies it. */
export interface PublicStorageReader {
	getPublicStorageAt(block: "latest", contract: AztecAddress, slot: Fr): Promise<Fr>
}

/** The `token_of` map's base slot, from the artifact the hub was deployed from. */
export function hubTokenOfSlot(): Fr {
	const slot = tokenBridgeHubArtifact.storageLayout.token_of?.slot
	if (!slot) throw new Error("the hub artifact declares no token_of storage")
	return slot
}

/**
 * The hub's binding for an ERC-20 without a wallet: the address sits first in the `WithHash`
 * the map's `PublicImmutable` packs, so the entry's own slot holds it, and zero — the value an
 * unwritten slot reads as — means unregistered, since the hub never binds to the zero address.
 */
export async function hubBindingAt(node: PublicStorageReader, hub: string, erc20: string): Promise<string | undefined> {
	const slot = await deriveStorageSlotInMap(hubTokenOfSlot(), EthAddress.fromString(erc20))
	const value = await node.getPublicStorageAt("latest", AztecAddress.fromStringUnsafe(hub), slot)
	return value.isZero() ? undefined : value.toString()
}

/** The hub's binding for an ERC-20, or undefined when it has not registered it. */
export async function hubTokenFor(hub: ContractBase, erc20: string, from: string): Promise<string | undefined> {
	const r = (await hub.methods
		.token_for(EthAddress.fromString(erc20))
		.simulate({ from: AztecAddress.fromStringUnsafe(from) } as never)) as { result?: unknown }
	const addr = String(r.result ?? r)
	return addr.toLowerCase() === ZERO_FIELD ? undefined : addr
}

/** The guardian's exit switch, read without simulating an exit. */
export async function hubExitsPaused(hub: ContractBase, from: string): Promise<boolean> {
	const r = (await hub.methods.exits_paused().simulate({ from: AztecAddress.fromStringUnsafe(from) } as never)) as {
		result?: unknown
	}
	const v = r.result ?? r
	if (v === true || v === 1n || v === 1 || v === "true") return true
	if (v === false || v === 0n || v === 0 || v === "false") return false
	// A safety switch must never read as open because the simulator's answer changed shape.
	throw new Error(`exits_paused() answered ${JSON.stringify(v)} — not a boolean; refusing to treat the hub as unpaused`)
}

/** How long a private first claim waits for its own registration to become visible to the claimer's
 *  wallet before the claim is sent. The registration's public effect lands on the node first; the
 *  claim is a private function that reads it at the wallet's synced block, which lags the node. */
export interface RegistrationWait {
	intervalMs?: number
	deadlineMs?: number
	sleep?: (ms: number) => Promise<void>
}

const REGISTRATION_WAIT: Required<RegistrationWait> = {
	intervalMs: 5_000,
	deadlineMs: 180_000,
	sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

/** Opaque send options (fee + from + wait); the shape varies by wallet. The seam keys ride along and
 *  never reach the wallet. A private first claim registers in a transaction of its own, so it has
 *  two fees: `registerFee` pays `register_token` instead of `fee`, and `registeredClaimFee` pays the
 *  claim that follows a registration THIS call sent — a fuel claim's fee consumes the bridged Fee
 *  Juice message, which only one transaction can do, so whichever of the two spends it, the other
 *  must draw on something else. `onRegisterSend` fires right before the registration is sent and
 *  `onClaimSend` right before the claim, so a caller can latch "the fuel was spent" against the
 *  transaction that actually carries it; `onRegistered` delivers the registration's hash as soon
 *  as it exists, before the claim is awaited. */
export type SendOpts = Record<string, unknown> & {
	registerFee?: unknown
	registeredClaimFee?: unknown
	onRegisterSend?: () => void
	onRegistered?: (txHash: string) => void
	onClaimSend?: () => void
	registrationWait?: RegistrationWait
}

/** The claim's own options: the seam keys stripped, so nothing but the wallet's vocabulary reaches it —
 *  a simulation of the claim must use these too. */
export function claimSendOpts(send: SendOpts): SendOpts {
	const {
		registerFee: _registerFee,
		registeredClaimFee: _registeredClaimFee,
		onRegisterSend: _onRegisterSend,
		onRegistered: _onRegistered,
		onClaimSend: _onClaimSend,
		registrationWait: _registrationWait,
		...claim
	} = send
	return claim
}

/** The registration's options, the plain claim's, and the claim's after a registration of its own.
 *  The registration's wait never throws on a revert: its fee setup is non-revertible, so a
 *  registration that reverts in public has still spent what paid for it, and the caller must learn
 *  its hash rather than a bare error. */
function splitRegisterFee(send: SendOpts): { register: SendOpts; claim: SendOpts; registeredClaim: SendOpts } {
	const claim = claimSendOpts(send)
	const registerWait = { ...((claim.wait as Record<string, unknown> | undefined) ?? {}), dontThrowOnRevert: true }
	return {
		register: { ...claim, ...(send.registerFee === undefined ? {} : { fee: send.registerFee }), wait: registerWait },
		claim,
		registeredClaim: send.registeredClaimFee === undefined ? claim : { ...claim, fee: send.registeredClaimFee },
	}
}

/** A landed transaction that reverted past its setup: its block status is a mined one, its
 *  execution result says reverted — the fee is charged and any message its setup consumed is
 *  spent, but nothing the app phase meant to do happened. */
const revertedPastSetup = (receipt: { executionResult?: unknown }): boolean => /reverted/i.test(String(receipt.executionResult ?? ""))

/** Everything the L2 side needs from the L1 receipt + the journal. */
export interface HubClaimParams {
	token: JournalTokenBlock
	recipient: string
	amount: bigint
	/** PUBLIC: the raw secret. PRIVATE: the `claim_salt`. */
	claimValue: Fr
	leafIndex: bigint
	isPrivate: boolean
	/** The L2 account submitting (the recipient, or a relayer). */
	from: string
}

function registerArgs(t: JournalTokenBlock) {
	if (t.registerIndex === undefined) throw new Error("hub claim: the token block carries no registerIndex — cannot register")
	return [
		EthAddress.fromString(t.erc20),
		EthAddress.fromString(t.portal),
		Fr.fromHexString(t.nameWord),
		Fr.fromHexString(t.symbolWord),
		t.decimals,
		new Fr(BigInt(t.registerIndex)),
	] as const
}

/** True when the failure means someone else consumed the register leaf first. */
export function isRegisterRace(e: unknown): boolean {
	const msg = e instanceof Error ? e.message : String(e)
	return /non-nullified L1 to L2 message|already nullified|duplicate nullifier|Nullifier already exists/i.test(msg)
}

type Sent = Promise<{ receipt: { txHash: unknown; executionResult?: unknown } }>
const txHashOf = async (sent: Sent) => String((await sent).receipt.txHash)

export type HubClaimPath = "claim" | "register+claim" | "register,claim"
export interface HubClaimOutcome {
	path: HubClaimPath
	/** Only the private first claim registers in a transaction of its own. */
	registerTxHash?: string
	claimTxHash: string
}

function claimCall(hub: ContractBase, p: HubClaimParams) {
	const l2Token = AztecAddress.fromStringUnsafe(p.token.l2Token)
	const to = AztecAddress.fromStringUnsafe(p.recipient)
	return p.isPrivate
		? hub.methods.claim_private(l2Token, to, p.amount, p.claimValue, new Fr(p.leafIndex))
		: hub.methods.claim_public(l2Token, to, p.amount, p.claimValue, new Fr(p.leafIndex))
}

function plainClaim(hub: ContractBase, p: HubClaimParams, send: SendOpts): Sent {
	return claimCall(hub, p).send(send as never) as unknown as Sent
}

/** Polls the claim's own simulation until it passes: the registration is proposed on the node, but
 *  the claim reads the binding (and, when its fee draws on the credit the registration left at the
 *  FPC, that credit's note) at the wallet's synced block. A simulation is the one probe that sees
 *  exactly what the send will see. Any failure keeps polling — the message and the fee were gated
 *  before the registration was sent, so what remains is visibility — until the deadline, when the
 *  last failure is surfaced with the registration's hash so a retry claims plainly. */
async function awaitClaimVisible(hub: ContractBase, p: HubClaimParams, claim: SendOpts, registerTxHash: string, wait?: RegistrationWait) {
	const { intervalMs, deadlineMs, sleep } = { ...REGISTRATION_WAIT, ...wait }
	const start = Date.now()
	for (;;) {
		try {
			await claimCall(hub, p).simulate(claim as never)
			return
		} catch (e) {
			if (Date.now() - start + intervalMs > deadlineMs) {
				const why = e instanceof Error ? e.message : String(e)
				throw new Error(
					`hub claim: the registration ${registerTxHash} landed but the claim is not yet visible to your wallet — retry the claim in a moment (${why})`,
				)
			}
		}
		await sleep(intervalMs)
	}
}

/** The hub's binding for the block's ERC-20, refused when it names a different L2 token than the block. */
async function registeredTokenOf(hub: ContractBase, p: HubClaimParams): Promise<string | undefined> {
	const bound = await hubTokenFor(hub, p.token.erc20, p.from)
	if (bound !== undefined && bound.toLowerCase() !== p.token.l2Token.toLowerCase()) {
		throw new Error(`hub claim: the hub binds ${p.token.erc20} to ${bound}, the journal says ${p.token.l2Token} — refusing to claim`)
	}
	return bound
}

/**
 * A failed registration is a lost race only if the hub now knows the token. The same message
 * also means "the leaf is not consumable yet", and that case must reach the caller's sync retry —
 * a plain claim on an unregistered token would fail on the uninitialized binding instead.
 */
async function rethrowUnlessRaceLost(hub: ContractBase, p: HubClaimParams, e: unknown): Promise<void> {
	if (!isRegisterRace(e) || (await registeredTokenOf(hub, p)) === undefined) throw e
}

async function firstPublicClaim(hub: ContractBase, p: HubClaimParams, send: SendOpts): Promise<HubClaimOutcome> {
	const to = AztecAddress.fromStringUnsafe(p.recipient)
	const claim = claimSendOpts(send)
	// One attempt, whichever transaction carries it: the registering claim, or the plain claim it
	// falls back to when someone else registered first.
	send.onClaimSend?.()
	try {
		const sent = hub.methods
			.register_and_claim_public(...registerArgs(p.token), to, p.amount, p.claimValue, new Fr(p.leafIndex))
			.send(claim as never) as unknown as Sent
		return { path: "register+claim", claimTxHash: await txHashOf(sent) }
	} catch (e) {
		await rethrowUnlessRaceLost(hub, p, e)
		return { path: "claim", claimTxHash: await txHashOf(plainClaim(hub, p, claim)) }
	}
}

async function firstPrivateClaim(hub: ContractBase, p: HubClaimParams, send: SendOpts): Promise<HubClaimOutcome> {
	const { register, claim, registeredClaim } = splitRegisterFee(send)
	let registerTxHash: string | undefined
	send.onRegisterSend?.()
	try {
		const { receipt } = await (hub.methods.register_token(...registerArgs(p.token)).send(register as never) as unknown as Sent)
		registerTxHash = String(receipt.txHash)
		if (revertedPastSetup(receipt)) {
			// The registration's setup spent what paid for it before the public half reverted: the
			// hash is the caller's evidence of that spend, and the claim retries against the credit.
			send.onRegistered?.(registerTxHash)
			throw new Error(
				`hub claim: the registration ${registerTxHash} reverted after its setup spent the bridged gas — retry to claim from the credit it left`,
			)
		}
	} catch (e) {
		await rethrowUnlessRaceLost(hub, p, e)
	}
	// The registration derived the token from the words; a block whose l2Token disagrees is caught
	// here by name, before a claim on the wrong address burns a transaction.
	await registeredTokenOf(hub, p)
	// A lost race means someone else's registration bound the token and this call spent nothing:
	// the claim is then the plain one, with the plain fee.
	const claimOpts = registerTxHash === undefined ? claim : registeredClaim
	if (registerTxHash !== undefined) {
		send.onRegistered?.(registerTxHash)
		await awaitClaimVisible(hub, p, claimOpts, registerTxHash, send.registrationWait)
	}
	send.onClaimSend?.()
	return { path: "register,claim", registerTxHash, claimTxHash: await txHashOf(plainClaim(hub, p, claimOpts)) }
}

/** Sends the claim, registering the token first when the hub does not know it yet. */
export async function claimViaHub(hub: ContractBase, p: HubClaimParams, send: SendOpts): Promise<HubClaimOutcome> {
	if (await registeredTokenOf(hub, p)) {
		send.onClaimSend?.()
		return { path: "claim", claimTxHash: await txHashOf(plainClaim(hub, p, claimSendOpts(send))) }
	}
	return p.isPrivate ? firstPrivateClaim(hub, p, send) : firstPublicClaim(hub, p, send)
}

export interface HubExitParams {
	l2Token: string
	recipientL1: string
	amount: bigint
	callerOnL1: string
	authwitNonce: Fr
	isPrivate: boolean
}

function exitCall(hub: ContractBase, p: HubExitParams) {
	if (/^0x0{40}$/i.test(p.recipientL1)) throw new Error("exit recipient must not be the zero address (would strand the withdraw)")
	const args = [
		AztecAddress.fromStringUnsafe(p.l2Token),
		EthAddress.fromString(p.recipientL1),
		p.amount,
		EthAddress.fromString(p.callerOnL1),
		p.authwitNonce,
	] as const
	return p.isPrivate ? hub.methods.exit_to_l1_private(...args) : hub.methods.exit_to_l1_public(...args)
}

/**
 * The L2 half of the exit preflight: simulating the exit runs the pause assert (public inline,
 * private through its enqueued public call), the portal read and the burn, so a paused hub, an
 * unregistered token or a short balance all surface before the exit is sent.
 *
 * A private burn resolves its authorization through the witness oracle, so simulating one without
 * its off-chain authwit fails on the missing witness rather than on the exit itself — pass that
 * witness through `opts`, exactly as the send does.
 */
export async function preflightHubExit(hub: ContractBase, p: HubExitParams, from: string, opts: SendOpts = {}): Promise<void> {
	await exitCall(hub, p).simulate({ ...opts, from: AztecAddress.fromStringUnsafe(from) } as never)
}

export function exitViaHub(hub: ContractBase, p: HubExitParams, send: SendOpts) {
	return exitCall(hub, p).send(send as never)
}
