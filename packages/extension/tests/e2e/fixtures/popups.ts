/**
 * Helpers for driving the extension's approval popup windows from e2e tests.
 *
 * Each window is at `chrome-extension://<id>/src/popup/index.html#/windows/{kind}?requestId=...`.
 * The `requestId` query param is set by `DappInteractionService.interaction()`
 * and lets us match popup targets by ID instead of by substring (which races
 * on Linux Xvfb where windows can stack).
 */
import type { Page, Target } from "puppeteer"
import { clickByTestId, clickSelector, patchPagePolling, type ExtensionContext } from "./extension"

export type PopupKind = "discover" | "verify" | "capabilities" | "execute" | "json"

/**
 * Wait for a popup window of the given kind to open. If `requestId` is given,
 * match the popup whose URL contains that ID; otherwise match the first popup
 * of the kind that appears.
 */
export async function waitForPopup(
	ctx: ExtensionContext,
	kind: PopupKind,
	opts: { requestId?: string; timeout?: number } = {},
): Promise<Page> {
	const timeout = opts.timeout ?? 15_000
	// Snapshot existing matching target URLs so we only resolve a NEW popup,
	// not a stale one left by a prior interaction. URL contains a unique
	// requestId set by DappInteractionService.interaction(), so URL novelty
	// is the right discriminator when the caller doesn't already have the id.
	const preExisting = new Set(
		ctx.browser
			.targets()
			.filter((t) => t.type() === "page" && t.url().includes(`#/windows/${kind}`))
			.map((t) => t.url()),
	)
	const target: Target = await ctx.browser.waitForTarget(
		(t) => {
			if (t.type() !== "page") return false
			const url = t.url()
			if (!url.includes(`#/windows/${kind}`)) return false
			if (opts.requestId && !url.includes(`requestId=${opts.requestId}`)) return false
			if (preExisting.has(url)) return false
			return true
		},
		{ timeout },
	)
	const page = await target.asPage()
	// Puppeteer can resolve waitForTarget before the page's main frame is wired
	// up — calling waitForFunction immediately throws "Requesting main frame too
	// early!" Poll until mainFrame() succeeds before doing any further waits.
	await waitForMainFrame(page)
	// Apply the same waitForFunction/waitForSelector polling patch as openPopup
	// — without it, every wait on this approval popup uses Puppeteer's default
	// 'raf' polling which is throttled in offscreen tabs (this popup
	// definitely is offscreen — it's a separate browser target).
	patchPagePolling(page)
	// Wait for SW liveness so the page can render
	await page.waitForFunction(
		async () => {
			try {
				const r = await chrome.storage.session.get("nulo:liveness")
				return !!r["nulo:liveness"]
			} catch {
				return false
			}
		},
		{ timeout: 10_000, polling: 250 },
	)
	return page
}

async function waitForMainFrame(page: Page, timeout = 5_000): Promise<void> {
	const start = Date.now()
	while (Date.now() - start < timeout) {
		try {
			page.mainFrame()
			return
		} catch {
			await new Promise((r) => setTimeout(r, 50))
		}
	}
	throw new Error(`waitForMainFrame: page main frame not ready after ${timeout}ms`)
}

/** Wait for a popup page to be fully closed (target removed). Use before
 *  opening a second popup of the same kind so waitForTarget doesn't match
 *  the still-closing first popup. */
export async function waitForPopupClosed(page: Page, timeout = 5_000): Promise<void> {
	const start = Date.now()
	while (Date.now() - start < timeout) {
		if (page.isClosed()) return
		await new Promise((r) => setTimeout(r, 50))
	}
	throw new Error(`waitForPopupClosed: popup did not close within ${timeout}ms`)
}

export async function approveDiscover(page: Page): Promise<void> {
	await clickByTestId(page, "discover-allow-btn")
}

export async function denyDiscover(page: Page): Promise<void> {
	await clickByTestId(page, "discover-deny-btn")
}

