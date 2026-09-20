// @vitest-environment node
import { readFileSync, realpathSync } from "node:fs"
import { extractCallStack } from "@aztec/simulator/client"
import { type ContractArtifact, getFunctionDebugMetadata, loadContractArtifact } from "@aztec/stdlib/abi"
import { getContractClassFromArtifact } from "@aztec/stdlib/contract"
import { describe, expect, test } from "vitest"
import { debugStrippedArtifacts } from "../vite.shared"
import { stripArtifactDebugInfo, withoutDebugInfo } from "./strip-artifact-debug-info"

const read = (file: string) => readFileSync(file, "utf8")

type Transform = (this: unknown, code: string, id: string) => { code: string } | undefined
const transformOf = (files: readonly string[]) => stripArtifactDebugInfo(files).transform as unknown as Transform

describe("withoutDebugInfo", () => {
	test("empties file_map and each function's debug_symbols, and leaves every other key as it was", () => {
		const artifact = {
			noir_version: "1",
			name: "T",
			functions: [
				{ name: "f", bytecode: "AA==", debug_symbols: "eJw=" },
				{ name: "g", bytecode: "AQ==", debug_symbols: "eJx=" },
			],
			file_map: { 1: { source: "fn f() {}", path: "f.nr" } },
		}
		expect(JSON.parse(withoutDebugInfo(JSON.stringify(artifact)))).toEqual({
			...artifact,
			functions: artifact.functions.map((fn) => ({ ...fn, debug_symbols: "" })),
			file_map: {},
		})
	})
})

describe("stripArtifactDebugInfo", () => {
	// Vite resolves symlinks before a plugin sees an id, and package files sit behind one.
	test("matches an artifact by the real path Vite hands a plugin", () => {
		const [file] = debugStrippedArtifacts
		const real = realpathSync(file)
		expect(real).not.toBe(file)
		const out = transformOf(debugStrippedArtifacts).call({}, read(file), real)
		expect(JSON.parse(out?.code ?? "{}").file_map).toEqual({})
	})

	test("ignores a query suffix on the id", () => {
		const [file] = debugStrippedArtifacts
		expect(transformOf(debugStrippedArtifacts).call({}, read(file), `${realpathSync(file)}?import`)).toBeDefined()
	})

	test("leaves any other json alone", () => {
		const transform = transformOf(debugStrippedArtifacts)
		expect(transform.call({}, '{"file_map":{"1":{}}}', "/somewhere/else/package.json")).toBeUndefined()
	})
})

describe.each(debugStrippedArtifacts)("%s without its debug info", (file) => {
	const load = (json: string): ContractArtifact => loadContractArtifact(JSON.parse(json))
	const opcodesOf = (artifact: ContractArtifact, name: string) => {
		const fn = artifact.functions.find((candidate) => candidate.name === name)
		const debug = fn && getFunctionDebugMetadata(artifact, fn)
		return { debug, opcodes: Object.keys(debug?.debugSymbols.acir_locations ?? {}) }
	}

	test("keeps its contract class id", async () => {
		const classId = async (json: string) => (await getContractClassFromArtifact(load(json))).id.toString()
		expect(await classId(withoutDebugInfo(read(file)))).toBe(await classId(read(file)))
	})

	// A failing circuit must still surface its own error: upstream hands back the raw opcode
	// locations when an artifact has no debug info, instead of resolving them against sources.
	test("still yields a call stack for a failing opcode, unresolved", () => {
		const full = load(read(file))
		const name = full.functions.find((fn) => opcodesOf(full, fn.name).opcodes.length)?.name
		if (!name) throw new Error("fixture artifact has no function with ACIR debug locations")
		const [opcode] = opcodesOf(full, name).opcodes
		const failure = Object.assign(new Error("circuit failed"), { callStack: [opcode] })
		const stripped = opcodesOf(load(withoutDebugInfo(read(file))), name)

		expect(typeof extractCallStack(failure, opcodesOf(full, name).debug)?.[0]).toBe("object")
		expect(stripped.debug).toBeUndefined()
		expect(extractCallStack(failure, stripped.debug)).toEqual([opcode])
	})
})
