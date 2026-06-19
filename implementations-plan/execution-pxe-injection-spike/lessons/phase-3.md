# Phase 3 — cancel-mid-prove composition test

## What it proves (in-process, no sandbox)
Through the REAL `ExecutionService.executeTransfer` + `cancelJob`: seed the reuse cache → executeTransfer takes the fast path → journal `simulating` → `proving` → `proveTxTask` parks on the controllable `ProofGate`. The test then `cancelJob("op1")` (the lane journals `cancelled` + aborts the registered controller), `release()`s the gate → `proveTx` returns → the post-prove `checkCancelled` (`execution-coordinator.ts:164`) throws `JobCancelledSentinel` → the proof is dropped, `node.sendTx` is NEVER called. Assertions: transitions include `cancelled`; `sendTx` not called.

This is the exact behaviour that was previously ONLY checkable by booting the sandbox + `holdProofGate`. It runs in ~1.4s in plain vitest.

## Bug I hit (and the lesson)
First run timed out: `entered` was always false even though the flow reached `proving`. Cause: `const { gate, release, ...gateView } = makeControllableGate()` — the `...rest` spread evaluates the `get entered()` GETTER once at destructure time (false) and stores a static value. Fix: keep the controller object whole (`const ctrl = makeControllableGate()`; use `ctrl.entered`). Lesson: never spread an object that exposes state via a getter — the spread snapshots, it doesn't forward.

## Strengthened after the codex post-impl audit (High)
First version faked the journal + asserted loosely (`cancelled` present + no send) — codex flagged it could pass even if cancel fired at a LATER checkpoint. Now uses the REAL `OperationJournalService` (FakeBrowserApi FSM + transition lock): asserts the op ends terminally `cancelled`, NEVER `submitting`/`succeeded`, and `toTx` (proof→tx) is never called → proves the proof was dropped at the post-PROVE checkpoint, not later. Switching to the real journal also surfaced that `TransferType` is a numeric enum (`Public = 2`) — the stub had silently accepted an invalid `"public_to_public"` string. (Lesson: a faked collaborator hides the real contract; prefer the real service at a stable boundary.)

## Gate — MET
`vitest run service.composition.test.ts` green · execution dir 278 green · lint clean · typecheck 0. No sandbox.

LESSONS_FILE=implementations-plan/execution-pxe-injection-spike/lessons/phase-3.md
