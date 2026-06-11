# C1 cross-rebuttal — Claude side (round 1)

All refutations below re-verified against source this session.

## (a) What codex missed that Claude caught

1. **Chain-identity assert ritual ×8 across 5 files** (claude-1 F3 / claude-2 F4). The empirically strongest Shotgun Surgery in the cluster: commit `b44aac1` swept 5 production files, and `1e7ad89` exists because the sweep *missed two sinks*. Verified: `assertLiveChainIdentity` appears in `tx-request-builder.ts`, `service.ts`, `authwit-discoverer.ts`, `fast-path.ts`, `helpers/batched-view-simulation.ts`. Both codex instances missed it entirely — the biggest gap on the codex side.
2. **Stale `proveAndSend` doc** — `execution-coordinator.ts:17-19` documents a method that doesn't exist (grep: comment-only). codex-2 F2 even cites `execution-coordinator.ts:49-99` as "under-extraction" without noticing the doc lies.
3. **Primary-method extraction ×4 with FEE_METHODS-filter bypass** at `service.ts:1914`/`2061` (claude-1 F9 / claude-2 F6).
4. **Context-preamble duplication with error-string drift** — `"Wallet locked"` at 8+ sites vs `"Unauthorized"` at `operation-planner.ts:82` (claude-1 F7). Verified by grep.
5. **CLAUDE.md-banned provenance tags** (~30-49 occurrences) incl. the runtime log string `"[PR 8c] fast-path failed…"` at `fast-path.ts:220` (verified).
6. **Orphaned JSDoc** — claim-wrapper doc at `service.ts:1247-1255` stacked above `resolveExecutionMutexKey:1262`; real wrapper at `:1378` (verified; claude-2 F8).
7. **Dead filter** in `ContractResolver.resolveArtifacts` (claude-2 F9; see b2).
8. **Task execute-around bracket beyond strategies** — coordinator + builders too (claude-1 F8); codex saw only the strategy slice. codex-2 also missed the transfer-request clump that codex-1 F6 caught.

## (b) Codex findings that are overconfident or wrong

1. **codex-1 F5 overreaches**: claims all four fee strategies share "near-identical simulation orchestration" and prescribes a shared simulate/finalize helper. `fpc-strategy.ts:35-90` is two-pass (build/simulate ×2, gas-settings override, action mutation), and `fpc-strategy.ts:11-19` carries an explicit "Do NOT refactor to a non-mutating shape without re-verifying TxExecutionRequest bytes" warning — codex's "smallest safe refactoring" is documented as *not* safe for that class. Only the task bracket + tuple return are genuinely shared with FPC.
2. **codex-2 non-finding factually wrong**: "No dead-code finding was emitted… did not find a safe no-registration/no-reference proof for any candidate." `contract-resolver.ts:111` creates `artifacts` empty; the `:118` filter `!artifacts.has(...)` is provably always-true (map first populated at `:131`). The proof is a 10-line local read — claude-2 F9 stands.
3. **codex-1 comments non-finding mis-reasoned**: "the smell is the underlying coupling, not the presence of the comments" conflates invariant documentation (fine, sanctioned) with milestone/provenance tags ("codex final-pass FC6" `service.ts:270`, "plan-v4 Branch 5" `:289`, "opus post-impl F5" `claim-helper.ts:162`) that CLAUDE.md bans outright.
4. **Minor**: codex-1 F1's "16 injected collaborators" at `service.ts:252` — actually 17 fields (11 service refs + 6 collaborators), none constructor-injected (ctor takes only `logger`, `service.ts:337`). Cosmetic miscount.
5. **No DO-NOT-FLAG violations found**: codex F3 (temporal coupling) is in-scope — the prompt explicitly lists the analog. Caveat: its proposed "atomic coordinator" refactor is a concurrency redesign, not a mechanical Fowler move, and the comments it would delete are load-bearing.

## (c) Confirmed codex findings

- **Large Class facade** (codex-1 F1 / codex-2 F1) — confirmed; matches claude F2s.
- **4× journaled pipeline duplication** (codex-1 F2 / codex-2 F2) — confirmed; 4/4 agent consensus, top finding.
- **Temporal coupling in claim/cancel** (codex-1 F3 / codex-2 F3) — confirmed as in-scope; evidence (`claim-helper.ts:144-163`) verified. A legitimate codex catch the Claude side under-weighted (claude-1 relegated it to out-of-scope).
- **Lookup/registration duplication** (codex-1 F4 / codex-2 F6) — confirmed; cites check out, incl. `batched-view-simulation.ts:494` (`classifyCall`) as consumer.
- **Transfer-request clump** (codex-1 F6) — confirmed.
- **Positional tuples** (codex-1 F7 / codex-2 F4) — confirmed; 4/4 consensus.
- **codex-2 F5 (three single-pass strategies)** — partially confirmed: the scaffold repetition is real, but the mechanical core is exactly claude-1 F8's execute-around bracket; the residual variation is the Strategy pattern's purpose.

## (d) Contradictions among the four documents

1. **Fee-strategy scaffold**: claude ×2 non-finding ↔ codex-2 three-strategy finding ↔ codex-1 four-strategy finding (FPC inclusion refuted above).
2. **Dead code**: codex-2 "no provable candidate" ↔ claude-2 F9 (proof verified; claude-1 had it as below-threshold non-finding).
3. **Comments**: codex-1 explicit non-finding ↔ both claude instances flag ~30-49 policy violations.
4. **Claim/cancel coupling**: both codex flag as in-scope smell ↔ claude-1 calls it out-of-scope correctness ↔ claude-2 silent. Codex's framing wins under the prompt's analog list.
5. **Bucket drift**: codex-1 rates the facade "architectural"; claude rates "structural" — same evidence, severity disagreement only.
