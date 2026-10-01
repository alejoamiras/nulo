# Phase 2 — Controllable stub + barrier ✓

The barrier mechanism was built during Phase 0 (the spike produced the real
seam) and relocated SW-side after the offscreen-no-chrome.storage finding.
This phase formalizes it + validates the second STUB test.

## Delivered
- **`ProofGate`** interface + `NOOP_PROOF_GATE` (extension-local, `src/e2e/proof-gate.ts`).
- **`ChromeStorageProofGate`** (`src/e2e/chrome-storage-proof-gate.ts`): presence-only
  `chrome.storage.session` key `nulo:e2e:proof-gate`, event-driven (`onChanged`),
  `remove()` on release/timeout, 20s safety timeout (loud).
- **Injection**: SW `ExecutionCoordinator.proveTxTask`, immediately before `pxe.proveTx`
  (D1→approach 2, D8→SW-side). NOOP default → existing callers untouched.
- **Fixture**: `holdProofGate`/`releaseProofGate` (`tests/e2e/fixtures/proof-gate.ts`),
  importing `PROOF_GATE_KEY` from source so the contract can't drift.

## Gate — met
- `bun run lint` ✓ · stub unit tests (`chrome-storage-proof-gate.test.ts`, 4 cases:
  instant-by-default, hold→release, **safety-timeout-loud**, check-then-subscribe race) ✓.
- `cancel-mid-prove` proverless ✓ (Phase 0/0b — holds `proving`, releases, 4001 + D13).
- `concurrent-sendtx-approve` proverless ✓ — barrier holds T1 at `proving`
  deterministically; the T1-active + T2-queued boundary snapshot is stable proverless.

## Notes
- D13 preserved by construction: the gate sits between the coordinator's existing
  pre-/post-prove `checkCancelled` checkpoints; cancel during the hold is honored only
  at the post-prove checkpoint. Confirmed empirically by cancel-mid-prove's 4001 +
  the `data-stage="proving"` prove-entered assertion.

LESSONS_FILE=implementations-plan/e2e-proverless-stub/lessons/phase-2.md
