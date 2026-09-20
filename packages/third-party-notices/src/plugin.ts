import { fileURLToPath } from "node:url"
import { type BundleContents, bundleContents, type OutputBundleLike, workerIdentity } from "./collect.ts"
import { type GenerateOptions, generateNotices } from "./generate.ts"
import { POLICY } from "./policy.ts"
import { type InlinedStylesheets, inlinedStylesheets, isStylesheet } from "./stylesheets.ts"

export const NOTICES_FILE = "THIRD-PARTY-NOTICES.txt"

interface EmitContext {
	emitFile(file: { type: "asset"; fileName: string; source: string }): unknown
}

interface TransformContext {
	resolve(specifier: string, importer: string): Promise<{ id: string } | null>
}

type BundleHook = (this: EmitContext, options: unknown, bundle: OutputBundleLike) => void

interface NoticesPlugin {
	name: string
	apply: "build"
	transform: { order: "pre"; handler(this: TransformContext, code: string, id: string): Promise<null> }
	generateBundle: BundleHook
}

type MainNoticesPlugin = Omit<NoticesPlugin, "generateBundle"> & { generateBundle: { order: "post"; handler: BundleHook } }

interface WorkerRecord {
	outputs: string[]
	contents: BundleContents
}

/**
 * The main bundle plus every worker it actually ships. A worker's files reach the main bundle as
 * assets under the names its own build wrote, so that is what proves a record is still current
 * and that a script asset was really built here.
 */
function shipped(main: BundleContents, workers: Iterable<WorkerRecord>): BundleContents {
	const emitted = new Set(main.assets)
	const live = [...workers].filter((worker) => worker.outputs.some((file) => emitted.has(file)))
	const parts = [main, ...live.map((worker) => worker.contents)]
	return {
		moduleIds: parts.flatMap((part) => part.moduleIds),
		assets: parts.flatMap((part) => part.assets),
		assetText: Object.assign({}, ...parts.map((part) => part.assetText)),
		assetSha256: Object.assign({}, ...parts.map((part) => part.assetSha256)),
		builtAssets: live.flatMap((worker) => worker.outputs),
	}
}

/**
 * The main build's plugin and the worker builds' plugin, sharing one collector. Vite bundles a
 * worker while it transforms the module that spawns it, so each worker's modules are recorded
 * before the main bundle is generated and the file is emitted once, from the main build.
 *
 * A worker record is keyed by its entry module and outlives a rebuild, because Vite reuses a
 * cached worker bundle without generating it again; a record whose files the main bundle no
 * longer carries is ignored, and the main record is replaced on every generation.
 * Register both from the config that builds the shipped artifact only: the policy's stale-record
 * checks describe that artifact and would refuse any other bundle.
 */
export function thirdPartyNotices(overrides: Partial<GenerateOptions> = {}): { main: MainNoticesPlugin; worker: NoticesPlugin } {
	const workers = new Map<string, WorkerRecord>()
	// Keyed by the importing module, so a rebuild replaces what that stylesheet pulled in.
	const stylesheets = new Map<string, InlinedStylesheets>()
	const transform: NoticesPlugin["transform"] = {
		order: "pre",
		async handler(code, id) {
			if (!isStylesheet(id)) return null
			const resolve = async (specifier: string, importer: string) => (await this.resolve(specifier, importer))?.id
			stylesheets.set(id, await inlinedStylesheets(id, code, resolve))
			return null
		},
	}
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
			transform,
			generateBundle(_options, bundle) {
				const { entry, outputs } = workerIdentity(bundle)
				workers.set(entry, { outputs, contents: bundleContents(bundle) })
			},
		},
		main: {
			name: "nulo:third-party-notices",
			apply: "build",
			transform,
			// A hook-level "post" runs after every plugin's unordered hook, including plugins that are
			// themselves `enforce: "post"` (crx compiles and emits content scripts there). Being last
			// in the plugin list does not: Vite sorts enforce-post plugins behind it.
			generateBundle: {
				order: "post",
				handler(_options, bundle) {
					const contents = shipped(bundleContents(bundle), workers.values())
					const styles = [...stylesheets.values()]
					contents.moduleIds.push(...styles.flatMap((style) => style.files))
					contents.unfollowedStyles = styles.flatMap((style) => style.unfollowed)
					this.emitFile({ type: "asset", fileName: NOTICES_FILE, source: generateNotices(contents, options) })
				},
			},
		},
	}
}
