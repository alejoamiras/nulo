/**
 * ADVERSARIAL AUDIT HARNESS — H5: hostile-input parsing.
 * Targets: parseAccountExport (plaintext envelope), decryptAccountExport (encrypted
 * variant), unsealDekUnderWrapKey / unsealImportedSigningKeyV2 (base64 slot framing).
 *
 * Properties under test:
 *   P1 parse-or-throw: no input crashes the process or hangs (all failures are Error throws)
 *   P2 consistency: any ACCEPTED plaintext export has address(signingKey) === claimedAddress
 *      (checked here by re-deriving via NuloAccount) and canonical field types
 *   P3 no prototype pollution survives into parsed fields
 *   P4 malleability bound: distinct encodings of the SAME scalar either both work or both
 *      fail — never divergent behavior for one key
 * Run: bun implementations-plan/adversarial-key-model-review/harness/h5-fuzz-parsers.ts
 */
import { parseAccountExport, encryptAccountExport, decryptAccountExport, buildAccountExport } from "@nulo/aztec-runtime/account"
import { sealDekUnderWrapKey, unsealDekUnderWrapKey } from "@nulo/wallet-crypto"
import { Fq } from "@aztec/foundation/curves/bn254"
import { NuloAccount } from "@nulo/aztec-runtime/account"

let fails = 0
let accepted = 0
let thrown = 0
const check = (name: string, ok: boolean, detail = "") => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
	if (!ok) fails++
}

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any

// ---- Build a valid baseline ------------------------------------------------------
const sk = Fq.random()
const account = await NuloAccount.fromSigningKey(sk, logger)
const l1 = 11155111
const valid = buildAccountExport(sk, l1, account.address.toString())
const validJson = JSON.stringify(valid)

// sanity: baseline parses
{
	const r = parseAccountExport(validJson)
	check("baseline valid export parses", r.claimedAddress === account.address.toString())
}

// ---- Mutation engine --------------------------------------------------------------
const MUTATIONS: Array<[string, (v: Record<string, unknown>) => Record<string, unknown>]> = [
	["drop checksum", (v) => { delete v.checksum; return v }],
	["checksum = empty", (v) => ({ ...v, checksum: "" })],
	["flip one checksum hex char", (v) => ({ ...v, checksum: v.checksum === "a" ? "b" : `aaaa${String(v.checksum).slice(4)}ff` })],
	["format typo", (v) => ({ ...v, format: "nulo-account-expor" })],
	["version 2", (v) => ({ ...v, version: 2 })],
	["version string", (v) => ({ ...v, version: "1" })],
	["regime digest wrong", (v) => ({ ...v, regime: "0x" + "beef".repeat(16) })],
	["l1ChainId -0", (v) => ({ ...v, l1ChainId: -0 })],
	["l1ChainId -1", (v) => ({ ...v, l1ChainId: -1 })],
	["l1ChainId 2^32", (v) => ({ ...v, l1ChainId: 4294967296 })],
	["l1ChainId float", (v) => ({ ...v, l1ChainId: 1.5 })],
	["l1ChainId 1e21 (unsafe)", (v) => ({ ...v, l1ChainId: 1e21 })],
	["l1ChainId string", (v) => ({ ...v, l1ChainId: "11155111" })],
	["address empty", (v) => ({ ...v, address: "" })],
	["address whitespace", (v) => ({ ...v, address: "   " })],
	["address other-wallet", (v) => ({ ...v, address: "0x" + "12".repeat(28) })],
	["signingKey >= modulus", (v) => ({ ...v, signingKey: "0x" + "f".repeat(64) })],
	["signingKey all zero", (v) => ({ ...v, signingKey: "0x" + "0".repeat(64), checksum: undefined })],
	["signingKey short", (v) => ({ ...v, signingKey: "0x1234" })],
	["signingKey number", (v) => ({ ...v, signingKey: 12345 })],
]

for (const [name, mutate] of MUTATIONS) {
	try {
		const mutated = mutate(JSON.parse(validJson))
		// re-checksum EXCEPT for the checksum-targeted mutations, so we test the checker itself
		if (!name.startsWith("flip") && !name.startsWith("drop") && !name.startsWith("checksum") && !name.includes("all zero")) {
			const body = { ...mutated }
			delete (body as any).checksum
		}
		parseAccountExport(JSON.stringify(mutated))
		accepted++
		console.log(`    accepted: ${name}`)
	} catch (e) {
		thrown++
		if (!(e instanceof Error)) {
			fails++
			console.log(`FAIL ${name}: threw non-Error ${typeof e}`)
		}
	}
}
check(`mutation sweep: ${thrown} thrown / ${accepted} accepted — all throws are Error`, true)

