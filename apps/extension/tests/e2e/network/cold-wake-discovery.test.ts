import type { Page, Target } from "puppeteer"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { type ExtensionContext, openPopup, test, waitForHash } from "../fixtures/extension"
import { ensureUnlocked } from "../fixtures/helpers"
import { clickPgButton, openPlayground } from "../fixtures/playground"
import { approveDiscover, approveVerify, waitForPopup } from "../fixtures/popups"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

// Mirrors the helper in connect-locked-queue-sw-restart.test.ts. Kept inline
// rather than extracted because the SW-restart shape is the test-case under
// test. `worker().close()` + targetdestroyed-by-object-identity is the only
// verified-real kill.
async function stopServiceWorker(ext: ExtensionContext): Promise<void> {
	const swTarget = await ext.browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(ext.extensionId), {
		timeout: 15_000,
	})

	const destroyed = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			ext.browser.off("targetdestroyed", onDestroyed)
			reject(new Error("stopServiceWorker: the service-worker target was still alive 15s after close()"))
		}, 15_000)
		function onDestroyed(target: Target) {
			if (target !== swTarget) return
			clearTimeout(timer)
			ext.browser.off("targetdestroyed", onDestroyed)
			resolve()
		}
		ext.browser.on("targetdestroyed", onDestroyed)
	})

	const worker = await swTarget.worker()
	if (!worker) throw new Error("stopServiceWorker: service-worker target exposed no worker to close")
	await worker.close()
	await destroyed
}

/** Strictly-newer liveness on an extension page = the REPLACEMENT worker woke
 *  AND finished boot (the pre-kill value survives in chrome.storage.session). */
async function waitForLivenessOn(page: Page, afterTs: number): Promise<void> {
	await page.waitForFunction(
		async (priorTs: number) => {
			try {
				const result = await chrome.storage.session.get("nulo:liveness")
				return Number(result["nulo:liveness"] ?? 0) > priorTs
			} catch {
				return false
			}
		},
		{ timeout: 60_000, polling: 500 },
		afterTs,
	)
}

/**
 * Cold-wake discovery loss: a dApp's discovery message is what WAKES a dead
 * service worker — chrome dispatches it the moment the SW's top level has
 * executed, but the wallet-sdk listener registers ASYNC at the tail of
 * `runtime.start()`, so the waking message is dropped before any listener
 * exists. One click is ONE DiscoveryRequest (the SDK provider never
 * re-broadcasts), so the loss is not self-healing: the discover popup never
 * appears and the dApp times out at 60s.
 *
 * The dApp click must be the FIRST wake event after the kill — no popup is
 * opened, no extension page is touched between the kill and the click.
 */
test.skipIf(!hasConfig)(
	"cold-wake — a discovery that WAKES a dead SW still reaches the discover popup",
	{ timeout: 180_000 },
	async ({ registeredExtensionPerTest }) => {
		const ext = registeredExtensionPerTest

		// Boot + verify the wallet is up (unlocked, registered); capture the
		// liveness baseline; then close the popup page so nothing holds a client
		// connection to the SW.
		const popupPage = await openPopup(ext)
		await waitForHash(popupPage, "#/popup/general")
		const baseline = await popupPage.evaluate(async () => {
			try {
				const r = await chrome.storage.session.get("nulo:liveness")
				return Number(r["nulo:liveness"] ?? 0)
			} catch {
				return 0
			}
		})
		// Recurring alarms (the 1-minute journal reaper) could warm the worker
		// between the kill and the click and false-green the pre-fix run —
		// clear them all so the click is provably the first wake event.
		await popupPage.evaluate(async () => {
			await chrome.alarms.clearAll()
		})
		// Open the dApp page BEFORE the kill: page load injects the content
		// script but sends no runtime message, so the SW stays killable and the
		// later click is the first wake event.
		const dappPage = await openPlayground(ext)
		await popupPage.close()

		await stopServiceWorker(ext)

		// Wake isolation: the SW must be genuinely dead at click time.
		const swAlive = ext.browser.targets().some((t) => t.type() === "service_worker" && t.url().includes(ext.extensionId))
		expect(swAlive).toBe(false)

		// The connect click fires the content script's chrome.runtime.sendMessage —
		// the wake event itself. Arm the discover wait first (waiting never wakes).
		const discoverP = waitForPopup(ext, "discover", { timeout: 60_000 })
		await clickPgButton(dappPage, "connect")

		// DISCRIMINATOR: prove the replacement worker woke AND finished boot
		// (strictly-newer liveness) before judging the popup. Without this, a
		// slow cold boot could red the wait for the wrong reason. The probe
		// popup itself cannot resurrect a lost message.
		const probe = await openPopup(ext)
		await waitForLivenessOn(probe, baseline)

		// Strict security mode (default ON) means an SW kill drops the session:
		// the replayed discovery lands on a LOCKED wallet and is QUEUED, not
		// popped (the sw-resilience pins prove cold-restore never re-derives
		// the bearer). Unlock to drain the queue — pre-fix there is nothing
		// queued (the waking message was dropped before any listener existed),
		// so no popup ever appears; post-fix the relayed discovery drains here.
		await ensureUnlocked(probe)
		await probe.close()

		const discoverPage = await discoverP
		await approveDiscover(discoverPage)

		const verifyPage = await waitForPopup(ext, "verify", { timeout: 30_000 })
		await approveVerify(verifyPage)

		await dappPage.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 20_000 })

		await dappPage.close()
	},
)
