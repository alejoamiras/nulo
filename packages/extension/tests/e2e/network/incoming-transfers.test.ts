import { inject } from "vitest"
import { test } from "../fixtures/extension"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Network e2e for IncomingTransferService — surfaces decrypted notes
 * arriving on the user's account from known fungible-token contracts.
 *
 * Three scenarios called out by the post-impl codex audit:
 *
 *   1. **Faucet drip name regression** — the in-flight card title and
 *      the settled card title both show the user's actual call name
 *      (`drip_to_private`), not the wallet-injected fee call
 *      (`sponsor_unconditionally`). Verifies F4's unified
 *      `pickPrimaryMethod` helper across the 7 sites at runtime.
 *
 *   2. **A→B incoming receive** — sender A transfers fungible tokens
 *      to receiver B; B's History page shows an incoming "Received"
 *      row with the correct amount + token symbol within the poll
 *      window (default 30s). First receive from an unknown contract
 *      goes through the trust prompt; user Allow → record visible.
 *      Second receive from the same trusted contract auto-displays
 *      without a second prompt.
 *
 *   3. **Self-mint dedupe** — user calls a faucet drip; the
 *      `mint_to_private` note that lands on their own account does
 *      NOT surface as an incoming receive. The dedupe pipeline
 *      catches it via the outgoing-tx-hash match.
 *
 * IMPLEMENTATION STATUS:
 *
 * These tests are skeleton-skipped (`test.skipIf(true)`) until the
 * supporting fixtures are wired. They require:
 *   - A faucet-style contract that exposes a `drip_to_private` call
 *     wrapped by `sponsor_unconditionally`. Could leverage the
 *     `packages/faucet` package's contract bindings.
 *   - A two-account same-PXE setup (or two extension instances on the
 *     same sandbox) to drive A→B transfers and observe receiver state.
 *   - Polling helper for the activity-feed assertion within the
 *     30s poll cadence of `IncomingTransferService`.
 *
 * Logged as a tracked follow-up in
 * `implementations-plan/onboarding-fees-history-arc/lessons/phase-4.md`
 * under "Network e2e for incoming receives." A future PR fills in the
 * test bodies + flips `skipIf(true)` to `skipIf(!hasConfig)`.
 */
test.skipIf(true)(
	"faucet drip — in-flight title equals settled title (F4 7-site unification regression)",
	{ timeout: 90_000 },
	async () => {
		// Pseudocode:
		//   const playground = await openPlayground(dappConnectedExtension)
		//   await mintPublicTokensForAccount(...) // pre-mint for the drip
		//   await clickByTestId(playground, "pg-btn-faucet-drip")
		//   await waitForPopup(extension, "execute"); approveExecute(...)
		//   const walletPopup = await openPopup(extension)
		//   const inFlightTitle = await readByTestId(walletPopup, "tx-card-title")
		//   expect(inFlightTitle).toBe("Drip to private")
		//   await waitForTxConfirmation(walletPopup, ...)
		//   const settledTitle = await readByTestId(walletPopup, "tx-card-title")
		//   expect(settledTitle).toBe(inFlightTitle)
		void hasConfig
	},
)

test.skipIf(true)(
	"A→B incoming receive — receiver B sees 'Received' row + first-receive friction popup",
	{ timeout: 180_000 },
	async () => {
		// Pseudocode:
		//   const senderExt = await freshExtensionWithProfile()
		//   const receiverExt = await freshExtensionWithProfile()
		//   const senderAccount = await readActiveAccount(senderExt)
		//   const receiverAccount = await readActiveAccount(receiverExt)
		//   await mintPrivateTokensForAccount(aztecConfig!, senderAccount)
		//   await registerSameTokenOn(senderExt, receiverExt)
		//   // Sender drives a transfer to receiver
		//   await sendTransfer(senderExt, {
		//     tokenId, recipient: receiverAccount, amount: 100n,
		//   })
		//   await waitForTxConfirmation(senderExt, ...)
		//   // Receiver: history feed should NOT show the row yet (pending trust)
		//   const receiverPopup = await openPopup(receiverExt)
		//   await waitForSelectorAbsent(receiverPopup, '[data-testid="tx-incoming-card"]', { timeout: 35_000 })
		//   // First-receive friction popup should be open
		//   await waitForSelector(receiverPopup, '[data-testid="incoming-trust-contract"]')
		//   await clickByTestId(receiverPopup, "incoming-trust-allow")
		//   // Now the row appears
		//   await waitForSelector(receiverPopup, '[data-testid="tx-incoming-card"]')
		//   // Second receive from the same contract — no popup, auto-display
		//   await sendTransfer(senderExt, { tokenId, recipient: receiverAccount, amount: 50n })
		//   await waitForTxConfirmation(senderExt, ...)
		//   const cards = await countByTestId(receiverPopup, "tx-incoming-card")
		//   expect(cards).toBeGreaterThanOrEqual(2)
		//   expect(popupStillOpened(receiverPopup, "incoming_trust")).toBe(false)
		void hasConfig
	},
)

test.skipIf(true)("self-mint dedupe — faucet drip does NOT surface as incoming on the sender", { timeout: 90_000 }, async () => {
	// Pseudocode:
	//   const ext = await freshExtensionWithProfile()
	//   await drivePlaygroundDrip(ext, tokenAddress, account)
	//   await waitForTxConfirmation(ext, ...)
	//   // After confirmation, the mint note is in PXE for this account.
	//   // IncomingTransferService's dedupe (3-source: prior records,
	//   // outgoing tx hash match, in-flight journal txHash) must catch
	//   // it — txHash matches the outgoing tx record's hash so the
	//   // late-delete reconciliation kicks in even if PXE saw the
	//   // note before TransactionService.addTransaction landed.
	//   const popup = await openPopup(ext)
	//   await waitForBalance(popup, "100", 60_000) // mint completed
	//   await waitFor(() => readAccount(popup).then(a => a.incomingCount === 0), 35_000)
	//   const cards = await countByTestId(popup, "tx-incoming-card")
	//   expect(cards).toBe(0)
	void hasConfig
})

test.skipIf(true)(
	"visibility-off escape hatch — toggle off blocks live incoming events on a mounted page",
	{ timeout: 120_000 },
	async () => {
		// Pseudocode:
		//   const ext = await freshExtensionWithProfile()
		//   const receiverAccount = await readActiveAccount(ext)
		//   await registerTokenAndTrust(ext, tokenAddress)
		//   // Flip the toggle off via Settings → Appearance
		//   const settings = await openPopup(ext)
		//   await navigate(settings, "/popup/settings/appearance")
		//   await clickByTestId(settings, "appearance-incomingTransfersVisible-toggle")
		//   // Drive an external transfer to receiverAccount
		//   await sendTransferFromOtherAccount(...)
		//   await waitForTxConfirmation(...)
		//   // Receiver's History page must not show the row
		//   const popup = await openPopup(ext)
		//   await navigate(popup, "/popup/activity")
		//   await waitForSelectorAbsent(popup, '[data-testid="tx-incoming-card"]', { timeout: 35_000 })
		//   // Flip toggle back on: row appears via reload
		//   await navigate(popup, "/popup/settings/appearance")
		//   await clickByTestId(popup, "appearance-incomingTransfersVisible-toggle")
		//   await navigate(popup, "/popup/activity")
		//   await waitForSelector(popup, '[data-testid="tx-incoming-card"]')
		void hasConfig
	},
)
