import type { Page } from "puppeteer"
import { TOKEN_SEEDS_KEY } from "@/e2e/chrome-storage-token-seeds"

/**
 * Publish the sandbox's default-token seed list for an ARMED build
 * (`VITE_NULO_E2E_TOKEN_SEEDS` + `_CONFIRM`, set by `scripts/e2e/agent.sh`).
 *
 * Call this BEFORE the trigger under test: the seeder reads the list once per
 * pass, so a later write is simply missed. `expectedSymbol` is deliberately not
 * a parameter — the reader pins it, so a test cannot weaken the symbol check.
 */
export async function seedSandboxDefaultToken(extensionPage: Page, token: { address: string; classId: string }): Promise<void> {
	await extensionPage.evaluate(
		(key, contract, expectedClassId) => chrome.storage.session.set({ [key]: [{ chainId: 0, contract, expectedClassId }] }),
		TOKEN_SEEDS_KEY,
		token.address,
		token.classId,
	)
}
