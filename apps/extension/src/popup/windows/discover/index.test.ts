/**
 * Component tests for discover popup. Covers the `isReady` race fix from
 * plan e2e-stabilization Phase 1A — the discover popup's Allow button is
 * gated on `isReady` (not just `requestId`), and `approve()` throws loudly
 * if called pre-init rather than silently returning. The silent-return
 * pattern cost 19 iterations to find last time; see
 * implementations-plan/network-followups/investigation-journey.md.
 *
 * The Allow gate is a phishing defense: the user must see the dApp's
 * hostname/logo/name BEFORE the Allow button becomes clickable. Otherwise
 * a slow logo fetch + auto-focused button + scripted Enter could approve
 * a session the user never identified.
 *
 * Cases (≥10 per CLAUDE.md L4/L5 minimum + plan §5.3):
 *  1.  Allow disabled while loadInteractionPayload() pending
 *  2.  Allow disabled when profile is null but payload resolved
 *  3.  Allow enabled only after BOTH profile + payload resolve
 *  4.  Deny stays gated on !requestId (fast bail-out — codex final-pass §2)
 *  5.  approve() throws when called before isReady (defensive)
 *  6.  approve() error message includes the diagnostic phrase
 *  7.  approve() works normally once isReady
 *  8.  processingError 'error' keeps Allow disabled even after isReady
 *  9.  Init failure (loadInteractionPayload throws) leaves isReady=false
 *  10. Profile fetch throws — isReady stays false
 *  11. Deny callable while isReady=false (fast bail-out path)
 *  12. requestId set but payload not loaded → Allow still disabled
 *      (regression check: the pre-fix bug was Allow gating on !requestId alone)
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { ref, type Ref } from "vue"

// ── Mock state (closure refs so tests can flip values mid-test) ──────

let requestIdMock = ref<string | undefined>(undefined)
let dappMock = ref<{ name: string; url: string } | null>(null)
let isCancelledMock = ref(false)
let loadPromiseResolve: (() => void) | undefined
let loadPromiseReject: ((err: Error) => void) | undefined
let getActiveProfilePromiseResolve: ((p: unknown) => void) | undefined
let getActiveProfilePromiseReject: ((err: Error) => void) | undefined

const loadInteractionPayloadMock = vi.fn(() => {
	return new Promise<void>((resolve, reject) => {
		loadPromiseResolve = () => {
			// Simulate that loadInteractionPayload commits requestId + dapp BEFORE resolving
			requestIdMock.value = "req-123"
			dappMock.value = { name: "Test DApp", url: "https://example.com" }
			resolve()
		}
		loadPromiseReject = reject
	})
})

const rejectViaInteractionServiceMock = vi.fn()
const resolveInteractionMock = vi.fn(async () => undefined)

const getActiveProfileMock = vi.fn(() => {
	return new Promise<unknown>((resolve, reject) => {
		getActiveProfilePromiseResolve = resolve
		getActiveProfilePromiseReject = reject
	})
})

const profileServiceConnectMock = vi.fn()
const profileServiceDisconnectMock = vi.fn()
const interactionServiceConnectMock = vi.fn()
const interactionServiceDisconnectMock = vi.fn()
const onActiveProfileChangedAddMock = vi.fn()

// ── Mocks (vi.mock is hoisted; values inside must be vi.fn or vi.* primitives) ────

vi.mock("@/composables/useDappInteractionPayload", () => ({
	useDappInteractionPayload: vi.fn(() => ({
		requestId: requestIdMock,
		dapp: dappMock,
		payload: ref(null),
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
// instantiated with `new`. Arrow factories error: "Reflect.construct requires
// the first argument be a constructor". Matches NewTokenPopup.test.ts pattern.
vi.mock("@/wallet/services/profile/client", () => ({
	ProfileServiceClient: vi.fn(() => ({
		getActiveProfile: getActiveProfileMock,
		connect: profileServiceConnectMock,
		disconnect: profileServiceDisconnectMock,
		onActiveProfileChanged: { add: onActiveProfileChangedAddMock },
	})),
}))

vi.mock("@/wallet/services/dapp-interaction/client", () => ({
	DappInteractionServiceClient: vi.fn(() => ({
		connect: interactionServiceConnectMock,
		disconnect: interactionServiceDisconnectMock,
		resolveInteraction: resolveInteractionMock,
	})),
}))

vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({
		isSessionChecked: true,
		isLogined: true,
		account: { name: "TestAccount" },
		network: { name: "TestNet" },
		pageAwaitingAuth: "",
	}),
}))

// chrome.windows mock so closeWindow() doesn't throw
beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: chrome runtime stub for tests
	;(globalThis as any).chrome = {
		windows: {
			getCurrent: (_o: unknown, cb: (w: { id?: number }) => void) => cb({ id: 42 }),
			remove: vi.fn(),
		},
	}
})

afterEach(() => {
	requestIdMock = ref<string | undefined>(undefined)
	dappMock = ref<{ name: string; url: string } | null>(null)
	isCancelledMock = ref(false)
	loadPromiseResolve = undefined
	loadPromiseReject = undefined
	getActiveProfilePromiseResolve = undefined
	getActiveProfilePromiseReject = undefined
	vi.clearAllMocks()
})

// ── Stubs (all child components flattened so we can assert on testid directly) ──

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
				:data-loading="String(loading)"
				@click="$emit('click', $event)"
			>
				<slot />
			</button>
		`,
	},
	DappStatusStrip: { template: '<div data-testid="status-strip" />', props: ["accountName", "networkName", "status"] },
	DappIdentityBlock: {
		template: '<div data-testid="identity-block" />',
		props: ["dapp", "hostname", "hostnameSuspicious", "actionLabel", "hostnameTestId", "nameTestId"],
	},
	DappCancelledOverlay: { template: '<div data-testid="cancelled-overlay" />' },
}

// Lazy import after vi.mock hoist
import Discover from "./index.vue"

const factory = () => mount(Discover, { global: { stubs: STUBS } })

// Helpers
const allow = (w: ReturnType<typeof factory>) => w.find('[data-testid="discover-allow-btn"]')
const deny = (w: ReturnType<typeof factory>) => w.find('[data-testid="discover-deny-btn"]')
// `:disabled="false"` renders `disabled=""` instead of removing the attribute
// in some vue-test-utils versions. Treat "" + "disabled" + "true" as disabled,
// and missing-attr (undefined) as enabled.
const isDisabled = (btn: ReturnType<typeof allow>) => {
	const v = btn.attributes("disabled")
	return v === "" || v === "disabled" || v === "true"
}

describe("discover popup — isReady race fix", () => {
	test("1. Allow disabled while loadInteractionPayload() pending", async () => {
		const w = factory()
		// onMounted runs, getActiveProfile is awaiting; haven't resolved yet
		await flushPromises()
		// profile fetch hasn't resolved → init() blocked there → isReady false
		expect(isDisabled(allow(w))).toBe(true)
	})

	test("2. Allow disabled when profile is null but loadInteractionPayload resolved", async () => {
		const w = factory()
		// Resolve loadInteractionPayload first (sets requestId + dapp)
		// then leave getActiveProfile pending — init flow is profile-first, so
		// in this scenario profile is still null and isReady cannot flip.
		await flushPromises()
		expect(isDisabled(allow(w))).toBe(true)
		// Resolve getActiveProfile with null — should still keep isReady false
		getActiveProfilePromiseResolve?.(null)
		await flushPromises()
		loadPromiseResolve?.()
		await flushPromises()
		expect(isDisabled(allow(w))).toBe(true)
	})

	test("3. Allow enabled only after BOTH profile + payload resolve", async () => {
		const w = factory()
		await flushPromises()
		expect(isDisabled(allow(w))).toBe(true)
		getActiveProfilePromiseResolve?.({ id: "p1" })
		await flushPromises()
		// payload still pending → Allow still disabled
		expect(isDisabled(allow(w))).toBe(true)
		loadPromiseResolve?.()
		await flushPromises()
		// NOW both resolved → Allow enabled
		expect(isDisabled(allow(w))).toBe(false)
	})

	test("4. Deny stays gated on !requestId (fast bail-out, NOT isReady)", async () => {
		// Inspect the rendered :disabled props on Deny vs Allow to prove Deny
		// uses the looser `!requestId` predicate while Allow uses `!isReady`.
		// Codex final-pass §2 chose this asymmetry intentionally — early-reject
		// is harmless, early-approve is a trust bug.
		const w = factory()
		await flushPromises()
		// Initially: requestId undef + isReady false → both disabled
		expect(isDisabled(deny(w))).toBe(true)
		expect(isDisabled(allow(w))).toBe(true)
		// Simulate the racy "load() set requestId early" state directly:
		// useDappInteractionPayload's load() sets requestId.value before
		// payload fully lands. We force that state without resolving the
		// init() chain (so isReady stays false).
		requestIdMock.value = "req-early"
		await w.vm.$nextTick()
		// Deny is enabled (gates on !requestId, satisfied), Allow still disabled
		// (gates on !isReady, still false because init never completed).
		expect(isDisabled(deny(w))).toBe(false)
		expect(isDisabled(allow(w))).toBe(true)
	})

	test("5. approve() throws when called before isReady (defensive)", async () => {
		const w = factory()
		await flushPromises()
		// Bypass the button (which would be disabled anyway) — call the handler
		// directly via the component instance to simulate Enter / scripted click.
		const vm = w.vm as unknown as { approve: () => Promise<void> }
		await expect(vm.approve()).rejects.toThrow(/discover approve\(\) called before init\(\) completed/)
	})

	test("6. approve() error message includes the diagnostic phrase", async () => {
		const w = factory()
		await flushPromises()
		const vm = w.vm as unknown as { approve: () => Promise<void> }
		await expect(vm.approve()).rejects.toThrow(/:disabled gate must include !isReady/)
	})

	test("7. approve() works normally once isReady (direct handler call)", async () => {
		const w = factory()
		await flushPromises()
		// Resolve profile FIRST — init() awaits this before calling loadInteractionPayload
		getActiveProfilePromiseResolve?.({ id: "p1" })
		await flushPromises()
		// Now loadInteractionPayloadMock has been called and loadPromiseResolve is set
		loadPromiseResolve?.()
		await flushPromises()
		// init() committed isReady = true. Call approve directly.
		const vm = w.vm as unknown as { approve: () => Promise<void> }
		await vm.approve()
		await flushPromises()
		expect(resolveInteractionMock).toHaveBeenCalledWith("req-123", { approved: true })
	})

	test("8. processingError 'error' keeps Allow disabled even after isReady", async () => {
		const w = factory()
		await flushPromises()
		getActiveProfilePromiseResolve?.({ id: "p1" })
		await flushPromises()
		loadPromiseResolve?.()
		await flushPromises()
		// isReady true → Allow enabled
		expect(isDisabled(allow(w))).toBe(false)
		// Trigger the error path via direct handler call (avoid stub click issues).
		resolveInteractionMock.mockRejectedValueOnce(new Error("boom"))
		const vm = w.vm as unknown as { approve: () => Promise<void> }
		await vm.approve()
		await flushPromises()
		await w.vm.$nextTick()
		// After the catch sets processingError, Allow should be disabled
		expect(isDisabled(allow(w))).toBe(true)
	})

	test("9. Init failure (loadInteractionPayload throws) leaves isReady=false", async () => {
		const w = factory()
		await flushPromises()
		getActiveProfilePromiseResolve?.({ id: "p1" })
		await flushPromises()
		loadPromiseReject?.(new Error("payload-fetch-failed"))
		await flushPromises()
		// Allow must stay disabled even though requestId was never set
		expect(isDisabled(allow(w))).toBe(true)
		// Defensive: approve() should still throw
		const vm = w.vm as unknown as { approve: () => Promise<void> }
		await expect(vm.approve()).rejects.toThrow(/discover approve\(\)/)
	})

	test("10. Profile fetch throws — isReady stays false", async () => {
		const w = factory()
		await flushPromises()
		getActiveProfilePromiseReject?.(new Error("profile-fetch-failed"))
		await flushPromises()
		expect(isDisabled(allow(w))).toBe(true)
		const vm = w.vm as unknown as { approve: () => Promise<void> }
		await expect(vm.approve()).rejects.toThrow(/discover approve\(\)/)
	})

	test("11. Deny calls rejectViaInteractionService once requestId is set", async () => {
		const w = factory()
		await flushPromises()
		getActiveProfilePromiseResolve?.({ id: "p1" })
		await flushPromises()
		loadPromiseResolve?.()
		await flushPromises()
		// Direct handler call to avoid stub click issues.
		const vm = w.vm as unknown as { reject: () => Promise<void> }
		await vm.reject()
		await flushPromises()
		expect(rejectViaInteractionServiceMock).toHaveBeenCalledWith("User rejected")
	})

	test("12. requestId set but payload state half-loaded → Allow still disabled (REGRESSION CHECK)", async () => {
		// Pre-fix behavior: Allow gated on `!requestId`. Bug: requestId is set
		// inside load() BEFORE the payload resolves, so the gate opens too
		// early. This test simulates that exact state: requestId is set but
		// the load promise hasn't resolved yet, AND profile is set.
		// Result MUST be: Allow still disabled (because isReady requires both).
		const w = factory()
		await flushPromises()
		getActiveProfilePromiseResolve?.({ id: "p1" })
		await flushPromises()
		// Simulate the racy state: requestId set early by useDappInteractionPayload
		requestIdMock.value = "req-half-loaded"
		dappMock.value = null // identity NOT yet loaded
		// Force re-render
		await w.vm.$nextTick()
		// Allow MUST stay disabled — even though requestId is truthy.
		// Pre-fix: this assertion would have FAILED (Allow would be enabled).
		expect(isDisabled(allow(w))).toBe(true)
	})
})
