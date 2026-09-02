import { createServer } from "node:net"
import { describe, expect, test } from "vitest"
import { ephemeralFloor, reservePortPack } from "./resolve-ports"

/** Can we bind this exact loopback port right now? */
function bindable(port: number): Promise<boolean> {
	return new Promise((res) => {
		const srv = createServer()
		srv.unref()
		srv.once("error", () => {
			srv.close()
			res(false)
		})
		srv.listen(port, "127.0.0.1", () => srv.close(() => res(true)))
	})
}

describe("resolve-ports — collision-immune static allocation", () => {
	test("ephemeralFloor is a sane port above the static window", async () => {
		const floor = await ephemeralFloor()
		expect(floor).toBeGreaterThan(10256)
		expect(floor).toBeLessThanOrEqual(65535)
	})

	test("a pack has six distinct ports", async () => {
		const { ports, release } = await reservePortPack()
		try {
			expect(Object.keys(ports).sort()).toEqual(["anvil", "aztec", "aztecAdmin", "aztecP2P", "playground", "tools"])
			const values = Object.values(ports)
			expect(new Set(values).size).toBe(6)
			for (const p of values) {
				expect(p).toBeGreaterThan(1024)
				expect(p).toBeLessThanOrEqual(65535)
			}
		} finally {
			await release()
		}
	})

	// The fix: listener ports must sit BELOW the OS ephemeral floor so the
	// kernel can never assign them as an outgoing connection's source port
	// during the resolve→build→bind gap. This is the invariant the sticky
	// Q-06/Q-07 boot flake violated.
	test("every reserved port is below the ephemeral floor", async () => {
		const floor = await ephemeralFloor()
		const { ports, release } = await reservePortPack()
		try {
			for (const p of Object.values(ports)) expect(p).toBeLessThan(floor)
		} finally {
			await release()
		}
	})

	test("release frees the ports for immediate re-binding", async () => {
		const { ports, release } = await reservePortPack()
		await release()
		expect(await bindable(ports.aztec)).toBe(true)
	})
})
