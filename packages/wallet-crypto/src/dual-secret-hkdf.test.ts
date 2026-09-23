import { hkdfSync } from "node:crypto"
import { describe, expect, test } from "vitest"
import { DAPP_SESSION_MAC_LABEL, deriveDappSessionMacKey } from "./dapp-session-mac-key"
import { derivePxeStoreKey, PXE_STORE_KDF_LABEL } from "./pxe-store-key"
import { asImportedKeysDek, asMasterSecretBytes } from "./secret-types"

const bytes = (fill: number, len = 32) => new Uint8Array(len).fill(fill) as Uint8Array<ArrayBuffer>
const MASTER = asMasterSecretBytes(bytes(7))
const DEK = asImportedKeysDek(bytes(0x11))
const OTHER_DEK = asImportedKeysDek(bytes(0x12))
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex")

const sign = async (key: CryptoKey, msg: string) =>
	Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg))).toString("hex")

describe("dual-secret HKDF derivations (master ‖ dek — a same-phrase sibling holds the master, never the dek)", () => {
	test("PXE store key: matches an independent HKDF(master‖dek) reference and is bound to the dek AND the profile", async () => {
		expect(PXE_STORE_KDF_LABEL).toBe("nulo:pxe-store:v2")
		const key = await derivePxeStoreKey(MASTER, DEK, "profile-1")
		const reference = hkdfSync(
			"sha256",
			Buffer.concat([Buffer.from(MASTER), Buffer.from(DEK)]),
			Buffer.from("nulo:pxe-store-salt:profile-1"),
			Buffer.from("nulo:pxe-store:v2"),
			32,
		)
		expect(hex(key)).toBe(Buffer.from(reference).toString("hex"))
		expect(hex(await derivePxeStoreKey(MASTER, OTHER_DEK, "profile-1"))).not.toBe(hex(key))
		expect(hex(await derivePxeStoreKey(MASTER, DEK, "profile-2"))).not.toBe(hex(key))
		// A master-only derivation (the retired v1 shape) shares nothing with v2.
		const masterOnly = hkdfSync(
			"sha256",
			Buffer.from(MASTER),
			Buffer.from("nulo:pxe-store-salt:profile-1"),
			Buffer.from("nulo:pxe-store:v1"),
			32,
		)
		expect(hex(key)).not.toBe(Buffer.from(masterOnly).toString("hex"))
	})

	test("dApp-session MAC key: non-extractable HMAC, distinct per dek under one master", async () => {
		expect(DAPP_SESSION_MAC_LABEL).toBe("nulo:dappsession-mac:v2")
		const k1 = await deriveDappSessionMacKey(MASTER, DEK)
		const k2 = await deriveDappSessionMacKey(MASTER, OTHER_DEK)
		expect(k1.extractable).toBe(false)
		expect(k1.usages).toEqual(["sign", "verify"])
		expect(await sign(k1, "row")).toBe(await sign(await deriveDappSessionMacKey(MASTER, DEK), "row"))
		expect(await sign(k1, "row")).not.toBe(await sign(k2, "row"))
		const reference = hkdfSync(
			"sha256",
			Buffer.concat([Buffer.from(MASTER), Buffer.from(DEK)]),
			Buffer.from("nulo:dappsession-mac:salt:v2"),
			Buffer.from("nulo:dappsession-mac:v2"),
			// WebCrypto's HMAC-SHA-256 `deriveKey` without `length` takes the hash BLOCK size (64 bytes).
			64,
		)
		const refKey = await crypto.subtle.importKey("raw", reference, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
		expect(await sign(k1, "row")).toBe(await sign(refKey, "row"))
	})

	test("a 31-byte dek or master is rejected before any derivation (the 32+32 split is the key contract)", async () => {
		const short = asImportedKeysDek(bytes(0x11, 31))
		await expect(derivePxeStoreKey(MASTER, short, "p")).rejects.toThrow(/32-byte/)
		await expect(deriveDappSessionMacKey(MASTER, short)).rejects.toThrow(/32-byte/)
		await expect(derivePxeStoreKey(asMasterSecretBytes(bytes(7, 31)), DEK, "p")).rejects.toThrow(/32-byte/)
	})
})
