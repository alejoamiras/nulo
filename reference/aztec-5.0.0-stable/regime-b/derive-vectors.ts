/**
 * Regime-B reference vectors (plan D13): the signing-key-root chain computed EXCLUSIVELY from the
 * published 5.0.1 packages (pinned in package.json; digests in tarball-digests.json). These are the
 * known answers the repo's derivation helper must reproduce EXACTLY — no explanatory exception may
 * replace equality. Run from THIS directory: `bun install && bun derive-vectors.ts`.
 *
 * The address oracle is upstream's own `getSchnorrAccountContractAddress`; the CompleteAddress is
 * built through upstream's exact instance-construction sequence (mirrored from
 * `@aztec/aztec.js/dest/account/account_contract.js`) — never through the repo's helper.
 */
import { getSchnorrAccountContractAddress, SchnorrAccountContract, SchnorrAccountContractArtifact } from "@aztec/accounts/schnorr"
import { deriveSecretKeyFromSigningKey } from "@aztec/accounts/utils"
import { DomainSeparator } from "@aztec/constants"
import { sha512ToGrumpkinScalar } from "@aztec/foundation/crypto/sha512"
import { Fr } from "@aztec/foundation/curves/bn254"
import { CompleteAddress, getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract"
import { deriveKeys } from "@aztec/stdlib/keys"

// Regime-A values (from the rc.2-installed upstream deriveSigningKey — regime-a-vectors.json).
// The construction is version-independent; 5.0.1 primitives MUST reproduce them.
const REGIME_A = [
	{
		seed: "0x0000000000000000000000000000000000000000000000000000000000000042",
		signingKey: "0x14a31cb4d33a144675e70634830292153f78e8318e51f26a2f212783eb0a3cbc",
	},
	{
		seed: "0x0000000000000000000000000000000000000000000000000000000000001337",
		signingKey: "0x06de3315eea486fed5f27be5016611ce072c662c1a6700cb59f7f7454cba261b",
	},
]

const SALT = Fr.ZERO

const vectors = []
for (const { seed: seedHex, signingKey: expectedSigningKey } of REGIME_A) {
	const seed = Fr.fromHexString(seedHex)
	const signingKey = sha512ToGrumpkinScalar([seed, DomainSeparator.IVSK_M])
	if (signingKey.toString() !== expectedSigningKey) {
		throw new Error(`5.0.1 signingKey construction diverged from the rc.2 reference for ${seedHex}`)
	}

	const secretKey = await deriveSecretKeyFromSigningKey(signingKey)
	const keys = await deriveKeys(secretKey)

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

	// Upstream's address oracle.
	const address = await getSchnorrAccountContractAddress(signingKey, SALT, secretKey)

	// Upstream's exact instance sequence (account_contract.js) → CompleteAddress.
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

	vectors.push({
		seed: seedHex,
		signingKey: signingKey.toString(),
		secretKey: secretKey.toString(),
		masterSecretKeys: {
			masterNullifierHidingSecretKey: keys.masterNullifierHidingSecretKey.toString(),
			masterIncomingViewingSecretKey: keys.masterIncomingViewingSecretKey.toString(),
			masterOutgoingViewingSecretKey: keys.masterOutgoingViewingSecretKey.toString(),
			masterTaggingSecretKey: keys.masterTaggingSecretKey.toString(),
			masterMessageSigningSecretKey: keys.masterMessageSigningSecretKey.toString(),
			masterFallbackSecretKey: keys.masterFallbackSecretKey.toString(),
		},
		accountPrivacyKeys,
		publicKeys: keys.publicKeys.toString(),
		address: address.toString(),
		completeAddress: {
			address: completeAddress.address.toString(),
			publicKeys: completeAddress.publicKeys.toString(),
			partialAddress: completeAddress.partialAddress.toString(),
		},
	})
}

const out = {
	source: "published 5.0.1 tarballs (see package.json pins + tarball-digests.json)",
	chain: "seed -> sha512ToGrumpkinScalar([seed, IVSK_M]) -> deriveSecretKeyFromSigningKey -> deriveKeys -> instance(salt=0, immutablesHash) -> address",
	domainSeparator: { name: "IVSK_M", value: Number(DomainSeparator.IVSK_M) },
	salt: SALT.toString(),
	vectors,
}
console.log(JSON.stringify(out, null, "\t"))
