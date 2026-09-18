/** The slice of a Rollup/Rolldown output bundle this package reads. */
export type OutputBundleLike = Record<string, { type: "asset" } | { type: "chunk"; modules: Record<string, { renderedLength: number }> }>

export interface BundleContents {
	/** Ids of modules that contributed code to an emitted chunk. */
	moduleIds: string[]
	/** File names of every emitted asset. */
	assets: string[]
}

/**
 * What a bundle actually ships. A module the bundler loaded but tree-shook away renders zero bytes,
 * and naming its package would claim code that is not in the artifact.
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
			if (rendered.renderedLength > 0) moduleIds.push(id)
		}
	}
	return { moduleIds, assets }
}
