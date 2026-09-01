import { MAINNET_TARGET } from "./src/lib/network-targets"
import { makeFaucetConfig } from "./vite.config"

// Mainnet/Alpha build → tools.nulo.sh. Until Phase 8 deploys the real contracts, this bundles the
// PLACEHOLDER public/mainnet-bridge.json, whose chain identity deliberately mismatches the mainnet
// target so the startup assertion fails closed — a mainnet build cannot silently ship before the real
// manifest is promoted.
export default makeFaucetConfig(MAINNET_TARGET)
