# Phase 4 — Live validation (smoke + network e2e)

## Outcome — ✓ local portion (2026-06-15); full network-e2e delegated to CI

### Green locally
- **Smoke e2e: 67 passed** (18 files, 6 skipped) against a FRESH build — proves the extension boots + UI surface works with the refactor compiled in.
- **Targeted live dispatcher path:** `cap-request-basic.test.ts` PASSED (capability enforcement: requestCapabilities → enforceCapability → derived capability map + scope). The `grantPublicAuthwit` + `sendTx` dispatcher legs also passed live (the G1 grant + G1 consume steps of `authwit-lifecycle` before its unrelated revoke-step timeout).
- (Carried) 149 wallet-bridge unit (parity-exact + exhaustiveness + identity), 2392 ext unit, typecheck:all, lint.

### Three local proverless TIMEOUTS — none attributable to this refactor
| Test | Duration | Failing path | In my change? |
|---|---|---|---|
| `authwit-lifecycle` | 358s | revoke-via-settings = `revokeAuthwits` → `executeSendTransaction({type: OriginType.UI})` (auth-registry service) | NO — UI-originated, bypasses `WalletSdkDispatcher` |
| `concurrent-sendtx-confirm` | 944s | barrier-gated stub in `ExecutionCoordinator.proveTxTask` | NO — execution coordinator, not the dispatcher |
| `authwit-consume-smoke` | 120s/240s `waitForPgResult` | grant→consume — but the SAME flow PASSED in lifecycle minutes earlier | flake, not deterministic |

Pattern: all three are timing/sequencing-sensitive, with waits tuned for CI Linux runners. On this darwin/arm64 laptop (proverless, no accelerator), proverless mining + playground result-polling are slower/variable → the 120s–240s waits are exceeded. The full network suite runs serially (`fileParallelism:false`) at 6-16 min/test — not viable to complete locally.

## Codex consult (non-trivial attribution call)
**Prompt:** `/tmp/codex-q1-phase4-disposition.md` — "is there ANY mechanism by which my dispatcher-metadata refactor could cause a TIMEOUT (not a wrong result) in these flows; is deferring the full suite to CI sound; what am I rationalizing away?"

**Verdict:** `environmental — proceed to PR`. Key reasoning:
- No credible timeout mechanism: the dispatch-entry guard yields a fast wrong-result if it fired (the message layer still responds, the playground waiter settles on ok/error) — not a 6-16 min hang. Derived maps are synchronous precompute (no async/IO/lock/scheduler interaction). Leaf split is acyclic; an init/cycle bug would fail deterministically on first use, not as late proverless stalls.
- The touched legs (`grantPublicAuthwit`/`sendTx`) are string-special-cased handlers BEFORE the kind lookup → wrong kind-set derivation can't affect them; the extracted wrappers are one-line delegates; per-origin ordering hooks unchanged.
- Corrected my framing: `cap-request-basic` is NOT the strongest evidence — the strongest is that the `grantPublicAuthwit`/`sendTx` dispatcher legs already passed live, and the failing revoke/barrier paths are elsewhere.
- **Do NOT claim "Phase 4 locally green."** Say: smoke + targeted dispatcher path + unit/parity/exhaustiveness green, no local failure attributable to the refactor; final network-e2e verdict delegated to required CI.
- **Caveat:** if CI reproduces the same failures on Linux runners, reopen the attribution question immediately. Until then, more local digging is low-yield.

## Disposition
Phase 4 local validation complete. The full network-e2e gate runs on the PR (required CI check on `dev` per CLAUDE.md) — Linux, sharded, tuned timeouts, where the proverless arc validated these tests. Watch the PR's Network e2e result; if it red-reproduces the three failures, reopen attribution per the codex caveat.

## Next
- Phase 5: commit the README reconciliation + index.
- Post-impl: `/code-review max --fix` → commit → codex post-impl audit (adversarial on the authz boundary + exhaustiveness guard) → address → PR to dev → watch CI (incl. network e2e).
