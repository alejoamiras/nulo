import { describe, expect, test } from "vitest"
import { DependencyCycleError, topologicalPhases, UnknownDependencyError, type ServiceNode } from "./topology"

const n = (name: string, dependencies?: string[]): ServiceNode => ({ name, dependencies })

describe("topologicalPhases", () => {
	test("empty input returns no phases", () => {
		expect(topologicalPhases([])).toEqual([])
	})

	test("single service with no deps → one phase", () => {
		const phases = topologicalPhases([n("a")])
		expect(phases.map((p) => p.map((x) => x.name))).toEqual([["a"]])
	})

	test("independent services → one phase, registration order", () => {
		const phases = topologicalPhases([n("b"), n("a"), n("c")])
		expect(phases.map((p) => p.map((x) => x.name))).toEqual([["b", "a", "c"]])
	})

	test("chain a → b → c produces three phases", () => {
		// c depends on b, b depends on a.
		const phases = topologicalPhases([n("a"), n("b", ["a"]), n("c", ["b"])])
		expect(phases.map((p) => p.map((x) => x.name))).toEqual([["a"], ["b"], ["c"]])
	})

	test("diamond a → {b, c} → d produces three phases with b + c in parallel", () => {
		const phases = topologicalPhases([n("a"), n("b", ["a"]), n("c", ["a"]), n("d", ["b", "c"])])
		expect(phases.map((p) => p.map((x) => x.name))).toEqual([["a"], ["b", "c"], ["d"]])
	})

	test("services added before their deps still sort correctly", () => {
		// c is added first but depends on a which is added last.
		const phases = topologicalPhases([n("c", ["a"]), n("b", ["a"]), n("a")])
		expect(phases.map((p) => p.map((x) => x.name))).toEqual([["a"], ["c", "b"]])
	})

	test("unknown dep throws UnknownDependencyError with helpful detail", () => {
		let thrown: unknown
		try {
			topologicalPhases([n("a", ["ghost"])])
		} catch (err) {
			thrown = err
		}
		expect(thrown).toBeInstanceOf(UnknownDependencyError)
		expect((thrown as UnknownDependencyError).service).toBe("a")
		expect((thrown as UnknownDependencyError).missing).toBe("ghost")
		expect((thrown as Error).message).toContain("unknown service 'ghost'")
	})

	test("direct cycle throws DependencyCycleError listing both", () => {
		let thrown: unknown
		try {
			topologicalPhases([n("a", ["b"]), n("b", ["a"])])
		} catch (err) {
			thrown = err
		}
		expect(thrown).toBeInstanceOf(DependencyCycleError)
		expect((thrown as DependencyCycleError).pending).toEqual(expect.arrayContaining(["a", "b"]))
	})

	test("self-cycle is detected", () => {
		expect(() => topologicalPhases([n("a", ["a"])])).toThrow(DependencyCycleError)
	})

	test("long cycle a → b → c → a", () => {
		expect(() => topologicalPhases([n("a", ["c"]), n("b", ["a"]), n("c", ["b"])])).toThrow(DependencyCycleError)
	})

	test("cycle leaves the non-cyclic portion uncollected too", () => {
		// d is fine (depends on nothing), but a↔b cycle means we can't finish.
		let thrown: unknown
		try {
			topologicalPhases([n("a", ["b"]), n("b", ["a"]), n("d")])
		} catch (err) {
			thrown = err
		}
		expect(thrown).toBeInstanceOf(DependencyCycleError)
		// d is resolvable but a & b are the cycle; pending should include a and b.
		expect((thrown as DependencyCycleError).pending).toEqual(expect.arrayContaining(["a", "b"]))
	})
})
