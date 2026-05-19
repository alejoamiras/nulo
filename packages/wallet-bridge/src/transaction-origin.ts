/** Transaction origin — shared vocabulary between the wallet-sdk dispatcher
 *  and the extension's transaction service. The dispatcher tags dApp-initiated
 *  transactions with `OriginType.DAPP`; the UI-initiated path uses
 *  `OriginType.UI`. Kept in wallet-bridge because the enum is a *value*
 *  (not a type-only import) that the dispatcher reads at runtime. */

export enum OriginType {
	UI = 0,
	DAPP = 1,
}

export type TxOrigin = {
	type: OriginType
	name?: string
}

/** Origin for local transactions (UI/DApp). */
export type LocalTxOrigin = {
	type: OriginType.UI | OriginType.DAPP
	name?: string
}
