/**
 * Component tests for NewTokenPopup. Mocks all three service clients,
 * stores, toast composable, and FormPopup/Input so we can drive the
 * phase machine deterministically and assert close + toast behavior
 * across success / error / timeout / abort outcomes.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { ref } from "vue"

// ── Mocks ────────────────────────────────────────────────────────────

const balanceAddedHandlers: ((tb: unknown) => void)[] = []
const taskUpdatedHandlers: ((task: unknown) => void)[] = []

const tokenServiceMock = {
	getTokens: vi.fn(),
	parseTokenInterface: vi.fn(),
	addToken: vi.fn(),
	disconnect: vi.fn(),
}

const tokenBalanceServiceMock = {
	getTokenBalances: vi.fn(),
	refreshTokenBalance: vi.fn(),
	disconnect: vi.fn(),
	onTokenBalanceAdded: {
		add: (h: (tb: unknown) => void) => balanceAddedHandlers.push(h),
		remove: (h: (tb: unknown) => void) => {
			const i = balanceAddedHandlers.indexOf(h)
			if (i !== -1) balanceAddedHandlers.splice(i, 1)
		},
	},
}

const taskServiceMock = {
	connect: vi.fn(),
	disconnect: vi.fn(),
	onTaskUpdated: {
		add: (h: (task: unknown) => void) => taskUpdatedHandlers.push(h),
		remove: (h: (task: unknown) => void) => {
			const i = taskUpdatedHandlers.indexOf(h)
			if (i !== -1) taskUpdatedHandlers.splice(i, 1)
		},
	},
}

const openToastMock = vi.fn()

// Vitest 4 requires `function` expressions (not arrow functions) for mocks
// instantiated with `new`. Arrow factories error: "() => ... is not a constructor".
vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(function () {
		return tokenServiceMock
	}),
}))
vi.mock("@/wallet/services/token-balance/client", () => ({
	TokenBalanceServiceClient: vi.fn(function () {
		return tokenBalanceServiceMock
	}),
}))
vi.mock("@/wallet/services/task/client", () => ({
	TaskServiceClient: vi.fn(function () {
		return taskServiceMock
	}),
}))
// ContentKind is imported separately by the popup; mirror the enum exactly.
vi.mock("@/wallet/services/task/spec", () => ({
	ContentKind: { Step: 0, BalanceUpdate: 1, TokenMint: 2, ExecuteOperation: 3, Transfer: 4, RevokeAuthwits: 5 },
}))

vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({
		profile: { id: "p1" },
		network: { id: "net-1", chainId: 1 },
		account: { address: "0xacct" },
	}),
}))
const cacheStoreState = { preselectedTokenAddressToAdd: "" }
vi.mock("@/stores/cache.store", () => ({
	useCacheStore: () => cacheStoreState,
}))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ popups: { new_token: { order: 1 } } }),
}))

vi.mock("@/composables/toast", () => ({
	useToast: () => ({
		openToast: openToastMock,
		TOAST_DURATION: { SHORT: 1500, DEFAULT: 2000, LONG: 4000 },
	}),
}))

// useFormState is real — small composable, no chrome.* deps. Confirmed by
// the popup script that uses it heavily and would hate a stub.

// ── Stubs ────────────────────────────────────────────────────────────

const STUBS = {
	FormPopup: {
		props: ["show", "submitLabel", "submitDisabled", "submitLoading", "title", "displaceIdx", "submitTestId"],
		emits: ["onClose", "submit"],
		template: `
			<div
				data-testid="form-popup"
				:data-submit-label="submitLabel"
				:data-submit-loading="String(submitLoading)"
				:data-submit-disabled="String(submitDisabled)"
			>
				<slot />
				<slot name="belowSubmit" />
				<button
					data-testid="form-submit"
					:disabled="submitDisabled"
					@click="$emit('submit')"
				>{{ submitLabel }}</button>
				<button data-testid="form-close" @click="$emit('onClose')">x</button>
			</div>
		`,
	},
	Input: {
		props: ["modelValue", "disabled"],
		emits: ["update:modelValue"],
		template: `
			<div>
				<input
					data-testid="token-address-input"
					:value="modelValue"
					:disabled="disabled"
					@input="$emit('update:modelValue', $event.target.value)"
				/>
				<slot name="suffix" />
				<slot name="right" />
			</div>
		`,
	},
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
	Transition: { template: "<div><slot /></div>" },
}

// Lazy import after vi.mock calls hoist
import NewTokenPopup from "./NewTokenPopup.vue"

// ── Helpers ──────────────────────────────────────────────────────────

const validHex = `0x${"a".repeat(64)}`

function defaultTokenInfo(overrides: Record<string, unknown> = {}) {
	return { id: 7, chainId: 1, contract: validHex, name: "Test", symbol: "TST", decimals: 18, ...overrides }
}

function makeTb(overrides: Record<string, unknown> = {}) {
	return {
		id: 100,
		token: defaultTokenInfo(),
		account: "0xacct",
		publicBalance: "0",
		privateBalance: "0",
		updatedAt: 0,
		...overrides,
	}
}

function makeBalanceUpdateTask(tbId: number, opts: { finished?: boolean; error?: string } = {}) {
	return {
		id: "task-1",
		content: { kind: 1 /* BalanceUpdate */, tbId, account: "0xacct", label: "Refresh token balance" },
		finishedAt: opts.finished ? 1700_000_000_000 : undefined,
		error: opts.error,
		createdAt: 0,
		subtasks: [],
		status: opts.finished ? 2 : 0,
	}
}

