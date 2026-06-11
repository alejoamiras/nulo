# C3 — Round 1 cross-rebuttal (Claude side, vs codex-1 + codex-2)

All codex line citations re-verified against `feat/security-audit-remediation` HEAD. None fabricated; every cited line checks out. The disagreements are about judgment calls and coverage, not evidence accuracy.

## (c) Confirmed — 7 distinct codex findings, all source-verified

1. **Parallel method registries / Shotgun Surgery** (codex-1 F2, codex-2 F1). Verified: `dispatcher.ts:163-178` (`METHOD_TO_KIND`), `:184-192`, `:198`, if-chain `:253-280`, `capability-map.ts:18,21-46`, `scope-enforcement.ts:348-362`, sync-by-comment `scope-enforcement.ts:9-10`. Matches Claude F1 both instances.
2. **Large Class `WalletSdkDispatcher`** (codex-1 F1, codex-2 F2). 1,011 lines confirmed. Codex-distinct contribution: Claude flagged only the method-level Long Method (`handleRequestCapabilities`); the whole-class framing is valid and additive.
3. **CAIP cross-package duplication** (codex-1 F3, codex-2 F4). Bodies verified line-for-line identical (`wallet-bridge/src/caip.ts:24-70` ≡ `extension/src/wallet/utils/caip.ts:22-29,49-66,71-87`).
4. **Session-account resolution duplicated in dispatcher** (codex-1 F4). Sites `:347-358`, `:494-497`, `:721-724`, `:989-997` verified. Codex-1 missed the fifth resolve+getAccounts pair at `:599-600` and the false "Extracted so…" docblock at `:341-346` (enrich re-implements the projection inline at `:742-746`).
5. **Scope-checker skeleton duplication** (codex-1 F5, codex-2 F3). Byte-identical `checkGetAddressBook`/`checkRegisterSender` (`:300-306` vs `:313-319`) verified.
6. **Middle Man re-export shims** (codex-1 F6). Verified, incl. `utils/caip.ts:16` importing CAIP types via `dapp-interaction/spec.ts`.
7. **Primitive Obsession capability kinds** (codex-2 F5). Verified: hand-copied union `capability-map.ts:11`, `capabilityType: string` at `capabilities.ts:66-68`, `Record<string, CapabilityInfo>` at `capability-meta.ts:34`.

## (a) Missed by both codex instances

1. **`DispatchHooks` vs `IExecutionHooks`** — an explicit C3 focus item, and both codex instances filed it as a NON-finding. Verified: `DispatchHooks` (`dispatcher.ts:90-107`) is a hand-written `Omit<IExecutionHooks, "originKey">` (`services-contract.ts:56-60`); repack is field-by-field at `dispatcher.ts:458`; and `wallet-sdk/background.ts:285-291` documents that this exact shape already shipped a dead release ("a past field-name drift here is exactly what left this release dead before"). Codex-2's "narrowness is intentional" rationale doesn't hold — intent can be kept while deriving the type; the silent-drop hazard on new hook fields remains.
2. **Dead code family**: no-session guards at `dispatcher.ts:312-314`, `:419-421`, `:485-487` are unreachable post-F-006 (`enforceCapability` throws `CapabilityNotGrantedError` first at `:784-803`; for sendTx, `resolveNetworkAndAccount` at `:411` also throws before `:419`); dead `else enforceScope` branch `:247-249`; `IDispatcherServices` (`services-contract.ts:98-104`) has zero inbound references (grep: definition only — no DI applies to this plain library package).
3. **Rejection-merge duplication inside `handleRequestCapabilities`** (`:622-629` vs `:678-684` — same five-step merge on both exit paths). Codex saw the method only through the Large-Class lens.
4. **Stale/false comments + banned milestone vocabulary**: "Phase 0.5" ×8 in dispatcher.ts (CLAUDE.md violation); contract row `:300-301` still documents the pre-F-006 plain-Error behavior; `index.ts:5-8` says the dispatcher "stays in `@nulo/extension`" nine lines above `export * from "./dispatcher"` — codex acknowledged only the last, as a non-finding.

## (b) Overconfident / mischaracterized

1. **CAIP header "conflict" claim** (codex-1 F3, codex-2 F4): the two headers do not conflict with each other — both name the extension copy as source of truth (`wallet-bridge/src/caip.ts:5-9`, `extension/.../caip.ts:4-9`). The actual defect is that the extension header's claim is false in practice: it lists "dispatcher" as a consumer while the dispatcher imports the bridge copy. Finding stands; the evidence framing is wrong.
2. **Codex-2's shim non-finding** misapplies the prompt carve-out: the carve-out covers the `spec/service/client` triple itself, not hand-maintained cross-package re-export lists — and drift is concrete (consumers already split between direct `@nulo/wallet-bridge` imports and shim paths).

No DO-NOT-FLAG violations in codex's filed findings.

## (d) Contradictions

1. **Intra-codex**: codex-1 rejects `CAPABILITY_LABELS`/`Capability["type"]` as a non-finding; codex-2 flags it (F5). Source + both Claude instances support codex-2.
2. **Intra-codex**: codex-1 flags the re-export shims (F6); codex-2 rejects them. Source supports codex-1.
3. **Cross-side**: both codex reject DispatchHooks/IExecutionHooks; both Claude flag it. The documented prior production incident decides it for the Claude side.
