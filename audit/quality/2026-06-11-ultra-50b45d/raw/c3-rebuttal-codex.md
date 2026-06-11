## a) Misses
- The Claude side missed the `Large Class` call on `WalletSdkDispatcher`. Codex flagged that the class concentrates routing, popup orchestration, grant persistence, response shaping, operation building, and session-account resolution in one 1,011-line hub (`packages/wallet-bridge/src/dispatcher.ts:207-1011`), while Claude split that pressure into narrower findings but never named the class-level smell.
- Everyone missed a smaller local duplicate in capability metadata: `getCapabilityInfo()` and `getSafeDisplay()` each re-encode the same “known capability lookup vs fallback” branch over `CAPABILITY_LABELS` (`packages/extension/src/wallet/services/dapp-session/capability-meta.ts:83-92`, `179-199`). That is a real `Duplicate Code` / divergent-change surface if capability metadata fields change.

## b) Overconfident / wrong / DO-NOT-FLAG concerns
- Claude 2 F2 overreaches scope by folding in the `NO_FROM` duplicate at `packages/extension/src/wallet/services/execution/utils/fee-detection.ts:17-20`. C3 scope only includes `packages/wallet-bridge/src/**`, `wallet/utils/caip.ts`, `dapp-session/{spec.ts,capability-meta.ts}`, `dapp-interaction/spec.ts`, and `execution/models/index.ts` (`audit/quality/2026-06-11-ultra-50b45d/raw/clusters.md:14-16`). The CAIP duplication is valid; the `fee-detection.ts` add-on is not a C3 finding.
- Claude 1 F10 overstates its test evidence for `registerToken`. The source does support the dead-guard claim: `dispatch()` calls `enforceCapability()` before `handleRegisterToken()` (`packages/wallet-bridge/src/dispatcher.ts:237-280`), and missing session throws at `:784-803`. But the cited test at `packages/wallet-bridge/src/dispatcher.test.ts:965-972` only asserts “throws” plus one storage lookup; it does not pin `CapabilityNotGrantedError`. The behavioral conclusion is fair; the evidentiary claim is too strong.
- Claude 1 F8 is mixed. The stale factual docs are fair targets (`packages/wallet-bridge/src/index.ts:5-8` vs `:18`; `dispatcher.ts:299-302` vs actual flow at `:237-280`), but broadening that into a general finding about review-history comments leans close to the prompt’s sanctioned-comment carve-out. I would keep the stale boundary docs, not the wider comment-style argument.

## c) Claude findings I confirm
- Confirmed strongly: the parallel wallet-method registries / shotgun-surgery finding. The method surface is split across `capability-map.ts:18-46`, `dispatcher.ts:163-198,252-280,867-956`, and `scope-enforcement.ts:348-362`.
- Confirmed strongly: CAIP helper duplication. `packages/wallet-bridge/src/caip.ts:24-70` and `packages/extension/src/wallet/utils/caip.ts:22-87` are duplicated, and their headers contradict each other.
- Confirmed strongly: scope-checker duplication. `scope-enforcement.ts:53-130` and `:286-319` clearly repeat parameterized skeletons.
- Confirmed: duplicated session-account resolution/projection inside the dispatcher. The repeated `resolveNetwork -> getAccounts -> getSessionAccountAddresses` pipeline is at `dispatcher.ts:348-358`, `494-497`, `721-747`, and `989-997`.
- Confirmed, but weaker than the four above: re-export shim / middle-man cost in `dapp-session/spec.ts`, `dapp-interaction/spec.ts`, and `execution/models/index.ts`.

## d) Contradictions
- `DispatchHooks` vs `IExecutionHooks`: Claude 1 F6 and Claude 2 F7 promote this as a real smell; both Codex reports explicitly rejected it as below threshold / intentional.
- Capability-kind string modeling: Claude 1 F7 and Claude 2 F6 flag the hand-maintained discriminator set; Codex 1 rejected it as not strong enough.
- Re-export shims: Claude 1 F9 and Claude 2 F8 promote them as `Middle Man`; Codex 2 explicitly rejects them as not strong enough, while Codex 1 promotes the same family.
- Comment drift: Claude 2 F10 and Claude 1 F8 elevate stale package/docs comments; both Codex reports treated the `index.ts` header drift as below threshold or folded it into non-findings.