async function mountAndOpen(showRef = ref(false)) {
	const w = mount(NewTokenPopup, {
		props: { show: showRef.value },
		global: { stubs: STUBS },
	})
	// Trigger the watcher by flipping show=false → true so the popup
	// loads its initial state (getTokens, etc).
	tokenServiceMock.getTokens.mockResolvedValueOnce([])
	await w.setProps({ show: true })
	await flushPromises()
	return w
}

async function typeAddress(w: ReturnType<typeof mount>, value: string) {
	// The parent passes data-testid="token-address-input" to <Input>; with our
	// multi-root stub the attribute falls through to the wrapping div as well
	// as the inner input. Pick the actual <input> element.
	const inputs = w.findAll('[data-testid="token-address-input"]')
	const native = inputs.find((wrap) => wrap.element.tagName === "INPUT") ?? inputs[0]
	await native.setValue(value)
	await flushPromises()
}

function submitBtn(w: ReturnType<typeof mount>) {
	return w.find('[data-testid="form-submit"]')
}

// ── Lifecycle ────────────────────────────────────────────────────────

beforeEach(() => {
	balanceAddedHandlers.splice(0)
	taskUpdatedHandlers.splice(0)
	tokenServiceMock.getTokens.mockReset().mockResolvedValue([])
	tokenServiceMock.parseTokenInterface.mockReset()
	tokenServiceMock.addToken.mockReset()
	tokenServiceMock.disconnect.mockReset()
	tokenBalanceServiceMock.getTokenBalances.mockReset().mockResolvedValue([])
	tokenBalanceServiceMock.refreshTokenBalance.mockReset()
	tokenBalanceServiceMock.disconnect.mockReset()
	taskServiceMock.connect.mockReset().mockResolvedValue(undefined)
	taskServiceMock.disconnect.mockReset()
	openToastMock.mockReset()
	cacheStoreState.preselectedTokenAddressToAdd = ""
	vi.useRealTimers()
})

afterEach(() => {
	vi.useRealTimers()
})

// ── Tests ────────────────────────────────────────────────────────────

