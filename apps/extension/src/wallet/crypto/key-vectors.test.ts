/**
 * Cryptographic derivation test vectors.
 *
 * Purpose
 * -------
 * Lock the cryptographic derivation invariants used to
 *   (a) encrypt the profile master secret at rest (`EncryptionKey`),
 *   (b) derive a passkey-wallet master secret from WebAuthn PRF +
 *       credentialId (`PasskeyCredential`),
 *   (c) derive the per-account signing key from the account seed
 *       (`deriveSigningKeyFromSeed` — NULO-ACCOUNT-KDF v2 in
 *       `@nulo/wallet-crypto`, the signing-key-root model adopted at
 *       Aztec 5.0.0; upstream's removed `deriveSigningKey` construction
 *       under the dedicated Nulo separator, reference-vectored in
 *       `implementations-plan/key-model-v2/reference/`).
 *
 * Any accidental drift in a refactor here, or a silent upstream change
 * in `@aztec/foundation` or `@aztec/stdlib`, fails one of these tests
 * before it bricks every existing wallet on disk.
 *
 * On upgrading `@aztec/*` — the ritual
 * ------------------------------------
 * Some vectors are Aztec-stack sensitive: V3 (`Fr.fromBufferReduce`),
 * V7a (`deriveSigningKeyFromSeed` = sha512-to-grumpkin-scalar + the
 * NULO_SIGNING_ROOT_SEP domain separator). When you bump `@aztec/foundation`,
 * `@aztec/stdlib`, or `@aztec/accounts`:
 *
 *   1. Run `bun run test`.
 *   2. If any vector in this file fails, **do not blindly regenerate**.
 *   3. Classify each failure:
 *        (a) Neutral wrap / rename — upstream just moved the code.
 *            Confirm the underlying math is equivalent (independent
 *            recomputation or published reference). Then regenerate
 *            the fixture constant in this file and commit with
 *            "chore(crypto): regenerate fixtures for @aztec X.Y.Z —
 *            verified equivalent".
 *        (b) Backward-compatible primitive optimization — output bytes
 *            are identical. Test shouldn't fail; if it did, investigate
 *            why (endianness, serialization-order change).
 *        (c) Breaking derivation change — output bytes differ for the
 *            same inputs. **Stop and think.** This means existing
 *            wallets will derive different keys and brick. Pin the old
 *            version until a migration exists, or write the migration.
 *            V7a is the canary for this class — if it fails, the
 *            signing key of every wallet on disk just changed.
 *   4. Document the decision in the commit message.
 *
 * Aztec-independent vectors (V1, V2, V6, V8, V9, P1) survive any
 * `@aztec/*` bump — they exercise Web Crypto or constants only.
 *
 * Break-it-to-prove-it
 * --------------------
 * Each vector was validated by temporarily breaking the constant it
 * pins and confirming the test fails. See the per-vector header
 * comment for what's locked.
 *
 * Deferred vectors
 * ----------------
 * V4 (poseidon2Hash account secret), V10 (passkey → address full chain),
 * and P2 (Barretenberg Poseidon2 cross-check) require `@aztec/bb.js`
 * WASM poseidon2, which crashes in the vitest jsdom environment with
 * `BBApiException: std::bad_cast` on the WASM boundary. The downstream
 * chain V7a feeds (signingKey → privacy secret → NuloAccount address —
 * the old deferred V7b) IS now pinned end-to-end in a node environment:
 * `packages/aztec-runtime/src/account/derivation-vectors.test.ts`
 * against the committed regime-B reference vectors. The unit-level
 * locks V1–V9 still catch the bulk of regressions a refactor in this
 * area could introduce.
 */

import { describe, expect, test } from "vitest"
import { Fr } from "@aztec/foundation/curves/bn254"
import { deriveSigningKeyFromSeed } from "@nulo/wallet-crypto"
import { EncryptionKey } from "@nulo/wallet-crypto"
import { PasskeyCredential } from "@nulo/wallet-crypto"
import { PASSKEY_PRF_LABEL, PXE_STORE_KDF_LABEL, derivePxeStoreKey } from "@nulo/wallet-crypto"
import { AccountType } from "@/wallet/services/account/spec"

/** Reusable hex helper — keeps fixture constants readable. */
const toHex = (buf: ArrayBuffer | Uint8Array) => {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
}
const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)))

