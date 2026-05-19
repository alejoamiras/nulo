import { describe, expect, test } from "vitest"
import { isBenignSwDisconnect } from "./is-benign-sw-disconnect"

describe("isBenignSwDisconnect", () => {
	test("Error('Client disconnected') → true (the canonical message from background/client.ts:80)", () => {
		expect(isBenignSwDisconnect(new Error("Client disconnected"))).toBe(true)
	})

	test("Error with other message → false (real errors still surface)", () => {
		expect(isBenignSwDisconnect(new Error("transient network failure"))).toBe(false)
	})

	test("non-Error reason (string) → false (defensive — exact-shape match only)", () => {
		// Even if the message string matches, a non-Error reason isn't from our
		// disconnect cascade. Don't swallow it just because the text matches.
		expect(isBenignSwDisconnect("Client disconnected")).toBe(false)
	})

	test("null → false", () => {
		expect(isBenignSwDisconnect(null)).toBe(false)
	})

	test("undefined → false", () => {
		expect(isBenignSwDisconnect(undefined)).toBe(false)
	})

	test("Error subclass with matching message → true (covers wrapped throws too)", () => {
		class CustomError extends Error {}
		expect(isBenignSwDisconnect(new CustomError("Client disconnected"))).toBe(true)
	})
})
