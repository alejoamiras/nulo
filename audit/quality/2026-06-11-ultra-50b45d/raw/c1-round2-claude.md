# C1 Round 2 push-back — Claude-side self-critique

## Missed

1. **Standard-prep skeleton duplicated across the two read-only Aztec paths.** `executeAztecSimulateTxStandard` and `executeAztecProfileTx` repeat the same 4-step prep — `planner.processAztecJsPayload` → `txBuilder.buildStandard({...op, actions}, feePaymentMethod)` → `suggestGasLimits` → `applyEmbeddedFpcGasCap` (+ `additionalScopes` parse): `service.ts:1796-1809` vs `service.ts:1848-1852`, third partial copy in NO_FROM at `service.ts:2101-2102`. Duplicate Code; Extract Method. Both instances dismissed the `additionalScopes` line as micro-dup and missed the surrounding skeleton.

2. **`opts.from` ↔ `accountAddress` guard hand-copied ×3** — `service.ts:1714-1716`, `1845-1847`, `1932-1934` (identical condition + `"Invalid \`opts.from\`"` string). Minor Duplicate Code at a trust boundary; below F-threshold alone, but nobody recorded it even as a non-finding.

3. Codex round-2's NO_FROM payload-normalization fork (`operation-planner.ts:159-223` vs `tx-request-builder.ts:438-449` vs `service.ts:2091-2100`) verifies against source — a genuine Claude-side miss.

## Over-asserted

1. **"No facade test exists" is false as worded** (claude-1 F2 "only tested fragments are the two fingerprint functions"; claude-2 F2 "no service-level test (verified)"). `feesettings-invariant.test.ts:27-34` instantiates `ExecutionService` directly and tests `executeAztecSendTx`/`executeSendTransaction` (`:64-100`). Correct claim: coverage is a single entry-invariant pin; cache/pipeline logic untested. Also weakens "exercising requires the full 11-dependency facade" — that test demonstrates logger-only + `initialized`-flag instantiation.

2. **claude-1 F1 line-count inflation**: "~250 duplicated lines / ~200 disappear" vs claude-2's ~120-150 on identical evidence; the lower figure matches source — much of the 4 pipelines is per-path variation.

3. **claude-1 F5 mechanism overstated**: "positional drift between client and service does not type-fail" — both ends implement the shared `Methods` from `spec.ts`, so arity/type drift compile-fails; only same-typed transposition (accountAddress/recipientAddress) is silent. Hazard real, mechanism wrong.

Stand by: F1 (pipeline ×4 + stale `proveAndSend` doc, re-verified), chain-identity ritual, FEE_METHODS bypass, comment-tag findings (rebuttal scoping holds — tags, not invariants), orphaned JSDoc, dead filter.

## Anchoring corrections

1. Both instances inherited repo-map §7's "Untested large facades: execution/service.ts" and "verified" it by filename absence (`service.test.ts`) instead of grepping for tests importing the facade — confirmation-shaped verification; `feesettings-invariant.test.ts` sat in the same directory.

2. The cluster's "pain-point prior" framing concentrated both instances on facade/builders; leaf files (`rpc-cancel.ts`, `client.ts`, `utils/fee-detection.ts`, `block-header-anchor.ts`) produced zero findings and zero non-findings — unexamined, not exonerated. Missed #1 sat in the under-cited read-only handler band (`service.ts:1576-1860`).
