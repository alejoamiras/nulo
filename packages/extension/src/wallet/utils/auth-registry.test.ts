import { Fr } from "@aztec/foundation/curves/bn254"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { beforeEach, describe, expect, test, vi } from "vitest"

// `deriveStorageSlotInMap` uses poseidon2 (Barretenberg WASM), which isn't
// initialized in the jsdom unit env — and we don't need the real hash here. We
// only need to prove which MAP SLOT each reader passes, i.e. that the slot
// CONSTANTS are correct. So mock the derivation and assert its first argument.
const { deriveMock } = vi.hoisted(() => ({
	deriveMock: vi.fn(async (_mapSlot: Fr, _key: unknown): Promise<Fr> => new Fr(0x999n)),
}))
vi.mock("@aztec/stdlib/hash", () => ({ deriveStorageSlotInMap: deriveMock }))

import { isAuthRegistryEnabled, isAuthwitConsumable } from "./auth-registry"

// AUDIT F1: the AuthRegistry `#[storage]` struct declares `reject_all` FIRST
// (slot 1) then `approved_actions` SECOND (slot 2). These were once swapped, so
// isAuthwitConsumable + isAuthRegistryEnabled read the wrong public storage and a
// revoked authwit read as still-unknown. Pin the read slots so a re-swap fails
// here, not in a flaky network e2e.
describe("auth-registry read slots (AUDIT F1)", () => {
	const account = AztecAddress.fromNumber(0x1234).toString()
	const messageHash = new Fr(0x5678n).toString()

	beforeEach(() => deriveMock.mockClear())

	test("isAuthwitConsumable reads the approved_actions map (slot 2)", async () => {
		const getPublicStorageAt = vi.fn(async () => new Fr(1n)) // non-zero ⇒ approved
		const node = { getPublicStorageAt } as unknown as AztecNode

		await expect(isAuthwitConsumable(node, account, messageHash)).resolves.toBe(true)

		// First derivation keys the OUTER map by its slot constant.
		expect(deriveMock.mock.calls[0]?.[0].toBigInt()).toBe(2n)
		// approved_actions is a nested Map ⇒ a second derivation by message_hash.
		expect(deriveMock).toHaveBeenCalledTimes(2)
	})

	test("isAuthRegistryEnabled reads the reject_all map (slot 1)", async () => {
		const getPublicStorageAt = vi.fn(async () => new Fr(0n)) // zero ⇒ not reject-all ⇒ enabled
		const node = { getPublicStorageAt } as unknown as AztecNode

		await expect(isAuthRegistryEnabled(node, account)).resolves.toBe(true)

		expect(deriveMock.mock.calls[0]?.[0].toBigInt()).toBe(1n)
		// reject_all is a single-level Map ⇒ exactly one derivation.
		expect(deriveMock).toHaveBeenCalledTimes(1)
	})

	test("a non-zero approved slot ⇒ consumable; zero ⇒ not", async () => {
		const approved = { getPublicStorageAt: vi.fn(async () => new Fr(7n)) } as unknown as AztecNode
		const revoked = { getPublicStorageAt: vi.fn(async () => new Fr(0n)) } as unknown as AztecNode
		await expect(isAuthwitConsumable(approved, account, messageHash)).resolves.toBe(true)
		await expect(isAuthwitConsumable(revoked, account, messageHash)).resolves.toBe(false)
	})
})
