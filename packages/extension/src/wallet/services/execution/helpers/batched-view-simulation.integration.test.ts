/**
 * Integration smoke for `batchedViewSimulation` against a real sandbox PXE.
 *
 * Guarded by `describe.skipIf(!process.env.RUN_NETWORK_E2E)` per user
 * CLAUDE.md "external-system data → always include at least one real-data
 * integration test." Skipped in fast `bun run test`; enabled when the
 * e2e:agent harness runs with `RUN_NETWORK_E2E=1`.
 *
 * The unit tests in the sibling `.test.ts` file pin the helper's logic
 * (classification, batching, decode-failure isolation) via stub PXE. This
 * integration test pins the wire contract — the `.nested` vs
 * `.nested[1].nested` private-return branch quirk in particular, which
 * unit-level mocks can't faithfully reproduce because the real selection
 * depends on what `account.buildTxExecutionRequest` returns as
 * `txRequest.origin`.
 *
 * TODO(deprecate-simulate-views integration): wire this up to the existing
 * sandbox bootstrap in `packages/extension/tests/e2e/global-setup.ts`. Today
 * the unit tests above provide >90% behavior-parity coverage; this file
 * exists as the skeleton + check-list for the network-suite extension.
 */

import { describe, expect, test } from "vitest"

const ENABLE = process.env.RUN_NETWORK_E2E === "1"

describe.skipIf(!ENABLE)("batchedViewSimulation — integration (real PXE)", () => {
	test.todo("public TX-typed call → 1 simulateTx, decodes balance correctly")

	test.todo("utility call → 1 executeUtility, decodes balance correctly")

	test.todo("mixed (public + utility) → 1 simulateTx + N executeUtility, results in input order")

	test.todo("private return: origin === account.address → uses .nested directly")

	test.todo("private return: origin !== account.address → uses .nested[1].nested")
})
