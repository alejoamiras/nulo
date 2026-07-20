import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { ACCOUNT_INTEGRITY_BLOCKED_ROOT } from "@/wallet/services/account-integrity/types"
import { installChromeStorage } from "../../tests/helpers/chrome-storage-mock"
import AccountIntegrityBarrier from "./AccountIntegrityBarrier.vue"

const stubs = { MaterialIcon: true, Teleport: true }
const mountBarrier = () => mount(AccountIntegrityBarrier, { global: { stubs } })
const KEY = `${ACCOUNT_INTEGRITY_BLOCKED_ROOT}@p1`
const LAST_ACTIVE = "nulo:ui:lastActiveProfile"

function record(profileId: string): string {
	return JSON.stringify({
		profileId,
		chainId: 0,
		accountIndex: 0,
		storedAddress: "0xstored",
		derivedAddress: "0xderived",
		regimeId: "nulo-v5",
		walletVersion: "0.0.0",
		detectedAt: 1,
	})
}

describe("AccountIntegrityBarrier", () => {
	beforeEach(() => {
		document.body.innerHTML = ""
		window.location.hash = ""
	})
	afterEach(() => {
		window.location.hash = ""
	})

	test("no blocking record: renders nothing", async () => {
		installChromeStorage({ [LAST_ACTIVE]: "p1" })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='account-integrity-blocked']").exists()).toBe(false)
	})

	test("record for the last-active profile: full-screen barrier with the required copy", async () => {
		installChromeStorage({ [KEY]: record("p1"), [LAST_ACTIVE]: "p1" })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='account-integrity-blocked']").exists()).toBe(true)
		expect(w.text()).toContain("ACCOUNT VERIFICATION FAILED")
		// The two mandated content claims: what happened + the seed still derives the accounts
		// on a compatible version (and no categorical "funds are safe").
		expect(w.text()).toContain("derives a different address")
		expect(w.text()).toContain("seed phrase still derives your accounts")
		expect(w.text()).not.toContain("funds are safe")
	})

	test("record for a DIFFERENT profile does not brick the presented one", async () => {
		installChromeStorage({ [KEY]: record("p1"), [LAST_ACTIVE]: "other-profile" })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='account-integrity-blocked']").exists()).toBe(false)
	})

	test("phishing-surface bans: no inputs, no links, no buttons — nothing to click or type into", async () => {
		installChromeStorage({ [KEY]: record("p1"), [LAST_ACTIVE]: "p1" })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("input").exists()).toBe(false)
		expect(w.find("textarea").exists()).toBe(false)
		expect(w.find("a").exists()).toBe(false)
		expect(w.find("button").exists()).toBe(false)
	})

	test("a CORRUPT record blocks regardless of profile (fail-closed presence semantics)", async () => {
		installChromeStorage({ [KEY]: "{truncated", [LAST_ACTIVE]: "unrelated" })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='account-integrity-blocked']").exists()).toBe(true)
	})

	test("yields on the auth route so unlock (the heal vector) stays reachable", async () => {
		window.location.hash = "#/popup/auth"
		installChromeStorage({ [KEY]: record("p1"), [LAST_ACTIVE]: "p1" })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='account-integrity-blocked']").exists()).toBe(false)
	})

	test("live updates: appears on record write, disappears on heal", async () => {
		const storage = installChromeStorage({ [LAST_ACTIVE]: "p1" })
		const w = mountBarrier()
		await flushPromises()
		expect(w.find("[data-testid='account-integrity-blocked']").exists()).toBe(false)

		storage.data[KEY] = record("p1")
		storage.fire({ [KEY]: { newValue: storage.data[KEY] } })
		await flushPromises()
		expect(w.find("[data-testid='account-integrity-blocked']").exists()).toBe(true)

		delete storage.data[KEY]
		storage.fire({ [KEY]: { newValue: undefined } })
		await flushPromises()
		expect(w.find("[data-testid='account-integrity-blocked']").exists()).toBe(false)
	})

	test("changes in other storage areas or keys are ignored", async () => {
		const storage = installChromeStorage({ [LAST_ACTIVE]: "p1" })
		const w = mountBarrier()
		await flushPromises()
		storage.data[KEY] = record("p1")
		// Same key but SESSION area — must not trigger.
		storage.fire({ [KEY]: { newValue: storage.data[KEY] } }, "session")
		await flushPromises()
		expect(w.find("[data-testid='account-integrity-blocked']").exists()).toBe(false)
	})
})
