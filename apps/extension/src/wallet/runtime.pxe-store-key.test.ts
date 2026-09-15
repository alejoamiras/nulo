/**
 * The SW-side store-key provider's three answers: locked → `undefined` (the PXE client lets
 * its missing-key marker propagate), open-but-degraded → `RecoveryModeError` (the key cannot
 * exist without the DEK, and a silent undefined would read as "locked"), healthy → the
 * `HKDF(master ‖ dek)` key paired with the row's current generation, both secret copies wiped.
 */
import { describe, expect, test } from "vitest"
import { Fr } from "@aztec/foundation/curves/bn254"
import { RecoveryModeError } from "@nulo/extension-messaging/errors"
import { asImportedKeysDek, asMasterSecretBytes, derivePxeStoreKey } from "@nulo/wallet-crypto"
import type { ProfileService } from "./services/profile/service"
import { providePxeStoreKey } from "./runtime"

const MASTER = new Uint8Array(32).fill(3) as Uint8Array<ArrayBuffer>
const DEK = new Uint8Array(32).fill(4) as Uint8Array<ArrayBuffer>

function fakeProfileService(state: "locked" | "degraded" | "healthy", generation = "gen-A") {
	const deks: Uint8Array[] = []
	const service = {
		getPxeGeneration: async () => generation,
		getProfileSecret: async () => {
			if (state === "locked") throw new Error("Profile locked")
			return Fr.fromBuffer(Buffer.from(MASTER))
		},
		getProfileDek: async () => {
			if (state === "locked") throw new Error("Profile locked")
			if (state === "degraded") return undefined
			const copy = asImportedKeysDek(new Uint8Array(DEK) as Uint8Array<ArrayBuffer>)
			deks.push(copy)
			return copy
		},
	} as unknown as ProfileService
	return { service, deks }
}

describe("providePxeStoreKey", () => {
	test("locked → undefined", async () => {
		const { service } = fakeProfileService("locked")
		await expect(providePxeStoreKey(service, "p1")).resolves.toBeUndefined()
	})

	test("open but degraded → rejects with the recovery sentence", async () => {
		const { service } = fakeProfileService("degraded")
		await expect(providePxeStoreKey(service, "p1")).rejects.toBeInstanceOf(RecoveryModeError)
	})

	test("healthy → HKDF(master ‖ dek) under the profile salt, paired with the generation; the DEK copy is wiped", async () => {
		const { service, deks } = fakeProfileService("healthy")
		const provision = await providePxeStoreKey(service, "p1")
		const expected = await derivePxeStoreKey(asMasterSecretBytes(MASTER), asImportedKeysDek(DEK), "p1")
		expect(provision).toEqual({ key: expected, generation: "gen-A" })
		expect(deks).toHaveLength(1)
		expect([...deks[0]]).toEqual(new Array(32).fill(0))
	})
})
