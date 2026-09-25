/**
 * Frozen-oracle characterization tests for the capabilities approval window's
 * SHELL lifecycle — the connect/wait/redirect/init/beforeunload skeleton, the
 * unmount disconnect ORDER, and the closeWindow/beforeunload reject routing.
 * These pin CURRENT behavior verbatim so a shell extraction can be graded
 * against them; they must pass unchanged before AND after it.
 *
 * Pins covered here: A1 connect set+order · A2 session gate ·
 * A3 auth redirect · A4 beforeunload-after-init (incl. init-throw) ·
 * A5 unmount disconnect order · A6 closeWindow(true) vs closeWindow() ·
 * A7 no-double-reject · B8 reject two-layer order · B9 the MISSING !requestId
 * guard (capabilities-only divergence — execute/discover bail; do NOT "fix") ·
 * C12 onActiveProfileChanged guard.
 *
 * The describe blocks after the shell's pin the window's own business: the account
 * picker's widening consent, and the permission rows with the answer they produce.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { MaterialIcon, Toggle } from "@nulo/design"
import { JobCancelledError } from "@nulo/extension-messaging/errors"
import { flushPromises, mount } from "@vue/test-utils"
import { reactive, ref, type Ref } from "vue"

// ── Mock state (closure refs so tests can flip values mid-test) ──────

let requestIdMock = ref<string | undefined>(undefined)
let dappMock = ref<{ name: string; url: string } | null>(null)
let payloadMock: Ref<unknown> = ref(null)
let isCancelledMock = ref(false)
let payloadToLoad: unknown = null
let loadPromiseResolve: (() => void) | undefined
let _loadPromiseReject: ((err: Error) => void) | undefined
let getActiveProfilePromiseResolve: ((p: unknown) => void) | undefined
let getActiveProfilePromiseReject: ((err: Error) => void) | undefined

/** Ordered lifecycle log — the load-bearing pins assert exact sequences on this. */
const callLog: string[] = []

const loadInteractionPayloadMock = vi.fn(() => {
	return new Promise<void>((resolve, reject) => {
		loadPromiseResolve = () => {
			// Mirror the real composable: load() commits requestId first, then payload + dapp.
			requestIdMock.value = "req-123"
			dappMock.value = { name: "Test DApp", url: "https://example.com" }
			payloadMock.value = payloadToLoad
			resolve()
		}
		_loadPromiseReject = reject
	})
})

const rejectViaInteractionServiceMock = vi.fn((reason: string) => {
	callLog.push(`composableReject:${reason}`)
})
const resolveInteractionMock = vi.fn(async () => undefined)

const getActiveProfileMock = vi.fn(() => {
	return new Promise<unknown>((resolve, reject) => {
		getActiveProfilePromiseResolve = resolve
		getActiveProfilePromiseReject = reject
	})
})

const profileServiceConnectMock = vi.fn(() => callLog.push("profile.connect"))
const profileServiceDisconnectMock = vi.fn(() => callLog.push("profile.disconnect"))
const interactionServiceConnectMock = vi.fn(() => callLog.push("interaction.connect"))
const interactionServiceDisconnectMock = vi.fn(() => callLog.push("interaction.disconnect"))
const onActiveProfileChangedAddMock = vi.fn()
const windowsRemoveMock = vi.fn(() => callLog.push("windows.remove"))

const routerPushMock = vi.fn()
const routerMock = {
	currentRoute: { value: { fullPath: "/windows/capabilities?requestId=req-route", query: { requestId: "req-route" } } },
	push: routerPushMock,
}

const appStoreDefaults = () =>
	reactive({
		isSessionChecked: true,
		isLogined: true,
		account: { name: "TestAccount" },
		network: { name: "TestNet" },
		networks: [],
		pageAwaitingAuth: "",
	})
let appStoreMock = appStoreDefaults()

// ── Mocks (vi.mock is hoisted; factories run lazily at component import) ────

vi.mock("@/composables/useDappInteractionPayload", () => ({
	useDappInteractionPayload: vi.fn(() => ({
		requestId: requestIdMock,
		payload: payloadMock,
		dapp: dappMock,
		isCancelled: isCancelledMock,
		load: loadInteractionPayloadMock,
		reject: rejectViaInteractionServiceMock,
	})),
}))

vi.mock("@/composables/useDappHostname", () => ({
	useDappHostname: vi.fn(() => ({
		hostname: ref("example.com"),
		isSuspicious: ref(false),
	})),
}))

