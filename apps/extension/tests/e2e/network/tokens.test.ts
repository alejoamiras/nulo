import { expect, inject } from "vitest"
import { test, openPopup, waitForHash } from "../fixtures/extension"
import { importToken } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

test.skipIf(!hasConfig)("import token by contract address", { timeout: 120_000 }, async ({ localNetworkExtension }) => {
	const page = await openPopup(localNetworkExtension)
	await waitForHash(page, "#/popup/general")

	await importToken(page, aztecConfig!.tokenAddress)

	// The token card renders `token.symbol` ("TST"), not the full name
	await page.waitForSelector('[data-testid="token-symbol"][data-symbol="TST"]', {
		visible: true,
		timeout: 30_000,
	})

	// Regression guard for the balance-0-flash bug: by the time the popup's
	// "Token added" toast has fired, the active account's TB must be synced
	// (or the popup hit its 30s timeout). In either case the TokenCard's
	// loading skeleton (Layer A) must NOT still be on screen for our row.
	await page.waitForFunction(
		(symbol: string) => {
			const symbolNode = [...document.querySelectorAll('[data-testid="token-symbol"]')].find(
				(el) => (el as HTMLElement).dataset.symbol === symbol,
			)
			if (!symbolNode) return false
			const card = symbolNode.closest('[data-testid="tokens-card"]')
			if (!card) return false
			return !card.querySelector('[data-testid="token-balance-loading"]')
		},
		{ timeout: 30_000 },
		"TST",
	)

	// Phase 2.5 regression guard. The journal-backed TokenImportRow lives in
	// the tokens view and MUST disappear once the import succeeds — otherwise
	// either the FSM never transitioned to `succeeded` or the row's
	// in-flight/recently-failed filter is broken.
	const importRow = await page.$('[data-testid="token-import-row"]')
	expect(importRow).toBeNull()
})
