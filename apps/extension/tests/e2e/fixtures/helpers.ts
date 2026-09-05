import type { Page, Target } from "puppeteer"
import { TEST_PASSWORD } from "./constants"
import { type ExtensionContext, clickByTestId, clickSelector, replaceInputValue, withTimeoutMessage } from "./extension"

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
	// Wait for the lock control to be mounted BEFORE clicking — a bare
	// `querySelector(...)?.click()` silently no-ops if the header hasn't
	// (re)mounted yet (e.g. right after a `router.back()`).
	await page.waitForSelector('[data-testid="header-lock"]', { visible: true, timeout: 15_000 })
	await page.evaluate(() => {
		;(document.querySelector('[data-testid="header-lock"]') as HTMLElement)?.click()
	})

	// Assert the AUTHORITATIVE lock — the session record removed from
	// chrome.storage.session (frozen key SESSION_STORAGE_ROOT) — not the UI
	// auto-redirect. The redirect is event-driven (onActiveProfileChanged(undefined)
	// → app.vue → router.push("/popup/auth")) and can be bounced by the route
	// guard when a stale post-password-change `bootstrapActiveProfile` flips
	// `isLogined` back to true AFTER the lock. That's a real product race (the
	// session IS cleared, only the UI redirect loses the race) — surfaced to the
	// auth/session owners in lessons/Q-15.md; do NOT paper over it in product code
	// from here. Waiting on storage is strictly stronger than the redirect check.
	await page.waitForFunction(
		async () => {
			const r = await chrome.storage.session.get("nulo:core:session")
			return !r["nulo:core:session"]
		},
		{ timeout: 60_000 },
	)
	// If the redirect lost the race, reload: a fresh popup derives the locked
	// state from storage and routes to /popup/auth (the real reopen path).
	if (!(await page.evaluate(() => window.location.hash.includes("/popup/auth")))) {
		await page.reload({ waitUntil: "domcontentloaded" })
	}
	await page.waitForFunction(() => window.location.hash.includes("/popup/auth"), { timeout: 15_000 })
}

/** If the wallet is locked, re-enter the password; if it is already unlocked,
 *  do nothing. Defaults to the standard test password; pass a different one if
 *  a prior test rotated it via change-password.
 *
 *  Contract — this helper is authoritative only inside it:
 *  - **Password profiles only.** A locked passkey profile keeps its session
 *    record (`SessionManager.restore` returns early: WebAuthn needs a user
 *    gesture), so it cannot be told apart from an unlocked one except by the
 *    password field being absent on `/popup/auth`. On any other route it would
 *    read as unlocked. Passkey lock/unlock is not e2e-drivable today anyway —
 *    see `fixtures/passkey.ts`.
 *  - **One profile, or a trustworthy `nulo:ui:lastActiveProfile`.** The unlock
 *    proof is scoped to that id; `app.vue` can fall back to `profiles[0]`
 *    WITHOUT persisting it, so with several profiles and no persisted id the
 *    scope check degrades to "any newer well-formed record".
 *  - **Callers keep an authoritative postcondition.** The session record is
 *    persisted just before `activeSession` is assigned, so a success here can
 *    in principle observe a session that a concurrent deletion fence then
 *    closes. Every current caller follows with route convergence or an
 *    account/on-chain read, which is what actually pins the outcome. */
