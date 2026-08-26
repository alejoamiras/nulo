# runtime-edges — recon (batch 9, final, of the PR #448 remediation)

Single-agent recon against dev (verified spans re-checked at homing on `14bfcc67`). Findings in `audit/bugs/2026-08-22-production-ready/`; none has a RED proof (all "recipe", Minor/Low).

## N-15 — first-tx init decision trusts a single possibly-stale witness (Minor, re-weighted M)

- `packages/aztec-runtime/src/account/nulo-account.ts:170-188`: both `buildTxExecutionRequest` (:170-177) and `requiresInitialization` (:184-188) key the "wrap ctor?" decision on ONE `node.getNullifierMembershipWitness("latest", initNullifier)` read. Consumer: `apps/extension/src/wallet/services/execution/view-executor.ts:249` (routes the mixed-payload fast-path merge; the send path re-evaluates inside the builder — the TOCTOU window is between those two reads and across devices).
- Failure surface today: NO typed duplicate-nullifier error exists (repo grep zero). An inclusion failure lands on the 5.0 collapsed `REVERTED` → `TxExecutionResult.AppLogicReverted` catch-all (`transaction/service.ts:477-489`) — indistinguishable from any app revert.
- **Fix-recipe trap (recon-discovered)**: the audit's "cross-check via node.getContract" is the exact pattern `ensureContractRegistered` (:115-127) already REJECTED with a documented hazard — the node client's retry/backoff blows caller timeouts against an unreachable node (wedged the post-restore boot once; pxeOnly comment). The adjudication ("usually rejects rather than burns; self-heals; M") + the runbook's "minimal scope" point at the typed-error classification, not a pre-flight cross-check.
- Adjudication: `N-15 | Minor | re-weighted | Duplicate init usually rejects rather than burns fees; once-per-account ~30 s window; self-heals. Post-launch. M.`
- Coverage: none — `view-executor.test.ts:63` stubs `requiresInitialization`; no aztec-runtime test touches the span.

## N-21 — PATH-B passkey window budget < two-leg ceremony (Minor, latent)

- `passkey/service.ts:16` `PASSKEY_TIMEOUT_MS = 5*60*1000` (sole consumer `openWindowAndWait` :120, reached only from `createKey`/`getKey` — PATH B, "Currently NO production callers" per the service's own doc :28-31). `passkey/spec.ts:4` `PASSKEY_TIMEOUT = 60_000*3` is the per-leg WebAuthn timeout (`passkey-ceremony.ts:63/:75`); the PRF-on-get fallback (`:113-119`) runs a SECOND full leg → worst case 6 min against the 5-min window, which force-closes under the user's finger (`window-manager.ts:76-79`, :181-185) and orphans the just-minted resident credential.
- Adjudication: `N-21 | Minor | re-weighted | Math checks out but PATH-B create has no production caller — latent. Bump the constant. S.`
- Coverage: neither constant referenced by any test.

## N-28 — ServiceCollection mid-phase failure abandons siblings (Low, confirmed)

- `packages/wallet-core/src/base/index.ts:65-70`: `for (phase) await Promise.all(phase.map(start))` — reject-fast; pending same-phase siblings run on unobserved (a late rejection is an unhandled promise rejection), no later phase starts, `IService` has no stop hook (:21-31).
- Transport listeners are hot from CONSTRUCTION, not start: `extension-messaging/src/{background,offscreen}/service.ts` ctors call `subscribe()` → `chrome.runtime.onConnect/onMessage` — i.e. the wire is live at `services.add()` time. The composition root documents the symptom (`runtime.ts:414-420`, journalBootCutoff) and `retrySafe = false` at `runtime.ts:328` makes any start() failure a permanent SW-lifetime veto (single-flight contract; SW respawn is the retry).
- Raw fix text: "Promise.allSettled + aggregate first-error + surface sibling outcomes; optionally gate handler registration behind collection-level started ack." Adjudication fix column: "`allSettled` + aggregate. S/M." — gating is the raw text's "optionally".
- Verified clean by the same raw cluster: topology (cycles/dups/unknown-deps) — the defect is start()'s execution semantics only.
- Coverage: `topology.test.ts` covers only the pure phase computation; no ServiceCollection.start() execution test exists; `runtime.test.ts` covers pre-registration failures only. Composition-test conventions (`COMPOSITION-TESTS.md`, `composition-harness.ts` `svc()`) are the natural home for start()-semantics pins — but ServiceCollection lives in `packages/wallet-core`, so the pins colocate there (`base/index.test.ts`, new).

## Reuse/adapt map

- Adapt: `ServiceCollection.start()` (allSettled + AggregateError), `transaction/service.ts` result classification seam (N-15 typed error), `passkey/service.ts` constant (derived form).
- Reuse: `svc()`-style minimal IService stubs for the start() pins; the repo's typed-error precedent (`TxConfirmationTimeoutError` from batch 8; `UnlockTimeoutError`/`BootstrapFailedError` from batch 6 — instanceof-only, name-stamped).
- N-15 implementation question for codex: the exact classification seam (where the sequencer's duplicate-nullifier rejection is observable — dropped-tx path vs REVERTED result vs send-time error) and Aztec 5.0's actual error shape; resolve against the installed `@aztec/*` source during implementation.
