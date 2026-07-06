import { AztecAddress } from "@aztec/aztec.js/addresses"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import type { DepositJournalRecord } from "@nulo/bridge-core"
import {
	type BridgeWitness,
	SWAP_BRIDGE_ROUTER_ABI,
	bridgeWitnessPermitTypedData,
	PRIVATE_FPC_ADDRESS,
	feeJuiceAddress,
	isSealTrusted,
	markSealTrusted,
	parseFeeJuiceDeposit,
	planPrivateFuelDeposit,
	planPublicFuelDeposit,
	sealDepositRecord,
} from "@nulo/bridge-core"
import { sepolia } from "viem/chains"
import { ref } from "vue"
import { BRIDGE_PERMIT2, BRIDGE_ROUTER, BRIDGE_SWAP_TARGET, FUEL_ASSET, FUEL_PORTAL } from "@/contracts/bridge-deployments"
import { ERC20_ABI } from "./useL1Usdc"
import { humanizeWalletError, isUserRejection } from "@/lib/wallet-errors"
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
import { useBridgeWallet } from "./useBridgeWallet"
import { useL1FeeAsset } from "./useL1FeeAsset"
import { useL1Wallet } from "./useL1Wallet"

const log = (...args: unknown[]) => console.log("[bridge:fuel]", ...args)

