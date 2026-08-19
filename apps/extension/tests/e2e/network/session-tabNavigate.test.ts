import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { openPlayground } from "../fixtures/playground"
import { waitForPopup, approveDiscover, approveVerify } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #42 — cross-origin navigation terminates the wallet-sdk transport
 * session but does NOT delete the persisted DappSession.
 *
 * Per `wireTabLifecycle` (`wallet-sdk/tab-lifecycle.ts`: the
 * `chrome.tabs.onUpdated` cross-origin filter), navigation to a different
 * origin tears down the secure-channel transport but keeps the DappSession
 * record in storage. On reconnect (from any tab on the playground origin), the
 * canonical flow (`handleDiscovery`'s returning-session auto-approve in
 * `background.ts`) auto-approves discover and re-pops verify (since
 * `trustedVerification=false` for the default `approveVerify` fixture path).
 *
 * Same-origin SPA hash navigations do NOT terminate (per the upstream PR #56
 * comment block in `background.ts`); only true cross-origin navs do.
 */
test.skipIf(!hasConfig)(
	"session-tabNavigate — cross-origin nav auto-approves discover, re-pops verify",
	{ timeout: 90_000 },
	async ({ registeredExtensionPerTest }) => {
		// First connect on the playground origin
		const dappPage = await openPlayground(registeredExtensionPerTest)
		const discoverP = waitForPopup(registeredExtensionPerTest, "discover", { timeout: 30_000 })
		await clickByTestId(dappPage, "pg-btn-connect")
		await approveDiscover(await discoverP)
		const verifyPage = await waitForPopup(registeredExtensionPerTest, "verify", { timeout: 30_000 })
		await approveVerify(verifyPage)
		await dappPage.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 20_000 })

		// Navigate the same tab to a REAL cross-origin destination the guard can
		// SEE: the aztec node reached via 127.0.0.1 (an explicit host_permissions
		// grant, so changeInfo.url is delivered; match patterns ignore ports).
		// This used to be about:blank, where Chrome withholds changeInfo.url and
		// the guard's cross-origin branch never executed — the transport died only
		// via realm teardown and the test was blind to the guard it cites. A
		// localhost destination would be equally blind (see the visibility pin
		// below); 127.0.0.1:<node-port> is cross-origin vs the playground AND
		// URL-visible, so the guard branch runs for real.
		if (!aztecConfig) throw new Error("unreachable: guarded by skipIf(!hasConfig)")
		const nodePort = new URL(aztecConfig.nodeUrl).port
		await dappPage.goto(`http://127.0.0.1:${nodePort}/status`, { waitUntil: "domcontentloaded" })

		// Open a fresh playground tab to reconnect. Snapshot existing targets so we
		// can assert no NEW discover popup opened during the reconnect window.
		const dappPage2 = await openPlayground(registeredExtensionPerTest)
		const targetsBeforeReconnect = registeredExtensionPerTest.browser.targets().map((t) => t.url())

		// Reconnect: discover should auto-approve, verify should re-pop.
		const verifyP2 = waitForPopup(registeredExtensionPerTest, "verify", { timeout: 30_000 })
		await clickByTestId(dappPage2, "pg-btn-connect")
		const verifyPage2 = await verifyP2
		await approveVerify(verifyPage2)
		await dappPage2.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 20_000 })

		// Sanity: no NEW discover popup target opened between the snapshot and now.
		const targetsAfterReconnect = registeredExtensionPerTest.browser.targets().map((t) => t.url())
		const newDiscoverTargets = targetsAfterReconnect.filter(
			(url) => url.includes("#/windows/discover") && !targetsBeforeReconnect.includes(url),
		)
		expect(newDiscoverTargets).toEqual([])

		await dappPage.close()
		await dappPage2.close()
	},
)

