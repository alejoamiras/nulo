/**
 * Whether the sponsor that pays an estimate can cover its fee: the node refuses a transaction whose
 * fee payer's public Fee Juice, plus any setup-phase Fee Juice claim to it, is below
 * `gasSettings.getFeeLimit()` (Σ maxFeesPerGas × gasLimits, teardown excluded), and accepts at
 * equality. Nulo builds no claim to a sponsor, so the balance alone decides; a sponsor contract
 * that claims to itself during setup can read short.
 */

import { type PublicStorageReader, readPublicFeeJuiceBalance } from "@/wallet/utils/fee-juice-balance"
import type { FeeEstimate } from "./fee/fee-strategy"
import type { SponsorFunding } from "./spec"

export const SPONSOR_PROBE_TIMEOUT_MS = 5_000

type ProbeOutcome = "funded" | "short" | "failed"

/**
 * The verdict on `built`'s sponsor, or `undefined` when no sponsor pays or the read fails. Logs one
 * fixed line per probe: an RPC error can carry addresses, figures or the endpoint URL.
 */
export async function probeSponsorFunding(
	built: FeeEstimate,
	read: PublicStorageReader,
	log: (msg: string, data: { outcome: ProbeOutcome }) => void,
): Promise<SponsorFunding | undefined> {
	const { sponsor } = built
	if (!sponsor) return undefined
	let funded: boolean
	try {
		const balance = await readPublicFeeJuiceBalance(read, built.network, sponsor.address, SPONSOR_PROBE_TIMEOUT_MS)
		funded = balance >= built.txRequest.txContext.gasSettings.getFeeLimit().toBigInt()
	} catch {
		log("sponsor probe", { outcome: "failed" })
		return undefined
	}
	log("sponsor probe", { outcome: funded ? "funded" : "short" })
	return { fpcId: sponsor.fpcId, address: sponsor.address.toString(), funded }
}
