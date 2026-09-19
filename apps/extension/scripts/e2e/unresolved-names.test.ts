import { readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { expect, test } from "vitest"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const E2E_ROOT = path.resolve(__dirname, "../../tests/e2e")

/**
 * `bun run typecheck` does not cover the e2e tree, and the tree carries type debt a full check
 * would drown in. A name that resolves to nothing is the one class worth pulling out of that
 * noise: a missing import or a stale identifier passes every static gate and then throws on the
 * one path that reaches it — which for a fixture can be a reuse branch no ordinary run takes.
 */
const UNRESOLVED = new Set([
	2304, // Cannot find name
	2552, // Cannot find name, did you mean
	2305, // Module has no exported member
	2724, // … did you mean (exported member)
	2459, // Declared locally but not exported
	2614, // No exported member, did you mean a default import
	18004, // No value exists in scope for the shorthand property
])

/**
 * `chrome` is typed for `src/` by a package this standalone program does not load, and the tree
 * uses it inside page callbacks throughout. So a `chrome.*` reached from Node by mistake is the one
 * unresolved name this scan cannot tell from a legitimate one.
 */
const AMBIENT = /Cannot find name 'chrome'/

function* sources(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) yield* sources(full)
		else if (entry.name.endsWith(".ts")) yield full
	}
}

test("every name the e2e tree uses resolves", { timeout: 120_000 }, () => {
	const files = [...sources(E2E_ROOT)]
	expect(files.length).toBeGreaterThan(50)
	const program = ts.createProgram(files, {
		noEmit: true,
		skipLibCheck: true,
		strict: true,
		target: ts.ScriptTarget.ESNext,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		types: ["node"],
		lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
	})
	const unresolved = files
		.flatMap((file) => program.getSemanticDiagnostics(program.getSourceFile(file)))
		.filter((diagnostic) => UNRESOLVED.has(diagnostic.code))
		.map((diagnostic) => {
			const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")
			const file = diagnostic.file
			if (!file || diagnostic.start === undefined) return message
			const { line } = file.getLineAndCharacterOfPosition(diagnostic.start)
			return `${path.relative(E2E_ROOT, file.fileName)}:${line + 1} ${message}`
		})
		.filter((line) => !AMBIENT.test(line))
	expect(unresolved).toEqual([])
})