/**
 * Two-sided empirical pin for the origin guard's URL-visibility rule (see the
 * `wireTabLifecycle` header in `wallet-sdk/tab-lifecycle.ts`). With NO "tabs"
 * permission, `changeInfo.url` is delivered ONLY when the tab's new URL matches
 * an explicit `host_permissions` grant — the content script's all-URLs
 * `matches` pattern does NOT count (tabs-API scrubbing checks explicit hosts,
 * not scriptable hosts; this pin originally asserted the opposite and Chrome
 * falsified it).
 *
 * Leg 1 (delivered): navigate to 127.0.0.1 (explicit grant; match patterns
 * ignore ports) → the URL arrives, and its event captures the tab's id.
 * Leg 2 (withheld): navigate the SAME tab to a localhost origin (no grant) →
 * status events still flow for that tab, but no event satisfies the guard's
 * own `status === "loading" && url` predicate with the localhost URL — the
 * guard's cross-origin branch is genuinely dead for ordinary web origins.
 * If a manifest change ever alters either grant class, one leg reds.
 */
test.skipIf(!hasConfig)(
	"tabs.onUpdated url visibility — delivered for host-permitted 127.0.0.1, withheld for localhost",
	{ timeout: 60_000 },
	async ({ registeredExtensionPerTest }) => {
		if (!aztecConfig) throw new Error("unreachable: guarded by skipIf(!hasConfig)")
		const dappPage = await openPlayground(registeredExtensionPerTest)

		// An extension page records the SAME event stream the guard listens on.
		const popup = await openPopup(registeredExtensionPerTest)
		await popup.evaluate(() => {
			const w = window as unknown as { __navEvents: Array<{ tabId: number; status?: string; url?: string }> }
			w.__navEvents = []
			chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
				w.__navEvents.push({ tabId, status: changeInfo.status, url: changeInfo.url })
			})
		})

		const nodePort = new URL(aztecConfig.nodeUrl).port
		const permittedOrigin = `http://127.0.0.1:${nodePort}`
		const unpermittedOrigin = new URL(aztecConfig.nodeUrl).origin

		// Leg 1: host-permitted destination → changeInfo.url is delivered.
		await dappPage.goto(`${permittedOrigin}/status`, { waitUntil: "domcontentloaded" })
		const dappTabIdHandle = await popup.waitForFunction(
			(origin: string) => {
				const w = window as unknown as { __navEvents?: Array<{ tabId: number; url?: string }> }
				const hit = (w.__navEvents ?? []).find((e) => e.url?.startsWith(origin))
				return hit ? hit.tabId : false
			},
			{ timeout: 15_000 },
			permittedOrigin,
		)
		const dappTabId = (await dappTabIdHandle.jsonValue()) as number

		// Leg 2: same tab, localhost destination (covered by neither "tabs" nor
		// host_permissions) → events flow, but the URL is withheld.
		const marker = await popup.evaluate(() => {
			const w = window as unknown as { __navEvents: unknown[] }
			return w.__navEvents.length
		})
		await dappPage.goto(`${unpermittedOrigin}/status`, { waitUntil: "domcontentloaded" })
		// The tab's events for this navigation did arrive (status flows without
		// any URL grant)…
		await popup.waitForFunction(
			(tabId: number, from: number) => {
				const w = window as unknown as { __navEvents?: Array<{ tabId: number; status?: string }> }
				return (w.__navEvents ?? []).slice(from).some((e) => e.tabId === tabId && e.status !== undefined)
			},
			{ timeout: 15_000 },
			dappTabId,
			marker,
		)
		// …but none satisfies the guard's own firing predicate with the localhost
		// URL: the cross-origin branch cannot run for an ordinary origin.
		const leakedUrls = await popup.evaluate(
			(tabId: number, from: number, origin: string) => {
				const w = window as unknown as { __navEvents: Array<{ tabId: number; status?: string; url?: string }> }
				return w.__navEvents
					.slice(from)
					.filter((e) => e.tabId === tabId && e.status === "loading" && e.url?.startsWith(origin))
					.map((e) => e.url)
			},
			dappTabId,
			marker,
			unpermittedOrigin,
		)
		expect(leakedUrls).toEqual([])

		await popup.close()
		await dappPage.close()
	},
)
