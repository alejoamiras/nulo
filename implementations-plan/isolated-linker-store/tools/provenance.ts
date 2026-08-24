// Publish time + provenance for each bundle-reachable moved package (post-regen version).
const moves = (await Bun.file(process.argv[2] as string).text()).split("\n").filter((l) => l.includes("→"))
const reach = new Set((await Bun.file(process.argv[3] as string).text()).split("\n").filter(Boolean))
const rows: string[] = []
const now = Date.now()
for (const line of moves) {
	const key = (line.trim().split(":")[0] as string).trim()
	if (!reach.has(key)) continue
	const m = line.match(/→ (.+)$/)
	if (!m) continue
	const nv = (m[1] as string).trim()
	const at = nv.lastIndexOf("@")
	const name = nv.slice(0, at)
	const version = nv.slice(at + 1)
	try {
		const res = await fetch(`https://registry.npmjs.org/${name}`)
		const doc = (await res.json()) as {
			time?: Record<string, string>
			versions?: Record<string, { dist?: { attestations?: unknown; signatures?: unknown[] } }>
		}
		const t = doc.time?.[version]
		const ageDays = t ? ((now - Date.parse(t)) / 86400000).toFixed(1) : "?"
		const dist = doc.versions?.[version]?.dist
		const prov = dist?.attestations ? "attested" : dist?.signatures?.length ? "signed" : "none"
		rows.push(`${key}\t${version}\t${t ?? "?"}\t${ageDays}d\t${prov}`)
	} catch (e) {
		rows.push(`${key}\t${version}\tERR ${String(e).slice(0, 60)}`)
	}
}
rows.sort((a, b) => Number.parseFloat(a.split("\t")[3] as string) - Number.parseFloat(b.split("\t")[3] as string))
console.log(rows.join("\n"))
console.log(`--- ${rows.length} bundle-reachable moves; youngest first; all must be >= 7.0d ---`)
