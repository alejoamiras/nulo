/**
 * F-12: row-integrity (MAC) for `DappSession` rows.
 *
 * `chrome.storage.local` is tamperable; an attacker editing a row to add
 * `capabilityGrants` (or flip `confirmationLevel`, swap `accounts`, replay a
 * row under a different `id`/`profileId`) would mint capabilities the user
 * never approved. Each row carries an HMAC-SHA256 over its canonicalized
 * contents, keyed by a per-profile non-extractable key derived from the
 * profile master secret. On read a row that fails verification (or has no
 * `mac`) is DROPPED — no legacy verifier, no repair from stored contents.
 *
 * The key derivation + `verify`/`sign` primitive live behind
 * `ProfileService.deriveDappSessionMacKey` so `DappSessionService` never sees
 * the master secret or the HKDF details — it only holds a non-extractable
 * `CryptoKey` and calls these helpers.
 */

import type { DappSession } from "./spec"

/** The signed view of a row: everything except the `mac` field itself. */
export type SignableDappSession = Omit<DappSession, "mac">

/**
 * Deterministic canonical encoding for signing: recursively key-sorted,
 * whitespace-free UTF-8 JSON. Arrays stay order-sensitive (reordering is
 * tampering). `undefined` properties are omitted; non-finite numbers and
 * bigints are rejected (never valid in a persisted row).
 */
export function canonicalizeDappSession(row: SignableDappSession): Uint8Array<ArrayBuffer> {
	return new TextEncoder().encode(stableStringify(row))
}

function stableStringify(value: unknown): string {
	if (value === null) return "null"
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
	if (typeof value === "object") {
		const obj = value as Record<string, unknown>
		const keys = Object.keys(obj)
			.filter((k) => obj[k] !== undefined)
			.sort()
		return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`
	}
	if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-finite number in DappSession row")
	if (typeof value === "bigint") throw new Error("bigint in DappSession row")
	return JSON.stringify(value)
}

/** HMAC-SHA256 the canonical row; returns the MAC as base64. */
export async function signDappSession(key: CryptoKey, row: SignableDappSession): Promise<string> {
	const mac = await crypto.subtle.sign("HMAC", key, canonicalizeDappSession(row))
	return Buffer.from(new Uint8Array(mac)).toString("base64")
}

/** Constant-time (WebCrypto `verify`) check of a row against its stored MAC. */
export async function verifyDappSession(key: CryptoKey, row: SignableDappSession, mac: string): Promise<boolean> {
	let macBytes: Uint8Array<ArrayBuffer>
	try {
		macBytes = new Uint8Array(Buffer.from(mac, "base64"))
	} catch {
		return false
	}
	if (macBytes.length === 0) return false
	try {
		return await crypto.subtle.verify("HMAC", key, macBytes, canonicalizeDappSession(row))
	} catch {
		return false
	}
}
