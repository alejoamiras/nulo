# Phase 6 · Whole-tree and full-suite gate

Run on `cf882a39`, whose code is the last code commit `5f32ab5b` (the head adds plan docs only),
one leg at a time, at retry 0, on 2026-09-29 between 00:38 and 04:06 UTC. The host's load average
ran between 35 and 110 through it.

Two earlier starts do not count. The first ran the static gates on `113082f7`. The second, on
`cb22cca9`, passed the static gates and the Chrome smoke and was stopped at the start of the
Chrome pool when C7 changed code; `e2e:reap` removed its data directory and lock.

## Static and unit gates

| Command | Exit | Result |
|---|---|---|
| `bun run lint` | 0 | 1,885 files, complexity baseline OK; warnings only, none in a file this branch touches |
| `bun run typecheck:all` | 0 | every `@nulo/*` workspace |
| `bun run test:all` | 0 | extension 7,786 passed, 4 skipped, 8 todo (596 files passed, 3 skipped); wallet-bridge 423; aztec-runtime 250 passed, 2 skipped; design 401; wallet-core 247; extension-messaging 239; wallet-crypto 120; third-party-notices 66; legal 54; landing 40; resolve-asset 14; wallet-sdk-schema-patch 11; passkey-rp 5 passed, 6 skipped (`bun test`). The extension's one more pass than on `113082f7` is C7's case |
| `bun run test:ci-gating` | 0 | 244 passed, 2 skipped, 0 failed (17 files) |
| `bun run build` | 0 | |
| `bun scripts/ci-cd/plans/check.ts` | 0 | 5 findings, 0 enforced: the five path-token reports `dev` already carries |
| `scripts/check-no-local-paths.sh` | 0 | |

## E2E legs

Smoke after `<smoke flags> bun run --cwd apps/extension build:<b>` (exit 0 on both); the network
legs through `bun run e2e:agent`, the pool and heavy legs proverless, the canary prover-ON with
`assert-canary-results.ts` after it. Every port the network legs drew fell in the static window.

| Leg | Browser | Exit | Passed | Skipped | Failed | Files | Time |
|---|---|---|---|---|---|---|---|
| smoke | Chrome | 0 | 157 | 7 | 0 | 38 passed, 3 skipped | 996 s |
| pool | Chrome | 0 | 134 | 5 | 0 | 92 passed, 3 skipped | 3,411 s |
| heavy | Chrome | 0 | 10 | 0 | 0 | 3 passed | 598 s |
| canary | Chrome | 0; assert 0 | 6 | 0 | 0 | 4 passed | 412 s |
| smoke | Firefox | 0 | 153 | 11 | 0 | 39 passed, 2 skipped | 1,264 s |
| pool | Firefox | 0 | 132 | 7 | 0 | 92 passed, 3 skipped | 3,768 s |
| heavy | Firefox | 0 | 10 | 0 | 0 | 3 passed | 709 s |
| canary | Firefox | **1; assert 1** | 5 | 0 | **1** | 3 passed, 1 failed | 1,128 s |

`bun run e2e:reap` after the legs: exit 0, nothing to reap.

### Every skip

No file below changed on this branch (`git diff 0fa5a2cb HEAD` is empty for each).

- Smoke, both browsers: `_probe-console-capture.test.ts` ×3, gated on `NULO_E2E_CONSOLE_PROBE=1`,
  and `store-captures.test.ts`, gated on `STORE_CAPTURES`; `dev`'s smoke lanes skip both.
  `appearance.test.ts`'s "theme persists…" and `sw-resilience.test.ts`'s "strict mode OFF…" are
  `test.skip` in source, so every lane skips them.
- Smoke, Chrome only: `action-popup-layout.test.ts`, `skipIf(!isFirefox)`; `dev`'s Chrome lane
  skips it.
- Smoke, Firefox only: `import-dead-rpc.test.ts` ×4, `CHROME_ONLY.cdpFetch`;
  `sw-resilience.test.ts`'s "an open popup outlives the kill", Chrome-only by its inline reason
  (Firefox keeps an event page alive under an open extension page, the
  `CHROME_ONLY.backgroundKillUnderPage` reason).
