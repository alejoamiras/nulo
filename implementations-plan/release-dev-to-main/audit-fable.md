# Audit — "fable" seat (substituted)

**Fable 5 was unavailable** at planning time (`Claude Fable 5 is currently unavailable`). Per the blueprint skill's guidance — *"top-tier Claude subagent specialized for architectural planning … capability matters more than the literal name"* — the fable seat was filled by a top-tier Claude `Plan` subagent (default model), briefed identically to codex (same facts, same hard constraints, rollback-first angle, adversarial + assumption-attack asks). It produced an **independent** release runbook, not a review of mine.

## Verdict

> **Fundamentally sound to execute as-is — with one BLOCKING precondition: confirm the version (1.0.0 vs 0.23.0) before merging the Release PR.** With `bump-minor-pre-major` unset, release-please cuts `1.0.0`, not `0.23.0`. If a 1.0.0 major is unintended, override the Release PR's version before merge (not by changing automation).

→ **conditional approve** (condition: A1 / version).

## Findings folded into the consolidated plan

- **CONFIRMED v1.0.0** independently (3rd of 3 reviewers to land here). Top correction to my draft's "bump-minor-pre-major:true → 0.23.0" framing.
- **`verify:deployments` is path-gated**, not in the publish chain — it's invoked by `pr-quick.yml`'s `build-faucet` job only when the diff touches `packages/faucet/**` (which this fork does); `status` treats a skipped run as pass. → corrected Phase 0 + F7.
- **Faucet contracts are maintainer-manual** (`deploy:testnet`), not CI-deployed → **A5** (blocking for a usable faucet).
- **Cross-fork window**: faucet auto-deploys on 5.0 the instant `main` moves, ~30-45 min before the extension Latest exists → **A6**.
- **`Release-As:` override** as the clean, no-config-edit way to pin the version → folded into A1.
- Tighter gates: release body ≠ placeholder + 3 assets *before* landing redeploy; tag SHA == merge SHA; `self.crossOriginIsolated === true` in devtools; optional `dry_run=true` rehearsal.

Full reasoning is captured in the conversation transcript and synthesized into the **Decision ledger** + **Asks** in [`plan.md`](plan.md). No separate verbatim dump kept (the subagent did not persist a file; its findings are reproduced in the ledger).
