/**
 * Two loopback ports for one browser run — the tools preview and the test wallet — bind-tested
 * from the static window below the kernel's ephemeral range, so the resolve → build → serve gap
 * cannot lose them to an outgoing connection's source port, and claimed in the host registry under
 * the run's id so every other run on the host (the sandbox this run boots next included) picks
 * around them. The sandbox reserves its own four the same way.
 *
 *   bun scripts/e2e/resolve-ports.ts <state-dir> <run-id> <pid>   → writes <state-dir>/ports.json
 *   bun scripts/e2e/resolve-ports.ts --release <state-dir> <run-id>  → drops the run's registry rows
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { PortClaimConflict, registerHostPorts, registeredPorts, releaseHostPorts } from "@nulo/bridge-core/sandbox"

const STATIC_LO = 10_000
const FLOOR_GUARD = 512
const TRIES = 256

function ephemeralFloor(): number {
	try {
		const lo = Number.parseInt(readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8").trim().split(/\s+/)[0] ?? "", 10)
		return Number.isFinite(lo) && lo > STATIC_LO + 256 ? lo : 32_768
	} catch {
		return 32_768
	}
}

function free(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const srv = createServer()
		srv.unref()
		srv.once("error", () => resolve(false))
		srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)))
	})
}

async function reserve(taken: Set<number>): Promise<number> {
	const span = ephemeralFloor() - FLOOR_GUARD - STATIC_LO
	for (let i = 0; i < TRIES; i++) {
		const port = STATIC_LO + Math.floor(Math.random() * span)
		if (!taken.has(port) && (await free(port))) {
			taken.add(port)
			return port
		}
	}
	throw new Error("resolve-ports: no free port in the static window")
}

if (process.argv[2] === "--release") {
	const [stateDir, runId] = process.argv.slice(3)
	if (!stateDir || !runId) throw new Error("resolve-ports: --release <state-dir> <run-id>")
	const stored = JSON.parse(readFileSync(join(stateDir, "ports.json"), "utf8")) as { tools: number; testWallet: number }
	await releaseHostPorts(runId, { tools: stored.tools, testWallet: stored.testWallet })
} else {
	const [stateDir, runId, pid] = process.argv.slice(2)
	if (!stateDir || !runId) throw new Error("resolve-ports: <state-dir> <run-id> [pid] required")
	const ports = await claim(runId, Number(pid) || process.pid)
	mkdirSync(stateDir, { recursive: true })
	writeFileSync(join(stateDir, "ports.json"), `${JSON.stringify({ ...ports, resolvedAt: new Date().toISOString() }, null, 2)}\n`)
	console.log(`[e2e:tools] tools=:${ports.tools} test-wallet=:${ports.testWallet}`)
}

/** Bind-test around every port the registry lists, then claim under its lock; a claim another run
 *  beat this one to is picked again. */
async function claim(runId: string, pid: number): Promise<{ tools: number; testWallet: number }> {
	for (let attempt = 0; ; attempt++) {
		const taken = registeredPorts()
		const ports = { tools: await reserve(taken), testWallet: await reserve(taken) }
		try {
			await registerHostPorts(runId, "tools-e2e", ports, pid)
			return ports
		} catch (e) {
			if (!(e instanceof PortClaimConflict) || attempt >= 4) throw e
		}
	}
}
