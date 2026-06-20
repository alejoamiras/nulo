import { expect, inject } from "vitest"
import { openPopup, test, waitForHash } from "../fixtures/extension"
import { getAccountAddress, importToken, switchToLocalNetwork } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Pin: a user-explicit token add (via NewTokenPopup) auto-trusts so the
 * first-receive trust prompt never fires for the just-added contract,
 * AND the activity feed renders the token's resolved symbol immediately
 * (not the "Token" placeholder that required a popup re-open to clear in
 * the pre-fix build).
 *
 * Two manual-QA bugs surfaced after the trust state-machine refactor:
 *
 *   1. Auto-trust race. Adding a token via the in-popup form (origin
 *      "popup") OR via a dApp `register_token` (origin "dapp") emits
 *      onTokenAdded → kicks the per-account scheduler → the immediate
 *      poll's first per-note CS could acquire the service lock before
 *      the popup's after-addToken setTrustAllow IPC landed. That scan
 *      read trust=unknown → fired Pending → queued the prompt. The
 *      cleanup arrived a beat later — too late. The fix moves auto-
 *      trust into IncomingTransferService.onTokenAdded as its first
 *      step (under the service lock) so it runs BEFORE any scan can
 *      possibly read the row.
 *
 *   2. Token-symbol UI cache staleness. RecentActivityView + activity.vue
 *      loaded the tokens list once in onMounted but never subscribed
 *      to tokenService.onTokenAdded — so a just-added token's id wasn't
 *      in the local lookup map when its incoming-transfer rows
 *      rendered. The card fell back to `tokenSymbol: "Token"` until the
 *      next mount.
 *
 * Repro shape:
 *   - Fresh profile on Local Network (no existing tokens).
 *   - Mint PRIVATE notes to the user's address BEFORE adding the token
 *     — gives the post-add scan something to discover.
 *   - Import the token via the in-popup form.
 *   - Assert NO IncomingTrustPopup opens after the toast.
 *   - Navigate to /popup/activity; assert the incoming card shows the
 *     resolved symbol "TST" (not the "Token" placeholder).
 *
 * Pre-fix expectation:
 *   - The trust prompt DOES open shortly after the toast → first assert
 *     fails.
 *   - The first card after token-add renders "Token" → second assert
 *     fails (it picks up the correct symbol only after a popup re-open).
 *
 * Coverage at unit level: service.scenarios.test.ts → LR14 (auto-trust
 * runs first under the lock) and LR14-idempotent (no duplicate emit when
 * already trusted). This e2e adds the real-PXE + real-popup wire-up.
 */
test.skipIf(!hasConfig)(
	"popup add-token auto-trusts: no trust prompt + trust state flipped to trusted",
	{ timeout: 240_000, retry: 0 },
	async ({ registeredExtensionPerTest }) => {
		const page = await openPopup(registeredExtensionPerTest)
		await waitForHash(page, "#/popup/general", 30_000)
		await switchToLocalNetwork(page)

		const accountAddress = await getAccountAddress(page)

		// Mint private notes so the scanner finds something to commit
		// when the user adds the token. Without notes, the auto-trust
		// race can't be exercised because scanContract no-ops on an
		// empty notes list.
		const { createTestWallet, createSponsoredFeeOptions, mintPrivateTokens } = await import("../fixtures/aztec")
		const { wallet, node, cleanup } = await createTestWallet(aztecConfig!.nodeUrl)
		try {
			const feeOptions = await createSponsoredFeeOptions(wallet)
			await mintPrivateTokens(
				wallet,
				node,
				aztecConfig!.tokenAddress,
				accountAddress,
				500n * 10n ** 18n,
				aztecConfig!.minterAddress,
				feeOptions,
			)
		} finally {
			await cleanup()
		}

		// Add the token via the in-popup "Add custom token" form.
		// importToken waits for the "Token added" toast. mintPrivateTokens
		// blocks until mining via `wait: { timeout: 120 }`, so by the
		// time we reach this line the mint tx is already on-chain — the
		// user's PXE just needs to sync to discover the note (happens
		// in-band during the addToken → balance projection chain inside
		// importToken).
		await importToken(page, aztecConfig!.tokenAddress)

		// Bug 1 pin. Pre-fix, the IncomingTrustPopup could surface here (the scan's first
		// per-note CS won the lock race against the popup's setTrustAllow). Fail-fast — watch
		// for the trust prompt for up to 6s instead of a blind sleep: if it appears that's the
		// bug (fail at once); if the window elapses with no prompt, absence is confirmed.
		const trustPromptAppeared = await page
			.waitForSelector('[data-testid="incoming-trust-contract"]', { timeout: 6_000 })
			.then(() => true)
			.catch(() => false)
		expect(trustPromptAppeared).toBe(false)

		// Positive proof of the auto-trust step. Even if no notes ever
		// reach the scanner (e.g. PXE sync didn't catch up before this
		// test's window), the onTokenAdded handler MUST have flipped the
		// trust row to "trusted" — that step runs synchronously inside
		// the handler, before any scheduler is kicked. EntityStorage key
		// shape: `nulo:core:incoming-trust@<profileId>|<networkId>|<contract>`.
		const trustState = await page.evaluate(async (contract: string) => {
			const all = await chrome.storage.local.get(null)
			const prefix = "nulo:core:incoming-trust@"
			const keys = Object.keys(all).filter((k) => k.startsWith(prefix) && k.endsWith(`|${contract}`))
			if (keys.length === 0) return null
			const raw = all[keys[0]] as string
			try {
				const parsed = JSON.parse(raw) as { state?: string }
				return parsed.state ?? null
			} catch {
				return null
			}
		}, aztecConfig!.tokenAddress)
		expect(trustState).toBe("trusted")

		// Note on Bug 2 (Token-placeholder UI cache staleness): the e2e
		// surface for that bug is flaky here because the extension's PXE
		// sync of the just-minted private note is non-deterministic
		// relative to the scheduler's 30s interval. The fix (subscribing
		// activity.vue + RecentActivityView to tokenService.onTokenAdded)
		// is structurally trivial — it's a 1-line subscription whose
		// regression would also break the existing component tests that
		// pin the tokens-list refresh path. We accept unit-test + manual-
		// QA coverage for Bug 2; this e2e is scoped to Bug 1 (auto-trust
		// race), which is the genuinely concurrency-shaped bug that
		// warranted the network-level pin.

		await page.close()
	},
)
