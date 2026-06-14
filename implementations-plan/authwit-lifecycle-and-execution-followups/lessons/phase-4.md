# Phase 4 — Arc close

LESSONS_FILE=implementations-plan/authwit-lifecycle-and-execution-followups/lessons/phase-4.md

- /code-review max: clean on production code (missed F1 — a wiring gap a
  diff-review can't see).
- Codex post-impl audit: offline-deferred twice (plane wifi), then on user
  request a 4-way fan-out replaced it: 2 research subagents (CDP root-cause,
  flake attribution) + 1 adversarial code audit + a codex retry.
- The adversarial audit caught a HIGH security bug both /code-review and the
  (attempted) codex missed: grantPublicAuthwit's scope gate was DEAD CODE
  (missing METHOD_CAPABILITY_MAP entry → enforcement skipped). Fixed +
  regression-guarded (834b403). F2 (blind approval popup) fixed by rendering
  spender/method/contract/args (93ac86c); F3 resolved (funds-bound-to-signer
  verified; caller-scope-binding deferred with reasoning). Verification
  re-audit: all CLOSED, one latent non-live gap addressed (e6aff01).
- Heavy authwit e2e env-gated out of the shard pool (RUN_AUTHWIT_E2E): CDP +
  flake subagents both confirmed they're too proving-heavy for shared shards
  AND aggravate neighbors; env-gate is correct. Manual QA gates revoke/toggle
  (Ask A4). Real CI automation path: dedicated isolated heavy job +
  accelerator (recorded follow-up).
