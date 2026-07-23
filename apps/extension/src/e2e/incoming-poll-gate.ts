/**
 * E2E-only, bidirectional gate for deterministically parking an incoming-note
 * scan mid-flight. Unlike {@link ProofGate} (one-way: test holds, SW waits),
 * this gate also reports its state BACK to the test via a status key, because
 * the account-switch isolation race test must KNOW the scan for account A is
 * parked-after-discovery before it switches to B and releases.
 *
 * Protocol (both keys in `chrome.storage.session`, shared across extension
 * contexts): the test writes the HOLD key armed for a specific
 * `(profile, network, account, contract, txHash)`; the SW's `scanContract`,
 * after `getNotesRaw` returns and BEFORE the locked commit, calls
 * `waitIfArmed` — if the arming matches this scan (and one discovered note
 * carries the armed txHash) it writes `discovery-held`, blocks until the test
 * removes the HOLD key, writes `released`, and returns the held txHash; after
 * the locked commit loop the scan calls `markCommitted`, writing `committed`.
 * The test drives: arm → poll status===discovery-held → switch → release →
 * poll status===committed → assert isolation.
 *
 * Injected ONLY inside the static-false `if (E2E_PROVERLESS)` branch in
 * `wallet/runtime.ts` (like {@link ChromeStorageProofGate}) so prod builds
 * tree-shake the impl + both storage keys out; the `_build-extension.yml`
 * negative grep enforces the absence.
 */
export type IncomingPollMatch = {
	profileId: string
	networkId: string
	accountAddress: string
	contract: string
	/** Every txHash discovered in this scan. The gate parks iff the armed
	 *  txHash is among them (so an older/unrelated note can't satisfy it). */
	txHashes: string[]
}

export interface IncomingPollGate {
	/**
	 * Called after `getNotesRaw`, BEFORE the locked commit. If the gate is armed
	 * AND this scan matches AND one discovered note carries the armed txHash:
	 * write `discovery-held`, block until released, write `released`, and return
	 * the held txHash. Otherwise return `null` immediately. MUST NOT be called
	 * while the service lock is held.
	 */
	waitIfArmed(match: IncomingPollMatch): Promise<string | null>

	/** Called after the locked commit loop when `waitIfArmed` returned a hash;
	 *  writes `committed` so the test knows the late emission actually fired. */
	markCommitted(heldTxHash: string): Promise<void>
}
