/**
 * Imported-account EXECUTION — the end-to-end proof of the credential-rooted imported-key chain
 * on a live sandbox, prover-ON.
 *
 * Nothing else executes with a FILE-imported account: `account-import-export.test.ts` proves the
 * file round-trips (address re-derivation), and the unit/integration layers prove sealing —
 * but "the stored ciphertext, unsealed under the profile DEK, reconstructs a signing key that a
 * real node accepts a REAL-proved transaction from" only falls out of doing exactly that:
 *
 *   1. Browser 1 (profile A, token-ready): A executes one self-transfer — its FIRST tx, which
 *      runs the frozen ctor via the deploy path and leaves the account contract DEPLOYED. Then
 *      A's account is exported to a NULO-ACCOUNT-EXPORT file body.
 *   2. Browser 2 (profile B, a DIFFERENT master): imports the file — the signing key is sealed
 *      under B's DEK, the row is B's — switches to the imported account, and self-transfers.
 *      That signature comes from the unsealed imported key; simulate, REAL proof, node
 *      acceptance, confirmed activity row.
 *
 * A executes FIRST on purpose: the imported account's tx in B is then a post-deploy tx, so this
 * file proves the DEK→unseal→sign chain in isolation rather than compounding it with the
 * cross-PXE lazy-deploy path (its own surface, covered by the canaries for derived accounts).
 *
 * The SECOND test is the PASSKEY variant. A passkey profile's DEK is sealed under the
 * PRF-derived wrap key, not a passhash — and account EXPORT is password-gated by design, so the
 * re-export-preview probe the smoke suites use cannot exist for passkey profiles. Execution is
 * therefore the ONLY end-to-end proof of the passkey-rooted imported-key chain: PRF ceremony →
 * wrap key → DEK unseal → row unseal → sign → real proof → mined. The import additionally
 * survives a full lock → ceremony-unlock cycle before signing, so the row is proven against a
 * RE-unsealed DEK, not the still-warm session that imported it. FTN discipline applies (see the
 * canary): every ceremony runs on the anchor popup, which stays open for the whole test.
 *
 * Run solo: `bun run e2e:agent tests/e2e/network/imported-account-execution.test.ts`.
 */
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { clickByTestId, launchExtension, openPopup, registerProfile, test, waitForHash } from "../fixtures/extension"
import {
	getAccountAddress,
	importToken,
	lockWallet,
	navigateByHash,
	sendTransfer,
	switchAccountByAddress,
	switchToLocalNetwork,
	waitForTxConfirmation,
} from "../fixtures/helpers"
import { registerPasskeyProfile, setupPasskeyVirtualAuth } from "../fixtures/passkey"
import { confirmImport, exportAccountBody, previewImport } from "../helpers/account-io"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

test("agent-runner contract: a live sandbox must be configured (no false skip)", () => {
	if (process.env.E2E_REQUIRE_SETUP === "1") {
		expect(hasConfig).toBe(true)
	}
})

test.skipIf(!hasConfig)(
	"a file-imported account signs, proves, and lands a transfer in a DIFFERENT profile",
	{ timeout: 900_000 },
	async ({ tokenReadyExtension }) => {
		// ── Stage 1: profile A deploys itself with one self-transfer, then exports the account ──
		const sourceAddress = tokenReadyExtension.accountAddress
		let accountFile: string
		{
			const page = await openPopup(tokenReadyExtension)
			await waitForHash(page, "#/popup/general", 30_000)
			await sendTransfer(page, { fromType: "public", toType: "public", amount: "10", destination: sourceAddress })
			await waitForTxConfirmation(page, { amount: "10", fromType: "public", toType: "public" })
			console.log("✓ Source account deployed via its first self-transfer")

			accountFile = await exportAccountBody(page, "Account", false)
			expect(accountFile.trim().startsWith("{")).toBe(true)
			await page.close()
		}

		// ── Stage 2: profile B (its own master) imports the file and EXECUTES with it ──
		const target = await launchExtension()
		try {
			await registerProfile(target)
			const page = await openPopup(target)
			await waitForHash(page, "#/popup/general", 30_000)
			await switchToLocalNetwork(page)

			// B's own derived account differs from A's — the import is genuinely foreign.
			const ownAddress = await getAccountAddress(page)
			expect(ownAddress).not.toBe(sourceAddress)

			const previewed = await previewImport(page, accountFile)
			expect(previewed).toBe(sourceAddress)
			await confirmImport(page)

			// Operate AS the imported account: back on the home screen (the tokens menu and the
			// account selector live there), register the token, switch.
			await navigateByHash(page, "#/popup/general", 15_000)
			await importToken(page, aztecConfig!.tokenAddress)
			await switchAccountByAddress(page, sourceAddress)

			// The signature under this transfer comes from the imported key, unsealed from B's
			// DEK-rooted row. Real proof, node acceptance, confirmed row — no tolerated failure.
			await sendTransfer(page, { fromType: "public", toType: "public", amount: "5", destination: sourceAddress })
			await waitForTxConfirmation(page, { amount: "5", fromType: "public", toType: "public" })
			console.log("✓ Imported account executed a real-proved transfer in the second profile")

			expect(target.pageErrors.filter((e) => !e.message.includes("Client disconnected"))).toEqual([])
		} finally {
			await target.browser.close()
		}
	},
)

