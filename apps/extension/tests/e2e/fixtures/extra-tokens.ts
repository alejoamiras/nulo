import { inject } from "vitest"
import type { AztecTestConfig } from "./aztec"
import { type ExtensionContext, openPopup, waitForHash } from "./extension"
import { importTokenAndWaitForBalance } from "./helpers"

export interface ExtraToken {
	symbol: string
	amount: bigint
}

type TokenReadyContext = { tokenReadyExtension: ExtensionContext & { accountAddress: string } }

type ExtraTokensFixture = [
	(context: TokenReadyContext, use: (addresses: Record<string, string>) => Promise<void>) => Promise<void>,
	{ scope: "file" },
]

/**
 * A file-scoped fixture, like the wallet it imports into: deploys `tokens` for the funded account
 * and imports each behind its fresh-balance check, once per file, so a retried test reuses them
 * instead of adding rows its assertions count. Resolves symbol → contract address.
 */
export function extraTokensFixture(tokens: readonly ExtraToken[]): ExtraTokensFixture {
	return [
		async ({ tokenReadyExtension }, use) => {
			const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
			if (!aztecConfig) throw new Error("aztecTestConfig not provided")
			const { deployExtraTokensForAccount } = await import("./aztec")
			const addresses = await deployExtraTokensForAccount(aztecConfig, tokenReadyExtension.accountAddress, tokens)
			const page = await openPopup(tokenReadyExtension)
			await waitForHash(page, "#/popup/general")
			for (const { symbol, amount } of tokens) {
				await importTokenAndWaitForBalance(page, tokenReadyExtension.accountAddress, addresses[symbol], amount.toString())
			}
			await page.close()
			await use(addresses)
		},
		{ scope: "file" },
	]
}
