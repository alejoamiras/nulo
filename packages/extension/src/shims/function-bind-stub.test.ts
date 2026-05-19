/**
 * Contract tests for the CSP-safe `function-bind` replacement.
 *
 * Validates that the stub is API-compatible with `Function.prototype.bind`
 * for the cases upstream `function-bind` consumers depend on:
 *   - `bind.call(thisArg, ...args)` returns a function bound to thisArg
 *   - the returned function applies its own args after the bound ones
 *   - the returned function's length reflects bound-arg consumption
 *   - `bind.apply(...)` works (some consumers go through it)
 *
 * Failure here means the shim drift from the real `function-bind` and
 * something in the @aztec/* graph (or another transitive dep) will silently
 * break under MV3 CSP.
 */

import { describe, expect, test } from "vitest"
// biome-ignore lint/suspicious/noExplicitAny: CJS interop for the module-as-function shim.
const bind = require("./function-bind-stub.cjs") as (this: unknown, that: unknown, ...args: unknown[]) => any

describe("function-bind-stub", () => {
	test("module export is a function (CJS module-as-function shape)", () => {
		expect(typeof bind).toBe("function")
	})

	test("bind.call(thisArg, ...args) returns a callable bound to thisArg", () => {
		const fn = function (this: { x: number }, y: number) {
			return this.x + y
		}
		const bound = bind.call(fn, { x: 10 })
		expect(bound(5)).toBe(15)
	})

	test("bound function partially applies leading args", () => {
		const fn = (a: number, b: number, c: number) => a + b + c
		const bound = bind.call(fn, null, 1, 2)
		expect(bound(3)).toBe(6)
	})

	test("bound function's length reflects consumed bound args", () => {
		const fn = (_a: number, _b: number, _c: number): number => 0
		// fn.length === 3; binding (this, a) consumes 1 → bound.length === 2
		const bound = bind.call(fn, null, 0)
		expect(bound.length).toBe(2)
	})

	test("bind.apply(thisArg, [args]) is supported (some consumers use it)", () => {
		const fn = function (this: { x: number }, y: number) {
			return this.x * y
		}
		const bound = bind.apply(fn, [{ x: 3 }, 4])
		expect(bound()).toBe(12)
	})
})
