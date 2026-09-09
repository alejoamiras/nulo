/** The sandbox deploys the bridge from Foundry's `out/` artifacts, which are gitignored. A fresh
 *  checkout (CI included) gets them built here, with the same remappings the contract suite uses. */
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { aztecPin } from "./local-network"

const here = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(here, "..", "..")
const EVM_ROOT = resolve(PACKAGE_ROOT, "..", "..", "contracts", "bridge", "evm")

/** The forge the pinned Aztec toolchain bundles, so the sandbox and the L1 deploy agree on a
 *  compiler; PATH's forge is the fallback for a machine without that toolchain. */
function forgeBin(): string {
	const bundled = join(homedir(), ".aztec", "versions", aztecPin(), "internal-bin", "forge")
	return existsSync(bundled) ? bundled : "forge"
}

export function ensureForgeArtifacts(names: string[] = ["MockSwapTarget", "MintableERC20", "PortalFactory", "SwapBridgeRouter"]): void {
	const missing = names.filter((n) => !existsSync(join(EVM_ROOT, "out", `${n}.sol`, `${n}.json`)))
	if (missing.length === 0) return
	if (!existsSync(join(EVM_ROOT, "lib", "forge-std"))) {
		throw new Error(`${EVM_ROOT}/lib is missing — run the pinned \`forge install\` from contracts/bridge/evm/README.md first`)
	}
	console.log(`[sandbox] building forge artifacts (${missing.join(", ")} missing)`)
	execFileSync("bun", ["scripts/gen-remappings.ts"], { cwd: PACKAGE_ROOT, stdio: "inherit" })
	execFileSync(forgeBin(), ["build", "--root", EVM_ROOT], { stdio: "inherit" })
}
