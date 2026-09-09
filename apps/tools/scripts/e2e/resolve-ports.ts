/**
 * Two loopback ports for one browser run — the tools preview and the test wallet — bind-tested
 * from the static window below the kernel's ephemeral range, so the resolve → build → serve gap
 * cannot lose them to an outgoing connection's source port. The sandbox reserves its own four.
 *
 *   bun scripts/e2e/resolve-ports.ts <state-dir>   → writes <state-dir>/ports.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"

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

const stateDir = process.argv[2]
if (!stateDir) throw new Error("resolve-ports: <state-dir> required")
const taken = new Set<number>()
const ports = { tools: await reserve(taken), testWallet: await reserve(taken), resolvedAt: new Date().toISOString() }
mkdirSync(stateDir, { recursive: true })
writeFileSync(join(stateDir, "ports.json"), `${JSON.stringify(ports, null, 2)}\n`)
console.log(`[e2e:tools] tools=:${ports.tools} test-wallet=:${ports.testWallet}`)
