# Phase 10 — merge origin/dev (aztec 5.0.1 + v0.25.0 + testnet redeploy) into the arc

`[✓ 2026-07-20]` Merge commit `b63b53d` (parents `be3dafa` mine + `cff0ba2` dev), pushed to PR #260.
dev shipped, while this arc waited on the urgent release: aztec `rc.2 → 5.0.1` (#282), the v0.25.0
extension release, a **testnet redeploy** (new bearer-bridge addresses), and bridge recovery fixes
(#288 registerContract conformance, #290 L1-timeout deposit recovery, #291 stranded-card claim, #292
resilient receipt wait). My branch was 19 behind / 42 ahead.

## Clone consolidation (bit me first)
The canonical clone moved `~/Projects/nulo/nulo-1` → **`~/Projects/nulo`** (numbered strays → `~/Projects/nulo-multiple/`). The old path was deleted mid-session (cwd recovery). Fixed the stale `~/.agents/clones.md` row. **Lesson: on a "cwd was deleted" error, re-derive the canonical path from `~/.agents/clones.md` + the Projects dir before assuming anything; the registry can be stale after a consolidation.**

## The 11 conflicts + the 5.0.1 adaptations
- **Noir array API**: `consume_l1_to_l2_message(content_hash, [secret], …)` and `compute_secret_hash<N>([Field; N])` — 5.0.1 made the secret an explicit array. Kept the recipient-commitment derivation; **re-ran the keystone `aztec-nargo test` on 5.0.1 → all 6 vectors BYTE-IDENTICAL to rc.2** (the load-bearing result: no private deposit strands from the bump; `compute_secret_hash([x])` for N=1 == the rc.2 scalar hash, and the TS `computeSecretHash(scalar)` internally hashes `[scalar]` so it matches). v5.0.1 Noir tags across the 3 Nargo.toml + the `claim_secret` lib.
- **Recompiled** the recipient-committed `token_bridge` via `compile.sh` on the pinned 5.0.1 toolchain → new class id `0x2cb5c634…`; updated the supply-chain pin in `noir-artifact-classids.test.ts`.
- **Manifest**: took dev's LIVE 5.0.1 **bearer** manifest. See the gated-state caveat below.
- **useDeposit/useFuel**: kept the Permit2-router path (my arc); dev's #290/#291/#292 recovery auto-merged AROUND it (merged useDeposit 1099 lines > dev 1038 > mine 1019 — union preserved both). Re-added the merge-dropped `InboxAbi` import; ported #292's resilient `awaitL1Receipt` to the fuel approval (codex Medium).
- **5.0.1 API churn caught by typecheck (not the git merge)**: `deriveSigningKey` removed → `deriveNuloAccountKeys` (relayer); `@alejoamiras/aztec-standards` → `@aztec-foundation/aztec-standards` Token + a 5th `auth_contract = ZERO` constructor arg (verify + relay scripts — the orphaned rc.2 package MASKED this in typecheck); `candidate-schema` (dev's new strict zod) rejected `privateClaimMode` → added it; sole-consumer dataflow regex updated for `[secret]` (and tightened to reject a multi-element `[secret, X]`).

## codex gpt-5.6-sol @ ultra review (the user's ask — it earned its keep)
Verdict: no Critical. It found **4 High + 1 Medium + 1 Low, ALL fixed before commit**: (H1) the
recompiled artifact was UNSTAGED — a commit would have paired new source+pin with the rc.2 bytecode
(clean tooling → VK-size mismatch); (H3) candidate-schema `privateClaimMode` rejection would fail the
re-deploy after irreversible on-chain steps; (H4) the rc.2 Token import/arity in the scripts; (Med)
the #292 fuel-approval regression; (Low) the `[secret, X]` regex hole. It confirmed the crypto has **no
secret-hash mismatch** and that #290/#291 + the resilient waits survived. Session `019f80c0-…`.

## GATED — the faucet is code-ahead-of-config on 5.0.1 (worse than "private only")
The recompiled artifact is recipient-committed; dev's live manifest is the **bearer** bridge
(`0x00e3…`). `rebuildBridgeInstance` derives a different address (`0x06ff4d…`) from the recipient
artifact, and `registerContract` is unconditional — so the connect-time scope check rejects setup for
**the whole faucet (faucet + public bridge + Fuel), not just private** (codex H2). This is the
documented F1/L9 pre-cutover state, now on 5.0.1. **Resolution = a fresh recipient-committed Phase 6/7
re-deploy on the 5.0.1 testnet + promote a matching candidate manifest — HARD-GATED on explicit user
go.** (An alternative codex floated: make the runtime select the bearer artifact until cutover — a
bigger design change, not done.) The deploy tooling is now 5.0.1-ready (candidate-schema accepts
salt-v2, Token 5-arg, dev's journal-resume reuse logic).

Gates green: typecheck:all (13 pkgs), bridge-core 181, faucet 450, keystone 6/6 on 5.0.1,
sole-consumer self-test 5/5, biome lint.
