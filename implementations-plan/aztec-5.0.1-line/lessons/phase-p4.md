# Phase P4 — Identity generation: standards swap + fee-payment 5.0.1 + Noir. STATUS: ◑ trust STOP-gate CLEARED; swap + fee-payment + Noir remain.

## Trust STOP-gate (conditional Ask #1) — CLEARED, not a stop
The audit-hardened provenance gate for adopting `@aztec-foundation/aztec-standards@5.0.1` PASSES on
every dimension (verified read-only via npm registry + attestation API, no install):

- **Provenance present**: two attestations — npm publish v0.1 + `https://slsa.dev/provenance/v1`.
- **Subject binds the package**: `pkg:npm/@aztec-foundation/aztec-standards@5.0.1`.
- **Source repo binding**: SLSA `workflow.repository = https://github.com/AztecProtocol/aztec-standards`,
  `workflow.ref = refs/tags/v5.0.1`, buildType GitHub-Actions-workflow, invocation
  `github.com/AztecProtocol/aztec-standards/actions/runs/29506443626`.
- **PEELED COMMIT RECORDED** (later movement fails the build): resolvedDependency
  `git+https://github.com/AztecProtocol/aztec-standards@refs/tags/v5.0.1` →
  **gitCommit `c74541f7cf2bb23b704e96fd326ea95d98252669`**.
- **Reverse anchor**: the published package's own `name` @ 5.0.1 = `@aztec-foundation/aztec-standards`
  (matches the intended target).
- **NO install scripts**: `npm view …@5.0.1 scripts` is EMPTY (no pre/post/install hooks).
- Published versions: `5.0.1-rc.1`, `5.0.1`.

⚠️ **FLAG for the swap step**: unpacked size is **102 MB across 81 files** (`unpackedSize
102544762`) — far larger than a pure-source standards package; almost certainly bundled compiled
circuit/contract artifacts. Do a layout diff vs the old `@alejoamiras/aztec-standards` at swap time
and confirm what those 102 MB are before pinning (a min-age exclude will be needed too — the package
is fresh, and `@aztec-foundation/aztec-standards` is NOT yet in `bunfig.toml` excludes).

Since the attestation is PRESENT and correctly bound, this is NOT the conditional-ask STOP — P4
proceeds to the swap.

## Remaining P4 work (the swap + fee-payment + Noir)
- Swap the 5 `package.json` + ~22 import sites `@alejoamiras/aztec-standards` →
  `@aztec-foundation/aztec-standards`; update `renovate.json`; add the new name to `bunfig.toml`
  `minimumReleaseAgeExcludes` (dated, removal follow-up); zero-`@alejoamiras/aztec-standards` sweep
  (archived `reference/` untouched); layout diff vs old package (resolve the 102 MB flag).
- **fee-payment → 5.0.1**: the FPC identity re-pin + compat map (`@alejoamiras/aztec-fee-payment`
  currently HELD at 5.0.0 from P1). This shifts FPC identity → coordinate with the P6 live redeploy.
- **Noir 5.0.1 recompile**: needs the noir toolchain (nargo/bb) — a build step that may not be
  runnable on this host; the recompiled artifacts gate the faucet build (`verify:deployments`).
- Full P1-style install ritual (rm bun.lock → provenance re-verify → frozen-lockfile).
- Suggest `npm deprecate @alejoamiras/aztec-standards` to the user (their npm auth — NOT AFK).

## Gate (per plan)
Trust STOP-gate green (DONE — above); swap complete + zero-old-name sweep; `test:all` + lint green;
Noir artifacts recompiled + `verify:deployments` green. The fee-payment identity shift couples to P6.

`LESSONS_FILE=implementations-plan/aztec-5.0.1-line/lessons/phase-p4.md`

## 2026-07-18 — CI failure taxonomy CORRECTED (again): tests RUN and FAIL; "Address already in use" is benign noise

**What the reruns of 29649173706 actually show** (evidence: `gh run view --log-failed`, all 6 failing jobs):
- Every shard reached `Local Aztec node is ready` AND `Test contracts deployed` — the sandbox boots
  fine everywhere. `[aztec-node] Error: Address already in use (os error 98)` appears exactly ONCE per
  boot, on CI and locally, immediately before the node banner — it is a benign internal message the
  node emits every boot, not a failure. (Third mis-read of this string; it must never again be
  treated as a boot-failure signal without checking for `node is ready` AFTER it.)
- The REAL failures: 14 test-level failures, of which 13 are the SAME signature — `TimeoutError:
  Waiting failed: 60000ms exceeded` inside `waitForToast("Token added")` ← `importToken` — across
  tokens, token-management, token-add-auto-trust, register-token, send-amount-clamp, transfers,
  opfs-storage, fee-methods (5 tests), backup-restore-integrity, backup-migration-roundtrip. Plus one
  `AssertionError: expected 'error' to be 'ok'`.
- The prior note "local repro still hangs at importToken but passes on CI (SW-eviction)" is
  DISPROVEN: the hang is deterministic on CI too. The standards swap killed `0x0193c31b`, but a
  SECOND bug stalls the post-import-click pipeline (register → initial balance projection → toast).
- Local evidence narrowing it: in `backup-restore-integrity.test.ts` the restore test itself PASSED
  locally; only the `tokenReadyExtension` fixture hung. And metadata resolution (import button
  enable) SUCCEEDS locally — the stall is strictly after the import click.
- Correction on the port-allocator commit (cef390d): the below-ephemeral-floor allocation is real
  hardening (the resolve→build→bind TOCTOU window exists), but it was NOT the cause of these red
  runs — the commit message over-attributes. Keep the fix; drop the narrative.

