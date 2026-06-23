# Codex audit — composition-test-rollout (contradiction-check + adversarial, xhigh)

Session `019ee6e9` (resumed from its independent-plan draft). Reviewed the consolidated `plan.md` + `VERIFICATION.md`.

**Verdict: conditional approve** (conditions: fix the non-load-bearing Phase-1 gate; resolve the DappSession ctor/PXE contradiction; demote the shared canary from primary guard to optional seam-smoke). All adopted.

## Blocking (High) — both adopted
- **H(codex)-1 — Phase-1 gate non-load-bearing.** The Phase-1 gate ran `vitest` over the `token`/`fpc` dirs, which have no tests yet → the phase could go green proving nothing. **Fix adopted:** Phase-1 gate now runs EXACT new test paths (`pxe/shallow-port.test.ts` conformance + `token`/`fpc` `service.pxe-seam.test.ts`). Ledger #13.
- **H(codex)-2 — DappSession ctor contradiction.** The shared "consumers change minimally" snippet implied the PXE seam applies to DappSession, contradicting Phase 4 (PXE-free). **Fix adopted:** split into two explicit patterns — Token/Fpc = `pxeClientFactory` + `browserApi?`; DappSession = `browserApi?` only, no PXE. Ledger #6.

## Medium / Low — adopted
- **M — canary overclaimed.** Compile-time conformance + existing e2e already cover shape + semantics. **Fix:** canary demoted to optional seam-smoke. Ledger #8.
- **M — ledger #7 half-open.** **Fix:** #7 now firmly chooses the ctor seam; global-stub rejected (rationale corrected per the Opus audit — see audit-fable.md M4).
- **L — phase order.** **Fix:** Fpc sequenced before Token (fully shallow, lower risk). Ledger #5.

## Validated (genuinely fine)
- **Castless port holds** — `PxeServiceClient.getPXE(network: NetworkInfo): IPXE` is structurally assignable to `ShallowPxeClient.getPXE(...): ShallowPxe` by return-covariance; no overload/optionality trap. Caveat: import `NetworkInfo` from the runtime seam to avoid alias drift (folded in).
- **Storage ctor seam is behavior-preserving** — base `Service` ctor doesn't read the storage fields; `OperationJournalService` precedent. Global stub is NOT safer.
- **Token scope-out is correct** — `parseTokenInterface`/`getTokenInterface` do not transitively hit `simulate(...)`; the deep path is `fetchTokenMetadata`.
- Right to flag `registerContract` as deeper than it sounds, and to keep DappSession PXE-free on all paths.
