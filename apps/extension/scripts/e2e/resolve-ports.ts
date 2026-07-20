/**
 * Resolve a unique port pack for one parallel e2e run and persist it to
 * `.e2e-state/ports.json`. The agent wrapper (`scripts/e2e/agent.sh`)
 * reads that file to feed both the wallet build (`VITE_LOCAL_NETWORK_RPC_URL`)
 * and the test runner (`AZTEC_NODE_URL` / `ANVIL_URL` / `PLAYGROUND_URL` /
 * `ANVIL_PORT` / `AZTEC_PORT` / `PLAYGROUND_PORT`).
 *
 * Why bind-and-release rather than bind-and-hold:
 *
 *   The wallet is built BEFORE the test runner starts (the build bakes the
 *   aztec URL via `import.meta.env.VITE_LOCAL_NETWORK_RPC_URL`). The build
 *   process and the test runner are sibling shell commands — there is no
 *   handle we can pass for "this socket is mine, please reuse it." Holding
 *   the sockets across the build would require keeping this script alive
 *   for minutes and turning the build/test sequence into its children,
 *   which is unnecessary infrastructure.
 *
 *   So there is an unavoidable resolve→build→bind gap. The danger is not a
 *   foreign dev tool — it is the kernel itself: a listener bound via
 *   `listen(0)` gets a port from the OS *dynamic/ephemeral* range
 *   (`/proc/sys/net/ipv4/ip_local_port_range`, e.g. 32768–60999 on the CI
 *   runner). That is the SAME range the kernel draws from for the source
 *   port of every *outgoing* connection. The wallet build opens many
 *   outgoing sockets; during the gap one of them can be assigned the port
 *   we just released, and because the aztec-node port is baked into the
 *   bundle a collision is unrecoverable — the node's `.listen()` throws
 *   `Address already in use`, the boot classifier maps it to exit 86, and
 *   the retry (fresh ports + rebuild) rolls the same dice again. Across the
 *   ~7 parallel network-e2e jobs this made a fully-green run improbable
 *   (the sticky Q-06/Q-07 boot flake).
 *
 *   Fix: draw our listener ports from a STATIC window strictly *below* the
 *   ephemeral floor. The kernel never assigns those as outgoing source
 *   ports, so the resolve→build→bind gap is no longer a race for them. We
 *   bind-test each candidate and, if the static path can't apply (floor
 *   unreadable, window exhausted), fall back to `listen(0)` — never worse
 *   than the prior behavior on any platform.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "node:net"

interface PortReservation {
	port: number
	release: () => Promise<void>
}

const DEFAULT_EPHEMERAL_FLOOR = 32768
/** Bottom of the static window. Above the privileged range, clear of common dev ports. */
const STATIC_LO = 10000
/** Guard band kept clear immediately below the ephemeral floor. */
const FLOOR_GUARD = 512
/** Bounded random probes before conceding to the `listen(0)` fallback. */
const MAX_STATIC_TRIES = 256

/**
 * Read the bottom of the OS dynamic/ephemeral port range. Ports at or above
 * this can be handed to outgoing connections; ports below it cannot, which is
 * exactly the property we need for a collision-immune listener.
 */
export async function ephemeralFloor(): Promise<number> {
	try {
		const raw = await readFile("/proc/sys/net/ipv4/ip_local_port_range", "utf-8")
		const lo = Number.parseInt(raw.trim().split(/\s+/)[0] ?? "", 10)
		return Number.isFinite(lo) && lo > STATIC_LO + 256 ? lo : DEFAULT_EPHEMERAL_FLOOR
	} catch {
		return DEFAULT_EPHEMERAL_FLOOR
	}
}

/**
 * Attempt to bind (and hold) one specific port on loopback. Resolves to a
 * reservation on success, or `null` on ANY failure (port taken, permission,
 * teardown race) — never throws, so the caller's probe loop stays simple.
 */
