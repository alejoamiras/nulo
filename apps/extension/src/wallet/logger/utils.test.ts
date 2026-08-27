import { describe, expect, test } from "vitest"
import { trim } from "./utils"

/**
 * `trim()` is the only redaction between a log call and the log store, and until now it had no
 * test at all. These assert ABSENCE of values, not output shape, so they keep failing if the
 * output is refactored but a secret starts surviving again.
 */

const SECRET = "correct-horse-battery-staple"

describe("trim — secret key names", () => {
	const cases: Array<[string, unknown]> = [
		["masterKey", SECRET],
		["master-key", SECRET],
		["importedKeysDek", SECRET],
		["imported-keys-dek", SECRET],
		["imported-keys-dek-sealed", SECRET],
		["dek", SECRET],
		["dekSealed", SECRET],
		["encryptedSigningKey", SECRET],
		["signingKey", SECRET],
		["privateKey", SECRET],
		["entropy", SECRET],
		["mnemonic", [SECRET]],
		["seedPhrase", SECRET],
		["password", SECRET],
		["passhash", SECRET],
		["passphrase", SECRET],
		["prf", SECRET],
		["wrappedSecret", SECRET],
		["envelopeMac", SECRET],
		["bearer", SECRET],
	]

	test.each(cases)("blanks %s", (key, value) => {
		const out = trim({ [key]: value, keepMe: "visible" })
		expect(JSON.stringify(out)).not.toContain(SECRET)
		expect((out as Record<string, unknown>)[key]).toBe(`[${key}]`)
		expect((out as Record<string, unknown>).keepMe).toBe("visible")
	})

	test("still blanks the original five proof-material keys", () => {
		const out = trim({ acir: SECRET, authWitnesses: SECRET, partialWitness: SECRET, publicInputs: SECRET, vk: SECRET })
		expect(JSON.stringify(out)).not.toContain(SECRET)
	})

	test("blanks a nested secret, not just a top-level one", () => {
		const out = trim({ outer: { inner: { password: SECRET } } })
		expect(JSON.stringify(out)).not.toContain(SECRET)
	})

	test("does NOT blank the ambiguous keys `secret` and `token`", () => {
		// Both are handled by shape where they matter; banning the words would blind ordinary
		// diagnostics (`Profile.secret` is ciphertext, `token` is usually a token contract).
		const out = trim({ secret: "ciphertext-blob", token: "0xabc" }) as Record<string, unknown>
		expect(out.secret).toBe("ciphertext-blob")
		expect(out.token).toBe("0xabc")
	})
})

describe("trim — non-plain objects", () => {
	test("does not EXPAND a typed array into one field per byte", () => {
		// Object.entries(new Uint8Array([1,2,3])) is [["0",1],["1",2],["2",3]] — the generic walk
		// would have serialized raw key bytes instead of hiding them.
		const key = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
		const out = trim({ key })
		expect((out as Record<string, unknown>).key).toBe("[Uint8Array(8)]")
		expect(JSON.stringify(out)).not.toContain('"0":1')
	})

	test("summarises ArrayBuffer, Map and Set instead of losing them to {}", () => {
		expect(trim(new ArrayBuffer(16))).toBe("[ArrayBuffer(16)]")
		expect(trim(new Map([["a", SECRET]]))).toBe("[Map(1)]")
		expect(trim(new Set([SECRET]))).toBe("[Set(1)]")
	})

	test("renders a Date instead of collapsing it to {}", () => {
		expect(trim(new Date("2026-08-27T10:00:00.000Z"))).toBe("2026-08-27T10:00:00.000Z")
	})

	test("an invalid Date does not turn a log call into an exception", () => {
		// `toISOString()` throws "Invalid time value" — the one thing a logger must never do.
		expect(() => trim(new Date("not-a-date"))).not.toThrow()
		expect(trim(new Date("not-a-date"))).toBe("[Invalid Date]")
	})
})

