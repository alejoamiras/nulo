# C3 — Round 2 push-back (Claude side, self-critique)

## Missed

1. **`getCapabilityInfo()` / `getSafeDisplay()` duplicate the known-vs-fallback branch over `CAPABILITY_LABELS`** (`packages/extension/src/wallet/services/dapp-session/capability-meta.ts:83-92` vs `:179-199`). Verified: same lookup/projection skeleton, divergent-change surface when metadata fields change. The file is explicitly in C3 scope and both Claude instances *read it* (cited its comments in F7/F8) yet neither filed the Duplicate Code. Codex round-2 caught it; confirmed real.
2. **Large Class on `WalletSdkDispatcher`** — both Claude instances decomposed the 1,011-line class into Long Method + duplication findings without naming the class-level smell; only the rebuttal conceded it as codex-additive, after the fact.

## Over-asserted

1. **Claude-1 F2's headline is false.** Title says "both copies claiming to be the source of truth" and the intro says the headers "each point at the other." Verified: both headers name the *extension* copy as SoT (`wallet-bridge/src/caip.ts:5-9` defers; `extension/src/wallet/utils/caip.ts:2-9` self-claims). Worse, the Claude rebuttal pinned this exact mischaracterization on codex while leaving Claude-1's own title uncorrected. The real defect (extension header lists "dispatcher" as a consumer while `dispatcher.ts:54` imports the bridge copy) survives; the framing doesn't.
2. **Claude-1 F10 over-cites its test evidence.** It claims tests pin `CapabilityNotGrantedError` at `dispatcher.test.ts:341` *and* `:965`. Verified: `:341` pins the error class; `:965-972` only asserts `.rejects.toThrow()` + a storage-lookup count. Codex's correction stands.
3. **Claude-2 F2 scope overreach + intra-side contradiction.** Folding `fee-detection.ts:17-20` (NO_FROM) into a C3 finding exceeds the cluster scope (`clusters.md` — execution/** is C1), and Claude-1 filed the identical item as a below-threshold non-finding. One side of that pair is wrong.
4. **Claude-1 F8's CLAUDE.md-vocabulary sweep drifts into house-rule policing** (borderline DO-NOT-FLAG style territory). The durable kernel is the two verified-false boundary docs (`index.ts:5-8` vs `:18`; `dispatcher.ts:300-302`); "Phase 0.5" ×8 is confirmed but cosmetic.

## Anchoring

`clusters.md` C3's focus line pre-named tables, checker duplication, caip duplicate, sync-by-comment, and DispatchHooks — Claude F1/F2/F3/F5/F6/F7 map 1:1 onto hints, and F9 was seeded by the scope line's "(re-export shims)" annotation. Hint-independent finds reduce to F4, F10, and the lying docblocks. The irony: the one hint requiring synthesis ("dispatcher concern count" → Large Class) was the one missed. Churn-severity language is repo-map-led — both instances quote "8 commits" with different windows (6-month vs 3-month), i.e. copied framing rather than independent measurement (both happen to be true; neither was measured).
