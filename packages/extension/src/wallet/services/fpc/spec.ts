export const FPC_SERVICE_NAME = "fpc"

/**
 * Numeric values are explicit so a stale popup posting `type: 0`
 * (the deprecated DefaultFpc / Token FPC slot) fails a runtime check
 * in `addFpc` instead of silently mapping to a valid handler.
 */
export enum FpcType {
	DefaultSponsoredFpc = 1,
	PrivateFpc = 2,
}

/** On-disk shape (storage). `isProtocol` is computed at read time and
 * NOT persisted — see `FpcService.decorate`. */
export type FpcInfo = {
	id: string
	profileId: string
	chainId: number
	type: FpcType
	address: string
	name?: string
	/** Set by the service before returning over RPC; never stored. */
	isProtocol?: boolean
}

export type Methods = {
	/**
	 * Returns a list of FPCs.
	 * @param chainId Filter by chain id.
	 */
	getFpcs(chainId?: number): FpcInfo[]

	/**
	 * Returns a FPC with the specified id.
	 * @param id FPC id.
	 * @throws "Profile locked" if profile is locked.
	 * @throws "Invalid id" if the fpc with the specified id doesn't exist within the active profile.
	 */
	getFpc(id: string): FpcInfo

	/**
	 * Adds a new FPC.
	 * @param networkId Network id.
	 * @param type FPC type.
	 * @param address FPC address.
	 * @param name Alias name.
	 */
	addFpc(networkId: string, type: FpcType, address: string, name?: string): FpcInfo

	/**
	 * Renames an FPC. Rejects with "Cannot rename protocol FPC" if the
	 * target is auto-discovered SponsoredFPC or PrivateFPC.
	 */
	updateFpc(id: string, name: string): FpcInfo

	/**
	 * Replaces the FPC's address. The new address must (a) be registered
	 * in PXE (or registrable from the network), (b) implement the same
	 * FPC type as the existing entry. Allowed on protocol rows.
	 */
	updateFpcAddress(id: string, address: string): FpcInfo

	/**
	 * Deletes an FPC. Rejects with "Cannot delete protocol FPC" if the
	 * target is auto-discovered SponsoredFPC or PrivateFPC.
	 */
	deleteFpc(id: string): FpcInfo
}

export type Events = {
	/** Emitted when a new FPC is added */
	onFpcAdded: FpcInfo
	/** Emitted when an existing FPC is updated */
	onFpcUpdated: FpcInfo
	/** Emitted when an existing FPC is deleted */
	onFpcDeleted: FpcInfo
}
