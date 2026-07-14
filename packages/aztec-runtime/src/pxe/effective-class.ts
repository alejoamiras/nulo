/**
 * The ONE effective-class resolution seam for 5.0.0's preimage/instance split.
 *
 * Upstream `pxe.getContractInstance` now returns the address PREIMAGE (no `currentContractClassId`
 * — chain-tracked state that only the node knows), while every wallet consumer still keys artifact
 * and selector resolution off the current class id. Two rules, applied where each is honest:
 *
 *  - A NODE-sourced instance carries the real chain-derived current class: if it diverges from the
 *    original, the contract was UPGRADED — unsupported by this wallet, and we fail EXPLICITLY at
 *    entry rather than executing against a stale artifact.
 *  - A PXE-sourced preimage has no current class to compare: `hydratePreimage` fills
 *    `currentContractClassId := originalContractClassId`. That is exact for everything this wallet
 *    registers today (own accounts, tokens, FPCs — none upgradeable) and is the documented residual
 *    for a third-party contract upgraded AFTER registration; upgrade support is a filed follow-up.
 */
import type { ContractInstancePreimageWithAddress, ContractInstanceWithAddress } from "@aztec/stdlib/contract"

/** PXE preimage → effective instance under the no-upgrades assumption (see module doc). */
export function hydratePreimage(preimage: ContractInstancePreimageWithAddress): ContractInstanceWithAddress {
	return { ...preimage, currentContractClassId: preimage.originalContractClassId }
}

/** Node-sourced instances carry chain truth: reject upgraded contracts loudly at entry. */
export function assertNotUpgraded(instance: ContractInstanceWithAddress): ContractInstanceWithAddress {
	if (!instance.currentContractClassId.equals(instance.originalContractClassId)) {
		throw new Error(
			`contract ${instance.address.toString()} has been upgraded on-chain ` +
				`(original class ${instance.originalContractClassId.toString()} -> current ${instance.currentContractClassId.toString()}); ` +
				"upgraded contracts are not supported by this wallet",
		)
	}
	return instance
}
