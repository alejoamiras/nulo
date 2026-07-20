/**
 * THE behavioral pin for the contacts↔sender decoupling: a PRIVATE
 * transfer from an external sender the wallet has NEVER seen — not a
 * contact, provably not a registered sender — is discovered and credited.
 *
 * Why this holds at the 5.0.x line: the bundled token
 * (@aztec-foundation/aztec-standards) delivers private balance notes via
 * `onchain_constrained` MessageDelivery, which is handshake-backed by
 * construction — the first send publishes a non-interactive handshake
 * under a tag derived from the RECIPIENT's address alone, so the
 * recipient's PXE needs no sender registration to find it. This test
 * turns that source-level claim into a live-network invariant.
 *
 * REQUIRED ship gate for implementations-plan/contacts-sender-decouple —
 * do not .todo or soften; a red here means the decoupling's premise broke.
 */
import { expect, inject } from "vitest"
import { test, openPopup, waitForHash } from "../fixtures/extension"
import { getTokenDetailBalances, navigateByHash, navigateToTokenDetail, refreshBalances } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/** Assert the Advanced senders surface lists ZERO registrations.
 *  Hash hop (not navigateToSettings): callers arrive from sub-pages,
 *  which render no bottom nav for clickNavTab to find. */
async function assertNoSendersRegistered(page: Awaited<ReturnType<typeof openPopup>>) {
	await navigateByHash(page, "#/popup/settings/advanced/account-state/senders")
	await page.waitForSelector('[data-testid="senders-add-btn"]', { visible: true, timeout: 10_000 })
	const senderRows = await page.evaluate(() => document.querySelectorAll('[data-testid="sender-row"]').length)
	expect(senderRows).toBe(0)
}

test.skipIf(!hasConfig)(
	"private transfer from an UNREGISTERED external sender is discovered (handshake delivery)",
	{ timeout: 600_000 },
	async ({ tokenReadyExtension }) => {
		if (!aztecConfig) throw new Error("unreachable — skipIf guards")
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")

		// ── Pre-assert: exact zero senders, immediately before the transfer.
		await assertNoSendersRegistered(page)

		// ── Baseline: the fixture minted PUBLIC tokens only; private is 0.
		await navigateByHash(page, "#/popup/general")
		await page.waitForSelector('[data-testid="tokens-card"]', { visible: true, timeout: 30_000 })
		await navigateToTokenDetail(page)
		const before = await getTokenDetailBalances(page)
		expect(before.privateBalance.replace(/[,\s]/g, "")).toBe("0")

		// ── Node-side: an external account (the minter — never a contact,
		//    never registered) receives private funds and privately transfers
		//    25 to the extension account. Real prove + inclusion, both txs.
		const AMOUNT = 25n * 10n ** 18n
		const { createTestWallet, createSponsoredFeeOptions, mintPrivateTokens, transferPrivateTokens } = await import("../fixtures/aztec")
		let walletCleanup: (() => Promise<void>) | undefined
		try {
			const { wallet, node, cleanup } = await createTestWallet(aztecConfig.nodeUrl)
			walletCleanup = cleanup
			const feeOptions = await createSponsoredFeeOptions(wallet)
			await mintPrivateTokens(
				wallet,
				node,
				aztecConfig.tokenAddress,
				aztecConfig.minterAddress,
				AMOUNT,
				aztecConfig.minterAddress,
				feeOptions,
			)
			await transferPrivateTokens(
				wallet,
				node,
				aztecConfig.tokenAddress,
				aztecConfig.minterAddress,
				tokenReadyExtension.accountAddress,
				AMOUNT,
				feeOptions,
			)
		} finally {
			await walletCleanup?.()
		}
		console.log("✓ External unregistered sender privately transferred 25 tokens")

		// ── Wallet-side: the note is discovered with ZERO registrations.
		//    Poll refresh (each refresh advances the extension PXE's sync).
		await navigateByHash(page, "#/popup/general")
		await page.waitForSelector('[data-testid="tokens-card"]', { visible: true, timeout: 30_000 })
		let discovered = false
		for (let i = 0; i < 60 && !discovered; i++) {
			await refreshBalances(page)
			await page
				.waitForFunction(() => document.body.innerText.includes("1,025"), { timeout: 2_000, polling: 200 })
				.then(() => {
					discovered = true
				})
				.catch(() => {})
		}
		expect(discovered).toBe(true)

		// ── Exact private-balance delta on the token detail breakdown.
		await navigateToTokenDetail(page)
		const after = await getTokenDetailBalances(page)
		expect(after.privateBalance.replace(/[,\s]/g, "")).toBe("25")
		expect(after.publicBalance.replace(/[,\s]/g, "")).toBe("1000")
		console.log("✓ Private balance delta exact: 0 → 25, discovered without any sender registration")

		// ── Post-assert: discovery did not depend on (or create) a wallet-side
		//    sender registration.
		await assertNoSendersRegistered(page)
	},
)
