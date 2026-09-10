/**
 * Another submitter claiming a deposit the page journaled: the sandbox relayer, through the same
 * hub path the integration suite drives. The page's record supplies exactly what a public claim
 * needs — the token block, the recipient, the amount, the raw secret, the leaf index — so what the
 * cell then proves is the UI's own behaviour on finding its message already consumed.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { SendResult } from "@nulo/bridge-core"
import { claim } from "@nulo/bridge-core/sandbox"
import type { ActorHandle } from "../fixtures/test"
import type { JournalDeposit } from "./journal"

export async function claimAsRelayer(actor: ActorHandle, rec: JournalDeposit): Promise<string> {
	if (!rec.token || !rec.recipient || !rec.amount || !rec.secret || !rec.leafIndex || !rec.messageHash)
		throw new Error(`the record ${rec.id} lacks what a relayed public claim needs`)
	if (rec.isPrivate) throw new Error("a relayed claim needs the public secret; this record is private")
	const res = {
		token: rec.token,
		tokenClaimValueHex: rec.secret,
		tokenLeafIndex: BigInt(rec.leafIndex),
		tokenMessageHashHex: rec.messageHash,
	} as unknown as SendResult
	const outcome = await claim(actor.s, res, {
		amount: BigInt(rec.amount),
		isPrivate: false,
		recipient: AztecAddress.fromStringUnsafe(rec.recipient),
		submitter: "relayer",
	})
	return outcome.claimTxHash
}