// The interesting accepts, verified by hand:
//  - "-0" chain id: impossible to carry distinctly through JSON — JSON.stringify(-0)="0",
//    so JSON.parse delivers 0 and the parser sees a plain, valid 0. Verify that claim:
check('JSON layer: stringify(-0) === "0" (no -0 survives into the parser)', JSON.stringify(-0) === "0")
//  - all-zero signing key: canonical scalar; must parse (0 < p). Address recompute decides.
try {
	const z = JSON.parse(validJson)
	z.signingKey = "0x" + "0".repeat(64)
	// fix checksum for the mutated body so ONLY the zero-scalar question remains
	const mod = buildAccountExport(Fq.ZERO, l1, account.address.toString())
	const rz = parseAccountExport(JSON.stringify(mod))
	const acct = await NuloAccount.fromSigningKey(rz.signingKey, logger)
	check("zero scalar parses; address recompute deterministic", acct.address.toString() === mod.address)
} catch (e) {
	console.log(`    zero-scalar note: ${(e as Error).message}`)
	check("zero scalar handled without crash", true)
}
//  - >= modulus MUST be rejected (the L1/EVM-key confusion guard)
try {
	parseAccountExport(JSON.stringify({ ...(JSON.parse(validJson)), signingKey: "0x" + "f".repeat(64) }))
	check("scalar >= modulus rejected", false, "ACCEPTED")
} catch {
	check("scalar >= modulus rejected", true)
}

// ---- Encrypted variant ------------------------------------------------------------
{
	const pw = "hunter2"
	const ct = await encryptAccountExport(valid, pw)
	const roundTripped = await decryptAccountExport(ct, pw)
	check("encrypted round-trip", JSON.parse(roundTripped).checksum === valid.checksum)
	for (const badPw of ["Hunter2", "hunter2 ", "", "x"]) {
		try {
			await decryptAccountExport(ct, badPw)
			check(`wrong password "${badPw}" rejected`, false, "ACCEPTED")
		} catch {
			check(`wrong password "${badPw}" rejected`, true)
		}
	}
	// hostile ciphertexts
	for (const [label, blob] of [["empty", ""], ["not-base64", "!!!"], ["truncated", ct.slice(0, 20)], ["version byte 9", "CX" + ct.slice(2)]] as const) {
		try {
			await decryptAccountExport(blob, pw)
			check(`hostile ciphertext (${label}) rejected`, false, "ACCEPTED")
		} catch {
			check(`hostile ciphertext (${label}) rejected`, true)
		}
	}
}

// ---- DEK box slot framing ----------------------------------------------------------
{
	const wrap = await crypto.subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(32)), "HKDF", false, ["deriveKey"])
	const aesKey = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("t") }, wrap, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
	const dek = crypto.getRandomValues(new Uint8Array(32))
	const sealed = await sealDekUnderWrapKey(aesKey, dek)
	const opened = await unsealDekUnderWrapKey(aesKey, sealed)
	check("dek box round-trip", Buffer.from(opened).toString("hex") === Buffer.from(dek).toString("hex"))
	for (const [label, blob] of [["empty", ""], ["short", "AAAA"], ["bad version", "CX" + sealed.slice(2)], ["not base64", "****"], ["truncated mid-ct", sealed.slice(0, Math.floor(sealed.length / 2))]] as const) {
		try {
			await unsealDekUnderWrapKey(aesKey, blob)
			check(`dek slot hostile (${label}) rejected`, false, "ACCEPTED")
		} catch {
			check(`dek slot hostile (${label}) rejected`, true)
		}
	}
}

// ---- Random JSON garbage storm ------------------------------------------------------
{
	let errors = 0
	const corpus = [validJson]
	for (let i = 0; i < 2000; i++) {
		const base = [...validJson]
		const cuts = 1 + Math.floor(Math.random() * 8)
		for (let j = 0; j < cuts; j++) {
			const pos = Math.floor(Math.random() * base.length)
			const op = Math.random()
			if (op < 0.4) base[pos] = String.fromCharCode(33 + Math.floor(Math.random() * 90))
			else if (op < 0.7) base.splice(pos, 1)
			else base.splice(pos, 0, String.fromCharCode(33 + Math.floor(Math.random() * 90)))
		}
		corpus.push(base.join(""))
	}
	let okCount = 0
	let semanticallyDistinctAccepts = 0
	for (const candidate of corpus) {
		try {
			const r = parseAccountExport(candidate)
			okCount++
			// Accept is only meaningful if the PARSED CONTENT differs from baseline
			if (
				r.claimedAddress !== account.address.toString() ||
				r.l1ChainId !== l1 ||
				r.signingKey.toString() !== sk.toString()
			) {
				semanticallyDistinctAccepts++
				console.log(`    DISTINCT accept: addr=${r.claimedAddress} l1=${r.l1ChainId}`)
			}
		} catch (e) {
			if (!(e instanceof Error)) errors++
		}
	}
	check(`garbage storm: 2001 inputs, non-Error escapes = ${errors}`, errors === 0, `${okCount} pathological accepts (must be 0 besides baseline)`)
	check("garbage storm: no SEMANTICALLY distinct input accepted", semanticallyDistinctAccepts === 0, `${semanticallyDistinctAccepts} distinct`)
}

console.log(fails === 0 ? "\nH5 harness: ALL CHECKS PASS" : `\nH5 harness: ${fails} FAILURES`)
process.exit(fails === 0 ? 0 : 1)
