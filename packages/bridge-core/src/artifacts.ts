import { type ContractArtifact, loadContractArtifact } from "@aztec/aztec.js/abi"
// The L2 bridge Noir artifacts (token_minter_proxy + token_bridge). Imported here so the
// browser app can register instances with a PXE without reaching across packages. The JSONs
// are large + gitignored (nargo output); the explicit ContractArtifact return type keeps the
// huge literal from leaking into consumers' typechecks.
import proxyJson from "../../bridge-aztec/token_minter_proxy/target/token_minter_proxy-TokenMinterProxy.json"
import bridgeJson from "../../bridge-aztec/token_bridge/target/token_bridge_contract-TokenBridge.json"

export const bridgeProxyArtifact: ContractArtifact = loadContractArtifact(proxyJson as never)
export const tokenBridgeArtifact: ContractArtifact = loadContractArtifact(bridgeJson as never)

// The Wonderland PrivateFPC artifact (already a loaded ContractArtifact), re-exported from this
// heavy-artifacts entry — NOT the main `@nulo/bridge-core` barrel — so the 2.2 MB JSON stays
// code-split. The faucet dynamic-imports it (mirroring `readPublicFeeJuiceBalance`'s lazy FeeJuice
// import) only when it must read the user's private Fee Juice balance via `PrivateFPC.balance_of`.
export { PrivateFPCContractArtifact } from "@wonderland/aztec-fee-payment/artifacts/private"
