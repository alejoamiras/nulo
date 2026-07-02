/**
 * E2E-only proverless build configuration.
 *
 * `VITE_NULO_E2E_PROVERLESS` makes the wallet skip BB-SNARK generation in
 * network e2e (kernel simulation + on-chain submission stay real) so the
 * suite runs fast and stays CDP-stable. It is a PRODUCTION CATASTROPHE if
 * it ever ships — a proverless wallet broadcasts unproven transactions.
 *
 * This module is the LOAD-BEARING guard (layer 1). The flag is armed only
 * when BOTH `VITE_NULO_E2E_PROVERLESS=1` AND the independent confirm flag
 * `VITE_NULO_E2E_PROVERLESS_CONFIRM=1` are set, so a single stray `.env`
 * line or typo can't flip it (Vite auto-loads `.env*`). If exactly one is
 * set we THROW (fail-closed) — the misconfiguration surfaces at build /
 * startup rather than silently shipping proverless or silently disabling
 * the e2e gate.
 *
 * Only `apps/extension/scripts/e2e/agent.sh` (and the proverless CI
 * job) set these. No `.env` default, no `vite.config` define, no release
 * workflow. Layer 2 is dead-code elimination (the proverless branch +
 * `ChromeStorageProofGate` are constructed strictly inside `if
 * (E2E_PROVERLESS)`); layer 3 is the negative bundle-grep in
 * `_build-extension.yml`.
 *
 * Do not import this from `@nulo/aztec-runtime` — that package stays
 * decoupled from the `@/` alias. Thread the proverless decision in via
 * `ProductionPxeFactory`'s `proverless` option and the injected `ProofGate`.
 */

const PROVERLESS = (import.meta.env.VITE_NULO_E2E_PROVERLESS ?? "") === "1"
const PROVERLESS_CONFIRM = (import.meta.env.VITE_NULO_E2E_PROVERLESS_CONFIRM ?? "") === "1"

if (PROVERLESS !== PROVERLESS_CONFIRM) {
	throw new Error(
		"[e2e-proverless] exactly one of VITE_NULO_E2E_PROVERLESS / " +
			"VITE_NULO_E2E_PROVERLESS_CONFIRM is set. Both are required to arm " +
			"proverless mode (fail-closed double opt-in). Set both, or neither.",
	)
}

export const E2E_PROVERLESS = PROVERLESS && PROVERLESS_CONFIRM

/**
 * Build-time marker. Present in the shipped bundle ONLY when this build was
 * stamped proverless. `agent.sh` greps `dist/chrome` for the literal as a
 * positive propagation assertion; `_build-extension.yml` greps every
 * non-proverless build to assert it is ABSENT (negative guard). Pinned to a
 * no-op side effect in `offscreen/index.ts` so vite can't tree-shake it.
 */
export const E2E_PROVERLESS_BUILD_STAMP: "NULO_E2E_PROVERLESS_BUILD_STAMP" | null = E2E_PROVERLESS
	? "NULO_E2E_PROVERLESS_BUILD_STAMP"
	: null
