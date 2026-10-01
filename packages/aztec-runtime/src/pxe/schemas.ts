// Modified from Azguard Wallet (https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., Apache-2.0.
import { EventSelector } from "@aztec-labs/stdlib/abi"
import { Fr } from "@aztec-labs/foundation/curves/bn254"
import type { ZodFor } from "@aztec-labs/foundation/schemas"
import { Note, NoteStatus } from "@aztec-labs/stdlib/note"
import { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import { inTxSchema, TxHash } from "@aztec-labs/stdlib/tx"
import { BlockNumberSchema } from "@aztec-labs/foundation/branded-types"
import type { PackedPrivateEvent, NotesFilter } from "@aztec-labs/pxe/client/bundle"
import z from "zod"

export const NoteDaoSchema = z.object({
	note: Note.schema,
	contractAddress: AztecAddress.schema,
	owner: AztecAddress.schema,
	storageSlot: Fr.schema,
	randomness: Fr.schema,
	noteNonce: Fr.schema,
	noteHash: Fr.schema,
	siloedNullifier: Fr.schema,
	txHash: TxHash.schema,
	l2BlockNumber: BlockNumberSchema,
	l2BlockHash: z.string(),
	txIndexInBlock: z.number(),
	noteIndexInTx: z.number(),
})

export const PackedPrivateEventSchema = z.intersection(
	inTxSchema(),
	z.object({
		packedEvent: z.array(Fr.schema),
		eventSelector: EventSelector.schema,
	}),
) satisfies ZodFor<PackedPrivateEvent>

export const NotesFilterSchema = z.object({
	contractAddress: AztecAddress.schema,
	owner: AztecAddress.schema.optional(),
	storageSlot: Fr.schema.optional(),
	status: z.nativeEnum(NoteStatus).optional(),
	siloedNullifier: Fr.schema.optional(),
	scopes: z.array(AztecAddress.schema),
}) satisfies ZodFor<NotesFilter>
