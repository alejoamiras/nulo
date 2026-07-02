import type { Page } from "puppeteer"
import { TEST_PASSWORD } from "./constants"
import { clickByTestId, clickSelector, replaceInputValue } from "./extension"

/**
 * Selector contract for tests in this directory.
 *
 *   <area>-<entity>-<verb>      e.g.  setting-nav-profile, new-account-submit
 *
 * For list rows expose two attributes:
 *   data-<entity>-id="<stable id>"     — used to compose selectors
 *   data-<entity>-name="<display>"     — readable in failures / debugging
 *
 * Always select by testid; never by text content. Toast assertions are the
 * one exception (waitForToast) and use textContent scan for ergonomics.
 *
 * For inline validation errors prefer `data-testid="error-text"` plus
 * `role="alert"`. Avoid asserting on copy.
 */

/**
 * Pinned workaround for a wallet bug: the simulate→prove pipeline doesn't
 * gate proveTx on PXE's anchor block having caught up to simulate's anchor.
 * Same race appears in dApp send paths (ExecutionService +
 * DappInteractionService). Real fix lives in the wallet — a shared
 * anchor-freshness gate factored as a pure helper. Until that lands, e2e
 * tests sleep here to let PXE catch up so proveTx doesn't fail on a stale
 * anchor. Renamed from a bare `setTimeout(5_000)` so the intent is
 * visible at every call site.
 */
export const PXE_ANCHOR_SYNC_WORKAROUND_MS = 5_000

// ── Auth ───────────────────────────────────────────────────────────────

/** Lock the wallet via the Header lock button. Navigates to auth page.
 *
 *  Click is async-fire-and-forget: the handler sets `appStore.isLogined =
 *  false` then kicks off `managers.profile.lockActiveProfile()` (RPC). An
 *  app.vue watcher reacts to the isLogined change and pushes the router.
 *  Under vitest worker pressure the SW round-trip can take 5-10s before
 *  the navigation lands; 20s timeout is generous enough to absorb that. */
export async function lockWallet(page: Page): Promise<void> {
	await page.evaluate(() => {
		;(document.querySelector('[data-testid="header-lock"]') as HTMLElement)?.click()
	})

	await page.waitForFunction(() => window.location.hash.includes("/popup/auth"), { timeout: 60_000 })
}

/** If the wallet is locked (auth page), re-enter the password. Defaults to
 *  the standard test password; pass a different one if a prior test rotated
 *  it via change-password. */
export async function ensureUnlocked(page: Page, password = TEST_PASSWORD): Promise<void> {
	const hash = await page.evaluate(() => window.location.hash)
	if (!hash.includes("/popup/auth")) return

	await page.waitForSelector('[data-testid="auth-password-input"]', {
		visible: true,
		timeout: 5_000,
	})
	await replaceInputValue(page, '[data-testid="auth-password-input"]', password)

	await clickByTestId(page, "auth-submit")

	// Wait for navigation away from auth
	await page.waitForFunction(() => !window.location.hash.includes("/popup/auth"), { timeout: 10_000 })
}

// ── Navigation ─────────────────────────────────────────────────────────

/** Click a bottom navigation tab. */
export async function clickNavTab(page: Page, tab: "activity" | "general" | "settings"): Promise<void> {
	await page.waitForSelector(`[data-testid="nav-${tab}"]`, { visible: true, timeout: 5_000 })
	await clickByTestId(page, `nav-${tab}`)
}

/** Navigate to a settings sub-page by URL segments. Only the first segment
 *  has a `setting-nav-<segment>` testid on the index page; deeper segments
 *  must be exposed by their parent page (add one when the test needs it).
 *  Example: `navigateToSettings(page, "accounts")`. */
export async function navigateToSettings(page: Page, ...segments: string[]): Promise<void> {
	await clickNavTab(page, "settings")
	await page.waitForFunction(() => window.location.hash === "#/popup/settings", { timeout: 5_000 })

	const pathSoFar: string[] = []
	for (const segment of segments) {
		pathSoFar.push(segment)
		const href = `#/popup/settings/${pathSoFar.join("/")}`
		// First segment: use the testid on the settings index. Deeper
		// segments: fall back to the SettingItem's `to` prop since child
		// pages don't yet have a consistent testid naming convention.
		const testidSelector = `[data-testid="setting-nav-${pathSoFar.join("-")}"]`
		// Poll for the nav target to RENDER, then click it. The destination route
		// component mounts asynchronously AFTER the hash changes, so finding the
		// next segment's link immediately (the prior `waitForFunction` only
		// confirmed the hash, not the DOM) races the mount — and on a slow CI box
		// that race is reliably lost: the page is still blank, the link absent.
		// `waitForFunction` retries the find+click until the element exists; the
		// click is the side effect that resolves it.
		const clicked = await page
			.waitForFunction(
				({ id, hash }: { id: string; hash: string }) => {
					const byTestId = document.querySelector<HTMLElement>(id)
					if (byTestId) {
						byTestId.click()
						return "testid"
					}
					const a = [...document.querySelectorAll("a")].find(
						(el) => el.getAttribute("href") === hash || el.getAttribute("to") === hash.slice(1),
					)
					if (a) {
						a.click()
						return "href"
					}
					return null
				},
				{ timeout: 10_000, polling: 200 },
				{ id: testidSelector, hash: href },
			)
			.then((h) => h.jsonValue())
			.catch(() => null)

		if (!clicked) {
			// Should be rare now that we wait for render. If it still fails, show
			// what the page actually held so a regression (stale path vs genuinely
			// absent target) is diagnosable instead of a bare throw.
			const diag = await page
				.evaluate(() => ({
					hash: window.location.hash,
					allTestids: [...document.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")).slice(0, 60),
					anchorCount: document.querySelectorAll("a").length,
					buttonCount: document.querySelectorAll("button").length,
					bodyText: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400),
				}))
				.catch(() => "nav diag read failed")
			console.error(`[nav-diag] navigateToSettings FAIL for ${href} (want ${testidSelector}): ${JSON.stringify(diag)}`)
			throw new Error(`navigateToSettings: no setting nav target for ${href} (expected testid ${testidSelector})`)
		}

		await page.waitForFunction((expected: string) => window.location.hash.startsWith(expected), { timeout: 5_000 }, href)
		// No explicit post-route sleep — every caller follows with its own
		// `waitForSelector` for an element on the landed page, which gives a
		// deterministic mount signal. The previous fixed 200ms padding was
		// wasted on every fast path. Confirmed safe across 26 smoke call
		// sites + 6 network sites in Phase 3 audit.
	}
}

