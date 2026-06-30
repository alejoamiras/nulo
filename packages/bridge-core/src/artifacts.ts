import { type ContractArtifact, loadContractArtifact } from "@aztec/aztec.js/abi"
// The L2 bridge Noir artifacts (token_minter_proxy + token_bridge). Imported here so the
// browser app can register instances with a PXE without reaching across packages. The JSONs
// are large + gitignored (nargo output); the explicit ContractArtifact return type keeps the
// huge literal from leaking into consumers' typechecks.
import proxyJson from "../../../contracts/bridge/aztec/token_minter_proxy/target/token_minter_proxy-TokenMinterProxy.json"
import bridgeJson from "../../../contracts/bridge/aztec/token_bridge/target/token_bridge_contract-TokenBridge.json"

export const bridgeProxyArtifact: ContractArtifact = loadContractArtifact(proxyJson as never)
export const tokenBridgeArtifact: ContractArtifact = loadContractArtifact(bridgeJson as never)
