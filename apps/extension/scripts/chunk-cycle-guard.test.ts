import { describe, expect, test } from "vitest"
import { cyclicChunks } from "./chunk-cycle-guard"

const graph = (edges: Record<string, string[]>) => new Map(Object.entries(edges))

describe("cyclicChunks", () => {
	test("finds nothing in a graph whose chunks only import downwards", () => {
		expect(cyclicChunks(graph({ entry: ["a", "b"], a: ["b"], b: [] }))).toEqual([])
	})

	test("names both chunks of a pair that import each other", () => {
		expect(cyclicChunks(graph({ a: ["b"], b: ["a"] }))).toEqual(["a", "b"])
	})

	// The entry that reaches a cycle and the leaf the cycle depends on are not part of it.
	test("leaves out what merely imports a cycle or is imported by one", () => {
		const found = cyclicChunks(graph({ entry: ["a"], a: ["b"], b: ["c", "leaf"], c: ["a"], leaf: [] }))
		expect(found).toEqual(["a", "b", "c"])
	})

	test("ignores imports of files outside the bundle", () => {
		expect(cyclicChunks(graph({ a: ["external.js"], b: ["a"] }))).toEqual([])
	})
})
