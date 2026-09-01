# execution-pipeline — round-2 plan 3 (blueprint light, BL/E; money path)

Scope authority: [round-2 scope](../complexity-residue-round-2/scope.md) § 3. 1–2 PRs.
Burns 10 directives: `batched-view-simulation` 71 + 152L, `claim-helper` 47,
`tx-request-builder` 38 + 208L, `execution/service` 159L + 88L (length-only),
`transfer-executor` 118L (length-only), `fee-strategy` 27, `fee-estimation-engine` 25,
`fpc/service` 21. Manifest 111 → 101. Seam toolkit as adjudicated in plans 1–2: sync
guard-ladder helpers; tail-returns; an awaited helper only where its call replaces a span
that already awaited, under a caller-side applicability guard; register-immediately spans
never gain a hop.

## PR split

- **PR-a**: the two monsters + the builder — `batched-view-simulation`, `claim-helper`,
  `tx-request-builder`. (111 → 107; 4 directives.)
- **PR-b**: the length splits + fee tail — `execution/service` (×2 length),
  `transfer-executor` (length), `fee-strategy`, `fee-estimation-engine`, `fpc/service`.
  (107 → 101; 6 directives.)

## Recon + decomposition (PR-a)

- **`batchedViewSimulation` (71 + 152L)** — two-arm (fast public-static prefix / slow)
  simulation orchestrator. Stages: (1) resolution prelude (resolve instances/artifacts,
  register, ensureRegistered) → awaited helper `resolveBatchContracts` (every span already
  awaited, sequential); (2) classify loop → awaited `classifyCalls` (each iteration
  awaited); (3) sync boundary partition → sync helper; (4) the fast-arm anchor/identity/
  gas setup block with its two fallback mutations → guarded awaited helper
  `prepareFastArm` returning `{leadingFast, slow, blockHeader, chainInfo, gasSettings}`
  (entered only when `leadingFast.length > 0`; that path's first op already awaited);
  (5) slow-tuple renumbering → sync; (6) slow-only chainInfo derivation stays inline
  (guarded await); (7) the `Promise.allSettled` dispatch + settle-branching stays INLINE
  (the fast-rejection classification and rerun flag are the money logic); (8) the rerun
  rebuild → guarded awaited helper; (9) fast unpack + slow unpack → sync helpers (decode
  loops + shape unpacking; log lines verbatim). Suite: `batched-view-simulation.test.ts`
  (29 — arms, fallbacks, rerun, utility-launch-once pins).
- **`claimOrCreateDappExecuteJournal` (47)** — cancel-race-hardened claim protocol.
  Extract `createAndRegisterFresh(deps, input)` (the create+controller+register block,
  duplicated ×3 — every site's path already awaited via `createFreshRecord`); the
  scope-mismatch block → guarded awaited `refileToExecutingScope(deps, input, record)`
  returning `{kind:"record"} | {kind:"result"}` (its throws — the three
  JobCancelledSentinel exits — stay inside, positions unchanged); the claim-transition
  CATCH body only → awaited `disambiguateClaimFailure` (the catch path already awaited via
  the re-read; the HAPPY transition path keeps NO helper so the documented
  register-immediately span — transition write → `activeControllers.set` — gains no hop).
  Suite: `claim-helper.test.ts` (18 — the race matrix).
- **`buildStandard` (38 + 208L)** — the action-processing switch dominates. Extract
  `resolveAuthwitMessageHash(content, nodeInfo, instances, artifacts)` (the messageHash
  inner switch, duplicated across the private/public authwit arms; the sync
  `message_hash` kind stays a caller-side ternary so it keeps its sync continuation);
  per-arm awaited helpers for the authwit arms (each arm already awaited); the SYNC
  `add_capsule` arm stays inline; the prelude (profile/network/account/node/identity/
  resolver chain) → awaited `resolveBuildContext` (sequential awaited spans); the
  entrypoint-build tail stays inline. **No direct suite — pre-extraction pins FIRST**
  (`tx-request-builder.pins.test.ts`): per-action-kind dispatch (capsule shape, extra-args
  hashing arity, authwit content-kind → messageHash routing incl. the invalid-kind throw,
  provided-vs-created authwit), the drift rejection (`assertLiveChainIdentity` before any
  resolve), and nonce threading — via fakes at the service seams (the
  `service.composition.test.ts` fake style).

## Recon (PR-b, refined at implementation under the same toolkit)

- `execution/service` 159L/88L + `transfer-executor` 118L: length-only stage splits at
  their `─ stage ─` seams; existing `transfer-executor.test.ts` +
  `service.{characterization,composition,pxe-seam}.test.ts` are the equivalence base.
- `fee-strategy` 27 / `fee-estimation-engine` 25 / `fpc/service` 21: single-hotspot
  extract-helper cuts; suites: fee clamp ×2 + structural parity, engine test, fpc test.

## Equivalence

BL/E + the builder pins. Existing suites zero-edit green per PR; error/log strings
byte-identical. Gates per scope.md § 3 (single sequential e2e run):
sim-methods · batch-mixed · batch-partial-failure · fee-methods · transfers ·
tx-sendTx-{default,delegated-authwit,feePayer,multicall,noFrom,reject,sponsoredFpc} ·
cancel-mid-prove — PR-a runs them all; PR-b re-runs fee-methods + transfers +
tx-sendTx-{default,feePayer,sponsoredFpc} + cancel-mid-prove (its files own fee/transfer
paths) plus audit:vue + test:ci-gating on both.

## Acceptance

- PR-a: 4 directives, 111 → 107, zero inserted (read the regen diff); builder pins green
  pre+post; the three suites zero-edit.
- PR-b: 6 directives, 107 → 101, zero inserted; all named suites zero-edit.
- Codex loop: one session — plan audit → PR-a impl review → PR-b impl review → approve.

## Rollback

Squash revert per PR; pure in-process refactors on the execution path, no wire-shape or
journal-schema change.
