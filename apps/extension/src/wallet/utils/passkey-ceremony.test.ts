import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildCreateOptions, runPasskeyCeremony } from "./passkey-ceremony"

const ID = "a3f29b14"
const toHex = (b: BufferSource): string => {
	const u =
		b instanceof ArrayBuffer
			? new Uint8Array(b)
			: new Uint8Array((b as ArrayBufferView).buffer, (b as ArrayBufferView).byteOffset, (b as ArrayBufferView).byteLength)
	return Buffer.from(u).toString("hex")
}

describe("buildCreateOptions", () => {
	it("sets user.name and user.displayName to the branded nulo-{name}-{id} label", async () => {
		const opts = await buildCreateOptions(ID, "Alice")
		expect(opts.user.name).toBe("nulo-alice-a3f29b14")
		expect(opts.user.displayName).toBe("nulo-alice-a3f29b14")
	})

	it("uses the name-free fallback when the profile name has no slugifiable characters", async () => {
		const opts = await buildCreateOptions(ID, "山田")
		expect(opts.user.name).toBe("nulo-profile-a3f29b14")
		expect(opts.user.displayName).toBe("nulo-profile-a3f29b14")
	})

	// Regression guard: changing the label must NOT disturb any crypto-adjacent
	// field. user.id, the PRF eval input, the challenge size, rp, and the
	// credential params are what the key-derivation + relying-party binding
	// depend on — they stay byte-identical to the pre-change shape.
	it("leaves user.id as the hex-decoded handle (independent of the label)", async () => {
		const opts = await buildCreateOptions(ID, "Alice")
		expect(toHex(opts.user.id)).toBe(ID)
	})

	it("keeps the PRF eval input = SHA-256('nulo:profile:v1')", async () => {
		const opts = await buildCreateOptions(ID, "Alice")
		const first = opts.extensions?.prf?.eval?.first
		expect(first).toBeDefined()
		const expected = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("nulo:profile:v1")))
		expect(toHex(first as BufferSource)).toBe(Buffer.from(expected).toString("hex"))
	})

	it("keeps rp, challenge size, credential params, and authenticator selection unchanged", async () => {
		const opts = await buildCreateOptions(ID, "Alice")
		expect(opts.rp).toEqual({ name: "Nulo", id: "passkey.nulo.sh" })
		expect((opts.challenge as Uint8Array).byteLength).toBe(32)
		expect(opts.pubKeyCredParams).toEqual([
			{ type: "public-key", alg: -7 },
			{ type: "public-key", alg: -257 },
		])
		expect(opts.authenticatorSelection).toEqual({
			residentKey: "required",
			userVerification: "required",
			requireResidentKey: true,
		})
	})
})

// jsdom ships no WebAuthn, so the ceremony's `instanceof` checks need real classes to match.
class StubAssertionResponse {
	constructor(readonly userHandle: Uint8Array | null) {}
}
class StubCredential {
	constructor(
		readonly rawId: Uint8Array,
		private readonly ext: Record<string, unknown>,
		readonly response?: StubAssertionResponse,
	) {}
	getClientExtensionResults() {
		return this.ext
	}
}

type CreateArgs = { publicKey: PublicKeyCredentialCreationOptions; signal?: AbortSignal }
type GetArgs = { publicKey: PublicKeyCredentialRequestOptions; signal?: AbortSignal }

const RAW_ID = new Uint8Array([1, 2, 3, 4])
const OTHER_RAW_ID = new Uint8Array([9, 8, 7, 6])
const PRF_AT_CREATE = new Uint8Array(32).fill(7)
const PRF_AT_GET = new Uint8Array(32).fill(9)
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64")
const CREATE_REQUEST = { mode: "create", userHandle: ID, name: "Alice" } as const

