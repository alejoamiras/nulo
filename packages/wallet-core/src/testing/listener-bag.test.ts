import { describe, expect, test } from "vitest"
import { createListenerBag } from "./listener-bag"

describe("createListenerBag", () => {
	test("remove drops the first occurrence, removeAll every occurrence", () => {
		const bag = createListenerBag<() => void>()
		const a = () => {}
		const b = () => {}
		bag.add(a)
		bag.add(b)
		bag.add(a)
		bag.remove(a)
		expect(bag.items).toEqual([b, a])
		bag.add(b)
		bag.removeAll(b)
		expect(bag.items).toEqual([a])
		bag.remove(() => {})
		expect(bag.items).toEqual([a])
	})

	test("a live-array dispatch sees a listener added mid-loop; a snapshot dispatch does not", () => {
		const bag = createListenerBag<() => void>()
		const seen: string[] = []
		const late = () => seen.push("late")
		bag.add(() => {
			seen.push("first")
			bag.add(late)
		})
		for (const l of bag.items) l()
		expect(seen).toEqual(["first", "late"])
		seen.length = 0
		bag.removeAll(late)
		for (const l of [...bag.items]) l()
		expect(seen).toEqual(["first"])
		expect(bag.items).toHaveLength(2)
	})
})