test.skipIf(!hasConfig)(
	"a PASSKEY profile imports the account, survives a ceremony re-unlock, and executes with it",
	{ timeout: 900_000 },
	async ({ tokenReadyExtension }) => {
		// ── Stage 1: export the token-ready source account (fresh export; idempotent). When this
		// file runs whole, the first test already deployed A, so the imported tx below is a clean
		// post-deploy signature. Run standalone, A is undeployed and the imported tx additionally
		// carries the ctor — a broader pass, never a false one. ──
		const sourceAddress = tokenReadyExtension.accountAddress
		let accountFile: string
		{
			const page = await openPopup(tokenReadyExtension)
			await waitForHash(page, "#/popup/general", 30_000)
			accountFile = await exportAccountBody(page, "Account", false)
			expect(accountFile.trim().startsWith("{")).toBe(true)
			await page.close()
		}

		// ── Stage 2: a PASSKEY profile (PRF ceremony on the anchor popup) imports the file ──
		const target = await launchExtension()
		try {
			const anchorPopup = await openPopup(target)
			const auth = await setupPasskeyVirtualAuth(target.browser, anchorPopup)
			try {
				await registerPasskeyProfile(anchorPopup)
				await switchToLocalNetwork(anchorPopup)
				console.log("✓ Passkey profile registered (in-page PRF ceremony)")

				// The passkey profile's own derived account differs — the import is genuinely foreign.
				const ownAddress = await getAccountAddress(anchorPopup)
				expect(ownAddress).not.toBe(sourceAddress)

				const previewed = await previewImport(anchorPopup, accountFile)
				expect(previewed).toBe(sourceAddress)
				await confirmImport(anchorPopup)
				await anchorPopup.waitForSelector('[data-testid="account-imported-badge"]', { visible: true, timeout: 20_000 })

				// ── Stage 3: full lock → ceremony re-unlock, so the signature below comes from a
				// RE-unsealed DEK (dekSealed opened under a fresh PRF-derived wrap key), not the
				// still-warm session that imported the row. Same FTN → same credential. ──
				await navigateByHash(anchorPopup, "#/popup/general", 15_000)
				await lockWallet(anchorPopup)
				await anchorPopup.waitForSelector('[data-testid="auth-submit"]', { visible: true, timeout: 15_000 })
				await anchorPopup.waitForFunction(
					() => {
						const btn = document.querySelector<HTMLButtonElement>('[data-testid="auth-submit"]')
						return btn !== null && !btn.disabled
					},
					{ timeout: 15_000 },
				)
				await clickByTestId(anchorPopup, "auth-submit")
				await waitForHash(anchorPopup, "#/popup/general", 60_000)
				console.log("✓ Ceremony re-unlock ok (DEK re-unsealed under the PRF wrap key)")

				// ── Stage 4: execute AS the imported account — the only decrypt-proof a passkey
				// profile has (account export is password-gated by design). ──
				await importToken(anchorPopup, aztecConfig!.tokenAddress)
				await switchAccountByAddress(anchorPopup, sourceAddress)
				await sendTransfer(anchorPopup, { fromType: "public", toType: "public", amount: "3", destination: sourceAddress })
				await waitForTxConfirmation(anchorPopup, { amount: "3", fromType: "public", toType: "public" })
				console.log("✓ Imported account executed a real-proved transfer inside a passkey profile")

				expect(target.pageErrors.filter((e) => !e.message.includes("Client disconnected"))).toEqual([])
			} finally {
				await auth.cleanup()
			}
		} finally {
			await target.browser.close()
		}
	},
)