const NODE_URL = import.meta.env.VITE_AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"

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
	const l1 = useL1Wallet()
	const feeAsset = useL1FeeAsset()
	const bridgeWallet = useBridgeWallet()
	const journal = useBridgeJournal()

	const busy = ref(false)
	const error = ref<string | null>(null)

	async function deposit(amount: bigint, isPrivate = false, opts: { onRecord?: (id: string) => void } = {}): Promise<string | null> {
		error.value = null
		const wallet = l1.ensureWalletClient()
		const from = l1.address.value
		const aztec = bridgeWallet.wallet.value
		const recipient = bridgeWallet.selectedAccount.value
		if (!wallet || !from) {
			error.value = "Connect your Ethereum wallet first."
			return null
		}
		if (!aztec || !recipient) {
			error.value = "Connect your Aztec wallet first."
			return null
		}
		if (!FUEL_PORTAL || !FUEL_ASSET) {
			error.value = "Fuel is not configured for this deployment."
			return null
		}
		busy.value = true
		let id: string | null = null
		try {
			// Fail-closed portal/asset cross-check BEFORE any record, signature, approve or deposit: the bundled
			// FeeJuicePortal must actually accept the configured fee asset (its on-chain UNDERLYING()).
			await feeAsset.verifyPortalAsset()
			const claimer = AztecAddress.fromStringUnsafe(recipient)
			const plan = isPrivate ? await planPrivateFuelDeposit(claimer, amount) : await planPublicFuelDeposit(claimer, amount)
			id = plan.secretHash
			const now = Date.now()
			log("start", { id, amount: amount.toString(), isPrivate })

			// The record exists BEFORE any signature: a storage failure aborts before the user signs, and
			// the stepper narrates from the first prompt. The FJ `received` lands from the deposit event.
			const base: DepositJournalRecord = {
				schema: 2,
				id,
				direction: "deposit",
				isPrivate,
				assetKind: "fee-juice",
				amount: amount.toString(),
				createdAt: now,
				updatedAt: now,
				chainId: sepolia.id,
				portal: FUEL_PORTAL,
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
			addRecordVerified(base)
			markSessionLive(id)
			opts.onRecord?.(id)

			// PRIVATE: seal the salt (the sole recovery input for the carrier-less claim). Trust-aware:
			// one signature steady-state, two on a wallet's first private bridge (the determinism self-test).
			if (isPrivate && plan.salt) {
				const provider = providerFingerprint()
				const trusted = isSealTrusted(localStorage, sepolia.id, from, provider)
				setRecordStep(
					id,
					"sealing",
					trusted ? "one Ethereum signature - encrypts the recovery salt" : "two Ethereum signatures - encrypt + verify",
				)
				const sign = (m: string) =>
					runOnLane("l1", () => wallet.signMessage({ account: from, message: m } as never) as Promise<string>)
				const envelope = {
					secret: plan.secret.toString(),
					recipient,
					amount: amount.toString(),
					sealerL1: from,
					salt: plan.salt.toString(),
				}
				const { blob } = await sealDepositRecord({
					sign,
					binding: { chainId: sepolia.id, portal: FUEL_PORTAL, bridge: feeJuiceAddress, secretHashHex: id },
					envelope,
					trusted,
				})
				if (!trusted) markSealTrusted(localStorage, sepolia.id, from, provider)
				cacheSecret(id, plan.secret.toString(), { v: 2, ...envelope })
				updateRecord(id, { sealedEnvelope: blob, sealerL1: from })
			}

			// Fuel-only now goes through the router's Permit2 bridge() (tokenPortal = FeeJuicePortal). The
			// canonical fee asset does NOT pre-approve Permit2 (unlike AZLO), so a ONE-TIME approve(Permit2,
			// max) is needed; thereafter it's sign-only. assertUnderlying (feeAsset) stays the fail-closed
			// portal/asset check. The router's isPrivate is ALWAYS false — the FJ portal has no private
			// deposit; record privacy is a claim-side concern (private fuel lands at the FPC via plan.to).
			if (!BRIDGE_ROUTER || !BRIDGE_PERMIT2 || !BRIDGE_SWAP_TARGET || !FUEL_ASSET || !FUEL_PORTAL) {
				throw new Error("Fuel router/permit2 not configured for this deployment.")
			}
			// Capture into locals — TS re-widens imported (ESM live) bindings to `| undefined` across `await`.
			const router = BRIDGE_ROUTER
			const permit2 = BRIDGE_PERMIT2
			const swapTarget = BRIDGE_SWAP_TARGET
			const feeAssetAddr = FUEL_ASSET
			const fuelPortalAddr = FUEL_PORTAL
			const p2Allowance = (await l1.publicClient.readContract({
				address: feeAssetAddr,
				abi: ERC20_ABI,
				functionName: "allowance",
				args: [from, permit2],
			})) as bigint
			if (p2Allowance < amount) {
				setRecordStep(id, "approving", "first time only: approve Permit2 in your Ethereum wallet")
				const approveHash = await runOnLane("l1", () =>
					wallet.writeContract({
						address: feeAssetAddr,
						abi: ERC20_ABI,
						functionName: "approve",
						args: [permit2, (1n << 256n) - 1n],
						chain: sepolia,
						account: from,
					}),
				)
				await l1.publicClient.waitForTransactionReceipt({ hash: approveHash })
			}

			setRecordStep(id, "signing", "sign the Fuel deposit in your Ethereum wallet - one signature")
			const nonce = BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`)
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800)
			const fuelWitness: BridgeWitness = {
				tokenPortal: fuelPortalAddr,
				bridgeToken: feeAssetAddr,
				totalAmount: amount,
				fuelAmount: 0n,
				aztecRecipient: plan.to as `0x${string}`,
				fuelRecipient: `0x${"0".repeat(64)}`,
				tokenSecretHash: plan.secretHash as `0x${string}`,
				fuelSecretHash: `0x${"0".repeat(64)}`,
				minFuelOutput: 0n,
				routeHash: `0x${"0".repeat(64)}`,
				isPrivate: false,
				swapTarget: swapTarget,
			}
			const fuelTyped = bridgeWitnessPermitTypedData(
				{ permitted: { token: feeAssetAddr, amount }, spender: router, nonce, deadline },
				fuelWitness,
				permit2,
				sepolia.id,
			)
			const fuelSig = await runOnLane("l1", () => wallet.signTypedData({ account: from, ...fuelTyped } as never))

			setRecordStep(id, "depositing", "confirm the Fuel deposit in your Ethereum wallet")
			const depositTxHash = await runOnLane("l1", () =>
				wallet.writeContract({
					address: router,
					abi: SWAP_BRIDGE_ROUTER_ABI,
					functionName: "bridge",
					args: [
						{
							tokenPortal: fuelPortalAddr,
							bridgeToken: feeAssetAddr,
							amount,
							aztecRecipient: plan.to as `0x${string}`,
							secretHash: plan.secretHash as `0x${string}`,
							isPrivate: false,
						},
						{ nonce, deadline, signature: fuelSig },
					],
					chain: sepolia,
					account: from,
				} as never),
			)
			updateRecord(id, { depositTxHash: depositTxHash as string })
			setRecordStep(id, "depositing", "waiting for the Ethereum confirmation")
			const receipt = await l1.publicClient.waitForTransactionReceipt({ hash: depositTxHash as `0x${string}` })

			// `received` comes from the portal's DepositToAztecPublic event - the content-hash law.
			const ev = parseFeeJuiceDeposit(receipt.logs as never)
			let depositL2Block: number | undefined
			try {
				depositL2Block = Number(await createAztecNodeClient(NODE_URL).getBlockNumber())
			} catch {
				depositL2Block = undefined
			}
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

			setRecordStep(id, undefined, undefined) // the engine narrates from here.
			await runDepositClaim(id)
			log("fuel flow finished", id)
		} catch (e) {
			const msg = humanizeWalletError(e instanceof Error ? e.message : "Fuel bridge failed")
			log("FAILED:", msg)
			error.value = msg
			if (id) {
				const rec = journal.records.value.find((r) => r.id === id) as DepositJournalRecord | undefined
				if (rec && !rec.depositTxHash && isUserRejection(e)) {
					discard(id)
					error.value = "Rejected in your wallet - nothing was sent."
				} else if (rec) {
					flagRecordError(id, `${msg}. Your funds are not lost - this bridge stays in Pending.`)
				}
			}
		} finally {
			busy.value = false
		}
		return id
	}

	return { busy, error, deposit, journal }
}