export async function approveVerify(page: Page, opts: { alwaysTrust?: boolean } = {}): Promise<void> {
	if (opts.alwaysTrust) {
		// Toggle the "Always trust" switch + WAIT for the toggle to latch before
		// we click confirm. Without this assertion, handleConfirm runs while
		// alwaysTrust is still false, the trustedVerification setter is never
		// called, and the next reconnect surprises us with a verify popup.
		// Target the inner Toggle's clickable element (Toggle.vue:17 — div with
		// @click="toggle"; not a button/role=switch). Read latch state via
		// data-toggle-active (added on Toggle.vue alongside the testid).
		const innerSelector = '[data-testid="verify-always-trust-toggle"] [data-testid="toggle-switch"]'
		await page.waitForSelector(innerSelector, { visible: true, timeout: 5_000 })
		await clickSelector(page, innerSelector)
		await page.waitForFunction(
			(sel: string) => document.querySelector(sel)?.getAttribute("data-toggle-active") === "true",
			{ timeout: 5_000, polling: 100 },
			innerSelector,
		)
	}
	await clickByTestId(page, "verify-confirm-btn")
	// Wait for the verify popup window to actually close. `handleConfirm` awaits
	// `setTrustedVerification` BEFORE calling `closeWindow`, so a closed window
	// proves the trust flag was persisted to chrome.storage.local. Returning
	// before close lets the next reconnect race a stale storage value.
	//
	// If the popup never closes within 10s, throw — silently proceeding would
	// mask the very failure mode this wait exists to prevent. (Codex audit
	// session 019e2b9b caught the earlier silent-resolve version.)
	if (!page.isClosed()) {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error("approveVerify: popup did not close within 10s — setTrustedVerification persistence may be racy"))
			}, 10_000)
			page.once("close", () => {
				clearTimeout(timer)
				resolve()
			})
		})
	}
}

/**
 * Approve a /windows/capabilities popup.
 *
 * - `toggleOff`: capability ids (e.g. ["data"]) to flip OFF before approving
 *   (default-on for new capabilities). Used by the partial-grant test.
 * - `accounts`: account ids to select for the accounts capability. Selects
 *   each row by data-account-id.
 * - `aliases`: per-account alias overrides (writes via the alias input).
 */
export async function approveCapabilities(
	page: Page,
	opts: { toggleOff?: string[]; accounts?: string[]; aliases?: Record<string, string> } = {},
): Promise<void> {
	// The popup's `init()` is async — wait for at least one cap-item OR
	// cap-account-item to render before manipulating. Either signals the
	// payload has been fetched and rendered.
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="cap-item"]') !== null ||
			document.querySelector('[data-testid="cap-account-item"]') !== null,
		{ timeout: 10_000, polling: 200 },
	)
	for (const capId of opts.toggleOff ?? []) {
		await page.waitForSelector(`[data-testid="cap-item"][data-cap-id="${capId}"] [data-testid="cap-toggle"]`, {
			visible: true,
			timeout: 5_000,
		})
		await page.evaluate((id: string) => {
			const item = document.querySelector(`[data-testid="cap-item"][data-cap-id="${id}"]`)
			const toggle = item?.querySelector<HTMLElement>('[data-testid="cap-toggle"]')
			toggle?.click()
		}, capId)
	}
	for (const accountId of opts.accounts ?? []) {
		await page.waitForSelector(`[data-testid="cap-account-item"][data-account-id="${accountId}"]`, {
			visible: true,
			timeout: 5_000,
		})
		await page.evaluate((id: string) => {
			const row = document.querySelector<HTMLElement>(`[data-testid="cap-account-item"][data-account-id="${id}"]`)
			row?.click()
		}, accountId)
	}
	for (const [accountId, alias] of Object.entries(opts.aliases ?? {})) {
		await page.evaluate(
			({ id, alias }: { id: string; alias: string }) => {
				const row = document.querySelector(`[data-testid="cap-account-item"][data-account-id="${id}"]`)
				const input = row?.querySelector<HTMLInputElement>('[data-testid="cap-account-alias-input"]')
				if (!input) return
				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
				setter?.call(input, alias)
				input.dispatchEvent(new Event("input", { bubbles: true }))
			},
			{ id: accountId, alias },
		)
	}
	await clickByTestId(page, "cap-approve-btn")
}

