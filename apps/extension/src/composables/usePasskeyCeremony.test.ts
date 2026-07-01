/**
 * Unit tests for `usePasskeyCeremony` — covers the Promise lifecycle,
 * error normalization, and concurrency guard.
 */

import { describe, expect, test } from "vitest"
import { asBase64CredentialId, asBase64SecretPrf, type PasskeyCredentialData } from "@nulo/wallet-crypto"
import { usePasskeyCeremony } from "./usePasskeyCeremony"

const fakeData = (id = "cred-x"): PasskeyCredentialData => ({ id: asBase64CredentialId(id), prf: asBase64SecretPrf("prf-bytes-base64") })

describe("usePasskeyCeremony", () => {
	test("opens the dialog (sets request) when runCeremony is called", () => {
		const { request, runCeremony } = usePasskeyCeremony()
		expect(request.value).toBeNull()
		runCeremony({ mode: "get", credentialId: "abc" })
		expect(request.value).toEqual({ mode: "get", credentialId: "abc" })
	})

	test("onResolve clears the dialog and resolves the awaiting Promise", async () => {
		const { request, runCeremony, onResolve } = usePasskeyCeremony()
		const promise = runCeremony({ mode: "create", userHandle: "uh", name: "Test" })

		const data = fakeData()
		onResolve(data)

		await expect(promise).resolves.toBe(data)
		expect(request.value).toBeNull()
	})

	test("onReject clears the dialog and rejects the awaiting Promise", async () => {
		const { request, runCeremony, onReject } = usePasskeyCeremony()
		const promise = runCeremony({ mode: "get", credentialId: "abc" })

		const err = new Error("user cancelled")
		onReject(err)

		await expect(promise).rejects.toBe(err)
		expect(request.value).toBeNull()
	})

	test("rejects a second concurrent runCeremony call", async () => {
		const { runCeremony, onResolve } = usePasskeyCeremony()
		const first = runCeremony({ mode: "create", userHandle: "uh", name: "Test" })
		const second = runCeremony({ mode: "create", userHandle: "uh2", name: "Test" })
		await expect(second).rejects.toThrow(/already in flight/)
		// First still resolvable cleanly.
		onResolve(fakeData())
		await expect(first).resolves.toBeDefined()
	})

	test("after resolve, a NEW ceremony can run", async () => {
		const { runCeremony, onResolve } = usePasskeyCeremony()
		const first = runCeremony({ mode: "create", userHandle: "uh", name: "Test" })
		onResolve(fakeData("cred-1"))
		await first

		const second = runCeremony({ mode: "create", userHandle: "uh2", name: "Test" })
		onResolve(fakeData("cred-2"))
		await expect(second).resolves.toMatchObject({ id: "cred-2" })
	})

	test("after reject, a NEW ceremony can run", async () => {
		const { runCeremony, onResolve, onReject } = usePasskeyCeremony()
		const first = runCeremony({ mode: "create", userHandle: "uh", name: "Test" })
		onReject(new Error("first cancelled"))
		await expect(first).rejects.toThrow(/first cancelled/)

		const second = runCeremony({ mode: "create", userHandle: "uh2", name: "Test" })
		onResolve(fakeData("cred-2"))
		await expect(second).resolves.toMatchObject({ id: "cred-2" })
	})

	test("onResolve with no pending ceremony is a safe no-op", () => {
		const { onResolve, request } = usePasskeyCeremony()
		expect(() => onResolve(fakeData())).not.toThrow()
		expect(request.value).toBeNull()
	})

	test("onReject with no pending ceremony is a safe no-op", () => {
		const { onReject, request } = usePasskeyCeremony()
		expect(() => onReject(new Error("late"))).not.toThrow()
		expect(request.value).toBeNull()
	})

	test("request.value mirrors the latest active request", () => {
		const { runCeremony, request, onResolve } = usePasskeyCeremony()
		const req1 = { mode: "get", credentialId: "a" } as const
		runCeremony(req1)
		expect(request.value).toEqual(req1)

		onResolve(fakeData())
		expect(request.value).toBeNull()

		const req2 = { mode: "create", userHandle: "uh", name: "Test" } as const
		runCeremony(req2)
		expect(request.value).toEqual(req2)
	})

	test("Promise propagates the resolved data verbatim (not a copy)", async () => {
		const { runCeremony, onResolve } = usePasskeyCeremony()
		const promise = runCeremony({ mode: "get", credentialId: "x" })
		const data = fakeData("identity-check")
		onResolve(data)
		await expect(promise).resolves.toBe(data) // strict equality
	})
})
