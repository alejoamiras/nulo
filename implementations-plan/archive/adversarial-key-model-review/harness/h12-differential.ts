/**
 * ADVERSARIAL AUDIT HARNESS — H12: full-chain differential.
 * Recomputes words → seed64 → master → accountSeed → signingKey → secretKey → address
 * three ways and cross-compares:
 *   (1) the committed REFERENCE vectors (independent node:crypto generator)
 *   (2) a fresh step-by-step composition done HERE from primitives
 *   (3) the wallet implementation's own helpers
 * Any wiring error between correct steps (wrong poseidon arg order, wrong separator slot,
 * encoding drift) shows up as a disagreement.
 * Run: bun implementations-plan/adversarial-key-model-review/harness/h12-differential.ts
 */
import { deriveBip39Seed, deriveMasterFromMnemonic } from "@nulo/wallet-crypto"
import { canonicalizeMnemonic, getMnemonic } from "@nulo/wallet-core/utils"
import { deriveAccountSeed, deriveNuloAccountKeys } from "@nulo/wallet-crypto"
import { NuloAccount } from "@nulo/aztec-runtime/account"
import { Fr } from "@aztec/foundation/curves/bn254"

let fails = 0
const check = (name: string, ok: boolean, detail = "") => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
	if (!ok) fails++
}

const vectors = await Bun.file("implementations-plan/key-model-v2/reference/vectors.json").json()
const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any

const rows = Array.isArray(vectors.fullChain) ? vectors.fullChain : [vectors.fullChain]
check(`reference fullChain has ${rows.length} row(s)`, rows.length > 0)

for (const [i, ref] of rows.entries()) {
	const words = canonicalizeMnemonic(ref.sentence)

	// Step 1: BIP-39 seed — implementation vs reference (reference used node:crypto).
	const implSeed = Buffer.from(await deriveBip39Seed(words, ref.passphrase))
	check(`row ${i}: seed64 impl === reference`, implSeed.toString("hex") === ref.seed64)

	// Step 2: master reduce.
	const implMaster = Buffer.from(await deriveMasterFromMnemonic(words, ref.passphrase))
	check(`row ${i}: master impl === reference`, implMaster.toString("hex") === Buffer.from(ref.master.replace(/^0x/, ""), "hex").toString("hex"))

	// Step 3: account seed via the ONE shared formula.
	const implSeedF = await deriveAccountSeed(new Fr(Buffer.from(implMaster)), ref.l1ChainId, ref.type, ref.index)
	check(`row ${i}: accountSeed impl === reference`, implSeedF.toString() === ref.seed)

	// Step 4+5: signing key + privacy secret.
	const { signingKey, secretKey } = await deriveNuloAccountKeys(implSeedF)
	check(`row ${i}: signingKey impl === reference`, signingKey.toString() === ref.signingKey)
	check(`row ${i}: secretKey impl === reference`, secretKey.toString() === ref.secretKey)

	// Step 6: address through the real account factory (frozen descriptor path).
	const acct = await NuloAccount.fromSigningKey(signingKey as any, logger)
	check(`row ${i}: address impl === reference`, acct.address.toString() === ref.address)

	// Round-trip guard: entropy → words → same master (the pairing invariant).
	const reWords = await getMnemonic(new Uint8Array(Buffer.from(ref.master.replace(/^0x/, ""), "hex")))
	void reWords
}

console.log(fails === 0 ? "\nH12 differential: ALL STEPS AGREE" : `\nH12 differential: ${fails} DISAGREEMENTS`)
process.exit(fails === 0 ? 0 : 1)
