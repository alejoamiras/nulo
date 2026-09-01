import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { DepositJournalRecord } from "@nulo/bridge-core"
import {
	awaitL1Receipt,
	PRIVATE_FPC_ADDRESS,
	feeJuiceAddress,
	isSealTrusted,
	markSealTrusted,
	parseFeeJuiceDeposit,
	planPrivateFuelDeposit,
	planPublicFuelDeposit,
	sealDepositRecord,
} from "@nulo/bridge-core"
import { NETWORK } from "@/lib/network"
import { type Ref, ref } from "vue"
import { BRIDGE_PERMIT2, BRIDGE_ROUTER, BRIDGE_SWAP_TARGET, FUEL_ASSET, FUEL_PORTAL } from "@/contracts/bridge-deployments"
import { humanizeWalletError, isUserRejection } from "@/lib/wallet-errors"
import { withOperation } from "./useOpsInFlight"
import {
	addRecordVerified,
	cacheSecret,
	discard,
	flagRecordError,
	markSessionLive,
	runDepositClaim,
	runOnLane,
	setRecordStep,
	updateRecord,
	useBridgeJournal,
} from "./useBridgeJournal"
import { ensureDepositJournalDeps, providerFingerprint } from "./useDeposit"
import { type RouterL1Ctx, bestEffortL2Block, ensurePermit2Approval, signAndSendRouterBridge } from "./router-bridge-leg"
import { useBridgeWallet } from "./useBridgeWallet"
import { useL1FeeAsset } from "./useL1FeeAsset"
import { useL1Wallet } from "./useL1Wallet"

const log = (...args: unknown[]) => console.log("[bridge:fuel]", ...args)

/**
 * The Fuel flow: deposit the L1 fee asset straight into the canonical FeeJuicePortal and claim it as
 * L2 Fee Juice — no swap, no token leg. The deposit always calls `depositToAztecPublic` (the portal has
 * no private variant); privacy is purely the L2-claim concern. The claim itself is built by the engine's
 * variant-aware dep → `fuelClaim.ts` (codex Option C); here we own only the L1 deposit + record creation.
 *
 * Record shape: a deposit with `assetKind:"fee-juice"`, the FJ claim material in the `fuel` block, and
 * `bridge = L2 Fee Juice address` / `portal = FeeJuicePortal` (the Phase-2 deployment binding). PUBLIC
 * also sets the TOP-LEVEL `secret` so the engine's public-claim gate passes (it requires `rec.secret`);
 * the claim builder reads `fuel.secret`. PRIVATE seals the salt (the sole recovery input).
 */
export function useFuelFlow() {
	ensureDepositJournalDeps() // wire the journal engine WITHOUT useDepositFlow's resumeSessionWork watch.
	const ctx: FuelFlowCtx = {
		l1: useL1Wallet(),
		feeAsset: useL1FeeAsset(),
		bridgeWallet: useBridgeWallet(),
		journal: useBridgeJournal(),
		busy: ref(false),
		error: ref<string | null>(null),
	}
	const deposit = (amount: bigint, isPrivate = false, opts: FuelDepositOpts = {}) => runFuelDeposit(ctx, amount, isPrivate, opts)

	// withOperation: an account-sensitive prompt/send span — while it runs, account switching is
	// blocked (useOpsInFlight, plan D-8/D-19).
	return {
		busy: ctx.busy,
		error: ctx.error,
		deposit: (...args: Parameters<typeof deposit>) => withOperation(() => deposit(...args)),
		journal: ctx.journal,
	}
}

type FuelDepositOpts = { onRecord?: (id: string) => void }

interface FuelFlowCtx {
	l1: ReturnType<typeof useL1Wallet>
	feeAsset: ReturnType<typeof useL1FeeAsset>
	bridgeWallet: ReturnType<typeof useBridgeWallet>
	journal: ReturnType<typeof useBridgeJournal>
	busy: Ref<boolean>
	error: Ref<string | null>
}

type FuelWalletClient = NonNullable<ReturnType<FuelFlowCtx["l1"]["ensureWalletClient"]>>
type FuelPlan = { secret: { toString(): string }; secretHash: string; to: string; salt?: { toString(): string } | undefined }

