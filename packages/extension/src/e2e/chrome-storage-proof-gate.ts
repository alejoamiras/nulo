import type { ProofGate } from "./proof-gate"

/**
 * Storage key the e2e proof gate watches. A test sets it (any value) to
 * hold a transaction mid-prove and removes it to release. Exported so e2e
 * fixtures import the exact literal — the negative bundle-grep
 * (`_build-extension.yml`) also asserts this string is ABSENT from
 * production builds.
 */
export const PROOF_GATE_KEY = "nulo:e2e:proof-gate"

/**
 * Safety timeout. Must stay well under the network vitest `testTimeout`
 * (30_000ms, `vitest.e2e.network.config.ts`) so a forgotten release fails
 * via THIS loud log + resolve, not the generic vitest timeout. STUB tests
 * set a per-test `{ timeout }` above this value.
 */
const SAFETY_TIMEOUT_MS = 20_000

/**
 * The e2e proof gate, backed by `chrome.storage.session`.
 *
 * Presence-only protocol: while {@link PROOF_GATE_KEY} is PRESENT, `wait()`
 * blocks; when it is ABSENT, `wait()` resolves. Behaviour:
 *
 * - Event-driven: subscribes to `chrome.storage.onChanged` so a release is
 *   observed immediately, not polled.
 * - Safety timeout: a forgotten release resolves loudly after
 *   {@link SAFETY_TIMEOUT_MS} so the suite never deadlocks — the test fails
 *   on its own assertion instead of hanging.
 * - `chrome.storage.session` (not `local`) so the key dies with the
 *   browser profile; the gate also `remove()`s it on release/timeout so a
 *   forgotten hold can't bleed into a later test in the same session.
 *
 * Lives in the extension shell (touches `chrome.*`), NOT
 * `@nulo/aztec-runtime`, and runs in the SERVICE WORKER — the offscreen
 * document has no `chrome.storage`. Constructed only inside the static-false
 * `if (E2E_PROVERLESS)` branch in `wallet/runtime.ts` (a normal top-level
 * import), so prod builds tree-shake this module — its `onChanged` listener +
 * the `nulo:e2e:proof-gate` key — out entirely. (A dynamic `import()` was
 * tried and rejected: rollup ships a code-split chunk for it even when dead.)
 * That absence (not storage write-access) is the production trust boundary,
 * enforced by the `_build-extension.yml` negative grep.
 */
export class ChromeStorageProofGate implements ProofGate {
	public async wait(): Promise<void> {
		if (!(await this.isHeld())) return

		await new Promise<void>((resolve) => {
			let settled = false
			const finish = (reason: "released" | "timeout"): void => {
				if (settled) return
				settled = true
				chrome.storage.onChanged.removeListener(onChange)
				clearTimeout(timer)
				if (reason === "timeout") {
					console.warn(
						`[e2e-proverless] proof gate safety timeout after ${SAFETY_TIMEOUT_MS}ms — releasing. ` +
							`A test set "${PROOF_GATE_KEY}" but never cleared it.`,
					)
				}
				// Clear so a forgotten hold can't bleed into a later test.
				chrome.storage.session.remove(PROOF_GATE_KEY).catch(() => {})
				resolve()
			}

			const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
				if (area === "session" && PROOF_GATE_KEY in changes && changes[PROOF_GATE_KEY].newValue === undefined) {
					finish("released")
				}
			}

			const timer = setTimeout(() => finish("timeout"), SAFETY_TIMEOUT_MS)
			chrome.storage.onChanged.addListener(onChange)

			// Re-check after subscribing: closes the release-between-check-and-
			// subscribe race (key removed in the gap would otherwise be missed).
			this.isHeld().then((stillHeld) => {
				if (!stillHeld) finish("released")
			})
		})
	}

	private async isHeld(): Promise<boolean> {
		const rec = await chrome.storage.session.get(PROOF_GATE_KEY)
		return rec[PROOF_GATE_KEY] !== undefined
	}
}
