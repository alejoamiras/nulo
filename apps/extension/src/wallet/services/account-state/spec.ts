// Modified from Azguard Wallet (https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., Apache-2.0.
import type { ContractArtifact } from "@aztec/stdlib/abi"
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import type { Restored } from "@/wallet/base"

export const ACCOUNT_STATE_SERVICE_NAME = "account-state"

export type BackupSender = {
	address: string
}
export type BackupContract = {
	address: string
	instance: ContractInstanceWithAddress
	artifact: ContractArtifact
}
export type BackupAccountState = {
	networkId: string
	/** The chain the item's network served; the import binds the item to the seeded network
	 *  of this chain, never to the exported id. Absent on older exports. */
	chainId?: number
	senders: Restored<BackupSender>[]
	contracts: Restored<BackupContract>[]
}

export type Methods = {
	/**
	 * Returns a list of registered accounts.
	 * @param networkId Network id.
	 */
	getAccounts(networkId: string): string[]

	/**
	 * Returns a list of registered senders.
	 * @param networkId Network id.
	 */
	getSenders(networkId: string): string[]

	/**
	 * Returns the union of registered sender addresses across every
	 * network in the active profile that reports `Active` node status.
	 * Networks whose status check or `getSenders` call fails are
	 * silently skipped — same precedent as `backup()`. Used by the
	 * contacts export to mark which contacts are senders without
	 * caring about per-network attribution.
	 */
	getSendersAcrossActiveNetworks(): string[]

	/**
	 * Adds a sender.
	 * @param networkId Network id.
	 * @param address Sender address.
	 * @emits `SenderAdded` event.
	 */
	addSender(networkId: string, address: string): string

	/**
	 * Deletes a sender.
	 * @param networkId Network id.
	 * @param address Sender address.
	 * @emits `SenderDeleted` event.
	 */
	deleteSender(networkId: string, address: string): string

	/**
	 * Returns a list of registered contracts.
	 * @param networkId Network id.
	 */
	getContracts(networkId: string): string[]
}

export type Events = {
	/** Emitted when a new sender is added */
	onSenderAdded: string
	/** Emitted when an existing sender is deleted */
	onSenderDeleted: string
}