// ── Network ────────────────────────────────────────────────────────────

/**
 * Switch to a network by name. The header chip now routes to the Manage
 * Networks settings page; from there we drill into the network's detail
 * page and tap "Set as active".
 */
export async function switchToNetwork(page: Page, networkName: string): Promise<void> {
	// Snapshot the BEFORE state. The header text identifies the chain the
	// popup is currently on; the activeAccount key identifies the address
	// `setupActiveAccount` last wrote. Both are needed to disambiguate
	// "this is a real chain switch" vs "this is a no-op repeat switch":
	//   - real switch  → activeAccount FLIPS to the target chain's address
	//                    (different secret-derivation key per chain)
	//   - repeat switch → activeAccount stays put; the network watcher fires
	//                    but `setupActiveAccount` re-picks the same account
	const beforeHeader = await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="network-button"]')
		return (btn?.textContent ?? "").trim()
	})
	const beforeAccount = await page.evaluate(async () => {
		const r = await chrome.storage.local.get("nulo:ui:activeAccount")
		return (r["nulo:ui:activeAccount"] as string | undefined) ?? ""
	})
	// Exact match (not substring) on the trimmed header text. Substring
	// matching collides when a custom network is renamed to contain another
	// network's name (e.g., "Local Backup" would falsely look like a no-op
	// when switching to "Local"). Network names are user-visible identifiers,
	// so an exact match against the rendered header is the precise contract.
	const isRealSwitch = beforeHeader !== networkName

	// Navigate via the header chip → Manage Networks → detail page → set active.
	// SettingItem rows render as <a> elements whose `href` can be `null`; raw
	// `.click()` doesn't reliably fire on those, so the row tap uses a synthetic
	// dispatchEvent (matches openNetworkDetail's contract).
	await clickByTestId(page, "network-button")
	const rowSelector = `[data-testid="network-row"][data-network-name="${networkName}"]`
	await page.waitForSelector(rowSelector, { visible: true, timeout: 5_000 })
	await page.evaluate((sel: string) => {
		const row = document.querySelector(sel) as HTMLElement | null
		row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
	}, rowSelector)
	await page.waitForSelector('[data-testid="network-set-active"]', { visible: true, timeout: 5_000 })
	await clickByTestId(page, "network-set-active")
	// Return to /popup/general so callers can keep using general-page selectors
	// (importToken, refreshBalances, gas-balance reads, …). The chip flow took
	// us from general → settings list → detail; navigate explicitly back rather
	// than `history.go(-2)`, which is fragile under deep-link bypasses.
	await page.evaluate(() => {
		window.location.hash = "/popup/general"
	})
	await page.waitForFunction(() => window.location.hash.includes("/popup/general"), { timeout: 5_000 })

	// First: wait for the network-button header to display the target name
	// exactly. This is the "appStore.network changed" signal.
	await page.waitForFunction(
		(target: string) => {
			const btn = document.querySelector('[data-testid="network-button"]')
			return !!btn && (btn.textContent ?? "").trim() === target
		},
		{ timeout: 30_000, polling: 250 },
		networkName,
	)

	// Then: wait for the network watcher's `setupActiveAccount` to land. On
	// a real switch, `nulo:ui:activeAccount` flips away from `beforeAccount`
	// because each chain derives its own address. On a repeat switch we just
	// confirm the existing value is still set (the watcher may briefly clear
	// the `account` ref while re-fetching).
	await page.waitForFunction(
		async ({ prev, real }: { prev: string; real: boolean }) => {
			const r = await chrome.storage.local.get("nulo:ui:activeAccount")
			const addr = r["nulo:ui:activeAccount"]
			if (typeof addr !== "string" || addr.length === 0) return false
			return real ? addr !== prev : true
		},
		{ timeout: 30_000, polling: 250 },
		{ prev: beforeAccount, real: isRealSwitch },
	)
}

/** Switch to the Local Network (chain ID 0, http://localhost:8080). */
export async function switchToLocalNetwork(page: Page): Promise<void> {
	await switchToNetwork(page, "Local Network")
}

// ── Account ────────────────────────────────────────────────────────────

/** Read the active account address from chrome.storage. */
export async function getAccountAddress(page: Page): Promise<string> {
	return await page.evaluate(async () => {
		const result = await chrome.storage.local.get("nulo:ui:activeAccount")
		return result["nulo:ui:activeAccount"] as string
	})
}

