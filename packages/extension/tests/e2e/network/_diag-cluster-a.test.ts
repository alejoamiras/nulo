import { inject } from "vitest"
import { test, openPopup, clickByTestId } from "../fixtures/extension"
import { openPlayground, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveDiscover, approveVerify, approveCapabilities } from "../fixtures/popups"
import { dumpProbes } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Diagnostic test — captures the full probe trace for cluster A.
 *
 * Drives the dApp flow manually instead of using dappConnectedExtension so
 * we can dump probes even when intermediate steps fail. Filename starts with
 * `_` so it's filterable from the suite. Will be deleted in Phase G.
 */
test.skipIf(!hasConfig)(
	"diag-cluster-a — manual dApp flow + probe dump regardless of step outcome",
	{ timeout: 180_000 },
	async ({ registeredExtensionPerTest }) => {
		const popupPage = await openPopup(registeredExtensionPerTest)
		const dappPage = await openPlayground(registeredExtensionPerTest)

		try {
			// Step 1: connect (discovery → verify → connected)
			await dappPage.waitForSelector('[data-testid="pg-btn-connect"]', { visible: true, timeout: 30_000 })
			const discoverP = waitForPopup(registeredExtensionPerTest, "discover", { timeout: 15_000 })
			await clickByTestId(dappPage, "pg-btn-connect")
			const discoverPage = await discoverP
			await approveDiscover(discoverPage)
			const verifyPage = await waitForPopup(registeredExtensionPerTest, "verify", { timeout: 15_000 })
			await approveVerify(verifyPage)
			await dappPage.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 30_000 })
			console.log("[DIAG] connect ✓")

			// Step 2: requestCapabilities (the first encrypted RPC)
			try {
				const capPopupP = waitForPopup(registeredExtensionPerTest, "capabilities", { timeout: 15_000 })
				const seq1 = await snapshotResultSeq(dappPage)
				await clickByTestId(dappPage, "pg-btn-requestCapabilities")
				const capPopup = await capPopupP
				await approveCapabilities(capPopup)
				await waitForPgResult(dappPage, "requestCapabilities", seq1, 30_000)
				console.log("[DIAG] requestCapabilities ✓")
			} catch (err) {
				console.log(`[DIAG] requestCapabilities FAILED: ${err instanceof Error ? err.message : String(err)}`)
			}

			// Step 3: a silent post-cap RPC (getChainInfo)
			try {
				const seq2 = await snapshotResultSeq(dappPage)
				await clickByTestId(dappPage, "pg-btn-getChainInfo")
				await waitForPgResult(dappPage, "getChainInfo", seq2, 30_000)
				console.log("[DIAG] getChainInfo ✓")
			} catch (err) {
				console.log(`[DIAG] getChainInfo FAILED: ${err instanceof Error ? err.message : String(err)}`)
			}
		} finally {
			// Dump probes regardless of which step failed.
			await dumpProbes(popupPage, "cluster-a")
		}
	},
)
