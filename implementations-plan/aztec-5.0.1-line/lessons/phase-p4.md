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
