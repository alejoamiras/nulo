import type { Page } from "puppeteer"
import { PROOF_GATE_KEY, SAFETY_TIMEOUT_MS } from "@/e2e/chrome-storage-proof-gate"

/** How long after a send's `enteredProveAt` its held gate still certainly holds: the gate starts its
 *  own release timer later than that stamp, and the margin covers polling and clock reads. */
export const PROOF_GATE_HOLD_MS = SAFETY_TIMEOUT_MS - 2_000

/**
 * Drive the proverless proof gate from an e2e test.
 *
 * Only meaningful against a PROVERLESS build (`NULO_E2E_PROVERLESS=1`), where
 * the offscreen `ChromeStorageProofGate` watches {@link PROOF_GATE_KEY} in
 * `chrome.storage.session`. The key literal is imported from the source so
 * the two halves of the contract can never drift.
 *
 * The gate holds inside the SW `ExecutionCoordinator.proveTxTask` — after the
 * coordinator has journaled `proving`, immediately before `pxe.proveTx` — so
 * "held" means the transaction is deterministically parked in its proving
 * stage. Use it to snapshot ordering / cancel behaviour, then release.
 *
 * Pass any extension-context page (popup, SW); `chrome.storage` is shared
 * across extension contexts, so a write from the popup is seen by the SW
 * coordinator's gate listener.
 */
export async function holdProofGate(extensionPage: Page): Promise<void> {
	await extensionPage.evaluate((key) => chrome.storage.session.set({ [key]: { held: true } }), PROOF_GATE_KEY)
}

/** Release a held gate; the SW coordinator's gate listener resolves `proveTx`. */
export async function releaseProofGate(extensionPage: Page): Promise<void> {
	await extensionPage.evaluate((key) => chrome.storage.session.remove(key), PROOF_GATE_KEY)
}
