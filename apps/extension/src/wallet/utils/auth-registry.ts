import { STANDARD_AUTH_REGISTRY_ADDRESS } from "@aztec/standard-contracts/auth-registry/constants"
import { Fr } from "@aztec/foundation/curves/bn254"
import { type FunctionAbi, FunctionSelector, FunctionType } from "@aztec/stdlib/abi"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { deriveStorageSlotInMap } from "@aztec/stdlib/hash"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"

// Auth Registry storage slots, in the upstream contract's declaration order: the
// AuthRegistry `#[storage]` struct declares `reject_all` FIRST (slot 1) then
// `approved_actions` SECOND (slot 2) — see @aztec/noir-contracts.js
// auth_registry_contract `main.nr`. These were previously swapped, so
// `isAuthwitConsumable` + `isAuthRegistryEnabled` read the wrong public storage:
// a granted/revoked authwit read as the reject_all map and vice-versa, so a revoke
// could never be confirmed on-chain and a fast follow-up consume raced the
// not-yet-mined revoke. AUDIT F1: pinned by auth-registry.test.ts.
const REJECT_ALL_SLOT = new Fr(1)
const APPROVED_ACTIONS_SLOT = new Fr(2)

// 5.0 demoted auth_registry from a protocol contract (hardcoded slot 1) to a standard contract;
// its address is now derived from the artifact and shipped as a precomputed AztecAddress.
export const getAuthRegistryAddress = () => STANDARD_AUTH_REGISTRY_ADDRESS

export const getSetAuthorizedFn = () =>
	({
		name: "set_authorized",
		functionType: FunctionType.PUBLIC,
		isOnlySelf: false,
		isStatic: false,
		isInitializer: false,
		parameters: [
			{
				name: "message_hash",
				type: { kind: "field" },
				visibility: "private",
			},
			{
				name: "authorize",
				type: { kind: "boolean" },
				visibility: "private",
			},
		],
		returnTypes: [],
		errorTypes: {},
	}) as FunctionAbi

export const getSetAuthorizedSelector = async () => {
	const fn = getSetAuthorizedFn()
	return await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters)
}

export const isAuthwitConsumable = async (node: AztecNode, account: string, message_hash: string) => {
	const slot = await deriveStorageSlotInMap(
		await deriveStorageSlotInMap(APPROVED_ACTIONS_SLOT, AztecAddress.fromString(account)),
		Fr.fromString(message_hash),
	)
	const approved = await node.getPublicStorageAt("latest", getAuthRegistryAddress(), slot)
	return !approved.isZero()
}

export const isAuthRegistryEnabled = async (node: AztecNode, account: string) => {
	const slot = await deriveStorageSlotInMap(REJECT_ALL_SLOT, AztecAddress.fromString(account))
	const rejectAll = await node.getPublicStorageAt("latest", getAuthRegistryAddress(), slot)
	return rejectAll.isZero()
}
