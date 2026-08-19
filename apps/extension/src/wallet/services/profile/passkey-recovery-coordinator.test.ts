/**
 * Unit tests for `PasskeyRecoveryCoordinator`.
 *
 * Uses a fake `PasskeyService` — no WebAuthn, no `chrome.windows`, no
 * DOM. Exercises the surface + error propagation.
 */

import { describe, expect, test, vi } from "vitest"
import { Fr } from "@aztec/foundation/curves/bn254"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { asBase64CredentialId, asBase64SecretPrf, asHexUserHandle, type PasskeyCredential } from "@nulo/wallet-crypto"
import type { PasskeyService } from "@/wallet/services/passkey/service"
import { PasskeyRecoveryCoordinator } from "./passkey-recovery-coordinator"
import type { Profile } from "./spec"

/** Canonical byte-form of a deterministic Fr. Mirrors the real
 *  `PasskeyCredential.deriveMasterSecret()` return shape. */
const frBytes = (byte: string): Buffer<ArrayBuffer> => Fr.fromHexString(`0x${byte.repeat(32)}`).toBuffer() as Buffer<ArrayBuffer>

/** Real (deterministic) AES-GCM key — mirrors `PasskeyCredential.deriveDekWrapKey()`'s shape. */
const fakeAesKey = (): Promise<CryptoKey> =>
	crypto.subtle.importKey("raw", new Uint8Array(32).fill(0x42), { name: "AES-GCM" }, false, ["encrypt", "decrypt"])

/** Minimal PasskeyService stand-in. Returns credential objects that
 *  expose `id`, `userHandle`, and a `deriveMasterSecret` that resolves
 *  to deterministic Fr-canonical bytes derived from the credential id. */
function makeFakePasskeyService(
	overrides: Partial<{
		create(userHandle: string): Promise<PasskeyCredential>
		get(credentialId?: string): Promise<PasskeyCredential>
		materialize(data: { id: string; prf: string; userHandle?: string }): Promise<PasskeyCredential>
	}> = {},
) {
	const defaultCredential = (id: string, userHandle?: string): PasskeyCredential =>
		({
			id,
			userHandle,
			deriveMasterSecret: async () => frBytes("01"),
			deriveDekWrapKey: async () => fakeAesKey(),
		}) as unknown as PasskeyCredential

	const fake = {
		createKey: overrides.create ?? (async (userHandle: string) => defaultCredential(`cred-${userHandle}`, userHandle)),
		getKey: overrides.get ?? (async (credentialId?: string) => defaultCredential(credentialId ?? "cred-unknown", "user-handle-abc")),
		materializeCredential:
			overrides.materialize ??
			(async (data: { id: string; prf: string; userHandle?: string }) => defaultCredential(data.id, data.userHandle)),
	} as unknown as PasskeyService

	return fake
}

function newCoordinator(passkeys: PasskeyService): PasskeyRecoveryCoordinator {
	return new PasskeyRecoveryCoordinator(passkeys, new LoggerStore(new ConfigStore()))
}

