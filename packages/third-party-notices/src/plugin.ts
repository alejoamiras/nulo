import { fileURLToPath } from "node:url"
import { type BundleContents, bundleContents, type OutputBundleLike } from "./collect.ts"
import { generateNotices } from "./generate.ts"
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

/**
 * One collector shared by the main build and every worker build. Vite bundles a worker while it
 * transforms the module that spawns it, so each worker's modules are recorded before the main
 * bundle is generated and the file is emitted once, from the main build.
 */
export function thirdPartyNotices(): { main: NoticesPlugin; worker: NoticesPlugin } {
	const seen: BundleContents = { moduleIds: [], assets: [] }
	const record = (bundle: OutputBundleLike) => {
		const contents = bundleContents(bundle)
		seen.moduleIds.push(...contents.moduleIds)
		seen.assets.push(...contents.assets)
	}
	return {
		worker: {
			name: "nulo:third-party-notices:worker",
			apply: "build",
			generateBundle(_options, bundle) {
				record(bundle)
			},
		},
		main: {
			name: "nulo:third-party-notices",
			apply: "build",
			generateBundle(_options, bundle) {
				record(bundle)
				const textsDir = fileURLToPath(new URL("../texts/", import.meta.url))
				this.emitFile({
					type: "asset",
					fileName: NOTICES_FILE,
					source: generateNotices(seen, { policy: POLICY, textsDir }),
				})
			},
		},
	}
}