export async function rejectCapabilities(page: Page): Promise<void> {
	await clickByTestId(page, "cap-reject-btn")
}

/**
 * Approve a /windows/execute popup, optionally overriding the fee method.
 *
 * FeeSettingsCard is shared with the wallet's own send flow; its testids stay
 * `send-fee-method-trigger` / `send-fee-method-{kind}`. Two-step override:
 * first click trigger, then click the chosen method.
 */
export async function approveExecute(page: Page, opts: { feeMethod?: "sponsored" | "fj" | "fpc" } = {}): Promise<void> {
	if (opts.feeMethod) {
		// FeeSettingsCard mounts after FPC auto-discovery completes — that's an async
		// service round-trip that can take several seconds on cold start. Wait for the
		// trigger to be visible before clicking it; otherwise the click is a no-op
		// against a not-yet-mounted DOM and the per-method option never renders.
		await page.waitForSelector('[data-testid="send-fee-method-trigger"]', { visible: true, timeout: 15_000 })
		await page.evaluate(() => {
			;(document.querySelector('[data-testid="send-fee-method-trigger"]') as HTMLElement)?.click()
		})
		await page.waitForSelector(`[data-testid="send-fee-method-${opts.feeMethod}"]`, { visible: true, timeout: 10_000 })
		await page.evaluate((kind: string) => {
			;(document.querySelector(`[data-testid="send-fee-method-${kind}"]`) as HTMLElement)?.click()
		}, opts.feeMethod)
	}
	await clickByTestId(page, "execute-confirm-btn")
}

export async function rejectExecute(page: Page): Promise<void> {
	await clickByTestId(page, "execute-reject-btn")
}

/**
 * Wait for the /windows/execute popup to finish its async render before
 * tests read op rows / fee badges. `waitForPopup("execute")` only blocks
 * on target+SW liveness; the Vue tree (operations.value, FeeSettingsCard)
 * mounts later. Calling this right after `waitForPopup("execute")` avoids
 * the "execute-op-item read returns []" race that previously skipped the
 * tx-sendTx-* suite.
 */
export async function waitForExecuteContent(page: Page, timeout = 15_000): Promise<void> {
	await page.waitForSelector('[data-testid="execute-op-item"]', { visible: true, timeout })
}

/** Read the visible op cards: returns `{ id, kind }[]`. Waits for at least one
 *  op-item to render — the popup's mount is async. */
export async function getExecuteOps(page: Page): Promise<Array<{ id: string; kind: string }>> {
	await waitForExecuteContent(page).catch(() => undefined)
	return page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('[data-testid="execute-op-item"]')].map((el) => ({
			id: el.getAttribute("data-op-id") ?? "",
			kind: el.getAttribute("data-op-kind") ?? "",
		})),
	)
}

/** Read the visible capability rows: returns `{ id, granted }[]`. Waits for at
 *  least one cap-item to render — the popup's init() is async. */
export async function getCapItems(page: Page): Promise<Array<{ id: string; granted: boolean; rerequested: boolean }>> {
	await page.waitForSelector('[data-testid="cap-item"]', { visible: true, timeout: 10_000 }).catch(() => undefined)
	return page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('[data-testid="cap-item"]')].map((el) => ({
			id: el.getAttribute("data-cap-id") ?? "",
			granted: el.getAttribute("data-cap-granted") === "true",
			rerequested: !!el.querySelector('[data-testid="cap-rerequested-badge"]'),
		})),
	)
}
