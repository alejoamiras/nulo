/**
 * BIP-39 mnemonic → master secret (NULO-ACCOUNT-KDF v2, the wallet-level root derivation).
 *
 *     seed64 = PBKDF2-HMAC-SHA512(NFKD(sentence), "mnemonic" + NFKD(passphrase), 2048, 64 bytes)
 *     master = Fr.fromBufferReduce(seed64)     // 64-byte input — the low-skew reduce upstream endorses
 *
 * 2048 iterations is the BIP-39 spec constant, NOT a brute-force defense (the entropy behind the
 * words is 256-bit CSPRNG; at-rest protection is EncryptionKey's PBKDF2-600k + AES-GCM). The
 * passphrase defaults to "" — passphrase support exists at this layer so a future UI can add it
 * without another address-breaking change. Reference vectors (cross-implementation, node:crypto):
 * `implementations-plan/key-model-v2/reference/vectors.json`; official BIP-39 rows at passphrase
 * "TREZOR", production rows at "".
 *
 * Uses `globalThis.crypto` (not `self.crypto`) deliberately: this module must run in the MV3
 * service worker, jsdom unit tests, AND the node-env aztec-runtime full-chain KAT, and only
 * `globalThis` names the Web Crypto object in all three.
 */
import { canonicalizeMnemonic } from "@nulo/wallet-core/utils"
import { Fr } from "@aztec/foundation/curves/bn254"
import { asMasterSecretBytes, type MasterSecretBytes } from "./secret-types"
import { zeroize } from "./zeroize"

const BIP39_ITERATIONS = 2048

/** The standard BIP-39 seed: 64 bytes of PBKDF2-HMAC-SHA512 over the canonicalized sentence. */
export async function deriveBip39Seed(words: string[], passphrase = ""): Promise<Uint8Array<ArrayBuffer>> {
	const sentence = canonicalizeMnemonic(words).join(" ")
	const utf8 = new TextEncoder()
	const sentenceBytes = utf8.encode(sentence)
	const saltBytes = utf8.encode(`mnemonic${passphrase.normalize("NFKD")}`)
	try {
		const baseKey = await globalThis.crypto.subtle.importKey("raw", sentenceBytes, "PBKDF2", false, ["deriveBits"])
		const bits = await globalThis.crypto.subtle.deriveBits(
			{ name: "PBKDF2", hash: "SHA-512", salt: saltBytes, iterations: BIP39_ITERATIONS },
			baseKey,
			512,
		)
		return new Uint8Array(bits)
	} finally {
		// The engine holds the sentence inside the non-extractable base key; the local sentence
		// copy is password-equivalent material and the salt carries the passphrase — neither may
		// linger. (The sentence STRING and Fr/CryptoKey internals are GC-managed and unwipeable —
		// same posture as the passkey path.)
		zeroize(sentenceBytes)
		zeroize(saltBytes)
	}
}

/** The wallet's 32-byte master secret for a mnemonic-origin profile. Caller owns + zeroes the result. */
export async function deriveMasterFromMnemonic(words: string[], passphrase = ""): Promise<MasterSecretBytes> {
	const seed64 = await deriveBip39Seed(words, passphrase)
	const seed64Copy = Buffer.from(seed64)
	try {
		const masterFr = Fr.fromBufferReduce(seed64Copy)
		return asMasterSecretBytes(masterFr.toBuffer() as Buffer<ArrayBuffer>)
	} finally {
		// Fr made its own copy (pinned by the Fr.fromBufferReduce test in zeroize.test.ts); both
		// recovery-equivalent 64-byte buffers are wiped, not just the original.
		zeroize(seed64)
		zeroize(seed64Copy)
	}
}