**Next:** disposable `zz-debug-import.test.ts` (SW console tapped via CDP; offscreen logs forward
into the SW) drives the import flow step-by-step under `e2e:agent` to expose where the pipeline
stalls. NEVER commit that file.

## 2026-07-18 — ✅✅ importToken "hang" ROOT-CAUSED + FIXED: crate-prefixed struct paths broke descriptor matching

**It was never a hang.** SW CDP tap + a popup phase-sampler (disposable `zz-debug-import.test.ts`,
since deleted) showed the popup dead-ending at *"Couldn't auto-detect this token's interface"* —
`parseTokenInterface` returned `isComplete: false` and `NewTokenPopup.handleAddToken` early-returns
with an inline error and NO toast, so `waitForToast("Token added")` times out. Deterministic,
CI and local.

**Root cause** (proven by running the pure matcher against the real installed artifact): the
5.0.1 `@aztec-foundation/aztec-standards` Token artifact namespaces AztecAddress params by the
artifact's import chain — `authorization_contract::aztec::protocol_types::…::AztecAddress` — while
`descriptors.ts` predicates exact-matched `aztec::protocol_types::…::AztecAddress`. Six kinds
(both balances + all four transfers) resolved ZERO candidates; the three metadata kinds survived
because they key on the (unchanged) `FieldCompressedString` return path / integer widths. All other
predicate inputs (flags, `_nonce`, u128 amount, `nonDispatchPublicFunctions` sourcing) already
matched — the wallet's public-fn split handling was fine.

**Fix**: `matchesStructPath` — crate-prefix-tolerant compare (`=== canonical` or
`endsWith("::" + canonical)`) at the five predicate sites + `matchesFieldCompressedString`.
Documented as the ONE deliberate divergence from the characterization pin's VERBATIM rule.
New pin: `descriptors-real-artifact.test.ts` asserts all nine kinds resolve their canonical
defaults against the REAL installed artifact (+ that the artifact still splits publics, + that
params still arrive crate-prefixed). Characterization + registry-equivalence stay green (old paths
still match exactly). 36/36 token tests, typecheck 0, lint 0.

**Method lesson (the one that ended a 9-misdiagnosis streak): when a pipeline "hangs", sample the
UI's own state machine** (button label + rendered error) — it names the stuck stage instantly and
distinguishes "stuck" from "cleanly errored with no toast". And when an ABI consumer misbehaves
after a package swap, run the PURE matcher against the REAL artifact before theorizing about
runtime/sync/eviction.

## 2026-07-18 — CI CONFIRMATION: descriptor-path fix clears the ENTIRE network suite
Run 29651144451 (head `450ae47`): all 5 shards, real-proving canary, heavy fee-methods +
concurrent-confirm, `network-e2e-status` — ALL SUCCESS. 13/13 previously-failing tests pass;
the lone 'error'-vs-'ok' assertion also cleared (it was downstream of the same broken import).
P4's remaining open items: deploy-script 5-arg arity + descriptor regen (P6-coupled), Noir
recompile against 5.0.1 toolchain, fee-payment tarball source-binding diff.

## 2026-07-18 — fee-payment SOURCE BINDING PROVEN + Noir recompile on 5.0.1

**Source binding (the audit's "the diff is the review"):**
- Publish tag resolved: the npm `@alejoamiras/aztec-fee-payment@5.0.1` tarball's `package.json`
  byte-matches `ecosystem-tooling@v5.0.1` (NOT `v5.0.1-revision.1`, which differs only in
  TS/tests/docs/audit files — the FPC Noir source is untouched between the tags).
- `canonical-deployment.json`: byte-identical across tarball, v5.0.1, and v5.0.1-revision.1;
  salt/aztecVersion/expectedAddress match our `private-fpc-canonical.json` (the published file has
  no `deployer` key — our ZERO-deployer pin is bound via the address re-derivation instead).
- Tarball artifact sha256 == our descriptor pin (`94fa4c71…`).
- **Rebuild-compare**: fresh `aztec compile` of the FPC at `ecosystem-tooling@v5.0.1` with the
  5.0.1 toolchain → raw digests differ ONLY via the debug `file_map` (machine-local paths);
  stripping `file_map`, the core digests (bytecode+ABI+VKs) are EQUAL: `e35b7bb75687a5dc…` both
  sides. The published package IS its tagged source. (Gotcha: the 5.0 CLI shells out to bare
  `nargo`; export `NARGO=$AZTEC_HOME/bin/aztec-nargo` + `BB=…/bb` or compile dies ENOENT — same
  wiring our compile.sh already documents.)

**Noir recompile (tags → v5.0.1 ×3, upstream token dep, toolchain already installed):**
- `aztec-packages` deps → `v5.0.1` (peeled `b97ff8c3e88f…`); token dep moved
  `alejoamiras/ecosystem-tooling → AztecProtocol/aztec-standards @ v5.0.1` (peeled
  `c74541f7cf2bb23b704e96fd326ea95d98252669`; `src/token_contract` path verified via API at the
  tag before edit). compile.sh → 5.0.1. All three compile clean; artifacts path-scrubbed
  (no home/abs paths — verified).
- Class-id table (address shifts follow at the P6 redeploy):

| contract | old class id | new class id |
|---|---|---|
| TokenMinterProxy | `0x055b5878e732a09a…` | `0x07689a539bf0a60a…` |
| TokenBridge | `0x0aea399e74e99a55…` | `0x2206e145ab6054f1…` |
| keystone (bin) | artifact byte-identical (`402be972…`) | unchanged |

- keystone `nargo test` 3/3 ✓; bridge-core suite 136/136 ✓ (tripwire + derivation pins green
  against the new state).
