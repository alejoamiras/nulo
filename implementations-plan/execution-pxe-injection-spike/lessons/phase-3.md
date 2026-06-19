# Phase 3 — cancel-mid-prove composition test

## What it proves (in-process, no sandbox)
Through the REAL `ExecutionService.executeTransfer` + `cancelJob`: seed the reuse cache → executeTransfer takes the fast path → journal `simulating` → `proving` → `proveTxTask` parks on the controllable `ProofGate`. The test then `cancelJob("op1")` (the lane journals `cancelled` + aborts the registered controller), `release()`s the gate → `proveTx` returns → the post-prove `checkCancelled` (`execution-coordinator.ts:164`) throws `JobCancelledSentinel` → the proof is dropped, `node.sendTx` is NEVER called. Assertions: transitions include `cancelled`; `sendTx` not called.

This is the exact behaviour that was previously ONLY checkable by booting the sandbox + `holdProofGate`. It runs in ~1.4s in plain vitest.

## Bug I hit (and the lesson)
First run timed out: `entered` was always false even though the flow reached `proving`. Cause: `const { gate, release, ...gateView } = makeControllableGate()` — the `...rest` spread evaluates the `get entered()` GETTER once at destructure time (false) and stores a static value. Fix: keep the controller object whole (`const ctrl = makeControllableGate()`; use `ctrl.entered`). Lesson: never spread an object that exposes state via a getter — the spread snapshots, it doesn't forward.

## Gate — MET
`vitest run service.composition.test.ts` green · execution dir 278 green · lint clean · typecheck 0. No sandbox.

LESSONS_FILE=implementations-plan/execution-pxe-injection-spike/lessons/phase-3.md
