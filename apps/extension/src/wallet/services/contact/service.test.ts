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
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
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
	private readonly deletionState = new ProfileDeletionState()
	private active: ProfileInfo | undefined

	public async start(): Promise<void> {}

	public getDeletionState(): ProfileDeletionState {
		return this.deletionState
	}

	public async getActiveProfile(): Promise<ProfileInfo | undefined> {
		return this.active
	}

	public async captureExecutionFence(): Promise<{ profileId: string; epoch: number }> {
		if (!this.active || this.deletionState.isReserved(this.active.id)) throw new Error("Wallet locked")
		return { profileId: this.active.id, epoch: this.deletionState.capture(this.active.id) }
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

			// Profile-delete cleanup is now the coordinator's AWAITED call, not a
			// fire-and-forget onProfileDeleted subscriber (finding D).
			await contactService.purgeForProfile(profileA.id)

			profile.setActiveProfile(profileA)
			expect(await contactService.getContacts()).toEqual([])
			profile.setActiveProfile(profileB)
			expect(await contactService.getContacts()).toHaveLength(1)
		})

		test("(F-B23) a MALFORMED row owned by the purged profile is removed by the raw second pass", async () => {
			await contactService.addContact("Alice", "0xa")
			// A validation-failed row (B-23 retain: hidden from reads, kept on
			// disk). The typed purge pass can't see it — pre-fix it survived the
			// privacy-erasing profile purge forever.
			await api.storage.local.set({
				"nulo:core:contacts@zz-malformed": JSON.stringify({ profileId: profileA.id, broken: true }),
			})
			// Another profile's malformed row must NOT be touched.
			await api.storage.local.set({
				"nulo:core:contacts@zz-other": JSON.stringify({ profileId: profileB.id, broken: true }),
			})
			// A JSON-syntax-broken row is unattributable — fail-closed, left alone.
			await api.storage.local.set({ "nulo:core:contacts@zz-syntax": "{not json" })

			await contactService.purgeForProfile(profileA.id)

			const raw = await api.storage.local.get(null)
			expect(raw["nulo:core:contacts@zz-malformed"]).toBeUndefined() // purged with its profile
			expect(raw["nulo:core:contacts@zz-other"]).toBeDefined() // other profile: untouched
			expect(raw["nulo:core:contacts@zz-syntax"]).toBeDefined() // unattributable: fail-closed
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

	describe("restore — deletion fence (N-14)", () => {
		const rows = [
			{ id: "c1", profileId: profileA.id, name: "Ali", address: "0xa", abbr: "AL" },
			{ id: "c2", profileId: profileA.id, name: "Bob", address: "0xb", abbr: "BO" },
		] as Parameters<typeof contactService.restore>[0]

		test("a deleteProfile beginning DURING the restore rejects every later row write", async () => {
			// The first row's awaited storage.set is the interleave point: the
			// deletion begins while it is in flight, so row 2's pre-write assert
			// must reject. Row 1's already-dispatched write is the tombstoned
			// purge's responsibility, not the fence's.
			const origSet = api.storage.local.set.bind(api.storage.local)
			let fired = false
			api.storage.local.set = async (items: Record<string, unknown>) => {
				await origSet(items)
				if (!fired) {
					fired = true
					profile.getDeletionState().beginDeletion(profileA.id)
				}
			}
			const restored = await contactService.restore(rows)
			expect(restored[0].restoreError).toBeUndefined()
			expect(restored[1].restoreError).toMatch(/deleted/)
			const raw = await api.storage.local.get(null)
			expect(Object.keys(raw).some((k) => k.includes("c2"))).toBe(false)
		})

		test("a restore starting while the profile is ALREADY mid-deletion writes nothing", async () => {
			profile.getDeletionState().beginDeletion(profileA.id) // reserved at entry
			const restored = await contactService.restore(rows)
			expect(restored.every((r) => typeof r.restoreError === "string")).toBe(true)
			const raw = await api.storage.local.get(null)
			expect(Object.keys(raw).some((k) => k.startsWith("nulo:core:contacts@"))).toBe(false)
		})

		test("positive control: no deletion → both rows land", async () => {
			const restored = await contactService.restore(rows)
			expect(restored.every((r) => r.restoreError === undefined)).toBe(true)
		})

		test("a deletion that begins AND completes mid-restore still rejects later rows (entry-capture pin)", async () => {
			// Discriminates entry capture from the rejected lazy design: after
			// begin+release the profile is no longer reserved and the epoch is
			// settled — a capture taken lazily at row 2 would observe the settled
			// value and land the orphan; the entry-captured epoch has moved.
			const origSet = api.storage.local.set.bind(api.storage.local)
			let fired = false
			api.storage.local.set = async (items: Record<string, unknown>) => {
				await origSet(items)
				if (!fired) {
					fired = true
					const d = profile.getDeletionState()
					d.beginDeletion(profileA.id)
					d.release(profileA.id)
				}
			}
			const restored = await contactService.restore(rows)
			expect(restored[0].restoreError).toBeUndefined()
			expect(restored[1].restoreError).toMatch(/deleted/)
		})

		test("a hostile null row is a per-row restoreError, never a whole-slice abort", async () => {
			// Backup slices are attacker-controlled; normalizeAllIds preserves
			// non-object elements. The entry capture must tolerate them (null-safe
			// read) so the documented per-row contract holds.
			const restored = await contactService.restore([rows[0], null as never])
			expect(restored[0].restoreError).toBeUndefined()
			expect(typeof restored[1].restoreError).toBe("string")
		})

		test("a deletion completing while parked at the e2e hold gate rejects every row (capture precedes the gate)", async () => {
			// The gate parks an import RPC pre-finalize; a deletion can begin AND
			// fully release during that park. The epochs must be captured BEFORE
			// the gate — a post-gate capture would read the settled post-bump
			// epoch and land orphan rows.
			let release!: () => void
			const parked = new Promise<void>((res) => {
				release = res
			})
			const gated = new ContactService(logger, api, { waitAt: () => parked })
			const gatedServices = new ServiceCollection()
			gatedServices.add(profile)
			gatedServices.add(gated)
			await gatedServices.start()

			const run = gated.restore(rows)
			await new Promise((r) => setTimeout(r, 0)) // capture done; parked at the gate
			const d = profile.getDeletionState()
			d.beginDeletion(profileA.id)
			d.release(profileA.id)
			release()
			const restored = await run
			expect(restored.every((r) => typeof r.restoreError === "string")).toBe(true)
			const raw = await api.storage.local.get(null)
			expect(Object.keys(raw).some((k) => k.startsWith("nulo:core:contacts@"))).toBe(false)
		})
	})

	describe("addContact — creation fence", () => {
		const contactRowCount = async (): Promise<number> => {
			const raw = await api.storage.local.get(null)
			return Object.keys(raw).filter((k) => k.startsWith("nulo:core:contacts@")).length
		}

		test("a deletion completing DURING the id allocation rejects the write (entry-capture pin)", async () => {
			// begin + RELEASE while the id-alloc read is parked: the deletion fully
			// settles, so only an entry-captured fence still rejects.
			const realGet = api.storage.local.get.bind(api.storage.local)
			let parked: (() => void) | null = null
			let armed = true
			api.storage.local.get = (async (key: unknown) => {
				if (armed) {
					armed = false
					await new Promise<void>((resolve) => {
						parked = resolve
					})
				}
				return realGet(key as never)
			}) as typeof api.storage.local.get

			const run = contactService.addContact("Ghost", "0xdead")
			await new Promise((r) => setTimeout(r, 0))
			profile.getDeletionState().beginDeletion(profileA.id)
			profile.getDeletionState().release(profileA.id)
			;(parked as (() => void) | null)?.()

			await expect(run).rejects.toThrow(/deleted|not current/i)
			api.storage.local.get = realGet as typeof api.storage.local.get
			expect(await contactRowCount()).toBe(0)
		})

		test("a deletion landing DURING the row write is compensated away before any emit", async () => {
			const emitted: unknown[] = []
			contactService.onContactAdded.add((c) => emitted.push(c))
			const realSet = api.storage.local.set.bind(api.storage.local)
			let fired = false
			api.storage.local.set = (async (items: Record<string, unknown>) => {
				await realSet(items)
				if (!fired && Object.keys(items).some((k) => k.startsWith("nulo:core:contacts@"))) {
					fired = true
					profile.getDeletionState().beginDeletion(profileA.id)
				}
			}) as typeof api.storage.local.set

			await expect(contactService.addContact("Ghost", "0xdead")).rejects.toThrow(/deleted/)
			api.storage.local.set = realSet as typeof api.storage.local.set
			expect(await contactRowCount()).toBe(0)
			expect(emitted).toHaveLength(0)
		})
	})
})