describe("trim — errors", () => {
	test("keeps name and message where it previously produced {}", () => {
		const out = trim(new Error("boom")) as Record<string, unknown>
		expect(out.name).toBe("Error")
		expect(out.message).toBe("boom")
	})

	test("drops the stack", () => {
		const out = trim(new Error("boom")) as Record<string, unknown>
		expect(out).not.toHaveProperty("stack")
	})

	test("scrubs a credential-bearing URL out of the message", () => {
		const out = trim(new Error(`fetch failed for https://rpc.example.com/v2/SUPER-SECRET-KEY?apiKey=${SECRET}`))
		expect(JSON.stringify(out)).not.toContain(SECRET)
		expect(JSON.stringify(out)).not.toContain("SUPER-SECRET-KEY")
		expect((out as Record<string, unknown>).message).toContain("https://rpc.example.com")
	})

	test("scrubs a websocket endpoint, not just http", () => {
		// The Aztec node transport is ws/wss, and those URLs carry API keys just the same.
		const out = trim(new Error(`socket closed: wss://node.example.com/v1/${SECRET}`))

		expect(JSON.stringify(out)).not.toContain(SECRET)
		expect((out as Record<string, unknown>).message).toContain("wss://node.example.com")
	})

	test("scrubs a protocol-relative endpoint", () => {
		const out = trim(new Error(`fetch failed: //rpc.example.com/v2/${SECRET}`))

		expect(JSON.stringify(out)).not.toContain(SECRET)
	})

	test("redacts a raw key-shaped blob interpolated into the message", () => {
		// The commonest way a secret reaches a log without anyone choosing to log it.
		const blob = "dGhpcy1pcy1hLXZlcnktbG9uZy1zZWFsZWQta2V5LWJsb2ItdmFsdWU="
		const out = trim(new Error(`failed to unseal ${blob}`))

		expect(JSON.stringify(out)).not.toContain(blob)
		expect((out as Record<string, unknown>).message).toContain("[redacted]")
	})

	test("leaves ordinary prose alone", () => {
		const out = trim(new Error("Network not found")) as Record<string, unknown>
		expect(out.message).toBe("Network not found")
	})

	test("caps a long message", () => {
		const out = trim(new Error("x".repeat(5000))) as Record<string, unknown>
		expect((out.message as string).length).toBeLessThanOrEqual(200)
	})

	test("handles a subclassed error", () => {
		class RpcError extends Error {
			public constructor() {
				super("nope")
				this.name = "RpcError"
			}
		}
		const out = trim(new RpcError()) as Record<string, unknown>
		expect(out.name).toBe("RpcError")
		expect(out.message).toBe("nope")
	})
})

describe("trim — domain shapes", () => {
	test("never emits a note's decrypted content", () => {
		const note = {
			contract: "0xcontract",
			storageSlot: "0x1",
			txHash: "0xtx",
			rawContent: ["0xamount", "0xowner"],
			type: "UintNote",
			content: { amount: SECRET, owner: "0xowner" },
		}
		const out = trim(note) as Record<string, unknown>

		expect(JSON.stringify(out)).not.toContain(SECRET)
		expect(JSON.stringify(out)).not.toContain("0xamount")
		expect(out).toMatchObject({ note: "UintNote", contract: "0xcontract", rawContentLen: 2, contentKeys: 2 })
	})

	test("never emits an ActiveSession's plaintext master secret", () => {
		const out = trim({
			profile: { id: "p1", type: "password", dekSealed: "sealed" },
			session: { id: "s1" },
			secret: SECRET,
			dek: new Uint8Array(32),
		}) as Record<string, unknown>

		expect(JSON.stringify(out)).not.toContain(SECRET)
		expect(out).toEqual({ activeSession: true, profileId: "p1", degraded: false })
	})

	test("collapses a Profile, including the password arm's ciphertext", () => {
		const out = trim({
			id: "p1",
			name: "Main",
			type: "password",
			dekSealed: "sealed",
			guard: SECRET,
			secret: SECRET,
			entropy: SECRET,
			envelopeMac: SECRET,
		}) as Record<string, unknown>

		expect(JSON.stringify(out)).not.toContain(SECRET)
		expect(out).toEqual({ profileId: "p1", type: "password" })
	})

	test("keeps the existing contract-artifact collapses", () => {
		expect(trim({ nonDispatchPublicFunctions: [], name: "Token", bytecode: SECRET })).toEqual({ name: "Token" })
		expect(trim({ packedBytecode: SECRET, id: "0x1" })).toEqual({ id: "0x1" })
	})
})

describe("trim — endpoint URLs", () => {
	test("reduces an rpcUrl to its origin, keeping which endpoint failed", () => {
		const out = trim({ rpcUrl: `https://eth-mainnet.example.com/v2/${SECRET}` }) as Record<string, unknown>
		expect(JSON.stringify(out)).not.toContain(SECRET)
		expect(out.rpcUrl).toBe("https://eth-mainnet.example.com")
	})

	test("strips userinfo credentials too", () => {
		const out = trim({ submittedEndpointUrl: `https://user:${SECRET}@node.example.com/rpc` }) as Record<string, unknown>
		expect(JSON.stringify(out)).not.toContain(SECRET)
	})

	test("does not throw on a malformed url", () => {
		expect((trim({ rpcUrl: "not a url" }) as Record<string, unknown>).rpcUrl).toBe("[url]")
	})
})

describe("trim — structural guards retained", () => {
	test("caps recursion depth", () => {
		let deep: Record<string, unknown> = { value: "bottom" }
		for (let i = 0; i < 10; i++) deep = { nested: deep }
		expect(JSON.stringify(trim(deep))).toContain("[Object]")
	})

	test("passes primitives through untouched", () => {
		expect(trim("hello")).toBe("hello")
		expect(trim(42)).toBe(42)
		expect(trim(null)).toBe(null)
		expect(trim(undefined)).toBe(undefined)
		expect(trim(true)).toBe(true)
	})

	test("walks arrays", () => {
		expect(trim([{ password: SECRET }, "safe"])).toEqual([{ password: "[password]" }, "safe"])
	})
})
