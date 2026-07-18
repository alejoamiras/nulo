Conditional-approve — fold the two critical corrections and four high-severity execution/security fixes below before approval.

## Critical

1. **D16 does not close resurrection and is partly impossible.** Offscreen explicitly lacks `chrome.storage`, yet P3 requires a direct read; moreover the current tombstone is cleared after successful purge, so restart → stale-first provision sees neither `deleted` state nor tombstone and can recreate OPFS state. Refs: [plan P3](implementations-plan/aztec-5.0.1-line/plan.md:111), [offscreen constraint](apps/extension/src/offscreen/index.ts:102), [tombstone clearing](apps/extension/src/wallet/services/profile/service.ts:731).  
   **Fix:** Hydrate/query an SW-owned authoritative `{profileId,currentGeneration,deletionState}` fence before offscreen accepts requests; reject absent profiles, and test successful purge → restart → stale-first provision.

2. **D19 detects a bad release after it has shipped.** Adding `verify-live` to `status` cannot gate the already-created release/assets/deploy; the faucet job still succeeds when its hook is absent and trusts uncontrolled dashboard Git deployment. Refs: [plan R](implementations-plan/aztec-5.0.1-line/plan.md:212), [faucet fallback](.github/workflows/release.yml:391), [verify-live ordering](.github/workflows/release.yml:412).  
   **Fix:** Restore the rejected draft-release redesign, require a wired deploy hook, disable Git auto-deploy, publish only after pre-publication gates, and define rollback for post-public acceptance failure.

## High

3. **P1’s gate is unsatisfiable.** P0 adds a deliberately failing `*.composition.test.ts`, while P1 simultaneously requires `test:all` green and that pin still red. Refs: [P0](implementations-plan/aztec-5.0.1-line/plan.md:50), [P1 gate](implementations-plan/aztec-5.0.1-line/plan.md:91).  
   **Fix:** Keep the regression as a targeted red patch/todo until P2, or define P1 green as “all except this single expected failure.”

4. **P4 dependencies bypass P1’s lock/provenance ritual.** Standards and fee-payment move only in P4, after P1’s scratch npm audit; no second fresh-lock, integrity-set comparison, or script-disabled installation is specified. Refs: [P1 ritual](implementations-plan/aztec-5.0.1-line/plan.md:68), [P4](implementations-plan/aztec-5.0.1-line/plan.md:133). npm itself notes provenance links bytes to a build/source but does not establish code safety. [npm provenance limitations](https://docs.npmjs.com/generating-provenance-statements/)  
   **Fix:** Repeat the complete secret-free lock/audit ritual in P4, compare Bun’s exact integrity set, pin Noir dependencies by peeled commit, and run lifecycle scripts only in a disposable credential-free environment.

5. **Post-live source mutation lacks a stop rule.** P7 review fixes occur after P6 broadcasting; a critical fix can invalidate deployed artifacts/tooling without requiring affected live gates again. Refs: [P6](implementations-plan/aztec-5.0.1-line/plan.md:183), [P7](implementations-plan/aztec-5.0.1-line/plan.md:198).  
   **Fix:** Require intent source-digest equality and rerun impacted P6 proofs/deploy recovery after any post-intent source change.

6. **The RPC ask is backwards.** A missing second Aztec endpoint is silently accepted, while disagreement becomes an ask; one malicious RPC can fabricate coherent L2 deployment and settlement observations. Ref: [P5](implementations-plan/aztec-5.0.1-line/plan.md:165).  
   **Fix:** Disagreement is an unconditional stop; absence triggers explicit capped-risk acceptance or independent canonical-state verification.

Decision trail: keep D-B2v3 and D13; keep D15 only with a concrete alternate source-binding—not a waiver. D18 is sound once crash journaling/source binding is normative. D16 and D19 require the flips above. Do not restore wipe-on-mismatch; restore draft release and stronger independent-RPC gating.