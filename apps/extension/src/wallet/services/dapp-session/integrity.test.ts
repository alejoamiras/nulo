import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { BUFFER_BINDINGS, withBuffer } from "../../../../tests/helpers/shipped-buffer"
import { AccessLevel } from "./service"
import { canonicalizeDappSession, signDappSession, verifyDappSession, type SignableDappSession } from "./integrity"

let key: CryptoKey
let otherKey: CryptoKey

beforeAll(async () => {
	key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
	otherKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
})

const row = (over: Partial<SignableDappSession> = {}): SignableDappSession =>
	({
		id: "s1",
		profileId: "p1",
		chainId: "1",
		dappMetadata: { name: "dapp", url: "https://dapp.example" },
		permissions: [],
		accounts: ["0xabc"],
		confirmationLevel: AccessLevel.Transactions,
		expiry: 123,
		...over,
	}) as SignableDappSession

describe("DappSession integrity (F-12)", () => {
	test("sign/verify round-trips", async () => {
		const mac = await signDappSession(key, row())
		expect(await verifyDappSession(key, row(), mac)).toBe(true)
	})

	test("canonical encoding is stable regardless of key insertion order", () => {
		const forward = canonicalizeDappSession(row())
		// same fields, reversed construction order — `stableStringify` sorts keys.
		const reversed = canonicalizeDappSession({
			expiry: 123,
			confirmationLevel: AccessLevel.Transactions,
			accounts: ["0xabc"],
			permissions: [],
			dappMetadata: { url: "https://dapp.example", name: "dapp" },
			chainId: "1",
			profileId: "p1",
			id: "s1",
		} as SignableDappSession)
		expect(Buffer.from(forward).toString()).toBe(Buffer.from(reversed).toString())
	})

	test("a tampered accounts list fails verification (mint-grant defense)", async () => {
		const mac = await signDappSession(key, row())
		expect(await verifyDappSession(key, row({ accounts: ["0xabc", "0xATTACKER"] }), mac)).toBe(false)
	})

	test("cross-profile / cross-key replay fails (per-profile key)", async () => {
		const mac = await signDappSession(key, row())
		expect(await verifyDappSession(otherKey, row(), mac)).toBe(false)
	})

	test("replay under a different session id fails (id is covered)", async () => {
		const mac = await signDappSession(key, row())
		expect(await verifyDappSession(key, row({ id: "s2" }), mac)).toBe(false)
	})

	test("empty or non-base64 mac → false, never throws", async () => {
		expect(await verifyDappSession(key, row(), "")).toBe(false)
		expect(await verifyDappSession(key, row(), "!!!not-base64!!!")).toBe(false)
	})
})

describe.each(BUFFER_BINDINGS)("stored-MAC decode is lenient (%s Buffer)", (_name, binding) => {
	afterEach(() => vi.unstubAllGlobals())

	/** A fixed key and the first row whose MAC uses `+`, `/` and `=`, so each variant below differs
	 *  from the canonical string. */
	async function fixture(): Promise<{ fixedKey: CryptoKey; signed: SignableDappSession; mac: string }> {
		const raw = new Uint8Array(32).map((_, i) => i * 7 + 1)
		const fixedKey = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
		for (let i = 0; i < 64; i++) {
			const signed = row({ id: `s${i}` })
			const mac = await signDappSession(fixedKey, signed)
			if (mac.includes("+") && mac.includes("/") && mac.endsWith("=")) return { fixedKey, signed, mac }
		}
		throw new Error("no fixture MAC uses + / and =")
	}

	test("junk, URL-safe, unpadded and whitespace-split MACs still verify; junk bytes do not", async () => {
		const { fixedKey, signed, mac } = await fixture()
		withBuffer(binding)
		expect(await verifyDappSession(fixedKey, signed, mac)).toBe(true)
		expect(await verifyDappSession(fixedKey, signed, `${mac}!`)).toBe(true)
		expect(await verifyDappSession(fixedKey, signed, mac.replaceAll("+", "-").replaceAll("/", "_"))).toBe(true)
		expect(await verifyDappSession(fixedKey, signed, mac.replace(/=+$/, ""))).toBe(true)
		expect(await verifyDappSession(fixedKey, signed, `${mac.slice(0, 20)} \n${mac.slice(20)}`)).toBe(true)
		expect(await verifyDappSession(fixedKey, signed, "")).toBe(false)
		expect(await verifyDappSession(fixedKey, signed, "!!!not-base64!!!")).toBe(false)
	})
})
