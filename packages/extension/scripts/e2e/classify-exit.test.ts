import { describe, expect, test } from "vitest"
import { BOOT_FAILURE_EXIT, classifyExit } from "../../tests/e2e/sentinel"

describe("classifyExit — boot-failure sentinel state machine", () => {
	test("success passes through regardless of markers", () => {
		expect(classifyExit(0, { bootStarted: true, bootReady: false, testsStarted: false })).toBe(0)
		expect(classifyExit(0, { bootStarted: false, bootReady: false, testsStarted: false })).toBe(0)
	})

	test("boot started, never ready, no test ran ⇒ 86 (the only retry case)", () => {
		expect(classifyExit(1, { bootStarted: true, bootReady: false, testsStarted: false })).toBe(BOOT_FAILURE_EXIT)
	})

	test("a real test failure (boot ready) passes the original code through ⇒ NOT 86", () => {
		expect(classifyExit(1, { bootStarted: true, bootReady: true, testsStarted: true })).toBe(1)
	})

	test("fixture/import failure AFTER boot-ready ⇒ NOT 86 (no retry)", () => {
		expect(classifyExit(1, { bootStarted: true, bootReady: true, testsStarted: false })).toBe(1)
	})

	test("a test ran but boot-ready missing ⇒ NOT 86 (a run that started tests is never infra)", () => {
		expect(classifyExit(1, { bootStarted: true, bootReady: false, testsStarted: true })).toBe(1)
	})

	test("no boot attempted (reuse / manifest fail before boot-started) ⇒ NOT 86", () => {
		expect(classifyExit(1, { bootStarted: false, bootReady: false, testsStarted: false })).toBe(1)
	})

	test("preserves arbitrary non-zero codes (e.g. agent.sh's own exit 2)", () => {
		expect(classifyExit(2, { bootStarted: true, bootReady: true, testsStarted: true })).toBe(2)
	})
})
