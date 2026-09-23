// Full-record lockfile extractor + comparator for the wallet-grade regen review.
// usage: bun lock-records.ts extract <bun.lock> <out.tsv>
//        bun lock-records.ts diff <pre.tsv> <post.tsv>
import { readFileSync, writeFileSync } from "node:fs"

type Rec = { key: string; nv: string; reg: string; integ: string; deps: string; peers: string; optPeers: string; bin: string; scripts: string }

function parseLock(path: string): Record<string, unknown[]> {
	// bun.lock is JSONC (trailing commas). Strip them before parsing.
	const txt = readFileSync(path, "utf8").replace(/,(\s*[}\]])/g, "$1")
	return (JSON.parse(txt) as { packages: Record<string, unknown[]> }).packages
}

function records(path: string): Map<string, Rec> {
	const out = new Map<string, Rec>()
	for (const [key, v] of Object.entries(parseLock(path))) {
		const [nv, reg, meta, integ] = v as [string, string, Record<string, unknown> | undefined, string | undefined]
		const m = meta ?? {}
		out.set(key, {
			key,
			nv,
			reg: reg ?? "",
			integ: integ ?? "",
			deps: JSON.stringify(m.dependencies ?? {}),
			peers: JSON.stringify(m.peerDependencies ?? {}),
			optPeers: JSON.stringify(m.optionalPeers ?? []),
			bin: JSON.stringify(m.bin ?? {}),
			scripts: JSON.stringify(m.scripts ?? {}),
		})
	}
	return out
}

const [mode, a, b] = process.argv.slice(2)
if (mode === "extract") {
	const recs = records(a as string)
	const lines = [...recs.values()].sort((x, y) => x.key.localeCompare(y.key)).map((r) => Object.values(r).join("\t"))
	writeFileSync(b as string, `${lines.join("\n")}\n`)
	console.log(`records: ${recs.size}`)
} else if (mode === "diff") {
	const load = (p: string) => {
		const m = new Map<string, Rec>()
		for (const line of readFileSync(p, "utf8").split("\n").filter(Boolean)) {
			const [key, nv, reg, integ, deps, peers, optPeers, bin, scripts] = line.split("\t") as string[]
			m.set(key as string, { key: key as string, nv: nv as string, reg: reg as string, integ: integ as string, deps: deps as string, peers: peers as string, optPeers: optPeers as string, bin: bin as string, scripts: scripts as string })
		}
		return m
	}
	const pre = load(a as string)
	const post = load(b as string)
	const added = [...post.keys()].filter((k) => !pre.has(k))
	const removed = [...pre.keys()].filter((k) => !post.has(k))
	const frozenScopes = /^(@aztec\/|@aztec-foundation\/|@alejoamiras\/)/
	const versionMoves: string[] = []
	const integrityOnly: string[] = []
	const edgeChanges: string[] = []
	const scriptBinChanges: string[] = []
	const frozenViolations: string[] = []
	for (const [k, p] of pre) {
		const q = post.get(k)
		if (!q) continue
		const name = k.split("/").pop() as string
		if (p.nv !== q.nv) versionMoves.push(`${k}: ${p.nv} → ${q.nv}`)
		else if (p.integ !== q.integ || p.reg !== q.reg) integrityOnly.push(`${k} (${p.nv}): integrity/resolved changed`)
		if (p.deps !== q.deps || p.peers !== q.peers || p.optPeers !== q.optPeers) edgeChanges.push(k)
		if (p.bin !== q.bin || p.scripts !== q.scripts) scriptBinChanges.push(k)
		if (frozenScopes.test(q.nv) && (p.nv !== q.nv || p.integ !== q.integ || p.reg !== q.reg)) frozenViolations.push(`${k}: ${p.nv}/${p.integ.slice(0, 20)} → ${q.nv}/${q.integ.slice(0, 20)}`)
		void name
	}
	console.log(`pre=${pre.size} post=${post.size}`)
	console.log(`ADDED (${added.length}):\n  ${added.join("\n  ") || "-"}`)
	console.log(`REMOVED (${removed.length}):\n  ${removed.join("\n  ") || "-"}`)
	console.log(`VERSION MOVES (${versionMoves.length}):\n  ${versionMoves.join("\n  ") || "-"}`)
	console.log(`INTEGRITY/RESOLVED-ONLY CHANGES (${integrityOnly.length}):\n  ${integrityOnly.join("\n  ") || "-"}`)
	console.log(`DEP/PEER EDGE CHANGES (${edgeChanges.length}):\n  ${edgeChanges.join("\n  ") || "-"}`)
	console.log(`BIN/SCRIPT CHANGES (${scriptBinChanges.length}):\n  ${scriptBinChanges.join("\n  ") || "-"}`)
	console.log(`FROZEN-SCOPE VIOLATIONS (${frozenViolations.length}):\n  ${frozenViolations.join("\n  ") || "-"}`)
}