export async function ensureUnlocked(
	page: Page,
	password = TEST_PASSWORD,
	opts: {
		/** How long the app may take to DECIDE its lock state. The default covers a warm popup;
		 *  a caller that just restarted the service worker passes its own bootstrap envelope. */
		decisionBudgetMs?: number
		/** Internal: the product's boot RETRY has already been pressed once on this call. */
		retried?: boolean
	} = {},
): Promise<void> {
	const decisionBudgetMs = opts.decisionBudgetMs ?? 30_000
	const retried = opts.retried === true
	// Lock state comes from the session record, never from the route and never
	// from a lone DOM marker — each of those lies in one direction. `app.vue`
	// pushes `/popup/auth` BEFORE `initNetworks()`/`initAccount()` finish and
	// `openPopup` returns inside that window, so an UNLOCKED wallet transiently
	// renders the password field; `header-lock` tracks `isLogined`, which
	// lockWallet documents as stale-TRUE after an authoritative lock.
	//
	// The record's mere PRESENCE is not enough either: `SessionManager.restore`
	// deliberately leaves it in place for a passkey profile (WebAuthn needs a
	// user gesture, so the lock screen handles it) and preserves an undecodable
	// one for repair. Presence therefore has to be paired with a shape check and
	// with the route, giving two states that cannot both hold:
	//   unlocked = a well-formed record AND the popup is not on /popup/auth
	//   locked   = the password field is mounted AND no usable record exists
	// Anything else — including a LOCKED passkey profile, which keeps its record
	// while showing no password field — stays unresolved and lands in the
	// timeout below, which names it.
	//
	// On the BUDGET, stated plainly because the arc bans raising bounds to paper
	// over flakes: the old 5s governed a different question ("has the password
	// field rendered"), which is answered in milliseconds. This wait asks "has the
	// app DECIDED whether it is locked", and the answer legitimately takes as long
	// as bootstrap does — the same transient window that makes a lone route or DOM
	// read unsafe. A caller right after a service-worker restart (the canary) hit
	// exactly that: record well-formed, hash still /popup/auth, field mounted, i.e.
	// mid-decision, and 5s was simply too short to observe the outcome. The 30s
	// default covers a warm popup. Right after a service-worker restart the
	// decision IS the activation bootstrap (`loadProfile` → `bootstrapActiveProfile`
	// → `/popup/general`, with the route guard parking the popup on `/popup/auth`
	// until `isSessionChecked` flips), and on a starved prover-ON runner that has
	// outlived 30s three times while the same test allows 120s for the very same
	// bootstrap to reach `/popup/general`. Such a caller passes `decisionBudgetMs`
	// equal to that envelope; the two waits then measure one thing with one clock.
	// Nothing here accepts a state it previously rejected.
	const readLiveness = () =>
		page.evaluate(async () => Number((await chrome.storage.session.get("nulo:liveness"))["nulo:liveness"] ?? 0)).catch(() => 0)
	const livenessAtStart = await readLiveness()
	const readSession = () =>
		page.evaluate(async () => {
			const raw = (await chrome.storage.session.get("nulo:core:session"))["nulo:core:session"]
			let rec: { profile?: unknown; since?: unknown } | undefined
			try {
				rec = typeof raw === "string" ? JSON.parse(raw) : undefined
			} catch {
				rec = undefined
			}
			const wellFormed = !!rec && typeof rec.profile === "string" && typeof rec.since === "number"
			return { wellFormed, present: raw !== undefined, since: wellFormed ? (rec?.since as number) : 0 }
		})

	const state = await withTimeoutMessage(
		page
			.waitForFunction(
				async () => {
					const raw = (await chrome.storage.session.get("nulo:core:session"))["nulo:core:session"]
					let rec: { profile?: unknown; since?: unknown } | undefined
					try {
						rec = typeof raw === "string" ? JSON.parse(raw) : undefined
					} catch {
						rec = undefined
					}
					const wellFormed = !!rec && typeof rec.profile === "string" && typeof rec.since === "number"
					// The shell saying its boot-time check GAVE UP (service unreachable across the
					// backoff, or the bootstrap threw over an OPEN session) wins over BOTH decisions
					// below: a missing record with the field mounted looks exactly like a lock, but
					// under the marker the record may be live and a reconnect may clear the marker
					// at any moment — so it is never typed against. The product's own RETRY is
					// pressed once, and the wait resumes for a real decision.
					const outcome = document.querySelector("[data-boot-outcome]")?.getAttribute("data-boot-outcome")
					if (outcome) return `boot:${outcome}`
					const field = !!document.querySelector('[data-testid="auth-password-input"]')
					if (wellFormed && !window.location.hash.includes("/popup/auth")) return "unlocked"
					if (!wellFormed && field) return "locked"
					return null
				},
				{ timeout: decisionBudgetMs, polling: 200 },
			)
			.then((handle) => handle.jsonValue() as Promise<string | null>),
		async () => {
			// Was the service worker alive and writing while we waited? A frozen heartbeat
			// means the worker died or never came back — a different bug from a slow bootstrap.
			const livenessAtEnd = await readLiveness()
			const heartbeat = livenessAtEnd > livenessAtStart ? "advanced" : livenessAtEnd === 0 ? "unreadable" : "frozen"
			const diag = await page
				.evaluate(async () => {
					const raw = (await chrome.storage.session.get("nulo:core:session"))["nulo:core:session"]
					let rec: { profile?: unknown; since?: unknown } | undefined
					try {
						rec = typeof raw === "string" ? JSON.parse(raw) : undefined
					} catch {
						rec = undefined
					}
					const shape =
						raw === undefined
							? "absent"
							: rec && typeof rec.profile === "string" && typeof rec.since === "number"
								? "well-formed"
								: "malformed"
					return {
						hash: window.location.hash,
						record: shape,
						field: !!document.querySelector('[data-testid="auth-password-input"]'),
					}
				})
				.catch(() => ({ hash: "<unreadable>", record: "<unreadable>", field: false }))
			return (
				`ensureUnlocked: lock state never settled within ${decisionBudgetMs / 1000}s (hash: ${diag.hash}, session record: ${diag.record}, ` +
				`password field: ${diag.field}, service-worker heartbeat during the wait: ${heartbeat}${retried ? ", boot RETRY pressed once" : ""}). ` +
				"A well-formed record on /popup/auth WITH the password field and no data-boot-outcome is the activation bootstrap " +
				"still deciding; a frozen heartbeat says the worker stopped writing. One with NO password field is a LOCKED PASSKEY " +
				"profile, which this helper cannot unlock — drive the passkey ceremony instead."
			)
		},
	)

	if (state === "unlocked") return
	if (typeof state === "string" && state.startsWith("boot:")) {
		// The one recovery a user has; taken exactly once so a product boot failure that
		// survives its own retry still fails the test with its name, never a typed password.
		if (retried)
			throw new Error(
				`ensureUnlocked: the popup's boot-time check gave up twice (${state.slice(5)}) — a product boot failure, not a slow bootstrap`,
			)
		await clickByTestId(page, "boot-retry")
		return ensureUnlocked(page, password, { ...opts, retried: true })
	}

	// Scope the proof below to THIS unlock: the profile the auth screen is about
	// to unlock, and the record generation preceding it.
	const before = await readSession()
	const expectedProfile = await page.evaluate(
		async () => (await chrome.storage.local.get("nulo:ui:lastActiveProfile"))["nulo:ui:lastActiveProfile"] as string | undefined,
	)

	await replaceInputValue(page, '[data-testid="auth-password-input"]', password)
	await clickByTestId(page, "auth-submit")

	// Prove the UNLOCK, not the navigation: leaving `/popup/auth` is also what
	// the bootstrap's own redirect does, and any session record would also be
	// written by a concurrent unlock of a different profile. Require a
	// well-formed record for the expected profile, newer than the one we
	// started from.
	await withTimeoutMessage(
		page.waitForFunction(
			async (want: string | undefined, priorSince: number) => {
				const raw = (await chrome.storage.session.get("nulo:core:session"))["nulo:core:session"]
				let rec: { profile?: unknown; since?: unknown } | undefined
				try {
					rec = typeof raw === "string" ? JSON.parse(raw) : undefined
				} catch {
					rec = undefined
				}
				if (!rec || typeof rec.profile !== "string" || typeof rec.since !== "number") return false
				if (want !== undefined && rec.profile !== want) return false
				return rec.since > priorSince
			},
			{ timeout: 10_000, polling: 200 },
			expectedProfile,
			before.since,
		),
		async () => {
			const wrong = await page.evaluate(() => !!document.querySelector('[data-testid="error-text"]')).catch(() => false)
			const now = await readSession().catch(() => undefined)
			return (
				`ensureUnlocked: submitted the password but no session for profile ${expectedProfile ?? "<unknown>"} newer than ` +
				`${before.since} appeared within 10s (wrong-password shown: ${wrong}; record now: ${JSON.stringify(now)})`
			)
		},
	)
}

