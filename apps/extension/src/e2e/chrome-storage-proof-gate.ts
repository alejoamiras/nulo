import type { ProofGate } from "./proof-gate"
import { waitForStorageRelease } from "./storage-gate"

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

		await waitForStorageRelease({
			key: PROOF_GATE_KEY,
			stillHeld: () => this.isHeld(),
			timeoutMs: SAFETY_TIMEOUT_MS,
			onTimeout: () =>
				console.warn(
					`[e2e-proverless] proof gate safety timeout after ${SAFETY_TIMEOUT_MS}ms — releasing. ` +
						`A test set "${PROOF_GATE_KEY}" but never cleared it.`,
				),
			// Clear so a forgotten hold can't bleed into a later test.
			onFinish: () => chrome.storage.session.remove(PROOF_GATE_KEY).catch(() => {}),
		})
	}

	private async isHeld(): Promise<boolean> {
		const rec = await chrome.storage.session.get(PROOF_GATE_KEY)
		return rec[PROOF_GATE_KEY] !== undefined
	}
}
