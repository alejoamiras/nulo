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
 * Run solo: `bun run e2e:agent tests/e2e/network/imported-account-execution.test.ts`.
 */
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { clickByTestId, launchExtension, openPopup, registerProfile, test, waitForHash } from "../fixtures/extension"
import {
	getAccountAddress,
	importToken,
	navigateByHash,
	sendTransfer,
	switchAccountByAddress,
	switchToLocalNetwork,
	waitForToast,
	waitForTxConfirmation,
} from "../fixtures/helpers"
import { exportAccountBody, previewImport } from "../helpers/account-io"

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
			await clickByTestId(page, "import-account-submit")
			await waitForToast(page, "Account imported")

			// Operate AS the imported account: back on the home screen (the tokens menu and the
			// account selector live there — previewImport parked us on manage-accounts), register
			// the token, switch.
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
