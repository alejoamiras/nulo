/**
 * Pre-P4 fail-closed gate: reconcile the live network's Aztec version against the Wonderland
 * artifact our PrivateFPC address was pinned from. The FPC address is bytecode + @aztec-version
 * specific — depositing real Fee Juice to an address derived from the wrong version is an
 * UNRECOVERABLE loss. Run this (read-only, no keys) before any fund-moving private-fuel run.
 *
 *   AZTEC_NODE_URL=https://rpc.testnet.aztec-labs.com bun packages/bridge-core/scripts/check-fpc-version.ts
 *
 * Exit 0 = the network's major.minor matches the artifact pin. Exit 1 = mismatch (STOP: re-pin via
 * the bridge-core address tripwire + dust-canary on the live net before trusting the address).
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { PRIVATE_FPC_ADDRESS } from "../src/private-fuel"

const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://rpc.testnet.aztec-labs.com"

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

	if (majorMinor(info.nodeVersion) !== majorMinor(artifactAztecVersion)) {
		console.error(
			`\n✗ VERSION MISMATCH — network ${majorMinor(info.nodeVersion)} vs artifact ${majorMinor(artifactAztecVersion)}.\n` +
				"  The pinned FPC address may not be the one the network recognizes. Do NOT deposit real Fee Juice\n" +
				"  until: (1) a matching Wonderland artifact is pinned + the bridge-core address tripwire re-greened,\n" +
				"  OR (2) a live dust-canary round-trips a minimal claim against this exact address (see plan P4).",
		)
		process.exit(1)
	}
	console.log("\n✓ network and artifact major.minor agree.")
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
