/**
 * Tests for the production note-schema map.
 *
 * Covers two non-bb.js areas:
 * 1. `canonicalSlotHex` normalization — pure logic.
 * 2. Storage-layout regression gates — read each bundled artifact's
 *    `storageLayout.<field>.slot` and assert it still matches the slot
 *    we hardcoded in `note-schemas.ts`. If a future aztec-packages bump
 *    moves a slot, this test fails loudly instead of the notes viewer
 *    silently falling back to raw-items rendering.
 *
 * The class-id → schema mapping itself goes through `getContractClassFromArtifact`
 * (Poseidon/bb.js). That's exercised end-to-end at runtime + via the
 * NoteService-level tests with synthetic class ids; we don't load real
 * bb.js here because it tends to fault under repeated unit-test calls.
 */
import { describe, expect, test } from "vitest"
import { loadContractArtifact } from "@aztec/stdlib/abi"
import { NFTContractArtifact } from "@aztec/noir-contracts.js/NFT"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
// @ts-expect-error — vite alias
import WonderlandTokenJson from "@wonderland-token-artifact"
// @ts-expect-error — vite alias
import PrivateFPCJson from "@private-fpc-artifact"
import { canonicalSlotHex } from "@nulo/aztec-runtime/pxe"

const slotOf = (artifact: { storageLayout: Record<string, { slot: { value?: bigint } | bigint }> }, field: string): bigint => {
	const slot = artifact.storageLayout[field].slot
	return BigInt((slot as { value?: bigint }).value ?? (slot as bigint))
}

describe("canonicalSlotHex", () => {
	test("strips leading zeros from a padded Fr-string", () => {
		expect(canonicalSlotHex("0x0000000000000000000000000000000000000000000000000000000000000003")).toBe("0x3")
		expect(canonicalSlotHex("0x0000000000000000000000000000000000000000000000000000000000000007")).toBe("0x7")
	})

	test("preserves a short hex unchanged in canonical form", () => {
		expect(canonicalSlotHex("0x3")).toBe("0x3")
		expect(canonicalSlotHex("0x7")).toBe("0x7")
	})

	test("normalizes a decimal Fr-string to lowercase hex", () => {
		expect(canonicalSlotHex("3")).toBe("0x3")
	})

	test("handles 2-digit hex slots without re-padding", () => {
		expect(canonicalSlotHex("0xff")).toBe("0xff")
	})
})

describe("note-schema storage-slot regression gates", () => {
	test("Aztec Token: balances at slot 0x3 (UintNote)", () => {
		expect(slotOf(TokenContractArtifact, "balances")).toBe(0x3n)
	})

	test("Aztec NFT: private_nfts at slot 0x7 (NFTNote)", () => {
		expect(slotOf(NFTContractArtifact, "private_nfts")).toBe(0x7n)
	})

	test("Wonderland Token: private_balances at slot 0x7 (UintNote)", () => {
		const artifact = loadContractArtifact(WonderlandTokenJson)
		expect(slotOf(artifact, "private_balances")).toBe(0x7n)
	})

	test("PrivateFPC: balances at slot 0x1 (UintNote)", () => {
		const artifact = loadContractArtifact(PrivateFPCJson)
		expect(slotOf(artifact, "balances")).toBe(0x1n)
	})
})
