import type { RestoreGate, RestoreGateHoldPoint } from "./restore-gate"

/**
 * Storage key the e2e restore gate watches. A test arms it with
 * `{ at: <hold-point> }`; the matching SW-side handler acknowledges by
 * rewriting `{ at, held: true }` and blocks until the key is removed.
 * Exported so e2e fixtures import the exact literal — the negative
 * bundle-grep (`_build-extension.yml`) asserts this string is ABSENT from
 * production builds.
 */
export const RESTORE_GATE_KEY = "nulo:e2e:restore-gate"

/**
 * Safety timeout. The holding worker is normally KILLED while held, so this
 * timer usually dies with it — it exists only for the non-kill misuse case
 * (a test arms the gate and never kills nor releases), where it resolves
 * loudly so the suite fails on its own assertion instead of hanging. Must
 * stay under the network vitest `testTimeout` (30_000ms); tests that hold
 * set a per-test `{ timeout }` above this value.
 */
const SAFETY_TIMEOUT_MS = 20_000

type GateRecord = { at?: RestoreGateHoldPoint; held?: boolean }

/**
 * The e2e restore gate, backed by `chrome.storage.session`. Sibling of
 * `ChromeStorageProofGate` (same presence-keyed protocol, event-driven
 * release, loud safety timeout) with two deliberate differences: the stored
 * value selects WHICH hold point engages, and the handler acknowledges entry
 * (`held: true`) so a test can distinguish "armed" from "reached".
 *
 * Lives in the SERVICE WORKER; constructed only inside the statically-false
 * `if (E2E_PROVERLESS)` branch in `wallet/runtime.ts`, so prod builds
 * tree-shake this module — its listener and the `nulo:e2e:restore-gate` key
 * — out entirely (the proof-gate precedent; enforced by the negative grep).
 */
export class ChromeStorageRestoreGate implements RestoreGate {
	public async waitAt(at: RestoreGateHoldPoint): Promise<void> {
		const rec = await this.read()
		if (rec?.at !== at) return
		if (!rec.held) {
			// Acknowledge entry: the test kills only after seeing held:true, so
			// "armed" can never be mistaken for "reached".
			await chrome.storage.session.set({ [RESTORE_GATE_KEY]: { at, held: true } })
		}

		await new Promise<void>((resolve) => {
			let settled = false
			const finish = (reason: "released" | "timeout"): void => {
				if (settled) return
				settled = true
				chrome.storage.onChanged.removeListener(onChange)
				clearTimeout(timer)
				if (reason === "timeout") {
					console.warn(
						`[e2e-restore-gate] safety timeout after ${SAFETY_TIMEOUT_MS}ms at "${at}" — releasing. ` +
							`A test armed "${RESTORE_GATE_KEY}" but never killed nor cleared.`,
					)
				}
				chrome.storage.session.remove(RESTORE_GATE_KEY).catch(() => {})
				resolve()
			}

			const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
				if (area === "session" && RESTORE_GATE_KEY in changes && changes[RESTORE_GATE_KEY].newValue === undefined) {
					finish("released")
				}
			}

			const timer = setTimeout(() => finish("timeout"), SAFETY_TIMEOUT_MS)
			chrome.storage.onChanged.addListener(onChange)

			// Re-check after subscribing: closes the release-between-check-and-
			// subscribe race.
			this.read().then((still) => {
				if (still?.at !== at) finish("released")
			})
		})
	}

	private async read(): Promise<GateRecord | undefined> {
		const rec = await chrome.storage.session.get(RESTORE_GATE_KEY)
		return rec[RESTORE_GATE_KEY] as GateRecord | undefined
	}
}
