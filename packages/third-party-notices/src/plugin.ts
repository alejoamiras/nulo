import { fileURLToPath } from "node:url"
import { type BundleContents, bundleContents, type OutputBundleLike } from "./collect.ts"
import { type GenerateOptions, generateNotices } from "./generate.ts"
import { POLICY } from "./policy.ts"

export const NOTICES_FILE = "THIRD-PARTY-NOTICES.txt"

interface EmitContext {
	emitFile(file: { type: "asset"; fileName: string; source: string }): unknown
}

interface NoticesPlugin {
	name: string
	apply: "build"
	generateBundle(this: EmitContext, options: unknown, bundle: OutputBundleLike): void
}

const merge = (...parts: BundleContents[]): BundleContents => ({
	moduleIds: parts.flatMap((part) => part.moduleIds),
	assets: parts.flatMap((part) => part.assets),
})

/**
 * The main build's plugin and the worker builds' plugin, sharing one collector. Vite bundles a
 * worker while it transforms the module that spawns it, so each worker's modules are recorded
 * before the main bundle is generated and the file is emitted once, from the main build.
 *
 * Worker records are kept per output set and outlive a rebuild, because Vite reuses a cached
 * worker bundle without generating it again; the main record is replaced on every generation.
 * Register both from the config that builds the shipped artifact only: the policy's stale-record
 * checks describe that artifact and would refuse any other bundle.
 */
export function thirdPartyNotices(overrides: Partial<GenerateOptions> = {}): { main: NoticesPlugin; worker: NoticesPlugin } {
	const workers = new Map<string, BundleContents>()
	const options: GenerateOptions = {
		policy: POLICY,
		textsDir: fileURLToPath(new URL("../texts/", import.meta.url)),
		workspaceRoot: fileURLToPath(new URL("../../../", import.meta.url)),
		...overrides,
	}
	return {
		worker: {
			name: "nulo:third-party-notices:worker",
			apply: "build",
			generateBundle(_options, bundle) {
				workers.set(Object.keys(bundle).sort().join("\0"), bundleContents(bundle))
			},
		},
		main: {
			name: "nulo:third-party-notices",
			apply: "build",
			generateBundle(_options, bundle) {
				const contents = merge(bundleContents(bundle), ...workers.values())
				this.emitFile({ type: "asset", fileName: NOTICES_FILE, source: generateNotices(contents, options) })
			},
		},
	}
}
