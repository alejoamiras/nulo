/**
 * Unit tests for `ContactService` using `FakeBrowserApi`.
 *
 * Reference pattern for the ports-and-adapters approach: no
 * `chrome.storage` mocks, no `vi.mock()` on modules — real in-memory
 * state via `@webext-core/fake-browser` through `FakeBrowserApi`, real
 * service lifecycle via `ServiceCollection`.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { ServiceCollection, type IService } from "@/wallet/base"
import { LoggerStore } from "@/wallet/logger"
import { ConfigStore } from "@/wallet/config"
import { PROFILE_SERVICE_NAME, type ProfileInfo } from "@/wallet/services/profile/spec"
import { ContactService } from "./service"

/**
 * Minimal ProfileService fake — satisfies the subset of the real surface that
 * ContactService depends on: `getActiveProfile()` and the `onProfileDeleted`
 * event handler. Registers into the real ServiceCollection so ContactService.init
 * resolves `services.get(ProfileService.name)` normally.
 */
class FakeProfileService implements IService {
	public static readonly name = PROFILE_SERVICE_NAME
	public readonly name = PROFILE_SERVICE_NAME
	public readonly onProfileDeleted = new EventHandler<ProfileInfo>()
	private active: ProfileInfo | undefined

	public async start(): Promise<void> {}

	public async getActiveProfile(): Promise<ProfileInfo | undefined> {
		return this.active
	}

	public setActiveProfile(profile: ProfileInfo | undefined): void {
		this.active = profile
	}
}

const profileA: ProfileInfo = { id: "pa", name: "A", type: "password" }
const profileB: ProfileInfo = { id: "pb", name: "B", type: "password" }

