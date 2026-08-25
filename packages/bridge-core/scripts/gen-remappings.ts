/**
 * Generates `contracts/bridge/evm/remappings.txt` with the `@aztec/` remap
 * resolved through THIS workspace's declared `@aztec/l1-artifacts` dependency.
 *
 * Why generated: `foundry.toml`'s static `../../../node_modules/...` remap
 * assumes the hoisted node_modules layout. Foundry gives `remappings.txt`
 * priority over the TOML remappings, so writing the resolved path here keeps
 * `forge` working under BOTH linkers without committing a machine path (the
 * file is gitignored). The four layout-independent remaps are repeated so the
 * override file is complete — Foundry treats remappings.txt as the full set.
 *
 * Run before any forge invocation in `contracts/bridge/evm` (verify-l1.ts does
 * this automatically): `bun scripts/gen-remappings.ts` from packages/bridge-core.
 */
import { existsSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolvePackageAsset } from "@nulo/resolve-asset"
import { run } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
export const EVM_ROOT = join(here, "..", "..", "..", "contracts", "bridge", "evm")

export function generateRemappings(): string {
	const aztecSrc = `${resolvePackageAsset("@aztec/l1-artifacts", "l1-contracts/src", { from: import.meta.url })}/`
	const lines = [
		"@oz/=lib/openzeppelin-contracts/contracts/",
		`@aztec/=${aztecSrc}`,
		"@uniswap/v4-core/=lib/v4-core/",
		"@test/=test/",
		"forge-std/=lib/forge-std/src/",
	]
	const target = join(EVM_ROOT, "remappings.txt")
	// Per-process temp name: concurrent verify runs must not rename each other's file.
	const tmp = `${target}.${process.pid}.tmp`
	writeFileSync(tmp, `${lines.join("\n")}\n`)
	renameSync(tmp, target)
	return target
}

/** Asserts forge actually sees the generated `@aztec/` mapping (and records the forge version). */
export function assertEffectiveRemapping(forgeBin: string): void {
	const version = run(forgeBin, ["--version"], { check: false })
	if (version.code !== undefined || version.exitCode !== 0) {
		throw new Error(`forge not runnable at ${forgeBin}: ${version.code ?? version.stderr}`)
	}
	const remaps = run(forgeBin, ["remappings"], { cwd: EVM_ROOT, check: false })
	if (remaps.code !== undefined || remaps.exitCode !== 0) {
		throw new Error(`forge remappings failed: ${remaps.code ?? remaps.stderr}`)
	}
	const aztecLine = remaps.stdout.split("\n").find((l) => l.startsWith("@aztec/="))
	const expected = `${resolvePackageAsset("@aztec/l1-artifacts", "l1-contracts/src", { from: import.meta.url })}/`
	// Exact-line equality: a substring match would accept `${expected}extra/` and
	// defeat the stale/unexpected-target rejection this assertion exists for.
	if (aztecLine?.trim() !== `@aztec/=${expected}`) {
		throw new Error(
			`forge (${version.stdout.split("\n")[0]}) does not see the generated @aztec/ remap.\n` +
				`effective: ${aztecLine ?? "<none>"}\nexpected suffix: ${expected}`,
		)
	}
	console.log(`remappings OK — ${version.stdout.split("\n")[0]} sees @aztec/=${expected}`)
}

const isMain = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false
if (isMain) {
	const target = generateRemappings()
	console.log(`wrote ${target}`)
	if (!existsSync(join(EVM_ROOT, "lib", "forge-std"))) {
		console.warn("note: contracts/bridge/evm/lib is not populated — forge assertions skipped")
	}
}
