import type { Page } from "puppeteer"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { openPopup, test, waitForHash } from "../fixtures/extension"
import { ensureUnlocked, readLivenessBaseline, stopServiceWorker, waitForWorkerLiveness } from "../fixtures/helpers"
import { clickPgButton, openPlayground } from "../fixtures/playground"
import { approveDiscover, approveVerify, waitForPopup } from "../fixtures/popups"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

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
		// Pre-kill baseline BY NECESSITY: no extension page may be touched between
		// the kill and the discovery click (the click must be the first wake), so
		// there is nowhere to read a post-stop value. The old worker's last tick
		// can land in the window before the kill; the 60s wait absorbs it.
		const baseline = await readLivenessBaseline(popupPage)
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
		await waitForWorkerLiveness(probe, baseline, { timeoutMs: 60_000 })

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
