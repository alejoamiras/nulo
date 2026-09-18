/** The slice of a Rollup/Rolldown output bundle this package reads. */
export type OutputBundleLike = Record<string, { type: "asset" } | { type: "chunk"; modules: Record<string, { renderedLength: number }> }>

export interface BundleContents {
	/** Ids of modules that contributed to an emitted file. */
	moduleIds: string[]
	/** File names of every emitted asset. */
	assets: string[]
}

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
	const moduleIds: string[] = []
	const assets: string[] = []
	for (const [fileName, output] of Object.entries(bundle)) {
		if (output.type === "asset") {
			assets.push(fileName)
			continue
		}
		for (const [id, rendered] of Object.entries(output.modules)) {
			if (rendered.renderedLength > 0 || !isScriptModule(id)) moduleIds.push(id)
		}
	}
	return { moduleIds, assets }
}
