/** ADVERSARIAL HARNESS — H2 support: measured per-guess cost of the at-rest KDF chain,
 * plus proof that SHA-256(password) prehashing changes nothing about offline attack cost
 * and that the per-ciphertext salt (sha256(iv), 96-bit IV) defeats precomputed tables. */
const enc = new TextEncoder()

async function timed(name: string, fn: () => Promise<void>) {
	const t0 = performance.now()
	await fn()
	console.log(`${name}: ${(performance.now() - t0).toFixed(1)} ms`)
}

// The real chain for one password guess against a sealed row:
// SHA-256(p) -> importKey -> PBKDF2-SHA256 600k -> AES-GCM decrypt attempt.
await timed("one full guess (SHA256 + PBKDF2-600k + AES-GCM)", async () => {
	const passhash = await crypto.subtle.digest("SHA-256", enc.encode("CorrectHorseBatteryStaple"))
	const baseKey = await crypto.subtle.importKey("raw", passhash, "PBKDF2", false, ["deriveKey"])
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const salt = await crypto.subtle.digest("SHA-256", iv)
	const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 600_000 }, baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
	try {
		await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, new Uint8Array(29))
	} catch {
		// expected wrong-key rejection — the cost is the point, not the outcome
	}
})

// Same-password two profiles -> identical passhash (transplant-class enabler), but
// distinct ciphertext keys (per-IV salt) — demonstrate key divergence:
{
	const mkKey = async (ivByte: number) => {
		const passhash = await crypto.subtle.digest("SHA-256", enc.encode("same-password"))
		const baseKey = await crypto.subtle.importKey("raw", passhash, "PBKDF2", false, ["deriveKey"])
		const iv = new Uint8Array(12).fill(ivByte)
		const salt = await crypto.subtle.digest("SHA-256", iv)
		return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1000 }, baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"])
	}
	const k1 = await mkKey(1)
	const k2 = await mkKey(2)
	const pt = crypto.getRandomValues(new Uint8Array(32))
	const c1 = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(12).fill(1) }, k1, pt))
	let c1OpensUnderK2 = false
	try {
		await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(12).fill(1) }, k2, c1)
		c1OpensUnderK2 = true
	} catch {}
	console.log(`same password, different IV -> ciphertext of profile A opens under profile B key: ${c1OpensUnderK2 ? "YES (bad)" : "no (per-IV salt binds)"}`)
}
console.log("H2 measurements done")
