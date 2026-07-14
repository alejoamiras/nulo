/**
 * Fail-closed PrivateFPC gate: reconcile the live network, the installed fee-payment artifact, and
 * the canonical descriptor (`src/private-fpc-canonical.json`) before ANY fund-moving private-fuel
 * step. The FPC address is bytecode + @aztec-version + salt specific — depositing real Fee Juice to
 * an address derived from the wrong artifact is an UNRECOVERABLE loss.
 *
 *   AZTEC_NODE_URL=https://v5.testnet.rpc.aztec-labs.com bun packages/bridge-core/scripts/check-fpc-version.ts
 *
 * Checks (ALL must hold — exit 1 otherwise):
 *   1. EXACT full-version agreement: installed package == descriptor == live nodeVersion. No
 *      prerelease-stripping, no major-only compare — "5.0.0-rc.2" vs a 5.0.0 node FAILS (the old
 *      gate's false-green; a version bump is exactly the op that opens the loss window).
 *   2. Artifact digest: sha256 of the installed artifact == descriptor.artifactSha256.
 *   3. Descriptor/constants coherence: descriptor address+salt == the exported pins.
 *   4. Live class: if the pinned address is already deployed, its ORIGINAL class id must equal the
 *      class id computed from the installed artifact (a different class at our address = wrong
 *      contract — never deposit). An RPC failure is an ERROR (exit 1), never treated as absence;
 *      clean absence is fine (the deploy script creates it).
 *
 * Read-only, no keys. The live dust canary (pre-promotion) stays the authoritative on-net proof.
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { loadContractArtifact } from "@aztec/stdlib/abi"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { getContractClassFromArtifact, getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract"
import { Fr } from "@aztec/foundation/curves/bn254"

import { PRIVATE_FPC_ADDRESS, PRIVATE_FPC_SALT } from "../src/private-fuel"

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

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
	const res = await fetch(NODE_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	})
	if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`)
	const body = (await res.json()) as { result?: T; error?: { message: string } }
	if (body.error) throw new Error(`${method}: RPC error — ${body.error.message}`)
	// A response with NEITHER `result` nor `error` is malformed — an ERROR, never a clean absence.
	// (Valid absence returns `result: null`, which is present-but-null and passes this guard.)
	if (!("result" in body)) throw new Error(`${method}: malformed RPC response (no result, no error)`)
	return body.result as T
}

const fail = (msg: string): never => {
	console.error(`\n✗ ${msg}`)
	process.exit(1)
}

async function main() {
	const here = fileURLToPath(new URL(".", import.meta.url))
	const descriptor = JSON.parse(readFileSync(join(here, "..", "src", "private-fpc-canonical.json"), "utf8")) as {
		aztecVersion: string
		salt: string
		expectedAddress: string
		artifactSha256: string
	}
	const pkg = JSON.parse(readFileSync(resolvePackageFile("@alejoamiras/aztec-fee-payment", "package.json"), "utf8"))
	const artifactBytes = readFileSync(resolvePackageFile("@alejoamiras/aztec-fee-payment", "target/private_contract-PrivateFPC.json"))

	const info = await rpc<{ nodeVersion: string; l1ChainId: number; rollupVersion: number }>("node_getNodeInfo", [])

	console.log("node URL           :", NODE_URL)
	console.log("network nodeVersion:", info.nodeVersion, `(l1ChainId=${info.l1ChainId}, rollupVersion=${info.rollupVersion})`)
	console.log("installed package  :", String(pkg.version), "| descriptor:", descriptor.aztecVersion)
	console.log("pinned FPC address :", PRIVATE_FPC_ADDRESS, `(salt ${PRIVATE_FPC_SALT})`)

	// 3. Descriptor/constants coherence (also machine-asserted in private-fuel.test.ts).
	if (descriptor.expectedAddress !== PRIVATE_FPC_ADDRESS || descriptor.salt !== PRIVATE_FPC_SALT) {
		fail("descriptor/constants drift — private-fpc-canonical.json disagrees with the private-fuel.ts pins.")
	}

	// 3b. Re-derive the address from the INSTALLED artifact + canonical salt + zero deployer, and bind
	// it to the pin. Without this, descriptor+constant could be coherently edited to an arbitrary
	// (absent) address and still pass version+digest — the standalone gate would green a wrong pin.
	const rederived = (
		await getContractInstanceFromInstantiationParams(loadContractArtifact(JSON.parse(artifactBytes.toString("utf8"))), {
			constructorArgs: [],
			salt: Fr.fromHexString(PRIVATE_FPC_SALT),
			deployer: AztecAddress.ZERO,
		})
	).address.toString()
	if (rederived !== PRIVATE_FPC_ADDRESS) {
		fail(`re-derived address ${rederived} (from the installed artifact + canonical salt) != pinned ${PRIVATE_FPC_ADDRESS}.`)
	}

	// 1. EXACT version agreement across all three sources.
	if (String(pkg.version) !== descriptor.aztecVersion) {
		fail(`installed @alejoamiras/aztec-fee-payment ${pkg.version} != descriptor aztecVersion ${descriptor.aztecVersion}.`)
	}
	if (info.nodeVersion !== descriptor.aztecVersion) {
		fail(
			`network nodeVersion ${info.nodeVersion} != pinned artifact version ${descriptor.aztecVersion} — ` +
				"EXACT match required (a version bump is exactly the operation that opens the unrecoverable-deposit window).",
		)
	}

	// 2. Artifact digest.
	const digest = createHash("sha256").update(artifactBytes).digest("hex")
	if (digest !== descriptor.artifactSha256) {
		fail(`installed artifact sha256 ${digest} != descriptor ${descriptor.artifactSha256}.`)
	}

	// 4. Live class at the pinned address (RPC failure = error, NOT absence).
	const expectedClassId = (await getContractClassFromArtifact(loadContractArtifact(JSON.parse(artifactBytes.toString("utf8"))))).id
	const live = await rpc<{ originalContractClassId?: string; currentContractClassId?: string } | null>("node_getContract", [
		PRIVATE_FPC_ADDRESS,
	])
	// (RPC failure already threw above; a malformed no-result response now throws too — never absence.)
	if (live) {
		const expected = expectedClassId.toString()
		const originalClass = String(live.originalContractClassId ?? "")
		// BOTH ids must equal the expected class. Checking only `original` would GREEN an UPGRADED
		// contract: its original class stays correct while `current` points at different/malicious
		// code that actually runs — and deposits to it can be consumed or stranded (fund loss).
		const currentClass = String(live.currentContractClassId ?? "")
		if (originalClass !== expected) {
			fail(
				`the pinned address is DEPLOYED with original class ${originalClass}, but the installed artifact ` +
					`computes ${expected} — wrong contract at our address; never deposit.`,
			)
		}
		if (currentClass !== expected) {
			fail(
				`the pinned address has been UPGRADED (current class ${currentClass} != expected ${expected}) — ` +
					"the running code is not the pinned artifact; never deposit.",
			)
		}
		console.log("live contract      : DEPLOYED with the expected class (original == current ==", `${expected})`)
	} else {
		console.log("live contract      : absent (clean) — deploy via deploy-private-fpc-testnet.ts")
	}

	console.log("\n✓ FPC gate green — exact version + digest + live class all agree.")
}

main().catch((err) => {
	console.error("\n✗ gate errored (treat as RED — an RPC failure is never absence):", err instanceof Error ? err.message : err)
	process.exit(1)
})
