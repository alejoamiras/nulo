# Phase 3 — remaining fix

**None.** Phase 0's dispatcher change is the whole fix: the matrix is green on every cell and
both fee variants with it, and red at the first second-account cell without it. The neighbour
files named by the gate (`tx-sendTx-selfPay`, `tx-sendTx-feePayer`, `tx-sendTx-sponsoredFpc`,
`tx-sendTx-noFrom`, `sim-methods`, `multi-account-from`, `authwit-lifecycle`, `fee-methods`)
run in CI on this branch's PR; the four closest ran locally in Phase 0.

`LESSONS_FILE=implementations-plan/self-pay-setup-fix/lessons/phase-3.md`