// Vitest 4 requires `function` expressions (not arrow functions) for mocks
// instantiated with `new`. Matches discover/index.test.ts pattern.
vi.mock("@/wallet/services/profile/client", () => ({
	ProfileServiceClient: vi.fn(function () {
		return {
			getActiveProfile: getActiveProfileMock,
			connect: profileServiceConnectMock,
			disconnect: profileServiceDisconnectMock,
			onActiveProfileChanged: { add: onActiveProfileChangedAddMock },
		}
	}),
}))

vi.mock("@/wallet/services/dapp-interaction/client", () => ({
	DappInteractionServiceClient: vi.fn(function () {
		return {
			connect: interactionServiceConnectMock,
			disconnect: interactionServiceDisconnectMock,
			resolveInteraction: resolveInteractionMock,
		}
	}),
}))

vi.mock("@/stores/app.store", () => ({
	useAppStore: () => appStoreMock,
}))

vi.mock("vue-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("vue-router")>()
	return { ...actual, useRouter: () => routerMock }
})

// ── window listener spies (call-through so real registration still happens,
//    letting tests deliver a synthetic `beforeunload` to the live listener) ──

type WinListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void
let nativeAdd: WinListener
let nativeRemove: WinListener
let addSpy: ReturnType<typeof vi.fn<WinListener>>
let removeSpy: ReturnType<typeof vi.fn<WinListener>>

const beforeunloadAdds = () => addSpy.mock.calls.filter((c) => c[0] === "beforeunload").length
const beforeunloadRemoves = () => removeSpy.mock.calls.filter((c) => c[0] === "beforeunload").length

beforeEach(() => {
	nativeAdd = window.addEventListener.bind(window)
	nativeRemove = window.removeEventListener.bind(window)
	addSpy = vi.fn<WinListener>((type, listener, options) => {
		if (type === "beforeunload") callLog.push("addEventListener:beforeunload")
		nativeAdd(type, listener, options)
	})
	removeSpy = vi.fn<WinListener>((type, listener, options) => {
		if (type === "beforeunload") callLog.push("removeEventListener:beforeunload")
		nativeRemove(type, listener, options)
	})
	window.addEventListener = addSpy as unknown as typeof window.addEventListener
	window.removeEventListener = removeSpy as unknown as typeof window.removeEventListener

	// biome-ignore lint/suspicious/noExplicitAny: chrome runtime stub for tests
	;(globalThis as any).chrome = {
		windows: {
			getCurrent: (_o: unknown, cb: (w: { id?: number }) => void) => cb({ id: 42 }),
			remove: windowsRemoveMock,
		},
	}
})

let w: ReturnType<typeof factory> | undefined

afterEach(() => {
	// Unmount FIRST so the component's removeEventListener goes through the spy
	// and the real listener actually detaches (no cross-test beforeunload leaks).
	w?.unmount()
	w = undefined
	window.addEventListener = nativeAdd as unknown as typeof window.addEventListener
	window.removeEventListener = nativeRemove as unknown as typeof window.removeEventListener
	callLog.length = 0
	payloadToLoad = null
	requestIdMock = ref<string | undefined>(undefined)
	dappMock = ref<{ name: string; url: string } | null>(null)
	payloadMock = ref(null)
	isCancelledMock = ref(false)
	appStoreMock = appStoreDefaults()
	loadPromiseResolve = undefined
	_loadPromiseReject = undefined
	getActiveProfilePromiseResolve = undefined
	getActiveProfilePromiseReject = undefined
	vi.clearAllMocks()
})

// ── Stubs (children flattened; overlay stub re-emits dismiss on click) ──

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i />" },
	Tooltip: { template: "<div><slot /></div>" },
	Button: {
		props: ["disabled", "loading"],
		emits: ["click"],
		template: `
			<button
				:data-testid="$attrs['data-testid']"
				:disabled="disabled || loading"
				@click="$emit('click', $event)"
			>
				<slot />
			</button>
		`,
	},
	SectionLabel: { template: "<div />" },
	ItemsContainer: { template: "<div><slot /></div>" },
	PermissionRow: { template: "<div />" },
	AccountSelectRow: { template: "<div />" },
	DappStatusStrip: { template: '<div data-testid="status-strip" />', props: ["accountName", "networkName", "status"] },
	DappIdentityBlock: {
		template: '<div data-testid="identity-block" />',
		props: ["dapp", "hostname", "hostnameSuspicious", "actionLabel"],
	},
	DappCancelledOverlay: {
		props: ["message"],
		emits: ["dismiss"],
		template: `<div data-testid="cancelled-overlay" :data-message="message" @click="$emit('dismiss')" />`,
	},
}

// Lazy import after vi.mock hoist
import PermissionRow from "@/components/composite/capabilities/PermissionRow.vue"
import Capabilities from "./index.vue"

