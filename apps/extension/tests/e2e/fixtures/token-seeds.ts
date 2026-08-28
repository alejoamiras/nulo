import type { Page } from "puppeteer"
import { TOKEN_SEEDS_KEY } from "@/e2e/chrome-storage-token-seeds"

/**
 * Publish the sandbox's default-token seed list for an ARMED build
 * (`VITE_NULO_E2E_TOKEN_SEEDS` + `_CONFIRM`, set by `scripts/e2e/agent.sh`).
 *
 * The wallet ships pinned seeds for Alpha and Testnet only — the sandbox mints
 * a fresh token address every run, so its seed can only be assembled from live
 * deploy output. An armed build REPLACES the shipped list with whatever this
 * writes, which is also what keeps the rest of the suite from calling the
 * public RPC endpoints the real seeds name.
 *
 * Write this BEFORE the trigger under test — the seeder reads the list once per
 * pass, so a write that lands after the pass started is simply missed.
 *
 * `expectedSymbol` is deliberately not a parameter: the reader pins it to the
 * fixture's own "TST", so a test cannot weaken the symbol check.
 */
export async function seedSandboxDefaultToken(extensionPage: Page, token: { address: string; classId: string }): Promise<void> {
	await extensionPage.evaluate(
		(key, contract, expectedClassId) => chrome.storage.session.set({ [key]: [{ chainId: 0, contract, expectedClassId }] }),
		TOKEN_SEEDS_KEY,
		token.address,
		token.classId,
	)
}
