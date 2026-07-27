/**
 * STABLE, network-keyed L2 deployer identity (F6 + audit A11). The deploy conductor used to draw
 * `Fr.random()` for both the account secret and salt — a crash after funding orphaned the fee juice
 * at an unrecoverable address. Instead, derive both deterministically from a network-separated env
 * secret: the same secret always yields the same L2 account, so the deployer is pre-fundable and a
 * crashed run resumes control by re-running with the same env.
 *
 * Network separation is double-walled: separate env vars (`BRIDGE_DEPLOYER_SECRET_TESTNET` /
 * `BRIDGE_DEPLOYER_SECRET_MAINNET`) AND a network-tagged derivation domain — so even an identical
 * raw secret yields DIFFERENT accounts per network (keys never cross networks, DP4).
 *
 * The secret stays in the operator's env — never journaled, printed, or persisted; the derived
 * ADDRESS is what the journal records.
 */
import { createHash } from "node:crypto"
import { Fr } from "@aztec/aztec.js/fields"

export type DeployerNetwork = "testnet" | "mainnet"

const ENV_NAMES: Record<DeployerNetwork, string> = {
	testnet: "BRIDGE_DEPLOYER_SECRET_TESTNET",
	mainnet: "BRIDGE_DEPLOYER_SECRET_MAINNET",
}

/** sha256(domain) truncated to 31 bytes — always < the BN254 field modulus, so Fr parsing never wraps. */
function deriveField(domain: string): Fr {
	const digest = createHash("sha256").update(domain).digest("hex")
	return Fr.fromHexString(`0x${digest.slice(0, 62)}`)
}

/** Fail-closed: throws when the network's deployer secret is missing or too short. */
export function resolveDeployerKeys(
	network: DeployerNetwork,
	env: Record<string, string | undefined> = process.env,
): { secret: Fr; salt: Fr } {
	const name = ENV_NAMES[network]
	const raw = env[name]
	if (!raw || raw.length < 16) {
		throw new Error(
			`${name} is required (>= 16 chars) — the STABLE ${network} L2 deployer secret. Losing it after ` +
				"funding orphans the deployer's fee juice; store it like a key, never commit it. STOP.",
		)
	}
	return {
		secret: deriveField(`nulo-bridge-deployer:secret:${network}:${raw}`),
		salt: deriveField(`nulo-bridge-deployer:salt:${network}:${raw}`),
	}
}
