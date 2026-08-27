// Who depends on each given package name, in a bun.lock (post-regen dry lock).
const lock = JSON.parse((await Bun.file(process.argv[2] as string).text()).replace(/,(\s*[}\]])/g, "$1")) as {
	packages: Record<string, unknown[]>
}
for (const name of process.argv.slice(3)) {
	const consumers: string[] = []
	for (const [k, v] of Object.entries(lock.packages)) {
		const deps = ((v as unknown[])[2] as { dependencies?: Record<string, string> } | undefined)?.dependencies ?? {}
		if (deps[name]) consumers.push(`${k}(${deps[name]})`)
	}
	console.log(`${name} <- ${consumers.slice(0, 6).join(", ") || "NO lock consumers (root/workspace dep?)"}`)
}
