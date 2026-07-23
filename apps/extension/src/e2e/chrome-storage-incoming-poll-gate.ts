import type { IncomingPollGate, IncomingPollMatch } from "./incoming-poll-gate"

/**
 * Storage keys the incoming-poll gate uses. HOLD is written by the test (armed
 * matcher); STATUS is written by the SW. Both literals are imported by the e2e
 * fixture so the contract can't drift, and BOTH are asserted ABSENT from
 * production builds by the `_build-extension.yml` negative grep.
 */
export const INCOMING_POLL_HOLD_KEY = "nulo:e2e:incoming-poll-hold"
export const INCOMING_POLL_STATUS_KEY = "nulo:e2e:incoming-poll-status"

/** Phases the SW publishes on {@link INCOMING_POLL_STATUS_KEY}. */
export type IncomingPollPhase = "discovery-held" | "released" | "committed"

type HoldValue = {
	profileId: string
	networkId: string
	accountAddress: string
	contract: string
	txHash: string
}

/**
 * Safety timeout — must stay well under the network vitest `testTimeout`
 * (30_000ms) so a forgotten release fails via THIS loud log, not the generic
 * vitest timeout, and can never wedge account A's poller past the test.
 */
const SAFETY_TIMEOUT_MS = 15_000

/**
 * `chrome.storage.session`-backed {@link IncomingPollGate}. Runs in the SERVICE
 * WORKER (where `IncomingTransferService` lives). Constructed only inside the
 * static-false `if (E2E_PROVERLESS)` branch (`wallet/runtime.ts`) → prod builds
 * tree-shake this module and both keys.
 */
export class ChromeStorageIncomingPollGate implements IncomingPollGate {
	public async waitIfArmed(match: IncomingPollMatch): Promise<string | null> {
		const hold = await this.readHold()
		if (!hold) return null
		if (
			hold.profileId !== match.profileId ||
			hold.networkId !== match.networkId ||
			hold.accountAddress !== match.accountAddress ||
			hold.contract !== match.contract ||
			!match.txHashes.includes(hold.txHash)
		) {
			return null
		}

		await this.writeStatus("discovery-held", hold.txHash)
		await this.blockUntilReleased()
		await this.writeStatus("released", hold.txHash)
		return hold.txHash
	}

	public async markCommitted(heldTxHash: string): Promise<void> {
		await this.writeStatus("committed", heldTxHash)
	}

	private async readHold(): Promise<HoldValue | null> {
		const rec = await chrome.storage.session.get(INCOMING_POLL_HOLD_KEY)
		const raw = rec[INCOMING_POLL_HOLD_KEY]
		if (!raw || typeof raw !== "object") return null
		const h = raw as Partial<HoldValue>
		if (
			typeof h.profileId !== "string" ||
			typeof h.networkId !== "string" ||
			typeof h.accountAddress !== "string" ||
			typeof h.contract !== "string" ||
			typeof h.txHash !== "string"
		) {
			return null
		}
		return h as HoldValue
	}

	private async writeStatus(phase: IncomingPollPhase, txHash: string): Promise<void> {
		await chrome.storage.session.set({ [INCOMING_POLL_STATUS_KEY]: { phase, txHash } })
	}

	/** Block while the HOLD key is present; resolve when the test removes it or
	 *  the safety timeout fires. Event-driven (mirrors {@link ChromeStorageProofGate}). */
	private async blockUntilReleased(): Promise<void> {
		await new Promise<void>((resolve) => {
			let settled = false
			const finish = (reason: "released" | "timeout"): void => {
				if (settled) return
				settled = true
				chrome.storage.onChanged.removeListener(onChange)
				clearTimeout(timer)
				if (reason === "timeout") {
					console.warn(
						`[e2e-proverless] incoming-poll gate safety timeout after ${SAFETY_TIMEOUT_MS}ms — releasing. ` +
							`A test set "${INCOMING_POLL_HOLD_KEY}" but never cleared it.`,
					)
				}
				resolve()
			}

			const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
				if (area === "session" && INCOMING_POLL_HOLD_KEY in changes && changes[INCOMING_POLL_HOLD_KEY].newValue === undefined) {
					finish("released")
				}
			}

			const timer = setTimeout(() => finish("timeout"), SAFETY_TIMEOUT_MS)
			chrome.storage.onChanged.addListener(onChange)

			// Re-check after subscribing: closes the release-between-check-and-
			// subscribe race.
			chrome.storage.session.get(INCOMING_POLL_HOLD_KEY).then((rec) => {
				if (rec[INCOMING_POLL_HOLD_KEY] === undefined) finish("released")
			})
		})
	}
}
