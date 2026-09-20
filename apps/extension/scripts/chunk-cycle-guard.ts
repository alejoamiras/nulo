import type { Plugin } from "vite"

/**
 * The chunks that sit on a static-import cycle, or on a path between two of them.
 *
 * Whatever imports nothing alive, or is imported by nothing alive, cannot be on a cycle; trimming
 * those until nothing changes leaves exactly the chunks worth naming.
 */
export function cyclicChunks(imports: ReadonlyMap<string, readonly string[]>): string[] {
	const alive = new Set(imports.keys())
	const importsAlive = (chunk: string) => (imports.get(chunk) ?? []).some((dep) => dep !== chunk && alive.has(dep))
	const importedByAlive = (chunk: string) => [...alive].some((other) => other !== chunk && imports.get(other)?.includes(chunk))

	let trimmed = true
	while (trimmed) {
		trimmed = false
		for (const chunk of [...alive]) {
			if (importsAlive(chunk) && importedByAlive(chunk)) continue
			alive.delete(chunk)
			trimmed = true
		}
	}
	return [...alive].sort()
}

/**
 * Fails the build when two chunks statically import each other. ES modules let that load, and the
 * chunk that runs first reads the other's bindings as `undefined` — a bundle that builds, passes
 * every unit test, and throws in the browser. The bundler reports each chunk's static imports
 * exactly, so this reads those rather than the emitted code.
 */
export function chunkCycleGuard(): Plugin {
	return {
		name: "chunk-cycle-guard",
		apply: "build",
		enforce: "post",
		generateBundle(_options, bundle) {
			const imports = new Map<string, readonly string[]>()
			for (const [file, output] of Object.entries(bundle)) if (output.type === "chunk") imports.set(file, output.imports)
			const cyclic = cyclicChunks(imports)
			if (cyclic.length) this.error(`chunks on a static import cycle: ${cyclic.join(", ")}`)
		},
	}
}