describe("PasskeyRecoveryCoordinator", () => {
	describe("createForNewProfile", () => {
		test("wraps PasskeyService.createKey + deriveMasterSecret", async () => {
			const createKey = vi.fn(async (userHandle: string) => ({
				id: `cred-${userHandle}`,
				userHandle,
				deriveMasterSecret: async () => frBytes("02"),
				deriveDekWrapKey: async () => fakeAesKey(),
			})) as unknown as PasskeyService["createKey"]
			const passkeys = makeFakePasskeyService({ create: createKey as never })
			const coord = newCoordinator(passkeys)

			const result = await coord.createForNewProfile("profile-123", "Test")

			expect(createKey).toHaveBeenCalledWith("profile-123", "Test")
			expect(result.credentialId).toBe("cred-profile-123")
			expect(result.userHandle).toBe("profile-123")
			expect(Buffer.from(result.secret).toString("hex")).toBe(frBytes("02").toString("hex"))
		})

		test("propagates errors from the underlying PasskeyService", async () => {
			const passkeys = makeFakePasskeyService({
				create: (async () => {
					throw new Error("user cancelled passkey prompt")
				}) as never,
			})
			const coord = newCoordinator(passkeys)

			await expect(coord.createForNewProfile("profile-123", "Test")).rejects.toThrow(/user cancelled/)
		})
	})

	describe("recoverByCredentialId", () => {
		test("calls PasskeyService.getKey with the supplied credentialId and returns full recovery shape", async () => {
			const getKey = vi.fn(async (credentialId?: string) => ({
				id: credentialId ?? "unknown",
				userHandle: "handle-from-credential",
				deriveMasterSecret: async () => frBytes("03"),
				deriveDekWrapKey: async () => fakeAesKey(),
			})) as unknown as PasskeyService["getKey"]
			const passkeys = makeFakePasskeyService({ get: getKey as never })
			const coord = newCoordinator(passkeys)

			const recovery = await coord.recoverByCredentialId("known-credential-id")

			expect(getKey).toHaveBeenCalledWith("known-credential-id")
			expect(recovery.credentialId).toBe("known-credential-id")
			expect(recovery.userHandle).toBe("handle-from-credential")
			expect(Buffer.from(recovery.secret).toString("hex")).toBe(frBytes("03").toString("hex"))
		})
	})

	describe("recoverUnknown", () => {
		test("calls getKey without arguments and returns full recovery shape", async () => {
			const getKey = vi.fn(async (credentialId?: string) => ({
				id: "picked-by-user",
				userHandle: "user-handle-xyz",
				deriveMasterSecret: async () => frBytes("04"),
				deriveDekWrapKey: async () => fakeAesKey(),
			})) as unknown as PasskeyService["getKey"]
			const passkeys = makeFakePasskeyService({ get: getKey as never })
			const coord = newCoordinator(passkeys)

			const result = await coord.recoverUnknown()

			expect(getKey).toHaveBeenCalledWith()
			expect(result.credentialId).toBe("picked-by-user")
			expect(result.userHandle).toBe("user-handle-xyz")
			expect(result.secret).toBeDefined()
		})

		test("userHandle is optional — WebAuthn may omit it", async () => {
			const passkeys = makeFakePasskeyService({
				get: (async () => ({
					id: "cred-without-userhandle",
					// no userHandle
					deriveMasterSecret: async () => frBytes("05"),
					deriveDekWrapKey: async () => fakeAesKey(),
				})) as never,
			})
			const coord = newCoordinator(passkeys)

			const result = await coord.recoverUnknown()
			expect(result.userHandle).toBeUndefined()
		})
	})

	describe("recoverFromCredentialData (PATH A)", () => {
		test("calls materializeCredential with the supplied data and returns the recovery shape", async () => {
			const materialize = vi.fn(async (data: { id: string; prf: string; userHandle?: string }) => ({
				id: data.id,
				userHandle: data.userHandle,
				deriveMasterSecret: async () => frBytes("06"),
				deriveDekWrapKey: async () => fakeAesKey(),
			})) as unknown as PasskeyService["materializeCredential"]
			const passkeys = makeFakePasskeyService({ materialize: materialize as never })
			const coord = newCoordinator(passkeys)

			const data = {
				id: asBase64CredentialId("cred-from-modal"),
				prf: asBase64SecretPrf("prf-bytes-base64"),
				userHandle: asHexUserHandle("uh-from-modal"),
			}
			const recovery = await coord.recoverFromCredentialData(data)

			expect(materialize).toHaveBeenCalledWith(data)
			expect(recovery.credentialId).toBe("cred-from-modal")
			expect(recovery.userHandle).toBe("uh-from-modal")
			expect(Buffer.from(recovery.secret).toString("hex")).toBe(frBytes("06").toString("hex"))
		})

		test("propagates undefined userHandle from the materialized credential", async () => {
			const passkeys = makeFakePasskeyService({
				materialize: (async () => ({
					id: "cred-no-handle",
					// no userHandle
					deriveMasterSecret: async () => frBytes("07"),
					deriveDekWrapKey: async () => fakeAesKey(),
				})) as never,
			})
			const coord = newCoordinator(passkeys)

			const recovery = await coord.recoverFromCredentialData({
				id: asBase64CredentialId("cred-no-handle"),
				prf: asBase64SecretPrf("prf-bytes"),
			})
			expect(recovery.userHandle).toBeUndefined()
		})

		test("propagates errors from materializeCredential", async () => {
			const passkeys = makeFakePasskeyService({
				materialize: (async () => {
					throw new Error("invalid PRF length")
				}) as never,
			})
			const coord = newCoordinator(passkeys)

			await expect(coord.recoverFromCredentialData({ id: asBase64CredentialId("x"), prf: asBase64SecretPrf("bad") })).rejects.toThrow(
				/invalid PRF/,
			)
		})
	})

	describe("confirm", () => {
		test("resolves successfully when the passkey service returns a credential", async () => {
			const getKey = vi.fn(async (credentialId?: string) => ({
				id: credentialId ?? "irrelevant",
				deriveMasterSecret: async () => Fr.random().toBuffer() as Buffer<ArrayBuffer>,
			})) as unknown as PasskeyService["getKey"]
			const passkeys = makeFakePasskeyService({ get: getKey as never })
			const coord = newCoordinator(passkeys)

			const profile: Profile = {
				id: "pid",
				name: "P",
				type: "passkey",
				pxeGeneration: "gen-test",
				dekSealed: "ZGVrLXNlYWxlZA==",
				walletFingerprint: "fp-test",
				credentialId: "stored-credential",
			}

			await expect(coord.confirm(profile)).resolves.toBeUndefined()
			expect(getKey).toHaveBeenCalledWith("stored-credential")
		})

		test("throws when the profile lacks a credentialId", async () => {
			const passkeys = makeFakePasskeyService()
			const coord = newCoordinator(passkeys)

			const profile = {
				id: "pid",
				name: "P",
				type: "passkey",
				pxeGeneration: "gen-test",
				credentialId: "",
			} as Profile & { type: "passkey" }

			await expect(coord.confirm(profile)).rejects.toThrow(/Missing credentialId/)
		})

		test("propagates failures from PasskeyService.getKey", async () => {
			const passkeys = makeFakePasskeyService({
				get: (async () => {
					throw new Error("user cancelled")
				}) as never,
			})
			const coord = newCoordinator(passkeys)

			const profile: Profile = {
				id: "pid",
				name: "P",
				type: "passkey",
				pxeGeneration: "gen-test",
				dekSealed: "ZGVrLXNlYWxlZA==",
				walletFingerprint: "fp-test",
				credentialId: "stored-credential",
			}

			await expect(coord.confirm(profile)).rejects.toThrow(/user cancelled/)
		})
	})
})