async function runFuelDeposit(ctx: FuelFlowCtx, amount: bigint, isPrivate: boolean, opts: FuelDepositOpts): Promise<string | null> {
	ctx.error.value = null
	const pre = checkFuelPreconditions(ctx)
	if (!pre) return null
	const { wallet, from, recipient, fuelPortal } = pre
	ctx.busy.value = true
	let id: string | null = null
	try {
		// Fail-closed portal/asset cross-check BEFORE any record, signature, approve or deposit: the bundled
		// FeeJuicePortal must actually accept the configured fee asset (its on-chain UNDERLYING()).
		await ctx.feeAsset.verifyPortalAsset()
		const claimer = AztecAddress.fromStringUnsafe(recipient)
		const plan = isPrivate ? await planPrivateFuelDeposit(claimer, amount) : await planPublicFuelDeposit(claimer, amount)
		id = plan.secretHash
		const now = Date.now()
		log("start", { id, amount: amount.toString(), isPrivate })

		// The record exists BEFORE any signature: a storage failure aborts before the user signs, and
		// the stepper narrates from the first prompt. The FJ `received` lands from the deposit event.
		addRecordVerified(buildFuelRecord({ id, amount, isPrivate, recipient, plan, now, portal: fuelPortal }))
		markSessionLive(id)
		opts.onRecord?.(id)

		if (isPrivate && plan.salt) {
			await sealFuelSalt({ id, secret: plan.secret, salt: plan.salt, from, recipient, amount, wallet, portal: fuelPortal })
		}

		// Fuel-only now goes through the router's Permit2 bridge() (tokenPortal = FeeJuicePortal). The
		// canonical fee asset does NOT pre-approve Permit2 (unlike AZLO), so a ONE-TIME approve(Permit2,
		// max) is needed; thereafter it's sign-only. assertUnderlying (feeAsset) stays the fail-closed
		// portal/asset check. The router's isPrivate is ALWAYS false — the FJ portal has no private
		// deposit; record privacy is a claim-side concern (private fuel lands at the FPC via plan.to).
		const cfg = resolveFuelRouterConfig()
		// viem's clients are structurally wider than the leg's minimal surface; same cast the deposit legs use.
		const l1: RouterL1Ctx = { publicClient: ctx.l1.publicClient as never, wallet: wallet as never, from }
		await ensurePermit2Approval({ permit2: cfg.permit2, token: cfg.feeAssetAddr, needed: amount, recordId: id, l1 })
		const { depositTxHash } = await signAndSendRouterBridge(l1, {
			id,
			router: cfg.router,
			permit2: cfg.permit2,
			swapTarget: cfg.swapTarget,
			tokenPortal: cfg.fuelPortalAddr,
			bridgeToken: cfg.feeAssetAddr,
			amount,
			aztecRecipient: plan.to as `0x${string}`,
			secretHash: plan.secretHash as `0x${string}`,
			isPrivate: false,
			prompts: {
				sign: "sign the Fuel deposit in your Ethereum wallet - one signature",
				confirm: "confirm the Fuel deposit in your Ethereum wallet",
			},
		})
		setRecordStep(id, "depositing", "waiting for the Ethereum confirmation")
		const recId = id
		const receipt = await awaitL1Receipt(ctx.l1.publicClient, depositTxHash, {
			onStillWaiting: (attempt) =>
				setRecordStep(recId, "depositing", `still waiting for the Ethereum confirmation (round ${attempt})`),
		})
		await finalizeFuelDeposit(ctx.journal, id, receipt)

		setRecordStep(id, undefined, undefined) // the engine narrates from here.
		await runDepositClaim(id)
		log("fuel flow finished", id)
	} catch (e) {
		const msg = humanizeWalletError(e instanceof Error ? e.message : "Fuel bridge failed")
		log("FAILED:", msg)
		ctx.error.value = msg
		if (id) {
			const override = settleFailedFuelRecord(ctx.journal, id, e, msg)
			if (override !== undefined) ctx.error.value = override
		}
	} finally {
		ctx.busy.value = false
	}
	return id
}

/** The connect/config gates, in their historical order and wording; sets `error` and returns null on the first miss. */
function checkFuelPreconditions(
	ctx: FuelFlowCtx,
): { wallet: FuelWalletClient; from: string; recipient: string; fuelPortal: string } | null {
	const wallet = ctx.l1.ensureWalletClient()
	const from = ctx.l1.address.value
	const aztec = ctx.bridgeWallet.wallet.value
	const recipient = ctx.bridgeWallet.selectedAccount.value
	if (!wallet || !from) {
		ctx.error.value = "Connect your Ethereum wallet first."
		return null
	}
	if (!aztec || !recipient) {
		ctx.error.value = "Connect your Aztec wallet first."
		return null
	}
	if (!FUEL_PORTAL || !FUEL_ASSET) {
		ctx.error.value = "Fuel is not configured for this deployment."
		return null
	}
	return { wallet, from, recipient, fuelPortal: FUEL_PORTAL }
}

/** The Fuel record: always schema 2 with `assetKind: "fee-juice"` and a no-swap fuel block — NOT the
 *  token deposit's `buildDepositRecord` (its schema/fuel semantics are the swap-fueled ones). */
function buildFuelRecord(p: {
	id: string
	amount: bigint
	isPrivate: boolean
	recipient: string
	plan: FuelPlan
	now: number
	portal: string
}): DepositJournalRecord {
	const { id, amount, isPrivate, recipient, plan, now, portal } = p
	return {
		schema: 2,
		id,
		direction: "deposit",
		isPrivate,
		assetKind: "fee-juice",
		amount: amount.toString(),
		createdAt: now,
		updatedAt: now,
		chainId: NETWORK.l1ChainId,
		portal,
		bridge: feeJuiceAddress,
		recipient,
		secretHashHex: id,
		// PUBLIC: the engine's claim gate requires a top-level secret (the builder reads fuel.secret).
		secret: isPrivate ? undefined : plan.secret.toString(),
		fuel: {
			amount: amount.toString(),
			secret: plan.secret.toString(),
			secretHashHex: plan.secretHash,
			minOutput: "0", // no swap — direct Fee-Juice bridge.
			...(isPrivate ? { bridgeSecretSalt: plan.salt?.toString(), fpc: PRIVATE_FPC_ADDRESS } : {}),
		},
	}
}

