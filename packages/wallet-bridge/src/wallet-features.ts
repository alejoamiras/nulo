/**
 * What this wallet build can route, for a dApp that must know before it asks. The list is static
 * and carries no account, network or balance data, so `getWalletFeatures` needs no grant; a build
 * that predates the method rejects it as unsupported, which a dApp reads as "none of these".
 */

/** A dApp payload naming the account itself as payer with no fee call pays from the Fee Juice
 *  the account already holds (see `classifyFeePayer`). A build without this routes such a payload
 *  as a claim in setup and builds an invalid transaction. */
export const DAPP_SELF_PAY_FEATURE = "dapp-self-pay"

export const WALLET_FEATURES: readonly string[] = Object.freeze([DAPP_SELF_PAY_FEATURE])
