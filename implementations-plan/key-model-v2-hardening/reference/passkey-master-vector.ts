/**
 * Passkey master-secret reference vector (the V3 pin's independent source).
 *
 * Computed EXCLUSIVELY from node:crypto's HKDF plus the published 5.0.1 `Fr` — never from the
 * repo's own wallet-crypto code, and via a DIFFERENT HKDF implementation than the wallet's
 * WebCrypto. The wallet's `PasskeyCredential.deriveMasterSecret()` must reproduce the value
 * EXACTLY; no explanatory exception may replace equality.
 *
 * Chain under pin (NULO-ACCOUNT-KDF v2, passkey branch — 512-bit low-skew form):
 *   ikm    = base64decode(prf)                                (WebAuthn PRF eval output)
 *   salt   = SHA-256( UTF8("nulo:kdf:v1") || credentialIdBytes )
 *   okm64  = HKDF-SHA256(ikm, salt, info = UTF8("nulo:master:v1"), 64 bytes)
 *   master = Fr.fromBufferReduce(okm64)                        (big-endian, mod BN254 Fr)
 *
 * Inputs mirror key-vectors.test.ts V3 verbatim: PRF = bytes 0x00..0x1f; credentialId =
 * "test-credential-id".
 */
import { createHash, hkdfSync } from "node:crypto"
import { Fr } from "@aztec/foundation/curves/bn254"

const V3_PRF_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
const V3_CREDENTIAL_ID_B64 = "dGVzdC1jcmVkZW50aWFsLWlk"

const ikm = Buffer.from(V3_PRF_B64, "base64")
const credentialId = Buffer.from(V3_CREDENTIAL_ID_B64, "base64")
const salt = createHash("sha256")
	.update(Buffer.concat([Buffer.from("nulo:kdf:v1", "utf8"), credentialId]))
	.digest()
const okm64 = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("nulo:master:v1", "utf8"), 64))
const master = Fr.fromBufferReduce(okm64)

console.log(
	JSON.stringify(
		{
			prfB64: V3_PRF_B64,
			credentialIdB64: V3_CREDENTIAL_ID_B64,
			hkdfOutputBytes: 64,
			expectedMasterHex: master.toBuffer().toString("hex"),
		},
		null,
		2,
	),
)