/** PRIVATE: seal the salt (the sole recovery input for the carrier-less claim). Trust-aware:
 *  one signature steady-state, two on a wallet's first private bridge (the determinism self-test). */
async function sealFuelSalt(p: {
	id: string
	secret: { toString(): string }
	salt: { toString(): string }
	from: string
	recipient: string
	amount: bigint
	wallet: FuelWalletClient
	portal: string
}): Promise<void> {
	const { id, from, recipient, amount, wallet, portal } = p
	const provider = providerFingerprint()
	const trusted = isSealTrusted(localStorage, NETWORK.l1ChainId, from, provider)
	setRecordStep(
		id,
		"sealing",
		trusted ? "one Ethereum signature - encrypts the recovery salt" : "two Ethereum signatures - encrypt + verify",
	)
	const sign = (m: string) => runOnLane("l1", () => wallet.signMessage({ account: from, message: m } as never) as Promise<string>)
	const envelope = {
		secret: p.secret.toString(),
		recipient,
		amount: amount.toString(),
		sealerL1: from,
		salt: p.salt.toString(),
	}
	const { blob } = await sealDepositRecord({
		sign,
		binding: { chainId: NETWORK.l1ChainId, portal, bridge: feeJuiceAddress, secretHashHex: id },
		envelope,
		trusted,
	})
	if (!trusted) markSealTrusted(localStorage, NETWORK.l1ChainId, from, provider)
	cacheSecret(id, p.secret.toString(), { v: 2, ...envelope })
	updateRecord(id, { sealedEnvelope: blob, sealerL1: from })
}

/** The router/permit2/asset/portal quintet, captured into locals — TS re-widens imported (ESM live)
 *  bindings to `| undefined` across `await`. */
function resolveFuelRouterConfig(): {
	router: `0x${string}`
	permit2: `0x${string}`
	swapTarget: `0x${string}`
	feeAssetAddr: `0x${string}`
	fuelPortalAddr: `0x${string}`
} {
	if (!BRIDGE_ROUTER || !BRIDGE_PERMIT2 || !BRIDGE_SWAP_TARGET || !FUEL_ASSET || !FUEL_PORTAL) {
		throw new Error("Fuel router/permit2 not configured for this deployment.")
	}
	return {
		router: BRIDGE_ROUTER,
		permit2: BRIDGE_PERMIT2,
		swapTarget: BRIDGE_SWAP_TARGET,
		feeAssetAddr: FUEL_ASSET,
		fuelPortalAddr: FUEL_PORTAL,
	}
}

/** `received` comes from the portal's DepositToAztecPublic event - the content-hash law; the L2 height
 *  is snapshotted best-effort alongside the leaf index. */
async function finalizeFuelDeposit(journal: FuelFlowCtx["journal"], id: string, receipt: { logs: unknown }): Promise<void> {
	const ev = parseFeeJuiceDeposit(receipt.logs as never)
	const depositL2Block = await bestEffortL2Block()
	const fresh = journal.records.value.find((r) => r.id === id) as DepositJournalRecord | undefined
	updateRecord(id, {
		leafIndex: ev.leafIndex.toString(),
		depositL2Block,
		fuel: {
			...(fresh?.fuel as NonNullable<DepositJournalRecord["fuel"]>),
			received: ev.amount.toString(),
			leafIndex: ev.leafIndex.toString(),
		},
	})
	log("DepositToAztecPublic", { leafIndex: ev.leafIndex.toString(), received: ev.amount.toString() })
}

/** Classify a failed run against its journal record. Returns the user-facing override for the
 *  discard case (a rejection before the deposit was sent), or undefined when the record was flagged. */
function settleFailedFuelRecord(journal: FuelFlowCtx["journal"], id: string, e: unknown, msg: string): string | undefined {
	const rec = journal.records.value.find((r) => r.id === id) as DepositJournalRecord | undefined
	if (rec && !rec.depositTxHash && isUserRejection(e)) {
		// A rejection AFTER the one-time Permit2 approval mined must not read as a no-op — the max
		// allowance stands (harmless: only YOUR signature can spend it; revocable anytime).
		const approvedFirst = !!rec.approveTxHash
		discard(id)
		return approvedFirst
			? "Rejected in your wallet - nothing was bridged. The one-time Permit2 approval from this attempt remains active (only your signature can use it; revocable anytime)."
			: "Rejected in your wallet - nothing was sent."
	}
	if (rec) flagRecordError(id, `${msg}. Your funds are not lost - this bridge stays in Pending.`)
	return undefined
}
