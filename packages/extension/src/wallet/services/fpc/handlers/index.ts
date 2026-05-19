import type { Fr } from "@aztec/foundation/curves/bn254"
import type { ContractArtifact } from "@aztec/stdlib/abi"
import type { Gas } from "@aztec/stdlib/gas"
import type { Action } from "@/wallet/services/execution/spec"
import { type FpcInfo, FpcType } from "../spec"
import { DefaultSponsoredFpcHandler } from "./default-sponsored-fpc-handler"
import { PrivateFpcHandler } from "./private-fpc-handler"

export interface IFpcHandler {
	validateArtifact(artifact: ContractArtifact): void
	getFeePayload(fpc: FpcInfo, account: string, maxFee: Fr): Action[]
	getTeardownGas(): Gas
	getTotalGas(): Gas
}

export function getFpcHandler(type: FpcType) {
	switch (type) {
		case FpcType.DefaultSponsoredFpc: {
			return new DefaultSponsoredFpcHandler()
		}
		case FpcType.PrivateFpc: {
			return new PrivateFpcHandler()
		}
		default: {
			throw new Error("Invalid FPC type")
		}
	}
}
