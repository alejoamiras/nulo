/**
 * Unit tests for getBlockHeaderAnchor. Pins the PXE-then-node fallback
 * semantics, and the "double failure returns undefined" contract that
 * lets callers branch uniformly on absence rather than thrown error type.
 */

import { describe, expect, test, vi } from "vitest"
import { getBlockHeaderAnchor } from "./block-header-anchor"

function makeFakes(opts: { pxe?: "ok" | "throw"; node?: "ok" | "null" | "throw"; headerSentinel?: unknown; nodeSentinel?: unknown }) {
	const headerSentinel = opts.headerSentinel ?? { kind: "pxe-header" }
	const nodeSentinel = opts.nodeSentinel ?? { kind: "node-header" }
	// biome-ignore lint/suspicious/noExplicitAny: duck-typed pxe stub
	const pxe: any = {
		getSyncedBlockHeader: vi.fn(async () => {
			if (opts.pxe === "throw") throw new Error("pxe sync error")
			return headerSentinel
		}),
	}
	// biome-ignore lint/suspicious/noExplicitAny: duck-typed node stub
	const node: any = {
		// 5.0: getBlockHeader removed → anchor falls back to getBlock("latest").header.
		getBlock: vi.fn(async () => {
			if (opts.node === "throw") throw new Error("node rpc error")
			if (opts.node === "null") return null
			return { header: nodeSentinel }
		}),
	}
	return { pxe, node, headerSentinel, nodeSentinel }
}

describe("getBlockHeaderAnchor", () => {
	test("PXE succeeds → returns its header, node not called", async () => {
		const { pxe, node, headerSentinel } = makeFakes({ pxe: "ok", node: "ok" })
		const result = await getBlockHeaderAnchor(pxe, node)
		expect(result).toBe(headerSentinel)
		expect(pxe.getSyncedBlockHeader).toHaveBeenCalledOnce()
		expect(node.getBlock).not.toHaveBeenCalled()
	})

	test("PXE throws → node.getBlock returned", async () => {
		const { pxe, node, nodeSentinel } = makeFakes({ pxe: "throw", node: "ok" })
		const result = await getBlockHeaderAnchor(pxe, node)
		expect(result).toBe(nodeSentinel)
		expect(node.getBlock).toHaveBeenCalledOnce()
	})

	test("PXE throws + node returns null → undefined", async () => {
		const { pxe, node } = makeFakes({ pxe: "throw", node: "null" })
		const result = await getBlockHeaderAnchor(pxe, node)
		expect(result).toBeUndefined()
	})

	test("PXE throws + node throws → undefined (does not propagate)", async () => {
		const { pxe, node } = makeFakes({ pxe: "throw", node: "throw" })
		const result = await getBlockHeaderAnchor(pxe, node)
		expect(result).toBeUndefined()
	})
})
