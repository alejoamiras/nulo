/** The slice of a Rollup/Rolldown output bundle this package reads. */
export type OutputBundleLike = Record<
	string,
	| { type: "asset"; source?: string | Uint8Array }
	| { type: "chunk"; isEntry?: boolean; facadeModuleId?: string | null; modules: Record<string, { renderedLength: number }> }
>

export interface BundleContents {
	/** Ids of modules that contributed to an emitted file. */
	moduleIds: string[]
	/** File names of every emitted asset. */
	assets: string[]
	/** The text of each small emitted script asset, for claims that are verified by content. */
	assetText: Record<string, string>
	/** Assets proven to be the output of a recorded build, which therefore need no claim. */
	builtAssets: string[]
}

/** Larger than any loader shim; a worker bundle runs to megabytes and is never matched by content. */
const READABLE_SCRIPT_BYTES = 64 * 1024

const SCRIPT_EXTENSION = /\.([cm]?[jt]sx?|vue)$/i

/** A Vue SFC's style block is a stylesheet wearing the component's file name. */
const isScriptModule = (id: string) => SCRIPT_EXTENSION.test(id.split("?")[0] ?? "") && !/[?&]type=style\b/.test(id)

/**
 * What a bundle actually ships. A script module the bundler loaded but tree-shook away renders
 * zero bytes, and naming its package would claim code that is not in the artifact. A stylesheet or
 * other resource also renders zero bytes of JavaScript while its content ships as an asset, so
 * only script modules are dropped on length.
 */
export function bundleContents(bundle: OutputBundleLike): BundleContents {
	const contents: BundleContents = { moduleIds: [], assets: [], assetText: {}, builtAssets: [] }
	for (const [fileName, output] of Object.entries(bundle)) {
		if (output.type === "asset") {
			contents.assets.push(fileName)
			const text = readableScript(fileName, output.source)
			if (text !== undefined) contents.assetText[fileName] = text
			continue
		}
		for (const [id, rendered] of Object.entries(output.modules)) {
			if (rendered.renderedLength > 0 || !isScriptModule(id)) contents.moduleIds.push(id)
		}
	}
	return contents
}

function readableScript(fileName: string, source: string | Uint8Array | undefined): string | undefined {
	if (source === undefined || !/\.[cm]?js$/.test(fileName) || source.length > READABLE_SCRIPT_BYTES) return undefined
	return typeof source === "string" ? source : new TextDecoder().decode(source)
}

/** The stable identity of a worker build and the files it wrote. */
export function workerIdentity(bundle: OutputBundleLike): { entry: string; outputs: string[] } {
	const outputs = Object.keys(bundle).sort()
	const entries = Object.values(bundle).flatMap((output) =>
		output.type === "chunk" && output.isEntry && output.facadeModuleId ? [output.facadeModuleId] : [],
	)
	return { entry: entries.sort()[0] ?? outputs.join("\0"), outputs }
}
