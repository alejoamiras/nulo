/**
 * The wallet's chain id. Persisted rows, storage scopes and dApp-session keys carry it, so its
 * value is frozen: an unsigned 32-bit `number`, never signed, bigint or hex.
 */
export function walletChainId(l1ChainId: number, rollupVersion: number): number {
	return (l1ChainId ^ rollupVersion) >>> 0
}
