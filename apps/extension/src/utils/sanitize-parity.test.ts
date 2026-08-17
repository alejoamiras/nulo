/**
 * Q-12: enforce the "byte-identical" pin both sanitizeString copies claim in
 * their comments. `@nulo/design`'s internal `sanitize.ts` is a deliberate copy
 * of the extension's `utils/string.ts` `sanitizeString` (design can't import the
 * extension). Each side is unit-tested in isolation, so a future edit to one
 * regex would pass both suites while silently diverging. This test runs one
 * shared fixture table through BOTH real implementations and asserts identical
 * output, converting the comment's claim into an enforced invariant.
 *
 * The design copy is `internal` (no package export), so it is imported by
 * source path — that boundary-crossing is the entire point of the parity check.
 */
import { describe, expect, test } from "vitest"
// The design package's internal copy, imported by source (no public export).
import { sanitizeString as designSanitize } from "../../../../packages/design/src/internal/sanitize"
import { sanitizeString as extensionSanitize } from "./string"

const FIXTURES: Array<[string, number]> = [
	["", 0],
	["hello world", 0],
	["Aa1 -._", 0],
	// Disallowed punctuation / symbols stripped.
	["a!b@c#d$e%", 0],
	["<script>alert(1)</script>", 0],
	// Non-Latin scripts (allowed: any \p{L}).
	[" Crypto", 0], // Cyrillic с
	["日本語 テスト", 0],
	["Ωμέγα", 0],
	// Bidi / zero-width control chars (stripped).
	["ab‮cd", 0],
	["a​b‌c‍d", 0],
	["﻿lead", 0],
	// Emoji (not \p{L}) stripped.
	["a😀b", 0],
	// Length truncation.
	["abcdefghij", 4],
	["日本語テスト", 3],
	["", 5],
	// Truncation applied AFTER stripping.
	["a!!!!!bcdef", 3],
]

describe("sanitizeString cross-package parity (Q-12)", () => {
	test("every fixture yields byte-identical output from both copies", () => {
		for (const [input, length] of FIXTURES) {
			expect(designSanitize(input, length)).toBe(extensionSanitize(input, length))
		}
	})
})
