/**
 * NULO-ACCOUNT-KDF v2 reference vectors. Computed EXCLUSIVELY from the published 5.0.1
 * packages plus node:crypto — never from the repo's own helpers. The wallet's implementation
 * (WebCrypto PBKDF2 + @nulo/wallet-crypto derivation modules) must reproduce every value
 * EXACTLY; no explanatory exception may replace equality.
 *
 * Chain under pin:
 *   words --PBKDF2-HMAC-SHA512(NFKD(sentence), "mnemonic"+NFKD(passphrase), 2048, 64B)--> seed64
 *   master      = Fr.fromBufferReduce(seed64)
 *   accountSeed = poseidon2HashWithSeparator([master, l1ChainId, type, index], NULO_ACCOUNT_SEED_SEP)
 *   signingKey  = sha512ToGrumpkinScalar([accountSeed, NULO_SIGNING_ROOT_SEP])
 *   secretKey   = deriveSecretKeyFromSigningKey(signingKey)      (upstream, one-way)
 *   ... deriveKeys -> instance(salt=0, immutablesHash) -> address (upstream sequence, as regime-b)
 *
 * Separator provenance: first 4 bytes (big-endian) of sha256(label) —
 *   NULO_ACCOUNT_SEED_SEP  = sha256("nulo:account-seed:v2")[0..4]  = 0xa22f2a02 = 2720999938
 *   NULO_SIGNING_ROOT_SEP  = sha256("nulo:signing-root:v2")[0..4]  = 0x36857b0b = 914717451
 *
 * BIP-39 rows: the TREZOR-passphrase rows carry the official test-vector seeds verbatim; the
 * script recomputes each with node:crypto and THROWS on any mismatch, so a carried value can
 * never drift from the standard algorithm. Empty-passphrase and Unicode-passphrase rows are
 * generated (node:crypto) for the wallet's production path.
 */
