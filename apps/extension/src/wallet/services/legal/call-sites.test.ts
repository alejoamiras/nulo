import { readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, test } from "vitest"

/**
 * The Terms gate is only as good as two structural facts a refactor can quietly undo: every
 * broadcast crosses ONE line, and the refusal is reachable from exactly the places that were
 * reasoned about. Textual on purpose — aliasing defeats it, which is what review is for.
 */

const SRC = resolve(__dirname, "../../..")

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) return walk(path)
		return /\.(ts|vue)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : []
	})
}

const files = walk(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }))
const filesMatching = (pattern: RegExp) => files.filter((file) => pattern.test(file.text)).map((file) => file.path)

describe("the Terms wall", () => {
	test("the wallet broadcasts from exactly one place", () => {
		expect(filesMatching(/\bnode\.sendTx\(/)).toEqual(["wallet/services/execution/execution-coordinator.ts"])
	})

	test("at that place: acceptance, then liveness, then the send — in that order, with no other await between", () => {
		const text = files.find((file) => file.path === "wallet/services/execution/execution-coordinator.ts")?.text ?? ""
		expect(text.match(/\bnode\.sendTx\(/g)).toHaveLength(1)
		expect(text).toMatch(/await this\.legal\.assertCurrent\(\)\n\s*assertLive\(\)\n\s*await node\.sendTx\(tx\)/)
	})

	test("the refusal is called from the reasoned-about sites and nowhere else", () => {
		expect(filesMatching(/\.assertCurrent\(\)/).sort()).toEqual([
			"wallet/services/execution/execution-coordinator.ts",
			"wallet/services/execution/service.ts",
			"wallet/services/wallet-sdk/background.ts",
		])
	})

	test("nothing on the session, export or backup paths knows the gate exists", () => {
		const gated = filesMatching(/TermsAcceptanceRequiredError|services\/legal\//)
		const forbidden = gated.filter((path) =>
			/services\/(profile|backup|account|account-state)\/|settings\/security\/export\/|route-guard|auth-guard/.test(path),
		)
		expect(forbidden).toEqual([])
	})
})
