/**
 * Receiver-honest display resolution for incoming receipts (D5-B/D). Maps a discriminated
 * `IncomingTransferRecord` to:
 *  - a THREE-label vocabulary + "Minted" (D7 dropped, so pub→priv is NOT distinguished — it's a
 *    note record shown as "Received privately");
 *  - a "From" treatment that states the truth without ever rendering the MAGIC/zero sentinel as a
 *    raw address.
 */
import { PRIVATE_ADDRESS_MAGIC_VALUE } from "@nulo/aztec-runtime/pxe/public-events"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { IncomingTransferRecord } from "@/wallet/services/incoming-transfer/spec"

const ZERO_ADDRESS = AztecAddress.ZERO.toString().toLowerCase()
const MAGIC = PRIVATE_ADDRESS_MAGIC_VALUE.toLowerCase()

/** The resolved receiver-honest category. */
export type ReceivedType = "received-privately" | "public-to-public" | "private-to-public" | "minted"

/** How the "From" card should render the sender. Never exposes the MAGIC/zero sentinel raw. */
export type FromDisplay =
	| { kind: "address"; address: string } // pub→pub: a real sender address
	| { kind: "private" } // priv→pub: "From private"
	| { kind: "redacted" } // both note kinds: sender not disclosed
	| { kind: "mint" } // from == zero: minted

const isMagic = (from: string): boolean => from.toLowerCase() === MAGIC
const isZero = (from: string): boolean => from.toLowerCase() === ZERO_ADDRESS

/** Resolve the receiver-honest type. Notes are always "Received privately" (D7 dropped). */
export function resolveReceivedType(record: IncomingTransferRecord): ReceivedType {
	if (record.kind === "note") return "received-privately"
	if (isZero(record.from)) return "minted"
	if (isMagic(record.from)) return "private-to-public"
	return "public-to-public"
}

const LABELS: Record<ReceivedType, string> = {
	"received-privately": "Received privately",
	"public-to-public": "Public → Public",
	"private-to-public": "Private → Public",
	minted: "Minted",
}

/** The chip / heading label for a resolved type. */
export function receivedLabel(type: ReceivedType): string {
	return LABELS[type]
}

/** Resolve the "From" card treatment. */
export function resolveFromDisplay(record: IncomingTransferRecord): FromDisplay {
	if (record.kind === "note") return { kind: "redacted" }
	if (isZero(record.from)) return { kind: "mint" }
	if (isMagic(record.from)) return { kind: "private" }
	return { kind: "address", address: record.from }
}
