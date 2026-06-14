import type { Page } from "puppeteer"
import { PROOF_GATE_KEY } from "@/e2e/chrome-storage-proof-gate"

/**
 * Drive the proverless proof gate from an e2e test.
 *
 * Only meaningful against a PROVERLESS build (`NULO_E2E_PROVERLESS=1`), where
 * the offscreen `ChromeStorageProofGate` watches {@link PROOF_GATE_KEY} in
 * `chrome.storage.session`. The key literal is imported from the source so
 * the two halves of the contract can never drift.
 *
 * The gate holds inside `PxeService.proveTx` — after the execution
 * coordinator has journaled `proving` — so "held" means the transaction is
 * deterministically parked in its proving stage. Use it to snapshot ordering
 * / cancel behaviour, then release.
 *
 * Pass any extension-context page (popup, offscreen); `chrome.storage` is
 * shared across all extension contexts, so a write from the popup is seen by
 * the offscreen listener.
 */
export async function holdProofGate(extensionPage: Page): Promise<void> {
	await extensionPage.evaluate((key) => chrome.storage.session.set({ [key]: { held: true } }), PROOF_GATE_KEY)
}

/** Release a held gate; the offscreen listener resolves `proveTx` immediately. */
export async function releaseProofGate(extensionPage: Page): Promise<void> {
	await extensionPage.evaluate((key) => chrome.storage.session.remove(key), PROOF_GATE_KEY)
}