describe("M2.6 — cryptographic derivation vectors", () => {
	// ── V1: password hash ────────────────────────────────────────────
	//
	// Locks: SHA-256(UTF-8(password)). Platform Web Crypto, no Aztec dep.
	// Break it: change `getPasshash` from SHA-256 to SHA-384, this fails.
	test("V1 — getPasshash('hunter2') matches fixture", async () => {
		const passhash = await EncryptionKey.getPasshash("hunter2")
		expect(toHex(passhash)).toBe("f52fbd32b2b3b86ff88ef6c490628285f482af15ddcb29541f94bcf526a3f6c7")
	})

	// ── V2: AES-GCM round-trip with fixed IV ─────────────────────────
	//
	// Locks: PBKDF2-SHA256 at 600_000 iterations, salt = SHA-256(iv),
	// AES-GCM-256, 13-byte prefix [version][iv].
	// The committed ciphertext was captured by running the current
	// encrypt() with the same password, plaintext, and IV. Two
	// assertions hold it in place:
	//   (a) decrypt(COMMITTED_CIPHERTEXT) === PLAINTEXT (verifies the
	//       full decrypt chain against a real stored value), and
	//   (b) encrypt(PLAINTEXT, mocked IV) === COMMITTED_CIPHERTEXT
	//       (verifies encrypt's prefix assembly + AES tag emission).
	// Break it: change PBKDF2_ITERATIONS — both assertions fail.
	const V2_PASSWORD = "hunter2"
	const V2_PLAINTEXT_HEX = "deadbeefcafebabe0011223344556677"
	const V2_IV_HEX = "aaaaaaaaaaaaaaaaaaaaaaaa" // 12 bytes of 0xAA
	const V2_CIPHERTEXT_HEX = "00aaaaaaaaaaaaaaaaaaaaaaaabbf9b797c51cbfaff2e2be5c04eee5303a5eac28711a196e271c960d5ab16a49"

	test("V2a — decrypt(COMMITTED_CIPHERTEXT, password) === PLAINTEXT", async () => {
		const key = await EncryptionKey.fromPassword(V2_PASSWORD)
		const plaintext = await key.decrypt(fromHex(V2_CIPHERTEXT_HEX))
		expect(toHex(plaintext)).toBe(V2_PLAINTEXT_HEX)
	}, 10_000)

	test("V2b — encrypt(PLAINTEXT, mocked IV) === COMMITTED_CIPHERTEXT", async () => {
		const originalGRV = self.crypto.getRandomValues.bind(self.crypto)
		const iv = fromHex(V2_IV_HEX)
		// biome-ignore lint/suspicious/noExplicitAny: narrow mock with explicit restore in finally
		const grv = self.crypto.getRandomValues as any
		self.crypto.getRandomValues = ((target: Uint8Array) => {
			target.set(iv.slice(0, target.length))
			return target
		}) as typeof self.crypto.getRandomValues
		try {
			const key = await EncryptionKey.fromPassword(V2_PASSWORD)
			const ct = await key.encrypt(fromHex(V2_PLAINTEXT_HEX))
			expect(toHex(ct)).toBe(V2_CIPHERTEXT_HEX)
		} finally {
			self.crypto.getRandomValues = originalGRV
			void grv
		}
	}, 10_000)

	// ── V3: passkey master-secret derivation ─────────────────────────
	//
	// Locks: HKDF-SHA256, salt = SHA-256(PASSKEY_KDF_LABEL || credentialId),
	// info = PASSKEY_MASTER_LABEL, 512 output bits (the low-skew reduce form)
	// reduced through Fr.fromBufferReduce (big-endian, mod BN254 Fr modulus).
	// AZTEC-SENSITIVE: depends on Fr.fromBufferReduce semantics.
	// Break it: change PASSKEY_KDF_LABEL — fails.
	// Input PRF is 32 clean bytes base64-encoded; credentialId is a
	// short base64 identifier mimicking a real WebAuthn credential.
	// The expected value is REFERENCE-GENERATED, not captured from this
	// implementation: implementations-plan/key-model-v2-hardening/reference/
	// passkey-master-vector.ts recomputes it via node:crypto's HKDF (a
	// different implementation than the wallet's WebCrypto), so a
	// consistently mis-wired wallet HKDF cannot self-consistently pass.
	// Never re-pin from deriveMasterSecret's own output.
	const V3_PRF_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
	const V3_CREDENTIAL_ID_B64 = "dGVzdC1jcmVkZW50aWFsLWlk"

	test("V3 — PasskeyCredential master secret matches the reference vector", async () => {
		const credential = await PasskeyCredential.create({ id: V3_CREDENTIAL_ID_B64, prf: V3_PRF_B64 })
		const master = await credential.deriveMasterSecret()
		expect(toHex(master)).toBe("23c252cf7215344c6fb3b35da3cf7be9ee99f92cae16ee1c235e26f5c4843e79")
	})

	// ── V6: getHashHex (backup checksum) ─────────────────────────────
	//
	// Used by pages/import.vue + export/full.vue to verify backup integrity.
	// If byte→hex encoding drifts (case change, TextEncoder swap,
	// SHA-256 substitution), backup import silently fails.
	// Platform Web Crypto, no Aztec dep.
	test("V6 — getHashHex('hunter2') matches fixture", async () => {
		const hex = await EncryptionKey.getHashHex("hunter2")
		expect(hex).toBe("f52fbd32b2b3b86ff88ef6c490628285f482af15ddcb29541f94bcf526a3f6c7")
	})

	// ── V7a: deriveSigningKeyFromSeed(seed) — NULO-ACCOUNT-KDF v2 ────
	//
	// The signing key is the account's OWNERSHIP ROOT under the 5.0.0
	// signing-key-root model (the privacy secret derives one-way from
	// it). The construction is upstream's removed `deriveSigningKey`
	// under the dedicated Nulo separator —
	// `sha512ToGrumpkinScalar([seed, NULO_SIGNING_ROOT_SEP])` — and is
	// REFERENCE-VECTORED in `implementations-plan/key-model-v2/reference/`
	// (published-5.0.1-tarball provenance; the v1 predecessor vectors
	// stay archived under `aztec-5.0.0-stable/reference/`). If this
	// fails, the signing key of every wallet on disk just changed:
	// stop, never re-pin from this implementation. AZTEC-SENSITIVE.
	test("V7a — deriveSigningKeyFromSeed(fixedSeed) matches fixture", () => {
		const seed = Fr.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000042")
		const signingKey = deriveSigningKeyFromSeed(seed)
		expect(signingKey.toString()).toBe("0x2aabed87d5340c673eae6dc5faaa57382b8d773fa38247a80bdafbd5277729e3")
	})

	// ── V8: PASSKEY_PRF_LABEL spec constant ──────────────────────────
	//
	// This label is passed to `navigator.credentials.get` as the PRF
	// eval info. Changing it detaches PRF output from every existing
	// passkey wallet — same severity as changing PASSKEY_KDF_LABEL,
	// but V3 starts AFTER the WebAuthn call, so label drift in the
	// call site alone wouldn't trip V3.
	test("V8 — PASSKEY_PRF_LABEL is 'nulo:profile:v1'", () => {
		expect(PASSKEY_PRF_LABEL).toBe("nulo:profile:v1")
	})

	// ── V9: AccountType.Nulo_v1 numeric value ────────────────────────
	//
	// The enum value feeds into poseidon2Hash([master, chainId, type,
	// index]) as the 3rd arg. Flipping Nulo_v1 from 0 to 1 changes
	// every derived account secret. The spec.ts file has a
	// "NEVER change it" SECURITY comment but a paranoid unit lock
	// catches a drive-by refactor before it breaks wallets.
	test("V9 — AccountType.Nulo_v1 === 0", () => {
		expect(AccountType.Nulo_v1).toBe(0)
	})

	// ── V11: derivePxeStoreKey(master, profileId) — NULO-PXE-STORE-KDF v1 ──
	//
	// The per-profile ChaCha20 key for the encrypted SQLite-OPFS PXE stores
	// (HKDF-SHA256, label "nulo:pxe-store:v1", salt bound to the profileId).
	// A Nulo-novel construction, so this is a DRIFT PIN (like V8): it locks
	// what we ship — changing the label, salt shape, or HKDF params orphans
	// every encrypted PXE store on disk (state resets, not data loss: the
	// PXE re-syncs — but never change it casually).
	test("V11 — derivePxeStoreKey(fixedMaster, fixture profileId) matches fixture + is not the master", async () => {
		expect(PXE_STORE_KDF_LABEL).toBe("nulo:pxe-store:v1")
		const master = new Uint8Array(32)
		master[31] = 0x42
		const key = await derivePxeStoreKey(master, "profile-fixture-1")
		expect(key).toHaveLength(32)
		expect(toHex(key)).toBe("7bc1e3d33de01d8650471666c8daa55436a18c77644bfcfd683aba02465018d4")
		expect(toHex(key)).not.toBe(toHex(master))
		// Distinct profiles derive distinct keys from the same master.
		const other = await derivePxeStoreKey(master, "profile-fixture-2")
		expect(toHex(other)).not.toBe(toHex(key))
	})

	// ── P1: HKDF-SHA256 RFC 5869 Appendix A.1 ────────────────────────
	//
	// Cross-checks the platform HKDF implementation against a
	// canonical external reference, independent of our labels or
	// input shapes. If V3 fails AND P1 passes, the bug is in our
	// label/input construction. If both fail, the platform HKDF
	// changed (upgrade browser / Node).
	test("P1 — HKDF-SHA256 RFC 5869 A.1 matches", async () => {
		const ikm = fromHex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b")
		const salt = fromHex("000102030405060708090a0b0c")
		const info = fromHex("f0f1f2f3f4f5f6f7f8f9")
		const expected = "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"

		const baseKey = await self.crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"])
		const bits = await self.crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, baseKey, 42 * 8)
		expect(toHex(bits)).toBe(expected)
	})
})