const factory = () => mount(Capabilities, { global: { stubs: STUBS } })

type CapVm = { reject: () => Promise<void>; closeWindow: (interactionCompleted?: boolean) => void }

/** Drive init to completion: resolve the profile fetch, then the payload load. */
const completeInit = async (profile: { id: string } = { id: "p1" }) => {
	await flushPromises()
	getActiveProfilePromiseResolve?.(profile)
	await flushPromises()
	loadPromiseResolve?.()
	await flushPromises()
}

describe("capabilities window — shell lifecycle frozen oracle", () => {
	test("A1: onMounted eager-connects exactly profile → interaction, in order", async () => {
		w = factory()
		await flushPromises()
		expect(callLog.filter((c) => c.endsWith(".connect"))).toEqual(["profile.connect", "interaction.connect"])
	})

	test("A2: session gate — init and beforeunload wait for isSessionChecked", async () => {
		appStoreMock.isSessionChecked = false
		w = factory()
		await flushPromises()
		expect(getActiveProfileMock).not.toHaveBeenCalled()
		expect(beforeunloadAdds()).toBe(0)
		appStoreMock.isSessionChecked = true
		await flushPromises()
		expect(getActiveProfileMock).toHaveBeenCalledTimes(1)
	})

	test("A3: auth redirect short-circuits — pageAwaitingAuth set, no init, no beforeunload", async () => {
		appStoreMock.isLogined = false
		w = factory()
		await flushPromises()
		expect(appStoreMock.pageAwaitingAuth).toBe(routerMock.currentRoute.value.fullPath)
		expect(routerPushMock).toHaveBeenCalledWith({ path: "/popup/auth" })
		expect(getActiveProfileMock).not.toHaveBeenCalled()
		expect(beforeunloadAdds()).toBe(0)
	})

	test("A4: beforeunload is added AFTER init resolves — exactly once", async () => {
		w = factory()
		await flushPromises()
		// init is suspended on getActiveProfile — listener must not exist yet.
		expect(beforeunloadAdds()).toBe(0)
		getActiveProfilePromiseResolve?.({ id: "p1" })
		await flushPromises()
		// Still inside init (payload load pending).
		expect(beforeunloadAdds()).toBe(0)
		loadPromiseResolve?.()
		await flushPromises()
		expect(beforeunloadAdds()).toBe(1)
	})

	test("A4: beforeunload is STILL added when init throws internally", async () => {
		// init swallows its own errors into the error strip; the listener must be
		// registered anyway so a failed popup still rejects the request on close.
		w = factory()
		await flushPromises()
		getActiveProfilePromiseReject?.(new Error("profile-fetch-failed"))
		await flushPromises()
		expect(beforeunloadAdds()).toBe(1)
		expect(w.find('[data-testid="error-text"]').exists()).toBe(true)
	})

	test("A5: unmount disconnect ORDER verbatim — profile, interaction, listener removal LAST", async () => {
		w = factory()
		await completeInit()
		callLog.length = 0
		w.unmount()
		w = undefined
		expect(callLog).toEqual(["profile.disconnect", "interaction.disconnect", "removeEventListener:beforeunload"])
	})

	test("A6: closeWindow(true) removes the beforeunload listener; closeWindow() keeps it; both close", async () => {
		w = factory()
		await completeInit()
		const vm = w.vm as unknown as CapVm
		vm.closeWindow()
		expect(beforeunloadRemoves()).toBe(0)
		expect(windowsRemoveMock).toHaveBeenCalledTimes(1)
		vm.closeWindow(true)
		expect(beforeunloadRemoves()).toBe(1)
		expect(windowsRemoveMock).toHaveBeenCalledTimes(2)
	})

	test("A6: overlay @dismiss wires to closeWindow() with NO arg — listener stays attached", async () => {
		w = factory()
		await completeInit()
		isCancelledMock.value = true
		await w.vm.$nextTick()
		const overlay = w.find('[data-testid="cancelled-overlay"]')
		expect(overlay.exists()).toBe(true)
		await overlay.trigger("click")
		// Dismiss closes WITHOUT detaching beforeunload — the rejection is
		// deliberately delivered by the unload event, not a direct call.
		expect(windowsRemoveMock).toHaveBeenCalledTimes(1)
		expect(beforeunloadRemoves()).toBe(0)
	})

	test("A7: no double-reject — a decided reject detaches the listener before the window unloads", async () => {
		w = factory()
		await completeInit()
		await (w.vm as unknown as CapVm).reject()
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledTimes(1)
		window.dispatchEvent(new Event("beforeunload"))
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledTimes(1)
	})

	test("B8: window-local reject() = composable reject THEN closeWindow(true) — order pinned", async () => {
		w = factory()
		await completeInit()
		callLog.length = 0
		await (w.vm as unknown as CapVm).reject()
		expect(callLog).toEqual(["composableReject:User rejected", "removeEventListener:beforeunload", "windows.remove"])
	})

	test("B9 (DIVERGENCE): reject() with NO requestId still closes + detaches the listener", async () => {
		// capabilities' reject() guards only on isInteractionCancelled — unlike
		// execute/discover, which also bail on !requestId. With requestId undefined
		// the composable-level reject is an internal no-op, but capabilities still
		// invokes it and still runs closeWindow(true). Preserved verbatim — a shell
		// must reproduce this asymmetry or get owner sign-off to normalize it.
		w = factory()
		await flushPromises()
		expect(requestIdMock.value).toBeUndefined()
		await (w.vm as unknown as CapVm).reject()
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledWith("User rejected")
		expect(beforeunloadRemoves()).toBe(1)
		expect(windowsRemoveMock).toHaveBeenCalledTimes(1)
	})

	test("C12: onActiveProfileChanged — undefined or different id rejects; same id is a no-op", async () => {
		w = factory()
		// Registered synchronously during setup, before the mounted hook.
		expect(onActiveProfileChangedAddMock).toHaveBeenCalledTimes(1)
		const handler = onActiveProfileChangedAddMock.mock.calls[0][0] as (p?: { id: string }) => void
		await completeInit({ id: "p1" })
		handler({ id: "p1" })
		await flushPromises()
		expect(rejectViaInteractionServiceMock).not.toHaveBeenCalled()
		expect(windowsRemoveMock).not.toHaveBeenCalled()
		handler({ id: "p-other" })
		await flushPromises()
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledTimes(1)
		handler(undefined)
		await flushPromises()
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledTimes(2)
	})

	test("a raced approve refused with JobCancelledError classifies as CANCELLED, not an error", async () => {
		resolveInteractionMock.mockRejectedValueOnce(new JobCancelledError())
		// Minimal payload so init() reaches initComplete (empty delta = no account gating).
		payloadToLoad = { params: { delta: [], existingGrants: [] }, session: { chainId: "1" } }
		w = factory()
		await completeInit()
		const vm = w.vm as unknown as { approve: () => Promise<void> }
		await vm.approve()
		await flushPromises()
		expect(w.find('[data-testid="cancelled-overlay"]').exists()).toBe(true)
		expect(w.find('[data-testid="error-text"]').exists()).toBe(false)
	})
})

