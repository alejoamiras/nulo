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
 *   Instead we accept a small race window: ports are picked here and may
 *   be lost to a foreign process during the build. The vitest global-setup
 *   re-validates by attempting to bind each port at spawn time and FAILS
 *   FAST with a clear "port X moved between resolve and spawn" error. The
 *   user retries; resolve-ports picks fresh ports; build runs; success.
 *
 *   The OS picks ephemeral ports (typically >= 49152), so collision with
 *   other dev tools is improbable in practice.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "node:net"

interface PortReservation {
	port: number
	release: () => Promise<void>
}

async function reservePort(): Promise<PortReservation> {
	return new Promise((resolveReservation, reject) => {
		const srv = createServer()
		srv.unref() // Don't keep the event loop alive on its own.
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