- Pool, both browsers: `_probe-warmup-effect.test.ts`, gated on `NULO_E2E_PROBE=1`;
  `tx-sendTx-delegated-authwit.test.ts`, gated on `NULO_E2E_STANDARD_CONTRACTS=1`; both skip on
  `dev`'s shards on both browsers. `stale-anchor-recovery.test.ts`'s reorg case, without
  `NULO_E2E_REORG=1`.
- Pool, Chrome only: `firefox-background-restart.test.ts`, `describe.skipIf(!isFirefox)`, skipped
  on `dev`'s Chrome shard; `window-placement.test.ts`'s refocus case, `FIREFOX_ONLY.windowRefocus`.
- Pool, Firefox only: `backup-restore-sw-restart.test.ts` ×3,
  `CHROME_ONLY.backgroundKillUnderPage`, skipped on `dev`'s Firefox shard; `cap-window.test.ts`'s
  reduced-motion case, Chrome-only by its inline reason (BiDi cannot emulate media features).

## The red leg: Firefox canary, `transfers.test.ts`

**Fingerprint.** Step 2's public transfer: `TimeoutError: Waiting failed: 300000ms exceeded` in
`waitForToast` (`sendTransfer`, `fixtures/helpers.ts:1171`), after "✓ Initial balance". The other
three canary files pass. A rerun of the leg failed the same way (exit 1, 5 passed, 1 failed).

**Mechanism, measured.** A scratch probe (uncommitted, deleted) ran step 2 alone on Firefox
prover-ON, recorded every snack, wrapped the page's `console.error`, and then followed the
transfer's own journal row in `chrome.storage.local`:

| Run | The popup | The transfer's journal row |
|---|---|---|
| this branch, 1 | at +60 s, "Send failed · Simulation failed, transaction not sent" | `proving`, then `succeeded` 86 s after creation |
| this branch, 2 | the same; `console.error`: `[send] executeTransfer failed: RpcTimeoutError: RPC 'executeTransfer' timed out after 60000ms` | `succeeded` at 94 s |
| base `0fa5a2cb` (exported tree, fresh install) | the same snack at +60 s | `succeeded` at 88 s |

The popup's `ExecutionServiceClient` keeps the popup-to-background default RPC timeout of 60 s
(`DEFAULT_RPC_TIMEOUT_MS`, `packages/extension-messaging/src/background/client.ts:17`), and
`executeTransfer` answers only once the transaction is proved and sent. Without Presto, Firefox
proves in the browser, and here a public transfer takes 86 to 94 s, so the popup reports a
failure the wallet then does not have: the transfer succeeds. On Chrome the whole four-transfer
scenario takes 116 s. The test waits 300 s for a success snack that never comes.

**Pre-existing.** The unmodified `transfers.test.ts` on the base commit fails the same way (exit 1,
step 2, `Waiting failed: 300000ms exceeded`, 345 s). Nothing on this branch touches the send path,
the RPC layer or proving. CI's Firefox canary lane proves natively through `presto-server`
(`VITE_NULO_PRESTO_REQUIRED=1`), which is why `dev`'s nightly passes it; setting
`NULO_E2E_DISABLE_PRESTO=1` would turn that lane red for this reason.

**Seen before, misread.** ux-feedback's batch 1 hit the same wait on a local Firefox prover-ON run
and concluded that a WASM-proved transfer took more than 300 s
([b1 phase 5](../../ux-feedback/b1-first-run-wording/lessons/phase-5.md)). The journal row shows
the transfer succeeding in about 90 s; the snack the test waits for was lost at 60 s. That program
then took its Firefox canary evidence from CI's Presto canary job on the PR head
([plan § Proving modes](../../ux-feedback/plan.md)), since the local `presto-server` (1.1.1) is
not CI's (1.1.2).