describe("capabilities window — account widening consent (real rows)", () => {
	const A = { address: `0x${"aa".repeat(32)}`, name: "Alpha", chainId: 1 }
	const B = { address: `0x${"bb".repeat(32)}`, name: "Beta", chainId: 1 }
	const accountsCap = { type: "accounts", canGet: true, canCreateAuthWit: false }
	const realRows = () => {
		resolveInteractionMock.mockClear()
		return mount(Capabilities, { global: { stubs: { ...STUBS, AccountSelectRow: false } } })
	}
	const rows = () => w!.findAll('[data-testid="cap-account-item"]')
	const resolvedArg = () =>
		(
			resolveInteractionMock.mock.calls[0] as unknown as [
				string,
				{ selectedAccounts?: string[]; granted: Array<Record<string, unknown>> },
			]
		)[1]

	test("held rows are pre-selected and locked; a membership-only approve needs a new row; approve returns held ∪ picked", async () => {
		payloadToLoad = {
			params: {
				delta: [accountsCap],
				existingGrants: [],
				availableAccounts: [A, B],
				grantedAccounts: [A.address],
				accountsMembershipOnly: true,
			},
			session: { chainId: "1" },
		}
		w = realRows()
		await completeInit()
		const [rowA, rowB] = rows()
		expect(rowA.attributes("data-granted")).toBe("true")
		expect(rowA.attributes("data-selected")).toBe("true")
		expect(rowB.attributes("data-granted")).toBeUndefined()
		expect(rowB.attributes("data-selected")).toBeUndefined()
		await rowA.trigger("click")
		expect(rowA.attributes("data-selected")).toBe("true")

		const vm = w!.vm as unknown as { approve: () => Promise<void> }
		await vm.approve()
		await flushPromises()
		expect(resolveInteractionMock).not.toHaveBeenCalled()
		expect(w!.find('[data-testid="error-text"]').exists()).toBe(true)

		await rowB.trigger("click")
		await vm.approve()
		await flushPromises()
		expect(resolveInteractionMock).toHaveBeenCalledTimes(1)
		expect(resolvedArg().selectedAccounts).toEqual([`aztec:1:${A.address}`, `aztec:1:${B.address}`])
		expect(resolvedArg().granted).toEqual([accountsCap])
	})

	test("a flag-only request (field-diff) approves with no new row and keeps the held row locked", async () => {
		const wide = { ...accountsCap, canCreateAuthWit: true }
		payloadToLoad = {
			params: {
				delta: [wide],
				existingGrants: [],
				availableAccounts: [A, B],
				grantedAccounts: [A.address],
				accountsMembershipOnly: false,
			},
			session: { chainId: "1" },
		}
		w = realRows()
		await completeInit()
		expect(rows()[0].attributes("data-granted")).toBe("true")
		const vm = w!.vm as unknown as { approve: () => Promise<void> }
		await vm.approve()
		await flushPromises()
		expect(resolveInteractionMock).toHaveBeenCalledTimes(1)
		expect(resolvedArg().selectedAccounts).toEqual([`aztec:1:${A.address}`])
		expect(resolvedArg().granted).toEqual([wide])
	})
})