describe("ContactService (port-migrated)", () => {
	let api: FakeBrowserApi
	let profile: FakeProfileService
	let logger: LoggerStore
	let contactService: ContactService
	let services: ServiceCollection

	beforeEach(async () => {
		api = new FakeBrowserApi()
		api.reset()
		profile = new FakeProfileService()
		profile.setActiveProfile(profileA)
		logger = new LoggerStore(new ConfigStore())

		services = new ServiceCollection()
		services.add(profile)
		contactService = new ContactService(logger, api)
		services.add(contactService)
		await services.start()
	})

	describe("getContacts", () => {
		test("empty by default", async () => {
			const contacts = await contactService.getContacts()
			expect(contacts).toEqual([])
		})

		test("throws when profile is locked", async () => {
			profile.setActiveProfile(undefined)
			await expect(contactService.getContacts()).rejects.toThrow(/locked/i)
		})

		test("only returns contacts for the active profile", async () => {
			await contactService.addContact("Alice", "0xaaaa")
			profile.setActiveProfile(profileB)
			await contactService.addContact("Bob", "0xbbbb")
			profile.setActiveProfile(profileA)

			const contacts = await contactService.getContacts()
			expect(contacts).toHaveLength(1)
			expect(contacts[0].name).toBe("Alice")
		})
	})

	describe("addContact", () => {
		test("persists to storage (verified via FakeBrowserApi)", async () => {
			const c = await contactService.addContact("Alice", "0xaaaa")
			expect(c.name).toBe("Alice")
			expect(c.address).toBe("0xaaaa")
			expect(c.profileId).toBe(profileA.id)
			expect(c.abbr).toBe("AL")

			// Inspect the underlying storage to prove the write reached the port,
			// not just in-memory state on the service instance.
			const entries = await api.storage.local.get(null)
			const key = `nulo:core:contacts@${c.id}`
			expect(key in entries).toBe(true)
			const stored = JSON.parse(entries[key] as string)
			expect(stored.id).toBe(c.id)
			expect(stored.name).toBe("Alice")
		})

		test("emits onContactAdded", async () => {
			const seen = vi.fn()
			contactService.onContactAdded.add(seen)
			const c = await contactService.addContact("Alice", "0xaaaa")
			expect(seen).toHaveBeenCalledWith(c)
		})

		test("two-word name → first letter of each", async () => {
			const c = await contactService.addContact("Alice Cooper", "0xa")
			expect(c.abbr).toBe("AC")
		})

		test("one-word name → first two letters", async () => {
			const c = await contactService.addContact("Alice", "0xa")
			expect(c.abbr).toBe("AL")
		})
	})

	describe("updateContact", () => {
		test("updates name and address", async () => {
			const c = await contactService.addContact("Alice", "0xaaaa")
			const updated = await contactService.updateContact(c.id, "Alice Cooper", "0xbbbb")
			expect(updated.name).toBe("Alice Cooper")
			expect(updated.address).toBe("0xbbbb")
			expect(updated.abbr).toBe("AC")
		})

		test("rejects a contact id owned by a different profile", async () => {
			const c = await contactService.addContact("Alice", "0xa")
			profile.setActiveProfile(profileB)
			await expect(contactService.updateContact(c.id, "X", "0xX")).rejects.toThrow(/invalid id/i)
		})

		test("emits onContactUpdated", async () => {
			const c = await contactService.addContact("Alice", "0xa")
			const seen = vi.fn()
			contactService.onContactUpdated.add(seen)
			const updated = await contactService.updateContact(c.id, "Alice Cooper")
			expect(seen).toHaveBeenCalledWith(updated)
		})
	})

	describe("deleteContact", () => {
		test("removes from storage + emits", async () => {
			const c = await contactService.addContact("Alice", "0xa")
			const seen = vi.fn()
			contactService.onContactDeleted.add(seen)
			await contactService.deleteContact(c.id)
			expect(seen).toHaveBeenCalledWith(c)
			expect(await contactService.getContacts()).toEqual([])
		})
	})

	describe("getContactByAddress", () => {
		test("finds by exact address match for the active profile", async () => {
			await contactService.addContact("Alice", "0xaaaa")
			const hit = await contactService.getContactByAddress("0xaaaa")
			expect(hit?.name).toBe("Alice")
		})

		test("returns undefined when address does not match", async () => {
			await contactService.addContact("Alice", "0xaaaa")
			const miss = await contactService.getContactByAddress("0xbbbb")
			expect(miss).toBeUndefined()
		})

		test("does not leak contacts from other profiles", async () => {
			await contactService.addContact("Alice", "0xshared")
			profile.setActiveProfile(profileB)
			const miss = await contactService.getContactByAddress("0xshared")
			expect(miss).toBeUndefined()
		})
	})

	describe("import/export", () => {
		test("exports and reimports round-trip", async () => {
			await contactService.addContact("Alice", "0xaaaa")
			await contactService.addContact("Bob", "0xbbbb")
			const json = await contactService.exportContacts()

			// Wipe and reimport into a fresh profile's context.
			profile.setActiveProfile(profileB)
			const restored = await contactService.importContacts(json)

			expect(restored).toHaveLength(2)
			const all = await contactService.getContacts()
			expect(all.map((c) => c.name).sort()).toEqual(["Alice", "Bob"])
		})

		test("import merges duplicate addresses by updating the existing entry", async () => {
			const original = await contactService.addContact("Alice", "0xsame")
			const json = JSON.stringify([{ name: "Alicia", address: "0xsame" }])
			await contactService.importContacts(json)

			const all = await contactService.getContacts()
			expect(all).toHaveLength(1)
			expect(all[0].id).toBe(original.id)
			expect(all[0].name).toBe("Alicia")
		})
	})

	describe("profile deletion cleanup", () => {
		test("removes contacts owned by the deleted profile", async () => {
			await contactService.addContact("Alice", "0xa")
			profile.setActiveProfile(profileB)
			await contactService.addContact("Bob", "0xb")

			// Fire the event ContactService subscribes to in init().
			profile.onProfileDeleted.invoke(profileA)

			// Allow the async handler to run.
			await new Promise((resolve) => setTimeout(resolve, 0))

			profile.setActiveProfile(profileA)
			expect(await contactService.getContacts()).toEqual([])
			profile.setActiveProfile(profileB)
			expect(await contactService.getContacts()).toHaveLength(1)
		})
	})

	describe("backup/restore", () => {
		test("backup returns the active profile's contacts", async () => {
			await contactService.addContact("Alice", "0xa")
			const backup = await contactService.backup()
			expect(backup).toHaveLength(1)
			expect(backup[0].name).toBe("Alice")
		})

		test("restore recreates contacts with unique ids", async () => {
			await contactService.addContact("Alice", "0xa")
			const backup = await contactService.backup()

			// Restore adds them under existing ids; since the existing entry has
			// the same id, restore must generate a new id to avoid collision.
			const restored = await contactService.restore(backup)
			expect(restored).toHaveLength(1)
			expect(restored[0].restoreError).toBeUndefined()

			const all = await contactService.getContacts()
			expect(all).toHaveLength(2)
		})

		test("(R3) a failed item stores the normalized error MESSAGE string, not the raw error", async () => {
			// Before Q14, contact stored the raw `err` here while every other
			// service stored `.message`. R3 normalized it through `toRestoreError`,
			// so a failed restore now carries the message STRING (object → string
			// is a ratified behavior change).
			await contactService.addContact("Alice", "0xa")
			const backup = await contactService.backup()
			vi.spyOn(api.storage.local, "set").mockRejectedValueOnce(new Error("disk full"))

			const restored = await contactService.restore(backup)
			expect(restored).toHaveLength(1)
			expect(restored[0].restoreError).toBe("disk full")
			expect(typeof restored[0].restoreError).toBe("string")
		})

		test("(P1) a schema-malformed contact row is recorded as restoreError and NEVER written to raw storage", async () => {
			// A hostile backup row that fails the read-codec would otherwise be
			// written by the pre-fix `restore` and then KEPT-but-hidden by
			// EntityStorage.decodeRow — codec-hidden private data that survives a
			// later cleanup's getValues(). Parse-before-write records it instead.
			const bad = [{ id: "bad-1", profileId: "p1", name: 123, address: "0xa", abbr: "AL" }] as unknown as Parameters<
				typeof contactService.restore
			>[0]

			const restored = await contactService.restore(bad)
			expect(restored).toHaveLength(1)
			expect(restored[0].restoreError).toBeDefined()

			const raw = await api.storage.local.get(null)
			expect(Object.keys(raw).some((k) => k.includes("bad-1"))).toBe(false)
		})
	})
})
