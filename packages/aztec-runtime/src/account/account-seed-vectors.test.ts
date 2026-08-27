import { Fr } from "@aztec/foundation/curves/bn254"
import type { ILogger } from "@nulo/wallet-core/logger"
import { deriveAccountSeed, deriveMasterFromMnemonic } from "@nulo/wallet-crypto"
import { describe, expect, test } from "vitest"
import referenceVectors from "../../../../implementations-plan/key-model-v2/reference/vectors.json"
import { NuloAccount } from "./nulo-account"

/**
 * KATs for the two NULO-ACCOUNT-KDF v2 stages the v1 test suite never pinned:
 * the account-seed fan-out (`deriveAccountSeed` — the formula whose silent duplication/drift
 * the R1 audits flagged as the bricking class) and the FULL words→address chain. Vectors are
 * REFERENCE-GENERATED (`implementations-plan/key-model-v2/reference/derive-vectors.ts`,
 * published 5.0.1 tarballs + node:crypto PBKDF2); never re-pin from the implementation.
 */
const nullLogger: ILogger = { log: () => {} }

describe("NULO-ACCOUNT-KDF v2 — account-seed fan-out known answers", () => {
	for (const v of referenceVectors.accountSeeds) {
		test(`master ${v.master.slice(0, 10)}… l1=${v.l1ChainId} idx=${v.index} matches`, async () => {
			const seed = await deriveAccountSeed(Fr.fromHexString(v.master), v.l1ChainId, v.type, v.index)
			expect(seed.toString()).toBe(v.accountSeed)
		})
	}

	test("non-canonical l1ChainId is rejected, never defaulted", async () => {
		const master = Fr.fromHexString(referenceVectors.accountSeeds[0]!.master)
		await expect(deriveAccountSeed(master, -1, 0, 0)).rejects.toThrow(/Non-canonical l1ChainId/)
		await expect(deriveAccountSeed(master, 1.5, 0, 0)).rejects.toThrow(/Non-canonical l1ChainId/)
		await expect(deriveAccountSeed(master, 0x1_0000_0000, 0, 0)).rejects.toThrow(/Non-canonical l1ChainId/)
	})
})

describe("NULO-ACCOUNT-KDF v2 — full words→address chain", () => {
	test("recovery words derive the reference local-chain account 0 address end-to-end", async () => {
		const fc = referenceVectors.fullChain
		const master = await deriveMasterFromMnemonic(fc.sentence.split(" "), fc.passphrase)
		const masterFr = Fr.fromBuffer(Buffer.from(master))
		expect(masterFr.toString()).toBe(fc.master)
		const seed = await deriveAccountSeed(masterFr, fc.l1ChainId, fc.type, fc.index)
		expect(seed.toString()).toBe(fc.seed)
		const account = await NuloAccount.new(seed, nullLogger)
		expect(account.address.toString()).toBe(fc.address)
	})
})
