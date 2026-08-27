import { describe, expect, test, vi } from "vitest"
import { definePassthroughs, definePassthroughsExhaustive } from "./service-client-factory"

/** Pin: definePassthroughs installs methods that forward to `this.request`
 *  preserving the method NAME and PARAMETER ORDER verbatim — the behavior the
 *  hand-written `return this.request("name", ...args)` bodies had. */
describe("definePassthroughs", () => {
	type M = {
		foo: (a: number, b: string) => Promise<string>
		bar: () => Promise<void>
	}

	function makeInstance() {
		const request = vi.fn(async (_method: string, ..._args: unknown[]) => "ok")
		class C {
			request = request
		}
		definePassthroughs<M>(C.prototype, ["foo", "bar"])
		return { instance: new C() as C & M, request }
	}

	test("forwards name + args in order", async () => {
		const { instance, request } = makeInstance()
		const r = await instance.foo(7, "x")
		expect(r).toBe("ok")
		expect(request).toHaveBeenCalledWith("foo", 7, "x")
	})

	test("forwards a no-arg method with just the name", async () => {
		const { instance, request } = makeInstance()
		await instance.bar()
		expect(request).toHaveBeenCalledWith("bar")
	})

	test("installs exactly the listed methods (no extras) and they are non-enumerable", () => {
		const { instance } = makeInstance()
		expect(typeof instance.foo).toBe("function")
		expect(typeof instance.bar).toBe("function")
		// Prototype methods must not be own-enumerable (mirrors real class methods).
		expect(Object.keys(instance)).not.toContain("foo")
	})

	test("installed methods carry their own name (stack-trace identity, not 'value')", () => {
		const { instance } = makeInstance()
		expect((instance.foo as { name: string }).name).toBe("foo")
		expect((instance.bar as { name: string }).name).toBe("bar")
	})

	test("returns whatever request returns (passthrough, no wrapping)", async () => {
		const request = vi.fn(async () => ({ shaped: true }))
		class C {
			request = request
		}
		definePassthroughs<{ baz: () => Promise<{ shaped: boolean }> }>(C.prototype, ["baz"])
		const instance = new C() as C & { baz: () => Promise<{ shaped: boolean }> }
		expect(await instance.baz()).toEqual({ shaped: true })
	})
})

describe("definePassthroughsExhaustive", () => {
	type M = {
		foo: (a: number) => Promise<number>
		bar: () => Promise<void>
	}

	test("installs identically to definePassthroughs when the list is complete", async () => {
		const request = vi.fn(async (_m: string, ..._a: unknown[]) => 42)
		class C {
			request = request
		}
		definePassthroughsExhaustive<M>()(C.prototype, ["foo", "bar"])
		const instance = new C() as C & M
		expect(await instance.foo(1)).toBe(42)
		expect(request).toHaveBeenCalledWith("foo", 1)
		expect((instance.bar as { name: string }).name).toBe("bar")
	})

	// Compile-time proof, both directions. Inside a never-executed function so the
	// intentionally-invalid calls are typechecked (typecheck covers src/**/*.test.ts)
	// without vitest ever installing anything from them.
	function _compileTimeProof(): void {
		// @ts-expect-error a MISSING Methods key ("bar") must fail the installer's signature
		definePassthroughsExhaustive<M>()(class {}.prototype, ["foo"])
		// @ts-expect-error an EXTRA/typo'd key must fail the tuple's element constraint
		definePassthroughsExhaustive<M>()(class {}.prototype, ["foo", "bar", "nope"])
	}
	void _compileTimeProof
})