**Not fixed here.** The fix is product code outside this plan (a per-method timeout for the popup's
long-running execution calls, as the offscreen client already has for `proveTx`), and it changes
what the Send screen tells a person, which needs the owner. A person shown the false failure may
also send again, and both transfers would go through. It is recorded in the e2e-testing ledger
(row 42) and in `follow-ups.md`.

## Verdict

Every leg is green except the Firefox canary, whose one failure is the pre-existing defect above,
reproduced on the base commit. The gate's own criterion (every command exits 0) is not met, so P6
is not marked ✓. The Firefox canary's evidence can come, as it did for ux-feedback, from CI's
`Firefox / Run / canary / real-proving` job on the PR head; that, and the defect's fix, are the
owner's calls.

## After merging `dev` (`a7b1ff62`)

The merge (`2b53816f`) brought the grant-check and wallet-safety fixes; its one conflict was
`follow-ups.md`, where both sides deleted neighbouring entries, and both deletions stand. With no
dependency change and only the curated docs in conflict, the static gates reran on the merged tree
and CI reruns the e2e on it:

| Command | Exit | Result |
|---|---|---|
| `bun run lint` | 0 | 1,890 files, complexity baseline OK; warnings only |
| `bun run typecheck:all` | 0 | every `@nulo/*` workspace |
| `bun run test:all` | 0 | extension 7,904 passed, 4 skipped, 8 todo (599 files passed, 3 skipped); wallet-bridge 481; aztec-runtime 250 passed, 2 skipped; design 401; wallet-core 247; extension-messaging 239; wallet-crypto 120; third-party-notices 66; legal 54; landing 40; resolve-asset 14; wallet-sdk-schema-patch 11; passkey-rp 5 passed, 6 skipped |
| `bun scripts/ci-cd/plans/check.ts` | 0 | 3 findings, 0 enforced: path-token reports `dev` carries |
| `scripts/check-no-local-paths.sh` | 0 | |

## CI on the PR head

The driver decided on 2026-09-29 that CI's Firefox canary job on the PR head counts for this gate's
Firefox canary leg, as it did for ux-feedback, so P6 is marked ✓. On `8eaf8f25`, whose code is
`5f32ab5b`'s, run 36583649521's job 109463507540 (`Run / canary / real-proving / Aztec agent`)
passed at 14:57:06 UTC, proving through `presto-server`. The final head's own CI runs the canary
again on the tree merged with `dev`, and the merge waits for it.

The same head's Chrome network run 36583649490 failed once, on shard 2/5 (job 109461436679):
`network/incoming-arrival`'s second `expectCalmArrival` read the hero as "$0.00" before its quotes
landed (`expected [ '$1,046.00', '$1,052.00' ] to deeply equal [ '$0.00', '$1,052.00' ]`). The file
is not on this branch, and the re-run passed with no code change. It is the flake ledger's row 43;
the hygiene follow-up takes it.

## After merging `dev` (`f32b1e0a`)

The merge (`f3424d7c`) brought the UX owner-picks changes. Its one conflict was `follow-ups.md`
again: each side deleted its own five entries from the same list, and both deletions stand. The
static gates on the merged tree:

| Command | Exit | Result |
|---|---|---|
| `bun run lint` | 0 | 1,899 files, complexity baseline OK; warnings only |
| `bun run typecheck:all` | 0 | every `@nulo/*` workspace |
| `bun run test:all` | 0 | extension 8,022 passed, 4 skipped, 8 todo (605 files passed, 3 skipped); wallet-bridge 481; aztec-runtime 250 passed, 2 skipped; design 401; wallet-core 247; extension-messaging 239; wallet-crypto 120; third-party-notices 66; legal 54; landing 40; resolve-asset 14; wallet-sdk-schema-patch 11; passkey-rp 5 passed, 6 skipped |
| `bun scripts/ci-cd/plans/check.ts` | 0 | 3 findings, 0 enforced: path-token reports `dev` carries |
| `scripts/check-no-local-paths.sh` | 0 | |
