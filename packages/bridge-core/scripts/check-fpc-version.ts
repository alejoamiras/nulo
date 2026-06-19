/**
 * Pre-P4 fail-closed gate: reconcile the live network's Aztec version against the Wonderland
 * artifact our PrivateFPC address was pinned from. The FPC address is bytecode + @aztec-version
 * specific — depositing real Fee Juice to an address derived from the wrong version is an
 * UNRECOVERABLE loss. Run this (read-only, no keys) before any fund-moving private-fuel run.
 *
 *   AZTEC_NODE_URL=https://v5.testnet.rpc.aztec-labs.com bun packages/bridge-core/scripts/check-fpc-version.ts
 *
 * Exit 0 = the network's major.minor matches the artifact pin. Exit 1 = mismatch (STOP: re-pin via
 * the bridge-core address tripwire + dust-canary on the live net before trusting the address).
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { PRIVATE_FPC_ADDRESS } from "../src/private-fuel"

const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"

function resolvePackageFile(pkg: string, file: string): string {
	const parts = pkg.startsWith("@") ? pkg.split("/").slice(0, 2) : [pkg.split("/")[0]]
	let dir = fileURLToPath(new URL(".", import.meta.url))
	while (dir !== dirname(dir)) {
		const candidate = join(dir, "node_modules", ...parts, file)
		if (existsSync(candidate)) return candidate
		dir = dirname(dir)
	}
	throw new Error(`Cannot find ${pkg}/${file} in any node_modules`)
}

const majorMinor = (v: string): string => v.replace(/^v/, "").split(".").slice(0, 2).join(".")
const major = (v: string): number => Number(v.replace(/^v/, "").split(".")[0])

async function main() {
	const pkg = JSON.parse(readFileSync(resolvePackageFile("@wonderland/aztec-fee-payment", "package.json"), "utf8"))
	// "4.2.0-prerelease.215fd08" → the @aztec line the artifact was compiled against.
	const artifactAztecVersion = String(pkg.version).split("-")[0]

	const res = await fetch(NODE_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "node_getNodeInfo", params: [] }),
	})
	const info = (await res.json()).result as { nodeVersion: string; l1ChainId: number; rollupVersion: number }

	console.log("node URL          :", NODE_URL)
	console.log("network nodeVersion:", info.nodeVersion, `(l1ChainId=${info.l1ChainId}, rollupVersion=${info.rollupVersion})`)
	console.log("artifact @aztec    :", artifactAztecVersion, `(@wonderland/aztec-fee-payment ${pkg.version})`)
	console.log("pinned FPC address :", PRIVATE_FPC_ADDRESS)

	// Aztec testnet is backward-compatible across MINOR bumps — a 4.2.0-compiled contract class is
	// supported + deployed on 4.3.x (confirmed for the live testnet, 2026-06-14). Only a MAJOR bump
	// risks changing the contract-class-id / private-proving so the pinned address or the class is
	// rejected; that is the fail-closed gate. The P4 dust canary stays the authoritative on-net proof.
	if (major(info.nodeVersion) !== major(artifactAztecVersion)) {
		console.error(
			`\n✗ MAJOR VERSION MISMATCH — network ${majorMinor(info.nodeVersion)} vs artifact ${majorMinor(artifactAztecVersion)}.\n` +
				"  A major bump can change contract-class-id / private proving, so the pinned FPC address and the\n" +
				"  4.x-compiled class may not be accepted. Do NOT deposit real Fee Juice until either a matching\n" +
				"  Wonderland artifact is pinned (re-green the bridge-core address tripwire) OR a live dust canary\n" +
				"  round-trips a minimal claim against this address (plan P4).",
		)
		process.exit(1)
	}
	if (majorMinor(info.nodeVersion) !== majorMinor(artifactAztecVersion)) {
		console.log(
			`\n✓ same major; network ${majorMinor(info.nodeVersion)} vs artifact ${majorMinor(artifactAztecVersion)} (minor diff,\n` +
				"  backward-compatible). The dust canary (plan P4) remains the on-network proof before scaling.",
		)
	} else {
		console.log("\n✓ network and artifact major.minor agree.")
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