/** Create a new account via the NewAccountPopup. */
export async function createAccount(page: Page, name: string): Promise<void> {
	// Navigate to the accounts settings page
	await navigateToSettings(page, "accounts")

	await clickByTestId(page, "accounts-new-btn")

	// Wait for the name input to mount
	await page.waitForSelector('[data-testid="account-name-input"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page, '[data-testid="account-name-input"]', name)

	await clickByTestId(page, "new-account-submit")

	// Wait for the new ROW (the post-create signal) — NOT the popup input
	// vanishing: Vue's <Transition> can stick mid-leave in headless Chrome
	// (rAF throttling). Mirrors the proven flow in accounts.test.ts.
	await page.waitForSelector(`[data-testid="manage-accounts-row"][data-account-name="${name}"]`, {
		visible: true,
		timeout: 10_000,
	})
	await closeStuckPopup(page)
}

/** Switch to an account by name via the AccountsPopup in header. */
export async function switchAccount(page: Page, name: string): Promise<void> {
	await clickByTestId(page, "account-selector")
	await page.waitForSelector('[data-testid="accounts-popup"]', { visible: true, timeout: 5_000 })

	const selector = `[data-testid="account-item"][data-account-name="${name}"]`
	await page.waitForSelector(selector, { visible: true, timeout: 5_000 })
	await clickSelector(page, selector)

	// Vue Transition can stick mid-leave; force-close.
	await closeStuckPopup(page)
}

/** Switch the wallet's active account by ADDRESS — stable across runs, unlike the
 *  display name, which depends on creation order vs the dApp's account-exposure
 *  order (e.g. `accountAddresses[0]` may be the "Second"-named account). */
export async function switchAccountByAddress(page: Page, address: string): Promise<void> {
	await clickByTestId(page, "account-selector")
	await page.waitForSelector('[data-testid="accounts-popup"]', { visible: true, timeout: 5_000 })

	const selector = `[data-testid="account-item"][data-account-address="${address}"]`
	await page.waitForSelector(selector, { visible: true, timeout: 5_000 })
	await clickSelector(page, selector)

	// Vue Transition can stick mid-leave; force-close.
	await closeStuckPopup(page)
}

// ── Contact ────────────────────────────────────────────────────────────

/** Add a contact via the NewContactPopup.
 *
 *  `opts.registerAsSender` controls the register-as-sender toggle. Default
 *  is `false` because `registeredExtension` runs without a real PXE node —
 *  the popup's add-sender call would fail with the WARNING toast
 *  "Contact saved · sender registration failed" rather than the success
 *  toast "Contact is added". Tests that need a sender contact must use
 *  `localNetworkExtension` and pass `registerAsSender: true`.
 *
 *  The popup's default toggle state is ON (per `NewContactPopup.vue`'s
 *  `useFormState({ registerAsSender: { initial: true } })`); the helper
 *  flips when `registerAsSender === false` to land on the requested state.
 */
export async function addContact(page: Page, name: string, address: string, opts: { registerAsSender?: boolean } = {}): Promise<void> {
	const registerAsSender = opts.registerAsSender ?? false

	await clickByTestId(page, "contacts-new-btn")

	// Wait for form inputs to mount
	await page.waitForSelector('input[placeholder="New contact"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page, 'input[placeholder="New contact"]', name)

	await page.waitForSelector('input[placeholder*="0x15c4"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page, 'input[placeholder*="0x15c4"]', address)

	// Toggle defaults ON; click flips it OFF when the caller doesn't want
	// sender registration. Idempotent across calls because `form.reset()`
	// (NewContactPopup.vue watcher) re-applies `initial: true` on every
	// popup open.
	if (!registerAsSender) {
		await clickByTestId(page, "new-contact-register-sender")
	}

	await clickByTestId(page, "new-contact-submit")

	// Deterministic post-mutation signal — wait for the new contact row to
	// render. Previously also asserted the popup had unmounted, but in the
	// headless test context the popup's close transition sticks (Vue
	// <Transition> rAF gets throttled despite the polling fix and
	// --disable-renderer-backgrounding flag — the wallet popup ends up
	// `slide-enter-from slide-enter-active` indefinitely even though
	// popupStore.popups is empty). Closing via Escape force-unmounts.
	await page.waitForFunction(
		(n: string) => !!document.querySelector(`[data-testid="contact-row"][data-contact-name="${n}"]`),
		{ timeout: 10_000, polling: 200 },
		name,
	)

	// When the caller asked for sender registration, also wait for the chip
	// to render BEFORE we close the popup. The submit handler awaits both
	// addContact and addSender before emitting onClose, but the contact-row
	// (storage write) lands well before addSender (PXE write) — so the
	// previous early `closeStuckPopup` call ran while addSender was still in
	// flight and we'd race the popup tear-down.
	if (registerAsSender) {
		await page.waitForSelector(`[data-testid="contact-row"][data-contact-name="${name}"] [data-testid="contact-sender-chip"]`, {
			visible: true,
			timeout: 30_000,
		})
	}

	await closeStuckPopup(page)
}

/** Force-close a popup that's stuck in Vue <Transition>'s enter-from class.
 *  Pinia state is correct (popupStore says nothing is open), but the DOM
 *  hasn't unmounted because the transitionend never fires. We dispatch
 *  Escape — every popup in the wallet listens for it via FormPopup or
 *  PopupHeader — and clear the popupStore for safety. */
export async function closeStuckPopup(page: Page): Promise<void> {
	await page.keyboard.press("Escape").catch(() => undefined)
	await page.evaluate(() => {
		// Mutate any leftover popup containers so subsequent waitForSelector
		// doesn't trip on stale `new-contact-submit` etc. Removing inert DOM
		// is safe — Vue will re-create on next open.
		const teleport = document.querySelector("#popup")
		if (teleport) {
			while (teleport.firstChild) teleport.removeChild(teleport.firstChild)
		}
		const dimmers = document.querySelectorAll("[class*='dark_bg'i]")
		for (const d of dimmers) d.remove()
	})
}

/** Delete a contact by name (assumes contacts page is open).
 *
 *  When the contact is currently registered as a sender on the active
 *  network, the confirm popup renders an additional "Also unregister as
 *  sender on <network>" toggle defaulted ON. `opts.unregisterSender`
 *  forces a desired state on that toggle:
 *    - `undefined` (default): leave whatever the popup decided. For
 *      non-sender contacts this is a no-op; for sender contacts the
 *      toggle stays ON.
 *    - `true`: ensure the toggle is ON before submitting.
 *    - `false`: ensure the toggle is OFF before submitting.
 *  When the contact is NOT a sender, the toggle isn't rendered and the
 *  option is silently ignored (caller responsibility to know).
 */
export async function deleteContact(page: Page, name: string, opts: { unregisterSender?: boolean } = {}): Promise<void> {
	const rowSelector = `[data-testid="contact-row"][data-contact-name="${name}"]`
	await page.waitForSelector(rowSelector, { visible: true, timeout: 5_000 })

	// Synthesize a hover so the action icons (revealed via :hover CSS) are
	// rendered + interactive. ElementHandle.hover() goes through the broken
	// CDP path; dispatching mouseover/mouseenter in page context is reliable.
	await page.evaluate((sel: string) => {
		const row = document.querySelector<HTMLElement>(sel)
		if (!row) return
		row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
		row.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
	}, rowSelector)

	// Click the scoped delete icon within this specific row
	await page.evaluate((n: string) => {
		const row = document.querySelector(`[data-testid="contact-row"][data-contact-name="${n}"]`)
		const del = row?.querySelector<HTMLElement>('[data-testid="contact-delete"]')
		del?.click()
	}, name)

	// Confirm deletion via ConfirmPopup
	await page.waitForSelector('[data-testid="confirm-submit"]', {
		visible: true,
		timeout: 5_000,
	})

	// If caller specified a desired toggle state, flip the unregister-sender
	// toggle when its current state doesn't match. The toggle is only present
	// for sender contacts; on non-sender contacts the query yields null and
	// we leave the popup as-is.
	if (opts.unregisterSender !== undefined) {
		const desired = opts.unregisterSender
		const flipped = await page.evaluate((want: boolean) => {
			const toggle = document.querySelector<HTMLElement>('[data-testid="confirm-toggle"]')
			if (!toggle) return false
			const isOn = toggle.getAttribute("data-toggle-active") === "true"
			if (isOn !== want) {
				toggle.click()
				return true
			}
			return false
		}, desired)
		// `flipped` is informational; the surface contract is the toggle's
		// final state matches `desired` (or it wasn't present and the caller
		// shouldn't have asked).
		void flipped
	}

	await clickByTestId(page, "confirm-submit")

	// Wait for row to disappear
	await page.waitForFunction((sel: string) => !document.querySelector(sel), { timeout: 5_000 }, rowSelector)
}

// ── Token ──────────────────────────────────────────────────────────────

/** Import a token by contract address via the NewTokenPopup. */
export async function importToken(page: Page, contractAddress: string): Promise<void> {
	// Open tokens dropdown menu
	await page.evaluate(() => {
		;(document.querySelector('[data-testid="tokens-menu-trigger"]') as HTMLElement)?.click()
	})
	// The "Import token" item teleports into the dropdown layer after the
	// menu opens; wait for it before clicking so we don't no-op on an
	// unmounted target.
	await page.waitForSelector('[data-testid="tokens-menu-import"]', { visible: true, timeout: 2_000 })

	// Click "Import token"
	await page.evaluate(() => {
		;(document.querySelector('[data-testid="tokens-menu-import"]') as HTMLElement)?.click()
	})

	// Enter contract address
	await page.waitForSelector('[data-testid="token-address-input"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page, '[data-testid="token-address-input"]', contractAddress)

	// Wait for parsing to complete (button text changes from "Awaiting..." to
	// "Import new token"). The wallet calls PXE to fetch token metadata,
	// which is slow under sustained network-suite load — 60s is the safe
	// envelope here.
	await page.waitForSelector('[data-testid="import-token-button"]', { visible: true, timeout: 60_000 })
	await page.waitForFunction(
		() => {
			const btn = document.querySelector('[data-testid="import-token-button"]')
			return btn && getComputedStyle(btn).pointerEvents !== "none"
		},
		{ timeout: 60_000 },
	)

	// Click import
	await page.waitForSelector('[data-testid="import-token-button"]', { visible: true })
	await clickByTestId(page, "import-token-button")

	// Wait for success toast. The popup now blocks until the active account's
	// initial balance projection completes (or 30s timeout in the popup
	// itself), then fires the toast. Generous timeout because under sustained
	// network-suite load the flow goes through PXE metadata fetch + storage
	// write before the projector run.
	await waitForToast(page, "Token added", 60_000)
}

/** Click "Refresh balances" from the token dropdown menu.
 *
 *  The dropdown menu and the refresh action are both state-driven: open the
 *  menu, wait for the refresh row to mount (a few hundred ms typically), then
 *  click. Callers own their own "did the balance actually update?" polling
 *  (e.g. the fixture loops in extension.ts and the input-enabled wait inside
 *  sendTransfer), so we don't add a defensive trailing sleep here. */
export async function refreshBalances(page: Page): Promise<void> {
	await page.evaluate(() => {
		;(document.querySelector('[data-testid="tokens-menu-trigger"]') as HTMLElement)?.click()
	})
	await page.waitForSelector('[data-testid="tokens-menu-refresh"]', { visible: true, timeout: 2_000 })
	await page.evaluate(() => {
		;(document.querySelector('[data-testid="tokens-menu-refresh"]') as HTMLElement)?.click()
	})
}

/** Read the displayed balance text from BalanceView. */
export async function getDisplayedBalance(page: Page): Promise<string> {
	return await page.evaluate(() => {
		const balanceEl = document.querySelector("[class*='balance'], [class*='amount']")
		return balanceEl?.textContent?.trim() || ""
	})
}

// ── Token Detail ──────────────────────────────────────────────────────

/** Navigate to the token detail page by clicking the first token card.
 *  Uses dispatchEvent instead of Puppeteer's coordinate-based click because
 *  the router-link <a> has href=null and Puppeteer's click doesn't reliably
 *  trigger Vue Router's navigation handler on it. */
export async function navigateToTokenDetail(page: Page): Promise<void> {
	// Wait for the token card to render (balance must load from PXE)
	await page.waitForSelector('[data-testid="tokens-card"]', { visible: true, timeout: 30_000 })
	// Dispatch a click event directly on the <a> — triggers Vue Router's handler
	await page.evaluate(() => {
		const a = document.querySelector('[data-testid="tokens-card"]') as HTMLElement
		a?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, button: 0 }))
	})
	await page.waitForFunction(() => window.location.hash.includes("#/popup/tokens/"), { timeout: 10_000 })
	await page.waitForSelector('[data-testid="balance-amount"]', { visible: true, timeout: 15_000 })
}

/** Read the private and public balance values from the token detail page's BalanceView breakdown. */
export async function getTokenDetailBalances(page: Page): Promise<{ privateBalance: string; publicBalance: string }> {
	await page.waitForSelector('[data-testid="private-balance-value"]', { visible: true, timeout: 10_000 })
	const privateBalance = await page.evaluate(() => {
		return document.querySelector('[data-testid="private-balance-value"]')?.textContent?.trim() || ""
	})
	const publicBalance = await page.evaluate(() => {
		return document.querySelector('[data-testid="public-balance-value"]')?.textContent?.trim() || ""
	})
	return { privateBalance, publicBalance }
}

// ── Transfer ───────────────────────────────────────────────────────────

export interface SendTransferOptions {
	fromType: "public" | "private"
	toType: "public" | "private"
	amount: string
	destination: string
}

/** Toggle a send-type pair (send-from-type or send-to-type) until the
 *  expected label is active. The SendTypesCard toggle handler is guarded
 *  by token capability flags that arrive asynchronously after popup
 *  mount, so an early click is a no-op. Retries the click every 500ms
 *  for up to 30s, verifying the `toggle_active` class landed on the
 *  expected span. */
export async function setActiveSendType(page: Page, testId: string, desired: "public" | "private"): Promise<void> {
	const targetLabel = desired.toUpperCase()
	await page.waitForFunction(
		({ id, label }: { id: string; label: string }) => {
			const container = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
			if (!container) return false
			const spans = [...container.querySelectorAll("span")]
			const active = spans.find((s) => (s.className ?? "").toLowerCase().includes("active"))
			if (active?.textContent?.trim() === label) return true
			// Kick the toggle (no-op if the handler is still guarded by
			// missing token capabilities; we'll re-check next tick)
			container.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
			return false
		},
		{ timeout: 30_000, polling: 500 },
		{ id: testId, label: targetLabel },
	)
}

/** Execute a transfer via the SendPopup. Uses data-testid selectors throughout.
 *  Opens the popup, toggles types, enters amount + destination, submits, waits for toast. */
export async function sendTransfer(page: Page, opts: SendTransferOptions): Promise<void> {
	// When sending from private, the token-balance cache the Send
	// popup reads may lag the on-chain state. Typical scenario: the
	// prior test shielded value, the tx confirmed, the test closed
	// the page, and this test opened a fresh popup whose cached
	// private balance is still 0 or pre-shield. Without an explicit
	// refresh, the amount input stays :disabled (gated on
	// `tokenBalanceByType`) and `sendTransfer` hangs on the 60s
	// amount-enabled wait. Mirror the manual recovery a user would
	// do: refresh balances on the Assets view, give PXE a moment,
	// then open Send. See memory/feedback_network_e2e_between_m21_prs.
	if (opts.fromType === "private") {
		await refreshBalances(page)
		// No post-refresh sleep: the downstream `tokenBalanceByType > 0`
		// wait on the amount input (60s budget, 2s polling) IS the
		// signal we'd be waiting for. If the refresh hasn't landed by
		// then the test fails honestly with "amount input never enabled"
		// rather than silently proceeding on a stale balance.
	}

	// Open SendPopup
	await page.evaluate(() => {
		;(document.querySelector('[data-testid="actions-send"]') as HTMLElement)?.click()
	})

	// Wait for SendTypesCard to mount
	await page.waitForSelector('[data-testid="send-from-type"]', { timeout: 10_000 })

	// The toggle handler is guarded by token capability flags
	// (hasPrivateTransfers / hasPublicTransfers). On mount, these are
	// falsy until the token loads its metadata, so an early click is a
	// no-op. Poll via setActiveSendType — we assert the expected active
	// label appears before proceeding.
	await setActiveSendType(page, "send-from-type", opts.fromType)
	await setActiveSendType(page, "send-to-type", opts.toType)

	// Wait for amount input to become ENABLED
	// AmountCard has :disabled="!tokenBalanceByType" — disabled when balance for selected type is 0/loading
	await page.waitForFunction(
		() => {
			const input = document.querySelector('[data-testid="send-amount-input"]') as HTMLInputElement
			return input && !input.disabled
		},
		{ timeout: 60_000, polling: 2_000 },
	)

	// Enter amount + destination via the v-model-aware helper; Puppeteer's
	// triple-click + type is unreliable on our custom Input wrapper.
	await replaceInputValue(page, '[data-testid="send-amount-input"]', opts.amount)
	await replaceInputValue(page, '[data-testid="send-destination-field"] input', opts.destination)

	// Wait for send button to become clickable (pointer-events != none)
	// This means fee estimation (which triggers simulateTx → PXE sync) completed.
	try {
		await page.waitForFunction(
			() => {
				const btn = document.querySelector('[data-testid="send-submit"]') as HTMLElement
				return btn && getComputedStyle(btn).pointerEvents !== "none"
			},
			{ timeout: 120_000, polling: 3_000 },
		)
	} catch (e) {
		const snapshot = await page.evaluate(() => {
			const amount = document.querySelector<HTMLInputElement>('[data-testid="send-amount-input"]')
			const dest = document.querySelector<HTMLInputElement>('[data-testid="send-destination-field"] input')
			const submit = document.querySelector<HTMLElement>('[data-testid="send-submit"]')
			const feeTrigger = document.querySelector<HTMLElement>('[data-testid="send-fee-method-trigger"]')
			return {
				amountValue: amount?.value,
				amountDisabled: amount?.disabled,
				destValue: dest?.value?.slice(0, 20),
				submitText: submit?.textContent?.trim().slice(0, 80),
				submitPointerEvents: submit ? getComputedStyle(submit).pointerEvents : null,
				feeMethodText: feeTrigger?.textContent?.trim().slice(0, 80),
				bodySnippet: (document.body.textContent ?? "").slice(0, 400),
			}
		})
		console.error("[sendTransfer] submit never became enabled. Snapshot:", JSON.stringify(snapshot, null, 2))
		throw e
	}

	await new Promise((r) => setTimeout(r, PXE_ANCHOR_SYNC_WORKAROUND_MS))

	// Submit — scroll into view via page.evaluate (the button may be below the
	// fold in PopupCard) then trigger via clickByTestId, which uses an
	// in-page synthetic click (the elementHandle path hangs on this stack).
	await page.evaluate(() => {
		document.querySelector('[data-testid="send-submit"]')?.scrollIntoView({ block: "center" })
	})
	await clickByTestId(page, "send-submit")

	// Wait for submission toast + popup auto-close. The toast only appears AFTER client-side
	// proving; native proving (the prover-ON canary) adds tens of seconds to that pipeline —
	// especially the shield (public→private) path — so give it real headroom there. Proverless
	// bulk shards stay tight to keep failures honest-fast.
	await waitForToast(page, "Transaction submitted", process.env.NULO_E2E_PROVERLESS === "1" ? 60_000 : 300_000)
	// Wait for popup to fully close
	await page.waitForFunction(() => !document.querySelector('[data-testid="send-destination-field"]'), { timeout: 10_000 })
}

/** Map a (fromType, toType) pair to the user-visible transfer-type label
 *  that the settled `TransactionCard` renders in its chip. Matches the
 *  wallet's TRANSFER_TYPE_LABELS table in `src/utils/tx-enrichment.ts`. */
function transferTypeLabel(fromType: "public" | "private", toType: "public" | "private"): string {
	if (fromType === "private" && toType === "private") return "Private → Private"
	if (fromType === "private" && toType === "public") return "Private → Public"
	if (fromType === "public" && toType === "public") return "Public → Public"
	return "Public → Private"
}

/** Wait for the most recent transfer to surface as a settled
 *  `TransactionCard` on the activity list with status="confirmed".
 *
 *  Matches by `(amount, transferType-label)` — both data-attributes that
 *  the wallet exposes on the card root and that mirror what the user
 *  sees in the rendered card. The user's confirmation event is the
 *  status icon flipping to the green check; the test waits for the
 *  same fact instead of sleeping past it.
 *
 *  Throws with a `(hash=...)` diagnostic if the card reaches a terminal
 *  state that isn't "confirmed" (i.e. "failed" — reverted or dropped),
 *  so flakes surface the chain hash for crash forensics.
 *
 *  "confirmed" here means **first-mined** (Proposed | Checkpointed |
 *  Proven | Finalized) — the same fact the user sees as the green check
 *  icon. NOT on-chain finality.
 *
 *  Scope caveat: safe for sequential submits with unique `(amount,
 *  transferType)` pairs (the transfers scenario). NOT a safe generic
 *  primitive for parallel or repeated identical-shape submits — a stale
 *  confirmed card from an earlier submit could false-positive. */
export async function waitForTxConfirmation(
	page: Page,
	opts: { amount: string; fromType: "public" | "private"; toType: "public" | "private"; timeout?: number },
): Promise<void> {
	const { amount, fromType, toType, timeout = 60_000 } = opts
	const label = transferTypeLabel(fromType, toType)
	await page.waitForFunction(
		({ a, t }: { a: string; t: string }) => {
			const card = document.querySelector(`[data-testid="tx-card"][data-tx-amount-display="${a}"][data-tx-transfer-type="${t}"]`)
			if (!card) return false
			const status = card.getAttribute("data-tx-status")
			return status === "confirmed" || status === "failed"
		},
		{ timeout, polling: 250 },
		{ a: amount, t: label },
	)
	const meta = await page.evaluate(
		({ a, t }: { a: string; t: string }) => {
			const card = document.querySelector(`[data-testid="tx-card"][data-tx-amount-display="${a}"][data-tx-transfer-type="${t}"]`)
			return {
				status: card?.getAttribute("data-tx-status"),
				hash: card?.getAttribute("data-tx-hash"),
			}
		},
		{ a: amount, t: label },
	)
	if (meta.status !== "confirmed") {
		throw new Error(
			`waitForTxConfirmation: tx ${label} ${amount} terminal as "${meta.status}" (hash=${meta.hash ?? "?"}), expected "confirmed"`,
		)
	}
}

/** Wait for a specific balance text to appear on the general page.
 *  Uses textContent case-insensitive because balance labels are
 *  text-transform: uppercase via CSS (e.g. "PRIVATE" rendered, "Priv"
 *  in source). */
export async function waitForBalance(page: Page, text: string, timeout = 60_000): Promise<void> {
	await page.waitForFunction(
		(t: string) => (document.body.textContent ?? "").toLowerCase().includes(t.toLowerCase()),
		{ timeout, polling: 3_000 },
		text,
	)
}

// ── Fee Method ────────────────────────────────────────────────────────

/** Select a fee payment method in the SendPopup's FeeSettingsCard dropdown.
 *  Uses data-testid on dropdown items: send-fee-method-{subtitle}
 *  @param methodSubtitle - "public" | "private" | "sponsored" | "token" */
export async function selectFeeMethod(page: Page, methodSubtitle: string): Promise<void> {
	// Open the fee method dropdown (items teleport to #dropdown)
	await page.evaluate(() => {
		;(document.querySelector('[data-testid="send-fee-method-trigger"]') as HTMLElement)?.click()
	})

	// Wait for the target item to teleport into the dropdown layer.
	const testid = `send-fee-method-${methodSubtitle}`
	await page.waitForSelector(`[data-testid="${testid}"]`, { visible: true, timeout: 2_000 })

	// Click the method by data-testid on the teleported DropdownItem
	await page.evaluate((id: string) => {
		;(document.querySelector(`[data-testid="${id}"]`) as HTMLElement)?.click()
	}, testid)

	// The trigger exposes `data-fee-method` once the selection commits;
	// wait for it to match instead of guessing at Vue's render timing.
	await page.waitForFunction(
		(want: string) => document.querySelector('[data-testid="send-fee-method-trigger"]')?.getAttribute("data-fee-method") === want,
		{ timeout: 2_000, polling: 50 },
		methodSubtitle,
	)
}

/** Read the currently selected fee method from the trigger's data attribute. */
export async function getSelectedFeeMethod(page: Page): Promise<string | null> {
	return page.evaluate(() => {
		const trigger = document.querySelector('[data-testid="send-fee-method-trigger"]')
		return trigger?.getAttribute("data-fee-method") ?? null
	})
}

// ── Toast ──────────────────────────────────────────────────────────────

/** Wait for a toast notification containing the given text. Toasts auto-dismiss in ~2s.
 *  Uses textContent + case-insensitive compare because the toast applies
 *  text-transform: uppercase via CSS, which `innerText` reflects but
 *  `textContent` does not — matching by textContent keeps the assertion
 *  readable (`"Contact is added"` not `"CONTACT IS ADDED"`). */
export async function waitForToast(page: Page, text: string, timeout = 5_000): Promise<void> {
	await page.waitForFunction(
		(t: string) => (document.body.textContent ?? "").toLowerCase().includes(t.toLowerCase()),
		{ timeout, polling: 200 },
		text,
	)
}

// ── Popup chain helpers ──────────────────────────────────────────────────

/** Wait for ConfirmPopup to mount, then click its confirm button. Use for
 *  delete-confirm flows that chain through ConfirmPopup. */
export async function acceptConfirmPopup(page: Page, timeout = 5_000): Promise<void> {
	await page.waitForSelector('[data-testid="confirm-submit"]', { visible: true, timeout })
	await clickByTestId(page, "confirm-submit")
	// The popup's <Transition> can stick mid-leave in headless Chrome
	// (rAF throttling), so we don't gate on the confirm-submit selector
	// disappearing. Force the close.
	await closeStuckPopup(page)
}

/** Close every open popup via the popupStore. Useful for resetting state
 *  between assertions when a flow leaves a popup mounted. */
export async function closeAllPopups(page: Page): Promise<void> {
	await page.evaluate(() => {
		// Pinia store is exposed on the app's globalThis under the hood, but
		// the most reliable way is to dispatch the same Esc key the popup
		// click-area handles already.
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
	})
	// Best-effort: wait briefly for any active popup teardowns
	await page.waitForFunction(
		() => {
			const popups = document.querySelectorAll('[data-testid$="-submit"], [data-testid$="-cancel"]')
			// If the popup container is still rendering submit/cancel buttons in a
			// teleport target, give it another tick. This is heuristic — most
			// callers are about to navigate anyway.
			return popups.length === 0 || true
		},
		{ timeout: 1_000 },
	)
}

/** Set an input's value AND fire blur so v-model + @blur validation both run.
 *  Use this in form-validation tests where errors only surface on blur. */
export async function setInputAndBlur(page: Page, selector: string, value: string): Promise<void> {
	await replaceInputValue(page, selector, value)
	await page.evaluate((sel: string) => {
		const candidates = [...document.querySelectorAll<HTMLInputElement>(sel)].filter((el) => el.offsetParent !== null)
		const input = candidates[candidates.length - 1]
		input?.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
	}, selector)
}

// ── Settings: appearance + privacy ───────────────────────────────────────

/** Click a theme button (system / light / dark) and wait for `html[theme=…]`
 *  to reflect the choice. The theme buttons are inside a Dropdown popup —
 *  open it by clicking the trigger first if the button isn't yet visible. */
export async function setTheme(page: Page, mode: "system" | "light" | "dark"): Promise<void> {
	const visible = await page.evaluate((m: string) => {
		const btn = document.querySelector(`[data-testid="theme-${m}-btn"]`) as HTMLElement | null
		return btn ? btn.offsetParent !== null : false
	}, mode)
	if (!visible) await clickByTestId(page, "theme-trigger")
	await clickByTestId(page, `theme-${mode}-btn`)
	if (mode === "system") {
		// system mode resolves to either "dark" or "light" via prefers-color-scheme
		await page.waitForFunction(() => !!document.documentElement.getAttribute("theme"), { timeout: 2_000 })
	} else {
		await page.waitForFunction((m: string) => document.documentElement.getAttribute("theme") === m, { timeout: 2_000 }, mode)
	}
}

/** Toggle a privacy setting by its testid suffix and return the new state.
 *  The container `setting-<key>` wraps a Toggle component (a `[tabindex="1"]`
 *  div whose `active` class reflects on/off). Click the inner toggle, then
 *  read its post-click class. Container-level click does NOT propagate. */
export async function togglePrivacySetting(page: Page, key: string): Promise<boolean> {
	await page.waitForSelector(`[data-testid="setting-${key}"] [tabindex="1"]`, { visible: true, timeout: 5_000 })
	const before = await getPrivacySetting(page, key)
	await page.evaluate((k: string) => {
		const toggle = document.querySelector(`[data-testid="setting-${k}"] [tabindex="1"]`) as HTMLElement | null
		toggle?.click()
	}, key)
	// Toggle exposes `data-toggle-active`; wait for the attribute to flip
	// instead of guessing how long Vue takes to re-render after setValue.
	const want = String(!before)
	await page.waitForFunction(
		({ k, w }: { k: string; w: string }) => {
			const root = document.querySelector(`[data-testid="setting-${k}"]`)
			return root?.querySelector("[data-toggle-active]")?.getAttribute("data-toggle-active") === w
		},
		{ timeout: 2_000, polling: 50 },
		{ k: key, w: want },
	)
	return getPrivacySetting(page, key)
}

/** Read a privacy setting's current state without toggling. The toggle
 *  reflects on/off via its `active` CSS-module class on the inner div. */
export async function getPrivacySetting(page: Page, key: string): Promise<boolean> {
	return page.evaluate((k: string) => {
		const toggle = document.querySelector(`[data-testid="setting-${k}"] [tabindex="1"]`) as HTMLElement | null
		if (!toggle) throw new Error(`getPrivacySetting: no toggle inside setting-${k}`)
		// CSS-module class names are mangled but always contain "active"
		return (toggle.className ?? "").includes("active")
	}, key)
}

// ── Profile / security ───────────────────────────────────────────────────

/** Read the active profile's display name from the reset-profile page root,
 *  which exposes it via `data-profile-name`. The reset flow requires typing
 *  the exact name to confirm; tests must read it dynamically because the
 *  default is auto-generated (`Profile 1`, `Profile 2`, …). */
export async function getActiveProfileName(page: Page): Promise<string> {
	const name = await page.evaluate(() => {
		const root = document.querySelector("[data-profile-name]") as HTMLElement | null
		return root?.getAttribute("data-profile-name") ?? ""
	})
	if (!name) throw new Error("getActiveProfileName: no element with data-profile-name on the current page")
	return name
}

/** Navigate by hash. Vue Router's hash mode listens for `hashchange`, but
 *  setting `location.hash` to the same value is a no-op — dispatch the
 *  event explicitly so the router sees a transition. Used for deep-linking
 *  past pages whose link buttons don't yet expose testids. */
export async function navigateByHash(page: Page, hash: string, timeout = 5_000): Promise<void> {
	await page.evaluate((h: string) => {
		if (window.location.hash !== h) {
			window.location.hash = h
		} else {
			window.dispatchEvent(new HashChangeEvent("hashchange"))
		}
	}, hash)
	await page.waitForFunction((h: string) => window.location.hash === h, { timeout }, hash)
	// No post-hash sleep: every caller follows with a `waitForSelector` for
	// an element on the destination page (or asserts on a globally-stable
	// document attribute like `theme`). If a new caller doesn't, it should
	// add its own state-driven wait, not bring the sleep back.
}

/** Drive the change-password form. Assumes you're on `/popup/settings/profile`
 *  or already on the change-password page; navigates explicitly to be
 *  idempotent. Submits and waits for the success toast. Caller is then on
 *  the auth or settings page (router.back()). */
export async function changePassword(page: Page, oldPwd: string, newPwd: string): Promise<void> {
	await navigateByHash(page, "#/popup/settings/security/change-password")
	await page.waitForSelector('[data-testid="current-password-input"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page, '[data-testid="current-password-input"]', oldPwd)
	await replaceInputValue(page, '[data-testid="new-password-input"]', newPwd)
	await replaceInputValue(page, '[data-testid="new-password-repeat-input"]', newPwd)
	await clickByTestId(page, "change-password-submit-btn")
}

/** Drive the reset-profile flow: tick all 3 checkboxes, type the active
 *  profile's name into the confirm input, and submit. Profile name is read
 *  from `data-profile-name` on the page root because it's auto-generated.
 *
 *  After submit the router redirects to either `/popup/auth` (if other
 *  profiles remain) or `/popup/register` (if it was the last profile). The
 *  caller asserts the redirect; this helper does not. */
export async function resetProfile(page: Page): Promise<void> {
	await navigateByHash(page, "#/popup/settings/security/reset")
	await page.waitForSelector('[data-testid="reset-checkbox-permanent"]', { visible: true, timeout: 5_000 })
	const profileName = await getActiveProfileName(page)

	await clickByTestId(page, "reset-checkbox-permanent")
	await clickByTestId(page, "reset-checkbox-undone")
	await clickByTestId(page, "reset-checkbox-sure")
	await replaceInputValue(page, '[data-testid="reset-confirm-input"]', profileName)
	await clickByTestId(page, "reset-submit-btn")
}

/** Drive the seed-phrase reveal flow on `/popup/settings/security/export/seed`.
 *  Caller asserts on `[data-testid="reveal-content"]` afterwards. */
export async function revealSeedPhrase(page: Page, password: string): Promise<void> {
	await navigateByHash(page, "#/popup/settings/security/export/seed")
	await clickByTestId(page, "agree-continue-btn")
	await page.waitForSelector('[data-testid="unlock-password-input"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page, '[data-testid="unlock-password-input"]', password)
	await clickByTestId(page, "unlock-submit-btn")
	await page.waitForSelector('[data-testid="reveal-content"]', { visible: true, timeout: 5_000 })
}

/** Drive the secret-key reveal flow. The "encrypted" variant is gateless
 *  (auto-fetches public key on selection — async, so wait for the input to
 *  receive a non-empty value). The "plain" variant goes through the same
 *  agree → unlock chain as the seed page. Caller asserts on
 *  `[data-testid="reveal-content"]` afterwards. */
export async function revealSecretKey(page: Page, password: string, variant: "plain" | "encrypted"): Promise<void> {
	await navigateByHash(page, "#/popup/settings/security/export/key")
	await clickByTestId(page, `key-variant-${variant}-btn`)
	if (variant === "plain") {
		await clickByTestId(page, "agree-continue-btn")
		await page.waitForSelector('[data-testid="unlock-password-input"]', { visible: true, timeout: 5_000 })
		await replaceInputValue(page, '[data-testid="unlock-password-input"]', password)
		await clickByTestId(page, "unlock-submit-btn")
	}
	await page.waitForSelector('[data-testid="reveal-content"]', { visible: true, timeout: 5_000 })
	// Wait for the inner input to actually have a value — the encrypted
	// variant fetches its key in an async watcher.
	await page.waitForFunction(
		() => {
			const scope = document.querySelector('[data-testid="reveal-content"]')
			const input = scope?.querySelector("input") as HTMLInputElement | null
			return !!input && input.value.length > 0
		},
		{ timeout: 10_000, polling: 100 },
	)
}

// ── Auth + profile flows ────────────────────────────────────────────────

/** From the auth screen, click "Reset Profile" to open the
 *  ForgotPasswordPopup. Resolves once the popup is mounted. */
export async function openForgotPasswordFromAuth(page: Page): Promise<void> {
	await clickByTestId(page, "auth-reset")
	await page.waitForSelector('[data-testid="forgot-reset-btn"]', { visible: true, timeout: 5_000 })
}

/** Open EditProfilePopup from /popup/settings/profile, replace the name,
 *  submit. Caller asserts on the new name elsewhere (toast / settings row /
 *  auth pill). */
export async function renameProfile(page: Page, newName: string): Promise<void> {
	await navigateByHash(page, "#/popup/settings/profile")
	await clickByTestId(page, "identity-name-row")
	await page.waitForSelector('[data-testid="profile-name-input"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page, '[data-testid="profile-name-input"]', newName)
	await clickByTestId(page, "edit-profile-submit")
}

// ── Settings: networks / fpcs / tokens CRUD ─────────────────────────────

/** Drill into a Network detail page (`/popup/settings/networks/[id]`) by name.
 *  Clicks the network-row via dispatchEvent (SettingItem renders as <a> whose
 *  href can be null). Resolves once the detail page has mounted (the rename
 *  row is the most stable detail-page testid). Caller is on the detail page. */
export async function openNetworkDetail(page: Page, name: string): Promise<void> {
	const rowSelector = `[data-testid="network-row"][data-network-name="${name}"]`
	await page.waitForSelector(rowSelector, { visible: true, timeout: 5_000 })
	await page.evaluate((sel: string) => {
		const row = document.querySelector(sel) as HTMLElement | null
		row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
	}, rowSelector)
	await page.waitForFunction(() => window.location.hash.includes("/popup/settings/networks/"), { timeout: 5_000 })
	await page.waitForSelector('[data-testid="network-detail-rename"]', { visible: true, timeout: 5_000 })
}

/** Open the detail page for the network row matching `name` and click
 *  "Delete chain". Accepts the ConfirmPopup and resolves after the
 *  router navigates back to the list (the row should be gone).
 *
 *  The inline delete icon lives on the per-`Network` detail page
 *  (`/popup/settings/networks/[id]`); the list drills via
 *  `chevron` + `@click`. Trigger navigation with the `dispatchEvent`
 *  trick because `SettingItem`'s `<a>` can have `href=null`. */
export async function deleteNetworkRow(page: Page, name: string): Promise<void> {
	const rowSelector = `[data-testid="network-row"][data-network-name="${name}"]`
	await page.waitForSelector(rowSelector, { visible: true, timeout: 5_000 })
	await page.evaluate((sel: string) => {
		const row = document.querySelector(sel) as HTMLElement | null
		row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
	}, rowSelector)
	// Wait for the detail page to mount.
	await page.waitForSelector('[data-testid="network-delete-chain-btn"]', { visible: true, timeout: 5_000 })
	await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="network-delete-chain-btn"]') as HTMLElement | null
		btn?.click()
	})
	await acceptConfirmPopup(page)
	// We should be back on the list; the deleted row should be gone.
	await page.waitForFunction(
		() => window.location.hash.startsWith("#/popup/settings/networks") && !window.location.hash.includes("/networks/"),
		{ timeout: 5_000 },
	)
	await page.waitForFunction((sel: string) => !document.querySelector(sel), { timeout: 5_000 }, rowSelector)
}