describe("capabilities window — permission rows and the answer (real rows)", () => {
	// Wire-shaped: 0x + 64 hex, each value below the field modulus.
	const TOKEN = `0x${"1b".repeat(32)}`
	const FEE_JUICE = `0x${"0".repeat(63)}3`
	const ALICE = { address: `0x${"0a".repeat(32)}`, name: "Alice", chainId: 1 }
	const ALICE_CAIP = `aztec:1:${ALICE.address}`
	const listed = [{ contract: TOKEN, function: "transfer_public_to_public" }]
	const authwitAccounts = { type: "accounts", canGet: true, canCreateAuthWit: true }
	const txAny = { type: "transaction", scope: "*" }
	const txListed = { type: "transaction", scope: listed }
	const contractsAny = { type: "contracts", contracts: "*", canRegister: true, canGetMetadata: true }
	const manifest = (capabilities: unknown[]) => ({
		version: "1.0",
		metadata: { name: "nulo-playground", version: "0.1.0", url: "http://localhost:5173" },
		capabilities,
	})
	/** A first request: the dispatcher's delta is the manifest's capabilities. */
	const firstRequest = (capabilities: unknown[], extra: Record<string, unknown> = {}) => ({
		params: {
			sessionId: "s1",
			manifest: manifest(capabilities),
			delta: capabilities,
			existingGrants: [],
			heldGrants: [],
			...extra,
		},
		session: { chainId: "1" },
	})
	const STYLE = (PermissionRow as unknown as { __cssModules: { $style: Record<string, string> } }).__cssModules.$style
	const mountWindow = async (payload: unknown) => {
		payloadToLoad = payload
		resolveInteractionMock.mockClear()
		w = mount(Capabilities, {
			global: {
				components: { MaterialIcon, Toggle },
				stubs: {
					...STUBS,
					Flex: { inheritAttrs: false, template: "<div v-bind='$attrs'><slot /></div>" },
					SectionLabel: { props: ["label", "count"], template: "<h2 :data-count='count'>{{ label }}</h2>" },
					DappIdentityBlock: {
						props: ["dapp", "hostname", "hostnameSuspicious", "actionLabel"],
						template: '<div data-testid="identity-block" :data-action-label="actionLabel" />',
					},
					PermissionRow: false,
					AccountSelectRow: false,
				},
			},
		})
		await completeInit()
	}
	const shownRows = () => w!.findAll('[data-testid="cap-item"]').filter((c) => c.attributes("data-cap-granted") === undefined)
	const rowKeys = () => shownRows().map((c) => c.attributes("data-cap-row"))
	const rowOf = (key: string) => {
		const found = shownRows().find((c) => c.attributes("data-cap-row") === key)
		if (!found) throw new Error(`no new ${key} row`)
		return found
	}
	const toggleOf = (key: string) => rowOf(key).find('[data-testid="cap-toggle"]')
	/** The line as read: the dotted term's always-mounted definition copy is `hidden`. */
	const lineOf = (key: string) => {
		const sub = rowOf(key).find('[data-testid="cap-row-sub"]')
		if (!sub.exists()) return ""
		const copy = sub.element.cloneNode(true) as HTMLElement
		for (const hidden of copy.querySelectorAll("[hidden]")) hidden.remove()
		return copy.textContent?.replace(/\s+/g, " ").trim()
	}
	/** Each shown row as the drawing reads it: title, line, switch state, flag and chip. */
	const read = (key: string) => {
		const row = rowOf(key)
		const chip = row.find(`.${STYLE.chip}`)
		return {
			title: row.find(`.${STYLE.title}`).text(),
			line: lineOf(key),
			on: toggleOf(key).exists() ? toggleOf(key).attributes("aria-checked") === "true" : undefined,
			flagged: row.classes().includes(STYLE.flagged),
			chip: chip.exists() ? chip.text() : undefined,
		}
	}
	const groups = () =>
		w!
			.findAll("[data-cap-group]")
			.map((group) => [
				group.find("h2").text(),
				group.findAll('[data-testid="cap-item"]').map((row) => row.attributes("data-cap-row")),
			])
	const note = () => w!.find('[data-testid="cap-unknown-contracts-note"]')
	const approve = async () => {
		await (w!.vm as unknown as { approve: () => Promise<void> }).approve()
		await flushPromises()
		expect(resolveInteractionMock).toHaveBeenCalledTimes(1)
		return (resolveInteractionMock.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]
	}
	const identity = () => w!.find('[data-testid="identity-block"]').attributes("data-action-label")
	const confirmLabel = () => w!.find('[data-testid="cap-approve-btn"]').text()

	describe("S1: listed scopes, one contract Nulo knows", () => {
		const simulation = {
			type: "simulation",
			transactions: { scope: listed },
			utilities: { scope: [{ contract: FEE_JUICE, function: "balance_of_public" }] },
		}
		const contracts = { type: "contracts", contracts: [TOKEN], canRegister: true, canGetMetadata: true }
		const request = firstRequest([authwitAccounts, simulation, contracts, txListed], {
			availableAccounts: [ALICE],
			knownContracts: [{ address: FEE_JUICE, name: "Fee Juice" }],
		})

		test("the account, the three groups and the words of the shot", async () => {
			await mountWindow(request)
			expect(identity()).toBe("wants to connect on Aztec:1")
			expect(w!.findAll("h2").map((h) => [h.text(), h.attributes("data-count")])).toEqual([
				["Account to share", "1"],
				["Without asking, it can", undefined],
				["If you allow, it can", undefined],
				["Always asks you first", undefined],
			])
			expect(groups()).toEqual([
				["Without asking, it can", ["account-address", "simulation", "contracts"]],
				["If you allow, it can", ["authorizations"]],
				["Always asks you first", ["transaction"]],
			])
			expect(read("account-address")).toEqual({
				title: "See Alice's address",
				line: "",
				on: undefined,
				flagged: false,
				chip: undefined,
			})
			expect(read("simulation")).toMatchObject({
				title: "Run simulations and read the results",
				line: "Results can include your private balances.",
			})
			expect(read("contracts")).toMatchObject({ title: "Add contracts to your wallet", line: "", on: undefined })
			expect(read("authorizations")).toEqual({
				title: "Act for you in transactions you approve",
				line: "Nulo signs its authorizations without asking.",
				on: true,
				flagged: false,
				chip: undefined,
			})
			expect(rowOf("authorizations").find('[data-testid="cap-auth-term"]').text()).toBe("authorizations")
			expect(read("transaction")).toEqual({ title: "Every transaction", line: "", on: undefined, flagged: false, chip: undefined })
			expect(note().exists()).toBe(false)
			expect(confirmLabel()).toBe("Connect")
		})

		test("the answer grants what the window shows, with the switch On", async () => {
			await mountWindow(request)
			expect(await approve()).toEqual({
				granted: [authwitAccounts, simulation, contracts, txListed],
				selectedAccounts: [ALICE_CAIP],
				accountAliases: { [ALICE_CAIP]: "Alice" },
				authorizationsWithoutAsking: true,
			})
		})
	})

	test("S2: the same rows, and the note when Nulo knows none of the contracts", async () => {
		const simulation = { type: "simulation", transactions: { scope: listed } }
		const contracts = { type: "contracts", contracts: [TOKEN], canRegister: true, canGetMetadata: true }
		await mountWindow(
			firstRequest([authwitAccounts, simulation, contracts, txListed], {
				availableAccounts: [ALICE],
				knownContracts: [{ address: FEE_JUICE, name: "Fee Juice" }],
			}),
		)
		expect(rowKeys()).toEqual(["account-address", "simulation", "contracts", "authorizations", "transaction"])
		expect(note().text()).toBe("Nulo doesn't recognize any of its contracts.")
	})

	describe("S3: every broad flag", () => {
		const simulation = { type: "simulation", transactions: { scope: "*" }, utilities: { scope: "*" } }
		const request = firstRequest(
			[authwitAccounts, simulation, { type: "data", addressBook: true }, { type: "experimental_v2" }, txAny],
			{
				availableAccounts: [ALICE],
			},
		)

		test("flags, the chip, the Off defaults and the any-contract words", async () => {
			await mountWindow(request)
			expect(groups()).toEqual([
				["Without asking, it can", ["account-address", "simulation"]],
				["If you allow, it can", ["authorizations", "address-book", "unknown"]],
				["Always asks you first", ["transaction"]],
			])
			expect(read("simulation")).toEqual({
				title: "Run simulations on any contract",
				line: "Results can include your private balances.",
				on: undefined,
				flagged: true,
				chip: "Any contract",
			})
			expect(read("authorizations")).toEqual({
				title: "Act for you in transactions you approve",
				line: "You confirm each authorization first. Off because it listed any contract.",
				on: false,
				flagged: true,
				chip: undefined,
			})
			expect(read("address-book")).toEqual({
				title: "See your address book",
				line: "Every name and address you saved.",
				on: true,
				flagged: true,
				chip: undefined,
			})
			expect(read("unknown")).toEqual({
				title: "Use 1 permission Nulo doesn't recognize",
				line: "Nulo can't tell you what it allows.",
				on: false,
				flagged: true,
				chip: undefined,
			})
			expect(rowOf("unknown").find('[data-testid="cap-unrecognized-badge"]').text()).toBe("Use 1 permission Nulo doesn't recognize")
			expect(rowOf("unknown").attributes("data-cap-id")).toBeUndefined()
			expect(read("transaction").title).toBe("Every transaction, on any contract")
			expect(note().exists()).toBe(false)
		})

		test("the answer keeps the unknown type out and the authorizations Off", async () => {
			await mountWindow(request)
			expect(await approve()).toEqual({
				granted: [authwitAccounts, simulation, { type: "data", addressBook: true }, txAny],
				selectedAccounts: [ALICE_CAIP],
				accountAliases: { [ALICE_CAIP]: "Alice" },
				authorizationsWithoutAsking: false,
			})
		})
	})

	test("the switch flips the row's line and the answer", async () => {
		await mountWindow(firstRequest([authwitAccounts, txAny], { availableAccounts: [ALICE] }))
		await toggleOf("authorizations").trigger("click")
		expect(lineOf("authorizations")).toBe("For any call, on any contract.")
		expect(toggleOf("authorizations").attributes("aria-checked")).toBe("true")
		expect((await approve()).authorizationsWithoutAsking).toBe(true)
	})

	test("the address row names the one selected account, and the sentence for none or several", async () => {
		const BOB = { address: `0x${"0b".repeat(32)}`, name: "Bob", chainId: 1 }
		await mountWindow(firstRequest([authwitAccounts, txListed], { availableAccounts: [ALICE, BOB] }))
		expect(w!.find("h2").text()).toBe("Accounts to share")
		const accountRows = () => w!.findAll('[data-testid="cap-account-item"]')
		expect(read("account-address").title).toBe("See the addresses of the accounts you share")
		await accountRows()[1].trigger("click")
		expect(read("account-address").title).toBe("See Bob's address")
		await accountRows()[0].trigger("click")
		expect(read("account-address").title).toBe("See the addresses of the accounts you share")
	})

	test("data: two rows, each with its switch; private events on any contract start Off with the chip", async () => {
		await mountWindow(firstRequest([{ type: "data", addressBook: true, privateEvents: { contracts: "*" } }, contractsAny]))
		expect(rowKeys()).toEqual(["contracts", "address-book", "private-events"])
		expect(rowOf("address-book").attributes("data-cap-id")).toBe("data")
		expect(read("address-book")).toMatchObject({ title: "See your address book", line: "Every name and address you saved.", on: true })
		expect(toggleOf("address-book").attributes("aria-label")).toBe("Share address book")
		expect(read("private-events")).toEqual({
			title: "See private events from any contract",
			line: "Not shared. The app may ask again later.",
			on: false,
			flagged: true,
			chip: "Any contract",
		})
		expect(read("contracts")).toMatchObject({ title: "Add any contract to your wallet", flagged: true, chip: "Any contract" })
		expect(await approve()).toEqual({ granted: [{ type: "data", addressBook: true }, contractsAny] })
	})

	test("data: both rows Off never sends a data grant", async () => {
		await mountWindow(firstRequest([{ type: "data", addressBook: true, privateEvents: { contracts: "*" } }, contractsAny]))
		await toggleOf("address-book").trigger("click")
		expect(await approve()).toEqual({ granted: [contractsAny] })
	})

	test("data on listed contracts: both rows On; private events switched Off keeps the address book", async () => {
		await mountWindow(firstRequest([{ type: "data", addressBook: true, privateEvents: { contracts: [TOKEN] } }, contractsAny]))
		expect(read("private-events")).toMatchObject({
			title: "See private events from its contracts",
			line: "Private messages its contracts sent to your accounts, like a transfer you received.",
			on: true,
		})
		await toggleOf("private-events").trigger("click")
		expect(await approve()).toEqual({ granted: [{ type: "data", addressBook: true }, contractsAny] })
	})

	test("a membership-only accounts widening: only the address row is new, no switch, no consent sent", async () => {
		const BOB = { address: `0x${"0b".repeat(32)}`, name: "Bob", chainId: 1 }
		const BOB_CAIP = `aztec:1:${BOB.address}`
		const held = [authwitAccounts, txListed]
		await mountWindow({
			params: {
				sessionId: "s1",
				manifest: manifest(held),
				delta: [authwitAccounts],
				existingGrants: held,
				heldGrants: held,
				authorizationsWithoutAsking: { broad: false },
				availableAccounts: [ALICE, BOB],
				grantedAccounts: [ALICE.address],
				accountsMembershipOnly: true,
			},
			session: { chainId: "1" },
		})
		expect(rowKeys()).toEqual(["account-address"])
		expect(w!.find("h2").text()).toBe("Accounts to share")
		expect(w!.findAll('[data-testid="cap-toggle"]')).toHaveLength(0)
		await w!.findAll('[data-testid="cap-account-item"]')[1].trigger("click")
		expect(read("account-address").title).toBe("See the addresses of the accounts you share")
		const answer = await approve()
		expect(answer).toEqual({
			granted: [authwitAccounts, txListed],
			selectedAccounts: [ALICE_CAIP, BOB_CAIP],
			accountAliases: { [ALICE_CAIP]: "Alice", [BOB_CAIP]: "Bob" },
		})
		expect(answer).not.toHaveProperty("authorizationsWithoutAsking")
	})

	test("a Settings change after dispatch: the defaults follow the snapshot, not the session", async () => {
		const held = [{ type: "accounts", canGet: false, canCreateAuthWit: true }, txListed]
		await mountWindow({
			params: {
				sessionId: "s1",
				manifest: manifest([authwitAccounts, txListed]),
				delta: [authwitAccounts],
				existingGrants: held,
				heldGrants: held,
				authorizationsWithoutAsking: { broad: false },
				availableAccounts: [ALICE],
				grantedAccounts: [ALICE.address],
			},
			// Re-read after the snapshot: Settings has since turned the consent off.
			session: { chainId: "1", authorizationsWithoutAsking: undefined, capabilityGrants: [] },
		})
		expect(toggleOf("authorizations").attributes("aria-checked")).toBe("true")
		expect(await approve()).toEqual({
			granted: [authwitAccounts, txListed],
			selectedAccounts: [ALICE_CAIP],
			accountAliases: { [ALICE_CAIP]: "Alice" },
			authorizationsWithoutAsking: true,
		})
	})

	test("a data re-request after a declined widening: private events new and badged, the address book not asked again", async () => {
		const heldData = { type: "data", addressBook: true, privateEvents: { contracts: [TOKEN] } }
		const asked = { type: "data", addressBook: true, privateEvents: { contracts: "*" } }
		await mountWindow({
			params: {
				sessionId: "s1",
				manifest: manifest([asked, contractsAny]),
				delta: [asked],
				// The stored rejection drops `data` from the echo list, never from the held grants.
				existingGrants: [contractsAny],
				heldGrants: [contractsAny, heldData],
				reRequested: ["data"],
			},
			session: { chainId: "1" },
		})
		expect(rowKeys()).toEqual(["private-events"])
		expect(toggleOf("private-events").attributes("aria-checked")).toBe("false")
		expect(rowOf("private-events").find('[data-testid="cap-rerequested-badge"]').text()).toBe("previously denied")
		expect(await approve()).toEqual({ granted: [contractsAny] })
	})

	test("a transaction widening with a held data record: only the transaction row is new", async () => {
		const heldData = { type: "data", addressBook: true, privateEvents: { contracts: [TOKEN] } }
		await mountWindow({
			params: {
				sessionId: "s1",
				manifest: manifest([txAny, heldData]),
				delta: [txAny],
				existingGrants: [heldData],
				heldGrants: [heldData],
			},
			session: { chainId: "1" },
		})
		expect(rowKeys()).toEqual(["transaction"])
		expect(await approve()).toEqual({ granted: [txAny, heldData] })
	})
})
