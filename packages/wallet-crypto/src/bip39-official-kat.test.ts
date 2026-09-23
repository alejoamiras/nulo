import { describe, expect, test } from "vitest"
import official from "../vectors/bip39-official-english.json"
import { deriveBip39Seed } from "./mnemonic-master"

/**
 * The OFFICIAL BIP-39 English test vectors, all 24 rows — the external oracle for the first step
 * of NULO-ACCOUNT-KDF v2.
 *
 * Every other test in this package compares the implementation against values this repository
 * produced. That catches regressions but not misreadings: code written from a wrong reading of the
 * spec, tested against vectors captured from that same code, is green forever. These expected
 * seeds were published by the BIP-39 reference implementation's authors, so they cannot share a
 * mistake with anything here. Provenance + retrieval command: `../vectors/PROVENANCE.md`.
 *
 * A green row proves at once — with no partial credit, since any one error changes the whole seed
 * — that PBKDF2 is correct, that the PRF is HMAC-SHA512, that the iteration count is exactly 2048,
 * that the salt is `"mnemonic" ‖ NFKD(passphrase)`, and that sentence normalization is NFKD.
 */

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")

describe("BIP-39 official English vectors", () => {
	// Guards the vendored file itself: a truncated, re-serialized, or partially-edited copy must
	// fail loudly here rather than silently shrink the oracle to the rows that still happen to pass.
	test("the vendored vector set is intact (24 rows, 12/18/24 words, 64-byte seeds)", () => {
		expect(official).toHaveLength(24)
		for (const row of official) {
			expect([12, 18, 24]).toContain(row.mnemonic.split(" ").length)
			expect(row.seedTrezor).toMatch(/^[0-9a-f]{128}$/)
			expect(row.entropy).toMatch(/^[0-9a-f]{32}$|^[0-9a-f]{48}$|^[0-9a-f]{64}$/)
		}
		// The vectors must not all share one entropy shape, or the set would prove far less than
		// it appears to.
		expect(new Set(official.map((r) => r.mnemonic.split(" ").length)).size).toBe(3)
	})

	for (const [i, row] of official.entries()) {
		test(`row ${i}: ${row.mnemonic.split(" ").slice(0, 3).join(" ")}… → published seed`, async () => {
			expect(toHex(await deriveBip39Seed(row.mnemonic.split(" "), "TREZOR"))).toBe(row.seedTrezor)
		})
	}

	// The published rows all use passphrase "TREZOR"; production uses "". Without this, a bug that
	// ignored the passphrase entirely would still pass all 24 rows above.
	test("the passphrase is load-bearing — production ('') seeds differ from the published ones", async () => {
		for (const row of official) {
			const words = row.mnemonic.split(" ")
			expect(toHex(await deriveBip39Seed(words))).not.toBe(row.seedTrezor)
		}
	})
})