describe("NewTokenPopup", () => {
	test("invalid hex address shows 'Invalid address' + button disabled", async () => {
		const w = await mountAndOpen()
		await typeAddress(w, "not-hex")
		expect(w.find('[data-testid="error-text"]').exists()).toBe(true)
		expect(w.find('[data-testid="error-text"]').text()).toContain("Invalid address")
		expect(submitBtn(w).attributes("disabled")).toBeDefined()
	})

	test("duplicate contract surfaces 'Already exist'", async () => {
		tokenServiceMock.getTokens.mockReset().mockResolvedValue([defaultTokenInfo({ contract: validHex })])
		const w = mount(NewTokenPopup, {
			props: { show: false },
			global: { stubs: STUBS },
		})
		await w.setProps({ show: true })
		await flushPromises()
		await typeAddress(w, validHex)
		expect(w.find('[data-testid="error-text"]').text()).toContain("Already exist")
	})

	test("parseTokenInterface returning isComplete=false shows the parse error", async () => {
		const w = await mountAndOpen()
		tokenServiceMock.parseTokenInterface.mockResolvedValueOnce({ isComplete: false })
		await typeAddress(w, validHex)
		await submitBtn(w).trigger("click")
		await flushPromises()
		expect(w.text()).toContain("Couldn't auto-detect this token's interface")
		// Did NOT call addToken; popup stays open
		expect(tokenServiceMock.addToken).not.toHaveBeenCalled()
		expect(w.emitted("onClose")).toBeUndefined()
	})

	test("happy path: addToken → onTokenBalanceAdded → onTaskUpdated finished → close + 'Token added' toast", async () => {
		const w = await mountAndOpen()
		tokenServiceMock.parseTokenInterface.mockResolvedValueOnce({ isComplete: true, contract: validHex, chainId: 1 })
		tokenServiceMock.addToken.mockResolvedValueOnce(defaultTokenInfo())
		// First check: no TB exists yet (we'll deliver it via the event)
		tokenBalanceServiceMock.getTokenBalances.mockResolvedValueOnce([])

		await typeAddress(w, validHex)
		await submitBtn(w).trigger("click")
		await flushPromises()

		// Now the popup is in 'loading-balance' phase, waiting on events.
		expect(submitBtn(w).text()).toContain("Loading balance")
		expect(taskServiceMock.connect).toHaveBeenCalled()

		// Fire the events.
		const tb = makeTb({ id: 100, account: "0xacct" })
		for (const h of balanceAddedHandlers) h(tb)
		for (const h of taskUpdatedHandlers) h(makeBalanceUpdateTask(100, { finished: true }))
		await flushPromises()

		expect(openToastMock).toHaveBeenCalledWith({ label: "Token added" })
		expect(w.emitted("onClose")).toBeTruthy()
	})

	// NOTE: auto-trust on user-add was moved out of NewTokenPopup into
	// IncomingTransferService.onTokenAdded so the in-popup AND dApp
	// register_token paths both auto-trust uniformly. Regression coverage
	// for "no Pending emit after onTokenAdded" lives at
	// service.scenarios.test.ts → (LR14 onTokenAdded auto-trusts before
	// any scan can read unknown).

	test("multi-account: events for non-active accounts are ignored; only the active-account TB resolves the wait", async () => {
		const w = await mountAndOpen()
		tokenServiceMock.parseTokenInterface.mockResolvedValueOnce({ isComplete: true, contract: validHex, chainId: 1 })
		tokenServiceMock.addToken.mockResolvedValueOnce(defaultTokenInfo())
		tokenBalanceServiceMock.getTokenBalances.mockResolvedValueOnce([])

		await typeAddress(w, validHex)
		await submitBtn(w).trigger("click")
		await flushPromises()

		// Fire a non-active account balance event first
		for (const h of balanceAddedHandlers) h(makeTb({ id: 999, account: "0xother" }))
		// Then the matching active-account event
		for (const h of balanceAddedHandlers) h(makeTb({ id: 100, account: "0xacct" }))
		// Fire a task for the non-active TB — must be ignored
		for (const h of taskUpdatedHandlers) h(makeBalanceUpdateTask(999, { finished: true }))
		await flushPromises()
		expect(w.emitted("onClose")).toBeUndefined()

		// Now fire task for the active TB
		for (const h of taskUpdatedHandlers) h(makeBalanceUpdateTask(100, { finished: true }))
		await flushPromises()
		expect(w.emitted("onClose")).toBeTruthy()
		expect(openToastMock).toHaveBeenCalledWith({ label: "Token added" })
	})

	test("re-import (TB exists with updatedAt>0) closes immediately without waiting on events", async () => {
		const w = await mountAndOpen()
		tokenServiceMock.parseTokenInterface.mockResolvedValueOnce({ isComplete: true, contract: validHex, chainId: 1 })
		tokenServiceMock.addToken.mockResolvedValueOnce(defaultTokenInfo())
		tokenBalanceServiceMock.getTokenBalances.mockResolvedValueOnce([
			makeTb({ id: 100, account: "0xacct", updatedAt: 1700_000_000_000, publicBalance: "5" }),
		])

		await typeAddress(w, validHex)
		await submitBtn(w).trigger("click")
		await flushPromises()

		expect(openToastMock).toHaveBeenCalledWith({ label: "Token added" })
		expect(w.emitted("onClose")).toBeTruthy()
		// We never had to drive any events
		expect(balanceAddedHandlers.length).toBe(0)
		expect(taskUpdatedHandlers.length).toBe(0)
	})

	test("balance fetch error: task finishes with error → close + warning toast", async () => {
		const w = await mountAndOpen()
		tokenServiceMock.parseTokenInterface.mockResolvedValueOnce({ isComplete: true, contract: validHex, chainId: 1 })
		tokenServiceMock.addToken.mockResolvedValueOnce(defaultTokenInfo())
		tokenBalanceServiceMock.getTokenBalances.mockResolvedValueOnce([])

		await typeAddress(w, validHex)
		await submitBtn(w).trigger("click")
		await flushPromises()

		for (const h of balanceAddedHandlers) h(makeTb({ id: 100, account: "0xacct" }))
		for (const h of taskUpdatedHandlers) h(makeBalanceUpdateTask(100, { finished: true, error: "PXE down" }))
		await flushPromises()

		expect(openToastMock).toHaveBeenCalled()
		const [opts] = openToastMock.mock.calls[0]
		expect(opts.label).toMatch(/Couldn't load balance/)
		expect(opts.icon).toBe("warning")
		expect(w.emitted("onClose")).toBeTruthy()
	})

	test("balance fetch timeout: no event in 30s → close + soft warning toast", async () => {
		vi.useFakeTimers()
		const w = await mountAndOpen()
		tokenServiceMock.parseTokenInterface.mockResolvedValueOnce({ isComplete: true, contract: validHex, chainId: 1 })
		tokenServiceMock.addToken.mockResolvedValueOnce(defaultTokenInfo())
		tokenBalanceServiceMock.getTokenBalances.mockResolvedValueOnce([])

		await typeAddress(w, validHex)
		await submitBtn(w).trigger("click")
		await flushPromises()

		// Identify the TB so the timer starts (timer only starts after we know pendingTbId)
		for (const h of balanceAddedHandlers) h(makeTb({ id: 100, account: "0xacct" }))
		await flushPromises()

		// Advance 30s — the timer should fire
		await vi.advanceTimersByTimeAsync(30_000)
		await flushPromises()

		expect(openToastMock).toHaveBeenCalled()
		const [opts] = openToastMock.mock.calls[0]
		expect(opts.label).toMatch(/balance will appear/)
		expect(w.emitted("onClose")).toBeTruthy()
	})

	test("user closes mid-fetch via FormPopup onClose: listeners cleaned up, no toast", async () => {
		const w = await mountAndOpen()
		tokenServiceMock.parseTokenInterface.mockResolvedValueOnce({ isComplete: true, contract: validHex, chainId: 1 })
		tokenServiceMock.addToken.mockResolvedValueOnce(defaultTokenInfo())
		tokenBalanceServiceMock.getTokenBalances.mockResolvedValueOnce([])

		await typeAddress(w, validHex)
		await submitBtn(w).trigger("click")
		await flushPromises()

		expect(balanceAddedHandlers.length).toBeGreaterThan(0)
		expect(taskUpdatedHandlers.length).toBeGreaterThan(0)

		// User clicks the close X — that flips `show` to false from the parent.
		// Simulate the parent doing so.
		await w.setProps({ show: false })
		await flushPromises()

		expect(balanceAddedHandlers.length).toBe(0)
		expect(taskUpdatedHandlers.length).toBe(0)
		expect(openToastMock).not.toHaveBeenCalled()
	})

	test("chain mismatch: addToken returns a token for a different chain → close immediately, no wait", async () => {
		const w = await mountAndOpen()
		tokenServiceMock.parseTokenInterface.mockResolvedValueOnce({ isComplete: true, contract: validHex, chainId: 999 })
		tokenServiceMock.addToken.mockResolvedValueOnce(defaultTokenInfo({ chainId: 999 }))

		await typeAddress(w, validHex)
		await submitBtn(w).trigger("click")
		await flushPromises()

		expect(openToastMock).toHaveBeenCalledWith({ label: "Token added" })
		expect(w.emitted("onClose")).toBeTruthy()
		// Wait was aborted — no leaked listeners
		expect(balanceAddedHandlers.length).toBe(0)
		expect(taskUpdatedHandlers.length).toBe(0)
	})

	test("button label transitions: 'Import new token' → 'Adding token…' → 'Loading balance…'", async () => {
		const w = await mountAndOpen()
		expect(submitBtn(w).text()).toBe("Import new token")

		// Hold parseTokenInterface so we observe the 'adding' phase
		let resolveParse: (v: unknown) => void = () => {}
		tokenServiceMock.parseTokenInterface.mockReturnValueOnce(
			new Promise((r) => {
				resolveParse = r
			}),
		)
		tokenServiceMock.addToken.mockResolvedValue(defaultTokenInfo())
		tokenBalanceServiceMock.getTokenBalances.mockResolvedValue([])

		await typeAddress(w, validHex)
		await submitBtn(w).trigger("click")
		await flushPromises()
		expect(submitBtn(w).text()).toContain("Adding token")

		// Resolve parse → addToken proceeds → into 'loading-balance'
		resolveParse({ isComplete: true, contract: validHex, chainId: 1 })
		await flushPromises()
		expect(submitBtn(w).text()).toContain("Loading balance")
	})

	test("clicking submit while phase != idle is a no-op (taskService.connect called once)", async () => {
		const w = await mountAndOpen()
		tokenServiceMock.parseTokenInterface.mockResolvedValueOnce({ isComplete: true, contract: validHex, chainId: 1 })
		tokenServiceMock.addToken.mockResolvedValueOnce(defaultTokenInfo())
		tokenBalanceServiceMock.getTokenBalances.mockResolvedValue([])

		await typeAddress(w, validHex)
		await submitBtn(w).trigger("click")
		await flushPromises()
		const connectCallsAfterFirst = taskServiceMock.connect.mock.calls.length
		expect(connectCallsAfterFirst).toBe(1)

		// Try to click again while loading-balance
		await submitBtn(w).trigger("click")
		await submitBtn(w).trigger("click")
		await flushPromises()
		expect(taskServiceMock.connect.mock.calls.length).toBe(connectCallsAfterFirst)
		expect(tokenServiceMock.addToken).toHaveBeenCalledTimes(1)
	})
})
