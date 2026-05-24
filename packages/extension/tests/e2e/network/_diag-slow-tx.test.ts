import { inject } from "vitest"
import { test, openPopup, clickByTestId } from "../fixtures/extension"
import { openPlayground, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveDiscover, approveVerify, approveCapabilities, approveExecute } from "../fixtures/popups"
import { dumpProbes } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Diagnostic test — captures probe traces for the two persistently slow
 * network tests (`multi-account-from`, `tx-sendTx-multicall`).
 *
 * Reproduces enough of each test's flow to drive the slow path, then dumps
 * the wallet-side probe trace (via dumpProbes) on either pass or fail.
 *
 * Probes are gated by VITE_E2E_PROBE=1 (set in agent.sh during this run).
 * Run explicitly via: `bun run e2e:agent tests/e2e/network/_diag-slow-tx.test.ts`.
 *
 * **TEMPORARY** — deleted at Phase C.3 of the network-followups plan.
 */
test.skipIf(!hasConfig)(
	"diag-slow-tx — captures probe trace for multicall sendTx + multi-from sendTx",
	{ timeout: 600_000 },
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
			console.log("[DIAG] connect OK")

			// Step 2: grant accounts + execute capabilities
			try {
				const capPopupP = waitForPopup(registeredExtensionPerTest, "capabilities", { timeout: 15_000 })
				const seqGrant = await snapshotResultSeq(dappPage)
				// Select bundle "send" which includes accounts + execute caps
				await dappPage.evaluate(() => {
					const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')
					if (select) {
						select.value = "send"
						select.dispatchEvent(new Event("change", { bubbles: true }))
					}
				})
				await clickByTestId(dappPage, "pg-btn-requestCapabilities")
				const capPopup = await capPopupP
				await approveCapabilities(capPopup, {})
				await waitForPgResult(dappPage, "requestCapabilities", seqGrant, 30_000)
				console.log("[DIAG] requestCapabilities OK")
			} catch (err) {
				console.log(`[DIAG] requestCapabilities FAILED: ${err instanceof Error ? err.message : String(err)}`)
			}

			// Step 3: trigger sendTx-multicall (the slowest known case)
			try {
				const seqMulti = await snapshotResultSeq(dappPage)
				const execPopupP = waitForPopup(registeredExtensionPerTest, "execute", { timeout: 20_000 })
				await clickByTestId(dappPage, "pg-btn-sendTx-multicall-chunked")
				const execPopup = await execPopupP
				await approveExecute(execPopup)
				await waitForPgResult(dappPage, "sendTx", seqMulti, 240_000)
				console.log("[DIAG] sendTx-multicall-chunked OK")
			} catch (err) {
				console.log(`[DIAG] sendTx-multicall-chunked FAILED: ${err instanceof Error ? err.message : String(err)}`)
			}

			// Step 4: trigger sendTx-default (multi-account-from's flow)
			try {
				const seqDefault = await snapshotResultSeq(dappPage)
				const execPopupP = waitForPopup(registeredExtensionPerTest, "execute", { timeout: 20_000 })
				await clickByTestId(dappPage, "pg-btn-sendTx-default")
				const execPopup = await execPopupP
				await approveExecute(execPopup)
				await waitForPgResult(dappPage, "sendTx", seqDefault, 120_000)
				console.log("[DIAG] sendTx-default OK")
			} catch (err) {
				console.log(`[DIAG] sendTx-default FAILED: ${err instanceof Error ? err.message : String(err)}`)
			}
		} finally {
			// Dump probes regardless of which step failed.
			await dumpProbes(popupPage, "slow-tx")
		}
	},
)