import { createHash, pbkdf2Sync } from "node:crypto"
import { getSchnorrAccountContractAddress, SchnorrAccountContract, SchnorrAccountContractArtifact } from "@aztec/accounts/schnorr"
import { deriveSecretKeyFromSigningKey } from "@aztec/accounts/utils"
import { DomainSeparator } from "@aztec/constants"
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/poseidon"
import { sha512ToGrumpkinScalar } from "@aztec/foundation/crypto/sha512"
import { Fr } from "@aztec/foundation/curves/bn254"
import { CompleteAddress, getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract"
import { deriveKeys } from "@aztec/stdlib/keys"

const sepFromLabel = (label: string): number => createHash("sha256").update(label, "utf8").digest().readUInt32BE(0)
const NULO_ACCOUNT_SEED_SEP = sepFromLabel("nulo:account-seed:v2")
const NULO_SIGNING_ROOT_SEP = sepFromLabel("nulo:signing-root:v2")
if (NULO_ACCOUNT_SEED_SEP !== 2720999938 || NULO_SIGNING_ROOT_SEP !== 914717451) {
	throw new Error(`separator derivation drifted: ${NULO_ACCOUNT_SEED_SEP}, ${NULO_SIGNING_ROOT_SEP}`)
}
for (const v of Object.values(DomainSeparator).filter((x) => typeof x === "number")) {
	if (v === NULO_ACCOUNT_SEED_SEP || v === NULO_SIGNING_ROOT_SEP) throw new Error(`separator collides with upstream DomainSeparator ${v}`)
}

const bip39Seed = (sentence: string, passphrase: string): Buffer =>
	pbkdf2Sync(sentence.normalize("NFKD"), `mnemonic${passphrase.normalize("NFKD")}`, 2048, 64, "sha512")

// Official BIP-39 24-word rows (entropy shown for provenance; seeds are the published
// TREZOR-passphrase values). Verified below by recomputation — a mismatch aborts the run.
const OFFICIAL = [
	{
		entropy: "00".repeat(32),
		sentence: `${"abandon ".repeat(23)}art`,
		seedTrezor:
			"bda85446c68413707090a52022edd26a1c9462295029f2e60cd7c4f2bbd3097170af7a4d73245cafa9c3cca8d561a7c3de6f5d4a10be8ed2a5e608d68f92fcc8",
	},
	{
		entropy: "7f".repeat(32),
		sentence:
			"legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title",
		seedTrezor:
			"bc09fca1804f7e69da93c2f2028eb238c227f2e9dda30cd63699232578480a4021b146ad717fbb7e451ce9eb835f43620bf5c514db0f8add49f5d121449d3e87",
	},
	{
		entropy: "ff".repeat(32),
		sentence: `${"zoo ".repeat(23)}vote`,
		seedTrezor:
			"dd48c104698c30cfe2b6142103248622fb7bb0ff692eebb00089b32d22484e1613912f0a5b694407be899ffd31ed3992c456cdf60f5d4564b8ba3f05a69890ad",
	},
]

const bip39Vectors = OFFICIAL.map(({ entropy, sentence, seedTrezor }) => {
	const recomputed = bip39Seed(sentence, "TREZOR").toString("hex")
	if (recomputed !== seedTrezor) {
		throw new Error(`official TREZOR seed mismatch for entropy ${entropy.slice(0, 8)}…: carried value is not standard-consistent\n  got ${recomputed}`)
	}
	return {
		entropy,
		sentence,
		seedTrezor,
		seedEmptyPassphrase: bip39Seed(sentence, "").toString("hex"),
	}
})

// Unicode passphrase row: NFC input that must be NFKD-normalized before PBKDF2. "ﬁancé" uses
// the U+FB01 ligature so NFKD genuinely changes the byte sequence.
const UNICODE_PASSPHRASE = "ﬁancé"
const unicodeRow = {
	sentence: OFFICIAL[0]!.sentence,
	passphrase: UNICODE_PASSPHRASE,
	seed: bip39Seed(OFFICIAL[0]!.sentence, UNICODE_PASSPHRASE).toString("hex"),
}
// Sanity: without NFKD the same passphrase must produce a DIFFERENT seed, or the row proves
// nothing about normalization. (Raw pbkdf2 here on purpose — bip39Seed normalizes internally.)
const rawNoNfkd = pbkdf2Sync(OFFICIAL[0]!.sentence, `mnemonic${UNICODE_PASSPHRASE}`, 2048, 64, "sha512").toString("hex")
if (unicodeRow.seed === rawNoNfkd) {
	throw new Error("unicode passphrase row is normalization-insensitive; pick a different passphrase")
}

// Master derivation: Fr.fromBufferReduce over the 64-byte seed.
const masterFromSeed64 = (seed64: Buffer): Fr => Fr.fromBufferReduce(seed64)

// Account-seed KATs: fixed opaque masters + the mnemonic-derived one, across the three seeded
// L1 chain ids, type 0 (Nulo_v1), indices 0/1.
const OPAQUE_MASTERS = [
	"0x0000000000000000000000000000000000000000000000000000000000000042",
	"0x0000000000000000000000000000000000000000000000000000000000001337",
]
const mnemonicMaster = masterFromSeed64(bip39Seed(OFFICIAL[0]!.sentence, ""))
const L1_CHAIN_IDS = [1, 11155111, 31337]

const accountSeedVectors: object[] = []
for (const masterHex of [...OPAQUE_MASTERS, mnemonicMaster.toString()]) {
	const master = Fr.fromHexString(masterHex)
	for (const l1ChainId of L1_CHAIN_IDS) {
		for (const index of [0, 1]) {
			const seed = await poseidon2HashWithSeparator([master, new Fr(l1ChainId), new Fr(0), new Fr(index)], NULO_ACCOUNT_SEED_SEP)
			accountSeedVectors.push({ master: masterHex, l1ChainId, type: 0, index, accountSeed: seed.toString() })
		}
	}
}

// Signing chain (v2 separator) + upstream address sequence — mirrors regime-b exactly except
// for the separator.
const SALT = Fr.ZERO
async function signingChain(seedHex: string) {
	const seed = Fr.fromHexString(seedHex)
	const signingKey = sha512ToGrumpkinScalar([seed, NULO_SIGNING_ROOT_SEP])
	const secretKey = await deriveSecretKeyFromSigningKey(signingKey)
	const keys = await deriveKeys(secretKey)
	const address = await getSchnorrAccountContractAddress(signingKey, SALT, secretKey)
	const accountContract = new SchnorrAccountContract(signingKey)
	const init = await accountContract.getInitializationFunctionAndArgs()
	const instance = await getContractInstanceFromInstantiationParams(SchnorrAccountContractArtifact, {
		constructorArtifact: init?.constructorName,
		constructorArgs: init?.constructorArgs,
		salt: SALT,
		publicKeys: keys.publicKeys,
		immutablesHash: await accountContract.getImmutablesHash(),
	})
	if (!instance.address.equals(address)) throw new Error(`instance/oracle address mismatch for ${seedHex}`)
	const completeAddress = await CompleteAddress.fromSecretKeyAndInstance(secretKey, instance)
	if (!completeAddress.address.equals(address)) throw new Error(`completeAddress mismatch for ${seedHex}`)
	// The exact PXE registration wire value (key-store AccountPrivacyKeys): the four privacy
	// SECRET keys + the message-signing/fallback PUBLIC keys.
	const accountPrivacyKeys = {
		masterNullifierHidingSecretKey: keys.masterNullifierHidingSecretKey.toString(),
		masterIncomingViewingSecretKey: keys.masterIncomingViewingSecretKey.toString(),
		masterOutgoingViewingSecretKey: keys.masterOutgoingViewingSecretKey.toString(),
		masterTaggingSecretKey: keys.masterTaggingSecretKey.toString(),
		masterMessageSigningPublicKey: keys.masterMessageSigningPublicKey.toString(),
		masterFallbackPublicKey: keys.masterFallbackPublicKey.toString(),
	}
	return {
		seed: seedHex,
		signingKey: signingKey.toString(),
		secretKey: secretKey.toString(),
		accountPrivacyKeys,
		masterSecretKeys: {
			masterNullifierHidingSecretKey: keys.masterNullifierHidingSecretKey.toString(),
			masterIncomingViewingSecretKey: keys.masterIncomingViewingSecretKey.toString(),
			masterOutgoingViewingSecretKey: keys.masterOutgoingViewingSecretKey.toString(),
			masterTaggingSecretKey: keys.masterTaggingSecretKey.toString(),
			masterMessageSigningSecretKey: keys.masterMessageSigningSecretKey.toString(),
			masterFallbackSecretKey: keys.masterFallbackSecretKey.toString(),
		},
		publicKeys: keys.publicKeys.toString(),
		address: address.toString(),
		completeAddress: {
			address: completeAddress.address.toString(),
			publicKeys: completeAddress.publicKeys.toString(),
			partialAddress: completeAddress.partialAddress.toString(),
		},
	}
}

const signingChainVectors = [await signingChain(OPAQUE_MASTERS[0]!), await signingChain(OPAQUE_MASTERS[1]!)]

// Full chain: all-zeros-entropy words at empty passphrase → local-chain account 0 → address.
const fullChainSeedFr = await poseidon2HashWithSeparator(
	[mnemonicMaster, new Fr(31337), new Fr(0), new Fr(0)],
	NULO_ACCOUNT_SEED_SEP,
)
const fullChain = {
	sentence: OFFICIAL[0]!.sentence,
	passphrase: "",
	seed64: bip39Seed(OFFICIAL[0]!.sentence, "").toString("hex"),
	master: mnemonicMaster.toString(),
	l1ChainId: 31337,
	type: 0,
	index: 0,
	...(await signingChain(fullChainSeedFr.toString())),
}

const out = {
	source: "published 5.0.1 tarballs + node:crypto PBKDF2 (cross-implementation reference for the wallet's WebCrypto)",
	chain:
		"words -> PBKDF2-HMAC-SHA512(NFKD, 'mnemonic'+passphrase, 2048, 64B) -> Fr.fromBufferReduce -> poseidon2HashWithSeparator([master,l1ChainId,type,index], NULO_ACCOUNT_SEED_SEP) -> sha512ToGrumpkinScalar([seed, NULO_SIGNING_ROOT_SEP]) -> deriveSecretKeyFromSigningKey -> deriveKeys -> instance(salt=0, immutablesHash) -> address",
	separators: {
		NULO_ACCOUNT_SEED_SEP: { label: "nulo:account-seed:v2", value: NULO_ACCOUNT_SEED_SEP },
		NULO_SIGNING_ROOT_SEP: { label: "nulo:signing-root:v2", value: NULO_SIGNING_ROOT_SEP },
	},
	salt: SALT.toString(),
	bip39: bip39Vectors,
	unicodePassphrase: unicodeRow,
	accountSeeds: accountSeedVectors,
	signingChain: signingChainVectors,
	fullChain,
}
console.log(JSON.stringify(out, null, "\t"))