function tryBind(port: number): Promise<PortReservation | null> {
	return new Promise((res) => {
		const srv = createServer()
		srv.unref() // Don't keep the event loop alive on its own.
		let settled = false
		const settle = (v: PortReservation | null) => {
			if (settled) return
			settled = true
			res(v)
		}
		srv.once("error", () => {
			srv.close()
			settle(null)
		})
		srv.listen(port, "127.0.0.1", () => {
			const addr = srv.address()
			if (!addr || typeof addr !== "object") {
				srv.close()
				settle(null)
				return
			}
			settle({
				port: addr.port,
				release: () =>
					new Promise<void>((rs) => {
						srv.close(() => rs())
					}),
			})
		})
	})
}

/** Original OS-assigned ephemeral reservation — retained as the fallback. */
function reserveEphemeral(): Promise<PortReservation> {
	return new Promise((resolveReservation, reject) => {
		const srv = createServer()
		srv.unref()
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address()
			if (!addr || typeof addr !== "object") {
				reject(new Error("listen returned no address"))
				return
			}
			resolveReservation({
				port: addr.port,
				release: () =>
					new Promise<void>((rs) => {
						srv.close(() => rs())
					}),
			})
		})
		srv.once("error", reject)
	})
}

/**
 * Reserve one loopback port from the static window below the ephemeral floor,
 * randomized to keep parallel local runs apart and bind-tested against
 * already-held siblings so the pack stays distinct. Falls back to an
 * OS-assigned ephemeral port when the static path can't apply.
 */
async function reservePort(): Promise<PortReservation> {
	const floor = await ephemeralFloor()
	const hi = Math.max(STATIC_LO + 256, floor - FLOOR_GUARD)
	const span = hi - STATIC_LO
	if (span >= 256) {
		for (let i = 0; i < MAX_STATIC_TRIES; i++) {
			const candidate = STATIC_LO + Math.floor(Math.random() * span)
			const reservation = await tryBind(candidate)
			if (reservation) return reservation
		}
	}
	return reserveEphemeral()
}

export interface PortPack {
	anvil: number
	aztec: number
	aztecAdmin: number
	aztecP2P: number
	playground: number
	faucet: number
}

export async function reservePortPack(): Promise<{ ports: PortPack; release: () => Promise<void> }> {
	const r = {
		anvil: await reservePort(),
		aztec: await reservePort(),
		aztecAdmin: await reservePort(),
		aztecP2P: await reservePort(),
		playground: await reservePort(),
		faucet: await reservePort(),
	}
	const ports: PortPack = {
		anvil: r.anvil.port,
		aztec: r.aztec.port,
		aztecAdmin: r.aztecAdmin.port,
		aztecP2P: r.aztecP2P.port,
		playground: r.playground.port,
		faucet: r.faucet.port,
	}
	return {
		ports,
		release: async () => {
			await Promise.all([
				r.anvil.release(),
				r.aztec.release(),
				r.aztecAdmin.release(),
				r.aztecP2P.release(),
				r.playground.release(),
				r.faucet.release(),
			])
		},
	}
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORTS_PATH = resolve(__dirname, "../../.e2e-state/ports.json")

async function main() {
	const { ports, release } = await reservePortPack()
	await mkdir(dirname(PORTS_PATH), { recursive: true })
	const payload = {
		...ports,
		anvilUrl: `http://127.0.0.1:${ports.anvil}`,
		aztecUrl: `http://localhost:${ports.aztec}`,
		playgroundUrl: `http://localhost:${ports.playground}/`,
		faucetUrl: `http://localhost:${ports.faucet}/`,
		resolvedAt: new Date().toISOString(),
	}
	await writeFile(PORTS_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
	await release()
	process.stdout.write(
		`${[
			`[resolve-ports] anvil=:${ports.anvil} aztec=:${ports.aztec} (admin :${ports.aztecAdmin}, p2p :${ports.aztecP2P}) playground=:${ports.playground} faucet=:${ports.faucet}`,
			`[resolve-ports] wrote ${PORTS_PATH}`,
		].join("\n")}\n`,
	)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
	main().catch((err) => {
		console.error("[resolve-ports] failed:", err)
		process.exit(1)
	})
}
