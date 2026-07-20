import { describe, expect, test } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EntityStorage } from "@/wallet/storage"
import { DappSessionMacStorage } from "./mac-storage"
import { DappSessionSchema, type DappSession } from "./spec"

const logger = { log: () => {} } as never
const ROOT = "nulo:core:dappSessions"

function row(id: string, profileId: string): DappSession {
	return {
		id,
		profileId,
		chainId: "1",
		dappMetadata: { url: `https://${id}.xyz` },
		permissions: [],
		accounts: [],
		confirmationLevel: 0 as unknown as DappSession["confirmationLevel"],
		expiry: Date.now() + 1_000_000,
	}
}

async function makeStore() {
	const api = new FakeBrowserApi()
	api.reset()
	// Mirror production: the inner store validates via DappSessionSchema.
	const inner = new EntityStorage<DappSession>(ROOT, api.storage.local, (raw) => DappSessionSchema.parse(raw))
	const kActive = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
	const kGone = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
	const locked = new Set<string>()
	const keyFor = async (pid: string): Promise<CryptoKey> => {
		if (locked.has(pid)) throw new Error("Profile locked")
		return pid === "active" ? kActive : kGone
	}
	return { api, inner, store: new DappSessionMacStorage(inner, keyFor, logger), locked }
}

describe("DappSessionMacStorage.rowsForProfile (F-12 profile-deletion cascade)", () => {
	test("returns an INACTIVE profile's rows the MAC view HIDES — with their true storageId", async () => {
		const { store, locked } = await makeStore()
		await store.set("s-active", row("s-active", "active"))
		await store.set("s-gone", row("s-gone", "gone"))

		locked.add("gone") // now inactive: MAC key underivable
		expect((await store.getValues()).map((r) => r.id)).toEqual(["s-active"]) // s-gone HIDDEN by the MAC view

		const rows = await store.rowsForProfile("gone")
		expect(rows.map((r) => r.storageId)).toEqual(["s-gone"])
		await store.delete(rows[0].storageId)
		expect(await store.rowsForProfile("gone")).toEqual([]) // physically purged
	})

	test("(gap 1) finds a SCHEMA-INVALID row that the codec keeps-but-hides", async () => {
		const { api, store } = await makeStore()
		// A row with profileId=P but a missing required field: the codec KEEPS it
		// (dev's policy) but HIDES it from getValues — a profile purge must still see it.
		await api.storage.local.set({ [`${ROOT}@bad`]: JSON.stringify({ id: "bad", profileId: "gone" /* no chainId etc. */ }) })
		expect((await store.getValues()).some((r) => r.id === "bad")).toBe(false) // hidden by codec
		expect((await store.rowsForProfile("gone")).map((r) => r.storageId)).toEqual(["bad"]) // still found for purge
	})

	test("(gap 2) deletes by the STORAGE KEY, not the row's self-reported id (alias can't survive)", async () => {
		const { api, store } = await makeStore()
		await store.set("s1", row("s1", "gone"))
		// Copy the valid signed row to a DIFFERENT key; its embedded id stays "s1".
		const raw = (await api.storage.local.get(`${ROOT}@s1`))[`${ROOT}@s1`]
		await api.storage.local.set({ [`${ROOT}@alias`]: raw })

		const rows = await store.rowsForProfile("gone")
		// Both keys surface with their TRUE storageId (not the shared embedded "s1").
		expect(rows.map((r) => r.storageId).sort()).toEqual(["alias", "s1"])
		for (const r of rows) await store.delete(r.storageId)
		expect(await store.rowsForProfile("gone")).toEqual([]) // alias removed too
	})
})