describe("runPasskeyCeremony in create mode", () => {
	const create = vi.fn<(o: CreateArgs) => Promise<unknown>>()
	const get = vi.fn<(o: GetArgs) => Promise<unknown>>()
	const withPrfOnGet = () => new StubCredential(RAW_ID, { prf: { results: { first: PRF_AT_GET } } }, new StubAssertionResponse(null))

	beforeEach(() => {
		create.mockReset()
		get.mockReset()
		vi.stubGlobal("PublicKeyCredential", StubCredential)
		vi.stubGlobal("AuthenticatorAssertionResponse", StubAssertionResponse)
		vi.stubGlobal("navigator", { credentials: { create, get } })
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("returns the create-time PRF without a second ceremony", async () => {
		create.mockResolvedValue(new StubCredential(RAW_ID, { prf: { enabled: true, results: { first: PRF_AT_CREATE } } }))
		const data = await runPasskeyCeremony(CREATE_REQUEST)
		expect(data).toEqual({ id: b64(RAW_ID), prf: b64(PRF_AT_CREATE), userHandle: ID })
		expect(get).not.toHaveBeenCalled()
	})

	// Firefox's shape: `enabled` without output. The assertion also omits `userHandle`, which is
	// legal once `allowCredentials` pins the request — the minted handle has to survive it.
	it("falls back to a get pinned to the new credential and keeps the minted handle", async () => {
		create.mockResolvedValue(new StubCredential(RAW_ID, { prf: { enabled: true } }))
		get.mockResolvedValue(withPrfOnGet())
		const data = await runPasskeyCeremony(CREATE_REQUEST)
		expect(data).toEqual({ id: b64(RAW_ID), prf: b64(PRF_AT_GET), userHandle: ID })
		expect(get).toHaveBeenCalledTimes(1)
		const opts = get.mock.calls[0][0].publicKey
		expect(opts.allowCredentials).toHaveLength(1)
		expect(b64(opts.allowCredentials?.[0].id as Uint8Array)).toBe(b64(RAW_ID))
		// The re-prompt has to request the same secret under the same terms as the create leg —
		// a different rp, a weaker userVerification or a different eval input all derive a
		// different master, or none.
		expect(opts.rpId).toBe("passkey.nulo.sh")
		expect(opts.userVerification).toBe("required")
		const prfLabel = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("nulo:profile:v1")))
		expect(toHex(opts.extensions?.prf?.eval?.first as BufferSource)).toBe(Buffer.from(prfLabel).toString("hex"))
	})

	it("refuses a fallback assertion from a different credential", async () => {
		create.mockResolvedValue(new StubCredential(RAW_ID, { prf: { enabled: true } }))
		get.mockResolvedValue(
			new StubCredential(OTHER_RAW_ID, { prf: { results: { first: PRF_AT_GET } } }, new StubAssertionResponse(null)),
		)
		await expect(runPasskeyCeremony(CREATE_REQUEST)).rejects.toThrow("Passkey PRF fallback returned a different credential")
	})

	it("throws without re-prompting when the authenticator reports no PRF at all", async () => {
		create.mockResolvedValue(new StubCredential(RAW_ID, {}))
		await expect(runPasskeyCeremony(CREATE_REQUEST)).rejects.toThrow("Passkey PRF not available")
		expect(get).not.toHaveBeenCalled()
	})

	it("throws when the fallback assertion carries no PRF output either", async () => {
		create.mockResolvedValue(new StubCredential(RAW_ID, { prf: { enabled: true } }))
		get.mockResolvedValue(new StubCredential(RAW_ID, { prf: {} }, new StubAssertionResponse(null)))
		await expect(runPasskeyCeremony(CREATE_REQUEST)).rejects.toThrow("Passkey PRF has no results")
		// Create can throw the same message; verify the failure reached get.
		expect(get).toHaveBeenCalledTimes(1)
	})

	it("forwards the abort signal to both ceremonies", async () => {
		const { signal } = new AbortController()
		create.mockResolvedValue(new StubCredential(RAW_ID, { prf: { enabled: true } }))
		get.mockResolvedValue(withPrfOnGet())
		await runPasskeyCeremony(CREATE_REQUEST, signal)
		expect(create.mock.calls[0][0].signal).toBe(signal)
		expect(get.mock.calls[0][0].signal).toBe(signal)
	})
})
