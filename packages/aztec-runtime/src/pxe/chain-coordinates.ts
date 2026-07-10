/**
 * Codec for the `(profileId, chainId)` coordinate that identifies a PXE runtime.
 *
 * The pair was string-encoded inline in ~7 places, two different ways:
 * `${profileId}:${chainId}` (the `ChainRuntimeRegistry` + per-chain guard key)
 * and `pxe/${profileId}/${chainId}` (the PXE IndexedDB data directory + name).
 * The `pxe/...` form is **PERSISTED on disk**, so the exact strings here are
 * load-bearing — changing them orphans a user's existing PXE databases.
 * Centralized so the two encodings + their profile-scoped prefixes can't drift.
 */
export type ChainCoordinates = {
	profileId: string
	chainId: number
}

/** Root of every PXE IndexedDB name. */
export const PXE_DATA_DIR_ROOT = "pxe/"

/** Registry / per-chain-guard key: `${profileId}:${chainId}`. */
export function chainRegistryKey({ profileId, chainId }: ChainCoordinates): string {
	return `${profileId}:${chainId}`
}

/** Prefix matching every registry key under one profile: `${profileId}:`. */
export function chainRegistryKeyPrefix(profileId: string): string {
	return `${profileId}:`
}

/** PXE IndexedDB data directory + name: `pxe/${profileId}/${chainId}`. PERSISTED — do not drift. */
export function chainDataDir({ profileId, chainId }: ChainCoordinates): string {
	return `${PXE_DATA_DIR_ROOT}${profileId}/${chainId}`
}

/** Prefix matching every PXE DB under one profile: `pxe/${profileId}/`. */
export function chainDataDirPrefix(profileId: string): string {
	return `${PXE_DATA_DIR_ROOT}${profileId}/`
}