/**
 * Model the realistic post-import recovery. The P0-proven wedge: an MV3 service
 * worker restart mid-import drops the in-memory master secret, so in strict mode
 * (the default) the just-imported profile is locked until the user reopens and
 * unlocks. This reproduces that recovery deterministically:
 *
 *   lock  — drops the session record from chrome.storage.session, exactly as a
 *           worker restart drops the in-memory master;
 *   reopen via the auth route (lockWallet reloads a fresh popup that derives the
 *           locked state from storage — the real reopen path);
 *   unlock — re-derives the master, which re-provisions the encrypted per-chain
 *           PXE store key and boots the chain runtime.
 *
 * Asserts the wallet lands back on /popup/general. Callers then do a
 * store-dependent read (account address / on-chain balance) to prove the
 * encrypted PXE store actually RE-OPENED under the re-derived key — never wiped
 * (refuse-and-preserve), never dead-ended.
 */
export async function reopenAndRecoverAfterImport(page: Page, password = TEST_PASSWORD): Promise<void> {
	await lockWallet(page)
	await ensureUnlocked(page, password)
	await page.waitForFunction(() => window.location.hash.includes("/popup/general"), { timeout: 30_000 })
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
	// The BEFORE snapshot below disambiguates real vs repeat switch, so it
	// must read a RENDERED header: on a freshly-opened popup the chip mounts
	// with empty text for a beat, and an empty read misclassifies an
	// already-on-target wallet as a real switch — whose "address flips" wait
	// below can then never be satisfied, because the target chain re-derives
	// the address the wallet already shows. Wait for the render signal.
	await page.waitForFunction(
		() => {
			const btn = document.querySelector('[data-testid="network-button"]')
			return !!btn && (btn.textContent ?? "").trim().length > 0
		},
		{ timeout: 15_000, polling: 200 },
	)
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

/** Poll `chrome.storage.local["nulo:ui:activeAccount"]` until it equals
 *  `address`, or throw with expected-vs-observed.
 *
 *  The account-switch click handlers fire `selectAccount` UN-awaited
 *  (`AccountsPopup.vue`), and `selectAccount` mutates the store ref before
 *  awaiting persistence — so the authoritative `nulo:ui:activeAccount` write
 *  lands a beat after the click. A caller that needs the switch to have TAKEN
 *  EFFECT (e.g. before reading the switched account's feed) must wait on this
 *  storage signal, not on the click returning. */
async function waitForActiveAccount(page: Page, address: string, timeoutMs = 5_000): Promise<void> {
	try {
		await page.waitForFunction(
			async (want: string) => {
				const r = await chrome.storage.local.get("nulo:ui:activeAccount")
				return r["nulo:ui:activeAccount"] === want
			},
			{ timeout: timeoutMs, polling: 100 },
			address,
		)
	} catch {
		const observed = await getAccountAddress(page).catch(() => "<read failed>")
		throw new Error(`switch account: expected nulo:ui:activeAccount="${address}" but observed "${observed}" after ${timeoutMs}ms`)
	}
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

/** Switch to an account by name via the AccountsPopup in header.
 *
 *  The AccountsPopup row exposes BOTH `data-account-name` and
 *  `data-account-address`, so we resolve the target address from the row
 *  before clicking and then wait until the switch actually lands in storage —
 *  callers can assume the active account IS the target on return, not merely
 *  that the row was clicked. */
export async function switchAccount(page: Page, name: string): Promise<void> {
	await clickByTestId(page, "account-selector")
	await page.waitForSelector('[data-testid="accounts-popup"]', { visible: true, timeout: 5_000 })

	const selector = `[data-testid="account-item"][data-account-name="${name}"]`
	await page.waitForSelector(selector, { visible: true, timeout: 5_000 })
	// Resolve the target address from the row so the post-click wait can key
	// on the authoritative storage signal (see waitForActiveAccount).
	const targetAddress = await page.evaluate(
		(sel: string) => document.querySelector(sel)?.getAttribute("data-account-address") ?? null,
		selector,
	)
	await clickSelector(page, selector)

	// Vue Transition can stick mid-leave; force-close.
	await closeStuckPopup(page)

	if (targetAddress) {
		await waitForActiveAccount(page, targetAddress)
	} else {
		// Row lacked a resolvable address (shouldn't happen — pinned by the
		// selector rule that both attrs are present). Fall back to the weaker
		// guarantee: the popup closed and an account is active.
		await page.waitForFunction(
			async () => {
				const r = await chrome.storage.local.get("nulo:ui:activeAccount")
				const addr = r["nulo:ui:activeAccount"]
				return typeof addr === "string" && addr.length > 0
			},
			{ timeout: 5_000, polling: 100 },
		)
	}
}

/** Switch the wallet's active account by ADDRESS — stable across runs, unlike the
 *  display name, which depends on creation order vs the dApp's account-exposure
 *  order (e.g. `accountAddresses[0]` may be the "Second"-named account).
 *
 *  Waits until `nulo:ui:activeAccount === address` before returning — the click
 *  fires `selectAccount` un-awaited, so without this a caller can read a
 *  half-switched state. */
export async function switchAccountByAddress(page: Page, address: string): Promise<void> {
	await clickByTestId(page, "account-selector")
	await page.waitForSelector('[data-testid="accounts-popup"]', { visible: true, timeout: 5_000 })

	const selector = `[data-testid="account-item"][data-account-address="${address}"]`
	await page.waitForSelector(selector, { visible: true, timeout: 5_000 })
	await clickSelector(page, selector)

	// Vue Transition can stick mid-leave; force-close.
	await closeStuckPopup(page)

	await waitForActiveAccount(page, address)
}

/** Create a second account and return its address.
 *
 *  Creating an account SELECTS it: `NewAccountPopup.handleCreateAccount` sets
 *  `appStore.account` and writes `nulo:ui:activeAccount = <new address>`. So we
 *  snapshot the current active address, create, then wait for the active
 *  account to flip to a NEW non-empty value and return it. Reuses
 *  `createAccount` for the UI flow. */
export async function createSecondAccount(page: Page, name = "Second"): Promise<string> {
	const previous = await getAccountAddress(page)
	await createAccount(page, name)
	await page.waitForFunction(
		async (prev: string) => {
			const r = await chrome.storage.local.get("nulo:ui:activeAccount")
			const addr = r["nulo:ui:activeAccount"]
			return typeof addr === "string" && addr.length > 0 && addr !== prev
		},
		{ timeout: 15_000, polling: 100 },
		previous,
	)
	return getAccountAddress(page)
}

// ── Contact ────────────────────────────────────────────────────────────

/** Add a contact via the NewContactPopup. Saving a contact touches the
 *  contact service only — sender registration is a separate concern
 *  (Settings → Advanced → Account State → Senders). */
export async function addContact(page: Page, name: string, address: string): Promise<void> {
	await clickByTestId(page, "contacts-new-btn")

	// Wait for form inputs to mount
	await page.waitForSelector('input[placeholder="New contact"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page, 'input[placeholder="New contact"]', name)

	await page.waitForSelector('input[placeholder*="0x15c4"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page, 'input[placeholder*="0x15c4"]', address)

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

/** Delete a contact by name (assumes contacts page is open). Deleting a
 *  contact never touches sender registration — senders are managed only
 *  in Settings → Advanced → Account State → Senders. */
export async function deleteContact(page: Page, name: string): Promise<void> {
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

// ── Fee Method ────────────────────────────────────────────────────────

/** The three selectable fee methods (`send-fee-method-{subtitle}` testids);
 *  the fourth rendered entry ("coming soon") is disabled by design. */
export type FeeMethodSubtitle = "sponsored" | "public" | "private"

/** Select a fee payment method in the shared FeeSettingsCard dropdown (the
 *  send flow AND the dApp execute/authwit popups embed the same card).
 *  `mountTimeoutMs` exists because the card mounts only after FPC
 *  auto-discovery — an async service round-trip that can take seconds on a
 *  cold path. */
export async function selectFeeMethod(
	page: Page,
	methodSubtitle: FeeMethodSubtitle,
	opts: { mountTimeoutMs?: number } = {},
): Promise<void> {
	const mountTimeoutMs = opts.mountTimeoutMs ?? 2_000
	await page.waitForSelector('[data-testid="send-fee-method-trigger"]', { visible: true, timeout: mountTimeoutMs })
	// Open the fee method dropdown (items teleport to #dropdown)
	await page.evaluate(() => {
		;(document.querySelector('[data-testid="send-fee-method-trigger"]') as HTMLElement)?.click()
	})

	// Wait for the target item to teleport into the dropdown layer.
	const testid = `send-fee-method-${methodSubtitle}`
	await page.waitForSelector(`[data-testid="${testid}"]`, { visible: true, timeout: mountTimeoutMs })

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
 *  to reflect the choice. The theme buttons are inside a Dropdown popup whose
 *  leave `<Transition>` keeps the options VISIBLE while the dropdown's state
 *  is already closed — a visibility sample taken mid-close (right after a
 *  previous selection closed the menu) reads "open", skips the trigger click,
 *  and then waits on an option that is about to disappear. Gate on the
 *  dropdown's OWN state (`data-dropdown-open`, synchronous with `isOpen`). */
export async function setTheme(page: Page, mode: "system" | "light" | "dark"): Promise<void> {
	const readOpen = () =>
		page.evaluate(
			() =>
				document
					.querySelector('[data-testid="theme-trigger"]')
					?.closest("[data-dropdown-open]")
					?.getAttribute("data-dropdown-open") === "true",
		)
	if (!(await readOpen())) {
		await clickByTestId(page, "theme-trigger")
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="theme-trigger"]')
					?.closest("[data-dropdown-open]")
					?.getAttribute("data-dropdown-open") === "true",
			{ timeout: 5_000 },
		)
	}
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
 *  Navigation is SETTLE-STABLE, not one-shot: setting `location.hash` updates the
 *  URL before vue-router commits, so a hash-equality wait passes while a competing
 *  `router.push("/popup/general")` (SW-reconnect `loadProfile` re-run, post-unlock
 *  bootstrap churn) can still supersede the in-flight navigation and revert the
 *  route — the checkbox then never mounts. Observed live: the 5s checkbox wait
 *  parked with the app fully back on general. The awaited signal here is "the
 *  reset route COMMITTED (checkbox mounted) and STUCK"; a reverted hash triggers
 *  a re-navigate, not a longer clock.
 *
 *  After submit the router redirects to either `/popup/auth` (if other
 *  profiles remain) or `/popup/register` (if it was the last profile). The
 *  caller asserts the redirect; this helper does not. */
export async function resetProfile(page: Page): Promise<void> {
	const RESET_HASH = "#/popup/settings/security/reset"
	// One re-navigation covers the single characterized race (a competing push
	// already in flight when the hash was set supersedes our navigation). A SECOND
	// revert would mean the app is repeatedly redirecting away from reset — a
	// product-level condition this helper must surface, never normalize.
	const ATTEMPTS = 2
	// The dwell must be monotonic: the route+checkbox condition has to hold
	// CONTINUOUSLY for the window, tracked in-page — a plain waitForFunction
	// resolves on its first truthy poll and proves nothing about stability.
	const DWELL_MS = 1_500

	// Poll-based hash trajectory (vue-router hash nav is pushState-based — no
	// hashchange/popstate fires), dumped into every failure for race forensics.
	// Re-armed per call (a prior call's timer is cleared) so a second
	// resetProfile on the same page never reports a frozen call-1 trace.
	await page.evaluate(() => {
		const w = window as unknown as { __nuloResetNavTrace?: Array<{ t: number; hash: string }>; __nuloResetNavTraceTimer?: number }
		if (w.__nuloResetNavTraceTimer) window.clearInterval(w.__nuloResetNavTraceTimer)
		w.__nuloResetNavTrace = [{ t: Date.now(), hash: window.location.hash }]
		w.__nuloResetNavTraceTimer = window.setInterval(() => {
			const trace = w.__nuloResetNavTrace as Array<{ t: number; hash: string }>
			if (window.location.hash !== trace[trace.length - 1].hash) trace.push({ t: Date.now(), hash: window.location.hash })
		}, 100)
	})

	let lastDiag = ""
	let settled = false
	for (let attempt = 0; attempt < ATTEMPTS && !settled; attempt++) {
		try {
			// INSIDE the try: the competing-push race can also land between
			// navigateByHash's hash-set and its equality poll — that throw must
			// count as a failed attempt (retry + diagnostics), never escape the
			// envelope uncaught with the trace interval still running.
			await navigateByHash(page, RESET_HASH)
			await page.waitForSelector('[data-testid="reset-checkbox-permanent"]', { visible: true, timeout: 5_000 })
			await page.evaluate(() => {
				;(window as unknown as { __resetStableSince: number | null }).__resetStableSince = null
			})
			await page.waitForFunction(
				({ h, dwellMs }: { h: string; dwellMs: number }) => {
					const w = window as unknown as { __resetStableSince: number | null }
					const ok = window.location.hash === h && !!document.querySelector('[data-testid="reset-checkbox-permanent"]')
					if (!ok) {
						w.__resetStableSince = null
						return false
					}
					// performance.now() — the dwell must be monotonic; a wall-clock
					// adjustment could silently shorten or stretch it.
					if (w.__resetStableSince == null) w.__resetStableSince = performance.now()
					return performance.now() - w.__resetStableSince >= dwellMs
				},
				{ timeout: 8_000, polling: 150 },
				{ h: RESET_HASH, dwellMs: DWELL_MS },
			)
			settled = true
		} catch {
			lastDiag = JSON.stringify(
				await page
					.evaluate(() => ({
						hash: window.location.hash,
						pageRootMounted: !!document.querySelector("[data-profile-name]"),
						checkboxInDom: !!document.querySelector('[data-testid="reset-checkbox-permanent"]'),
						navTrace: (window as unknown as { __nuloResetNavTrace?: Array<{ t: number; hash: string }> }).__nuloResetNavTrace,
						testidsOnPage: [...document.querySelectorAll("[data-testid]")]
							.slice(0, 12)
							.map((el) => el.getAttribute("data-testid")),
						readyState: document.readyState,
					}))
					.catch((e) => ({ evalFailed: String(e) })),
			)
		}
	}
	await page
		.evaluate(() => {
			const w = window as unknown as { __nuloResetNavTraceTimer?: number }
			if (w.__nuloResetNavTraceTimer) window.clearInterval(w.__nuloResetNavTraceTimer)
		})
		.catch(() => {})
	if (!settled) {
		throw new Error(
			`resetProfile: reset route never held for ${DWELL_MS}ms across ${ATTEMPTS} navigations; last parked state: ${lastDiag}`,
		)
	}
	const profileName = await getActiveProfileName(page)

	await clickByTestId(page, "reset-checkbox-permanent")
	await clickByTestId(page, "reset-checkbox-undone")
	await clickByTestId(page, "reset-checkbox-sure")
	await replaceInputValue(page, '[data-testid="reset-confirm-input"]', profileName)
	await clickByTestId(page, "reset-submit-btn")
}

/** Highest `updatedAt` across the account's balance rows (0 if none). Captured
 *  BEFORE a refresh so `waitForFreshBalanceRow` can require a projection that
 *  happened AFTER it — an imported backup already carries the expected value
 *  with a nonzero `updatedAt`, so a value-only poll could pass with zero
 *  post-import/post-reopen sync, silently un-proving the re-sync the tests
 *  exist to prove. */
export async function captureBalanceBaseline(page: Page, account: string, tokenContract: string): Promise<number> {
	let max = 0
	for (const row of await readScopedBalanceRows(page, account, tokenContract)) {
		if (typeof row.updatedAt === "number" && row.updatedAt > max) max = row.updatedAt
	}
	return max
}

const TOKEN_ROWS_PREFIX = "nulo:core:tokens@"
const BALANCE_ROWS_PREFIX = "nulo:core:token-balances@"

type BalanceRow = { account?: string; token?: number; publicBalance?: string; privateBalance?: string; updatedAt?: number }

/** Runs IN THE PAGE (Puppeteer serializes it, so it must not reference module scope): the raw
 *  `chrome.storage.local` values under each prefix, all from ONE snapshot, decoded by nothing —
 *  the hostile rows are parsed on the Node side by the same guarded loops that used to run here. */
async function readStorageValuesByPrefixes({ prefixes }: { prefixes: string[] }): Promise<unknown[][]> {
	const all = await chrome.storage.local.get(null)
	const entries = Object.entries(all)
	return prefixes.map((prefix) => entries.filter(([k]) => k.startsWith(prefix)).map(([, v]) => v))
}

/** Numeric ids of the token rows bound to `contract` (case-insensitive). Each raw value is decoded
 *  inside its own try: a malformed row, or one whose shape makes the predicate throw, is skipped —
 *  hostile-input discipline, never fatal. */
function tokenIdsForContract(tokenValues: unknown[], contract: string): Set<number> {
	const tokenIds = new Set<number>()
	for (const v of tokenValues) {
		try {
			const row = JSON.parse(v as string) as { id?: number; contract?: string }
			if (typeof row.id === "number" && row.contract?.toLowerCase() === contract.toLowerCase()) tokenIds.add(row.id)
		} catch {
			// Malformed row: skip.
		}
	}
	return tokenIds
}

/** Balance rows for exactly `account` × `tokenIds`, raw (no field normalization — the callers'
 *  comparisons keep coercing as they always did). Same per-row try discipline as the token scan. */
function balanceRowsFor(balanceValues: unknown[], account: string, tokenIds: Set<number>): BalanceRow[] {
	const rows: BalanceRow[] = []
	for (const v of balanceValues) {
		try {
			const row = JSON.parse(v as string) as BalanceRow
			if (row.account === account && typeof row.token === "number" && tokenIds.has(row.token)) rows.push(row)
		} catch {
			// Malformed row: skip.
		}
	}
	return rows
}

/** The exact (account, token) join both balance waits share, re-resolved from one storage snapshot
 *  per call: another token's row with the same raw value must never satisfy a freshness/value
 *  acceptance, and after a restore the token row itself can land later than the first read. */
async function readScopedBalanceRows(page: Page, account: string, tokenContract: string): Promise<BalanceRow[]> {
	const [tokenValues, balanceValues] = await page.evaluate(readStorageValuesByPrefixes, {
		prefixes: [TOKEN_ROWS_PREFIX, BALANCE_ROWS_PREFIX],
	})
	return balanceRowsFor(balanceValues, account, tokenIdsForContract(tokenValues, tokenContract))
}

/** Wait for a balance row for `account` that is both FRESH (`updatedAt` past the
 *  captured baseline — proves a re-projection actually ran) and CORRECT (exact
 *  raw `publicBalance`, plus exact raw `privateBalance` when the caller proves
 *  a private leg — note discovery is what several sweeps assert). Drives at
 *  most `maxRefreshes` refreshes. Retry cadence: a refresh is re-kicked when
 *  the previous projection observably finished (some row's `updatedAt`
 *  advanced past the last refresh) OR the projection envelope elapsed with no
 *  write (a failed projection persists `syncFailure` but leaves `updatedAt`
 *  untouched, so a silent stall and a failure look alike here) — AND at least
 *  the spacing floor has passed since the last kick, so a projection that
 *  completes fast with stale values cannot burn the cap and leave a dead tail.
 *  Both bounds pace only WHEN TO RE-KICK, never the acceptance signal, which
 *  stays freshness + exact value. Bounded refreshes (not spam) matter: blind
 *  spam starves the popup thread and queues PXE readers that delay any
 *  subsequent purge (ReadWriteGuard drains readers first). The row read is
 *  exact and locale-independent — a body-text scan for "1,000" can
 *  false-positive on "$1,000.00" fiat or "11,000". Value-display call sites
 *  pair this with a card-scoped DOM assertion (`waitForTokenCardAmount`). */
export async function waitForFreshBalanceRow(
	page: Page,
	opts: {
		account: string
		tokenContract: string
		expectedPublicRaw: string
		expectedPrivateRaw?: string
		baselineUpdatedAt: number
		maxRefreshes?: number
		timeoutMs?: number
	},
): Promise<void> {
	// No ambient periodic re-sync exists (projections fire only on explicit
	// refresh / token events / tx updates) and a failed batch is dropped, never
	// re-enqueued — so the refresh budget must span the whole timeout. The
	// envelope (queue tick + a ≤12-row batch + margin) re-kicks through silent
	// stalls; both it and the spacing floor bound the re-kick cadence only,
	// never the acceptance signal.
	const REFRESH_ENVELOPE_MS = 15_000
	// Floor between re-kicks: a projection that completes FAST with stale/wrong
	// values must not burn the refresh cap in seconds and leave a dead tail —
	// the cap is derived from this floor so kicks can span the whole deadline
	// (the old per-site loops re-kicked at ~1.5-2s for up to 60 iterations).
	const MIN_REFRESH_SPACING_MS = 2_000
	const { account, tokenContract, expectedPublicRaw, expectedPrivateRaw, baselineUpdatedAt, timeoutMs = 120_000 } = opts
	const maxRefreshes = opts.maxRefreshes ?? Math.ceil(timeoutMs / MIN_REFRESH_SPACING_MS)
	const deadline = Date.now() + timeoutMs
	// The (account, token) join re-resolves EVERY poll (audit condition) — see `readScopedBalanceRows`.
	const readRows = (): Promise<BalanceRow[]> => readScopedBalanceRows(page, account, tokenContract)

	let refreshes = 0
	let lastRefreshAt = 0
	let rows: BalanceRow[] = []
	while (Date.now() < deadline) {
		rows = await readRows()
		if (
			rows.some(
				(r) =>
					(r.updatedAt ?? 0) > baselineUpdatedAt &&
					r.publicBalance === expectedPublicRaw &&
					(expectedPrivateRaw === undefined || r.privateBalance === expectedPrivateRaw),
			)
		)
			return
		const attemptFinished =
			refreshes === 0 || rows.some((r) => (r.updatedAt ?? 0) >= lastRefreshAt) || Date.now() - lastRefreshAt >= REFRESH_ENVELOPE_MS
		const spaced = refreshes === 0 || Date.now() - lastRefreshAt >= MIN_REFRESH_SPACING_MS
		if (attemptFinished && spaced && refreshes < maxRefreshes) {
			lastRefreshAt = Date.now()
			refreshes++
			await refreshBalances(page)
		}
		await new Promise((r) => setTimeout(r, 1_000))
	}
	// Census across roots, account-agnostic: distinguishes "the account's rows are
	// keyed differently" from "the token/balance slices are simply absent" — the
	// latter points at restore-slice loss, a product condition, not a wait problem.
	const census = await page
		.evaluate(async () => {
			const all = await chrome.storage.local.get(null)
			const keys = Object.keys(all)
			const grab = (p: string) => keys.filter((k) => k.startsWith(p))
			return {
				tokenRows: grab("nulo:core:tokens@").length,
				balanceRows: grab("nulo:core:token-balances@").map((k) => {
					try {
						const r = JSON.parse(all[k] as string) as { account?: string; updatedAt?: number }
						return { account: `${r.account?.slice(0, 10)}…`, updatedAt: r.updatedAt }
					} catch {
						return { account: "unparseable", updatedAt: -1 }
					}
				}),
				accountRows: grab("nulo:core:accounts@").length,
			}
		})
		.catch((e) => ({ censusFailed: String(e) }))
	throw new Error(
		`waitForFreshBalanceRow: no (${account}, ${tokenContract}) row with publicBalance=${expectedPublicRaw}${expectedPrivateRaw !== undefined ? ` privateBalance=${expectedPrivateRaw}` : ""} and updatedAt>${baselineUpdatedAt} after ${refreshes} refresh(es); rows: ${JSON.stringify(rows)}; census: ${JSON.stringify(census)}`,
	)
}

/** Card-scoped display assertion: the tokens-card for `symbol` shows exactly
 *  `displayAmount` — the card is selected by its `data-symbol` attribute, the
 *  fiat node is excluded (so "$1,000.00" can't satisfy a "1,000" check), and
 *  the amount must sit on digit boundaries (so "11,000" or "1,000.5" can't
 *  satisfy "1,000" as a substring — audit condition). */
export async function waitForTokenCardAmount(page: Page, displayAmount: string, symbol: string, timeout = 30_000): Promise<void> {
	await page.waitForFunction(
		({ amt, sym }: { amt: string; sym: string }) => {
			const boundary = new RegExp(`(^|[^\\d,.])${amt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\d,.])`)
			return [...document.querySelectorAll('[data-testid="tokens-card"]')].some((card) => {
				if (!card.querySelector(`[data-testid="token-symbol"][data-symbol="${sym}"]`)) return false
				const clone = card.cloneNode(true) as HTMLElement
				for (const fiat of clone.querySelectorAll('[data-testid="token-fiat"]')) fiat.remove()
				return boundary.test(clone.textContent ?? "")
			})
		},
		{ timeout, polling: 500 },
		{ amt: displayAmount, sym: symbol },
	)
}

/** Capture the sole profile's id from raw storage and PROVE its row exists — the
 *  pre-condition that makes a later "row absent" read mean DELETED rather than
 *  never-created. Expects exactly one profile row (the shape of every reset-flow
 *  e2e); throws otherwise so a multi-profile drift can't silently weaken the
 *  purge assertion. */
export async function captureSoleProfileId(page: Page): Promise<string> {
	const ids = await page.evaluate(async () => {
		const all = await chrome.storage.local.get(null)
		return Object.keys(all)
			.filter((k) => k.startsWith("nulo:core:profiles@"))
			.map((k) => k.slice("nulo:core:profiles@".length))
	})
	if (ids.length !== 1) throw new Error(`captureSoleProfileId: expected exactly 1 profile row, found ${ids.length}`)
	return ids[0]
}

/** Wait until profile deletion COMPLETED for `profileId`: its row gone, its exact
 *  tombstone (`nulo:core:profile-tombstones@<id>`) gone, and every given owned
 *  root emptied. The tombstone is written BEFORE the row delete and cleared only
 *  after the coordinator's full awaited purge resolves, so this combined
 *  predicate — anchored on a row proven to exist beforehand — is the same
 *  completion fact the reset page's awaited `deleteProfile` observes. Tombstone
 *  absence ALONE would also be true before deletion ever started, which is why
 *  callers must capture the id via `captureSoleProfileId` first. On timeout the
 *  remaining keys are dumped: a persisting tombstone+row means a rejected or
 *  wedged purge; owned-root leftovers mean a partial cascade. */
export async function waitForProfilePurged(
	page: Page,
	profileId: string,
	opts: { ownedRoots?: string[]; timeoutMs?: number } = {},
): Promise<void> {
	const { ownedRoots = [], timeoutMs = 75_000 } = opts
	const deadline = Date.now() + timeoutMs
	let last: Record<string, boolean> = {}
	while (Date.now() < deadline) {
		last = await page.evaluate(
			async ({ id, roots }: { id: string; roots: string[] }) => {
				const all = await chrome.storage.local.get(null)
				const keys = Object.keys(all)
				const state: Record<string, boolean> = {
					profileRow: keys.includes(`nulo:core:profiles@${id}`),
					tombstone: keys.includes(`nulo:core:profile-tombstones@${id}`),
				}
				for (const r of roots) state[r] = keys.some((k) => k.startsWith(`${r}@`))
				return state
			},
			{ id: profileId, roots: ownedRoots },
		)
		if (!Object.values(last).some(Boolean)) return
		await new Promise((r) => setTimeout(r, 500))
	}
	// The "Couldn't delete profile" rejection toast auto-dismisses in ~2s, so it
	// cannot be sampled at timeout; the persisting tombstone+row combination IS the
	// rejected-or-wedged signature. Session presence distinguishes "delete never
	// started (still logged in, nothing changed)" from "mid-purge wedge".
	const sessionPresent = await page
		.evaluate(async () => {
			const r = await chrome.storage.session.get("nulo:core:session")
			return !!r["nulo:core:session"]
		})
		.catch(() => "unreadable")
	throw new Error(
		`waitForProfilePurged: purge incomplete after ${timeoutMs}ms for profile ${profileId}: ${JSON.stringify(last)}; sessionPresent=${sessionPresent}`,
	)
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

/** The worker global's creation time — a fresh value proves a fresh worker instance, whatever
 *  DevTools host it runs under. Read through a session of its own that is detached again before
 *  the caller does anything else, so the read never overlaps a stop. */
async function readWorkerTimeOrigin(target: Target): Promise<number> {
	const session = await target.createCDPSession()
	try {
		const { result } = await session.send("Runtime.evaluate", { expression: "performance.timeOrigin", returnByValue: true })
		return Number(result.value)
	} finally {
		await session.detach().catch(() => {})
	}
}

/**
 * Terminate the extension's service worker and wait until the ORIGINAL worker instance is gone.
 *
 * The stop is `Target.closeTarget` sent from the BROWSER-level CDP session with no DevTools
 * session attached to the worker. Chrome parks a stopped worker's DevTools host while any session
 * is attached, to hand the same host to the worker's next start — and an MV3 extension worker
 * restarts within milliseconds of stopping (a port disconnect or `tabs.onRemoved` is always
 * pending). Puppeteer's `worker.close()` is attach → close → detach, so whenever its stop landed
 * before its detach the restarted worker inherited the host: same target id, no `targetdestroyed`,
 * "still alive 15s after close()" — and when the host was already gone by the detach, "No session
 * with given id". Sending the stop unattached removes that race (measured under `taskset -c 0,1`:
 * 3 lost stops in 16 with `worker.close()`, 0 in 16 without a session).
 *
 * A host can still be parked by a session this helper does not own — Puppeteer auto-attaches to
 * every starting service worker before silently detaching — so `targetdestroyed` is not the only
 * accepted proof. The fallback witness is the worker's `performance.timeOrigin`: a value newer
 * than the one read before the stop is a new instance under whatever host Chrome gave it. The
 * check runs only once a normal stop would long have completed (a healthy destroy lands in tens
 * of milliseconds), so the read cannot itself overlap the stop. `Runtime.terminateExecution` is
 * not an alternative to any of this — it leaves the worker running.
 */
export async function stopServiceWorker(ext: ExtensionContext): Promise<void> {
	const isExtensionWorker = (t: Target) => t.type() === "service_worker" && t.url().includes(ext.extensionId)
	const swTarget = await ext.browser.waitForTarget(isExtensionWorker, { timeout: 15_000 })
	const originBefore = await readWorkerTimeOrigin(swTarget)

	let destroyed = false
	const onDestroyed = (target: Target) => {
		if (target === swTarget) destroyed = true
	}
	ext.browser.on("targetdestroyed", onDestroyed)

	const browserSession = await ext.browser.target().createCDPSession()
	try {
		// The id comes from the browser's own target list (public protocol), matched on the same
		// predicate as the Target above, so no private `_targetId` read is needed.
		const { targetInfos } = await browserSession.send("Target.getTargets")
		const info = targetInfos.find((t) => t.type === "service_worker" && t.url.includes(ext.extensionId))
		if (!info) throw new Error("stopServiceWorker: the browser lists no service-worker target for the extension")
		const { success } = await browserSession.send("Target.closeTarget", { targetId: info.targetId })
		if (!success) throw new Error("stopServiceWorker: Target.closeTarget reported failure")

		const deadline = Date.now() + 15_000
		const fallbackFrom = Date.now() + 2_000
		while (!destroyed) {
			if (Date.now() > deadline) {
				throw new Error("stopServiceWorker: the service-worker target was still alive 15s after close()")
			}
			await new Promise((r) => setTimeout(r, 100))
			if (destroyed || Date.now() < fallbackFrom) continue
			const live = ext.browser.targets().find(isExtensionWorker)
			if (!live) continue
			const origin = await readWorkerTimeOrigin(live).catch(() => undefined)
			if (origin !== undefined && origin > originBefore) return
		}
	} finally {
		ext.browser.off("targetdestroyed", onDestroyed)
		await browserSession.detach().catch(() => {})
	}
}
