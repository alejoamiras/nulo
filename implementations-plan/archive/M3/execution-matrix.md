# M3 — Execution Matrix

One PR per row. Each PR ships independently, reviewed in isolation, and can be reverted without cascading damage. No mega-PRs.

## Validation tiers

| Tier | What runs | Why |
|---|---|---|
| **UNIT** | `bun run test` in affected packages; `bun run typecheck:all`; `bun run check:deps` | Fast (seconds). Catches type errors, invariant regressions, boundary violations. |
| **SMOKE E2E** | UNIT **+** `bun run build` (both Chrome + Firefox) **+** manually load extension, unlock existing wallet, open Home/Assets/Settings | ~5-10 min. Catches build breakage, MV3 SW boot failures, popup-mount issues that unit tests miss. |
| **NETWORK E2E** | SMOKE **+** `bun run test:e2e` against local Aztec node (playground dApp) **+** manual send-token **+** dApp discovery/sendTx | ~30 min. Catches PXE/proveTx/offscreen plumbing breaks. Required for any change that touches the transaction path. |

Each PR MUST pass its tier before merge.

---

## Phase matrix (14 PRs total)

| # | Phase | TLDR (ELI5) | Branch | Depends on | Validation | Est |
|---|---|---|---|---|---|---|
| **0.1** | M3.1 Step 0a — Decouple Node globals | Change `NodeJS.Timeout` → `ReturnType<typeof setTimeout>` in 3 files; add `import { Buffer } from "buffer"` in 3 files. Pure-typecheck fix, zero runtime change. | `m3.0/decouple-node-globals` | master | UNIT | 0.5d |
| **0.2** | M3.1 Step 0b — Pre-test storage | Write `entity_storage.test.ts` + `value-storage.test.ts` against CURRENT code. Locks the contract before M3.1 purifies the ctors. | `m3.0/storage-pretests` | 0.1 | UNIT | 0.5d |
| **0.3** | M3.2 Step 0 — Buffer in crypto | Add `import { Buffer } from "buffer"` to `passkey/credential.ts`, `password-secret-box.ts`. Run M2.6 vectors — byte-identical. | `m3.0/crypto-buffer-imports` | 0.1 | UNIT (M2.6 vectors) | 0.25d |
| **0.4** | M3.3 Step 0 — Messaging types | `NodeJS.Timeout` → `ReturnType<typeof setTimeout>` in `base/offscreen/client.ts`. | `m3.0/messaging-decouple` | 0.1 | UNIT | 0.25d |
| **0.5** | M3.4 Step 0 — PXE source decoupling | Inline minimal `NetworkInfo` + `IConfigReader` structural interfaces in `chain-runtime.ts` + `artifact-registry.ts`. Remove extension-path imports. | `m3.0/pxe-structural-types` | 0.1 | UNIT | 0.5d |
| **0.6** | M3.5 Step 0 — Dispatcher decoupling | **Biggest pre-refactor.** Extract capability/session types to future wallet-bridge location, inline CAIP helpers, add `IDispatcherServices` structural interface, rewrite dispatcher.ts imports. | `m3.0/dispatcher-decouple` | 0.1 | UNIT + SMOKE E2E | 1.5-2d |
| **1** | **M3.1** — Extract `@nulo/wallet-core` | Move the pure library: ports, storage, utils (arrays/lock/queue/event-handler/mnemonic/etc.), topology, logger interfaces. No Chrome, no Vue, no Aztec. Everyone else depends on this. | `m3/1-wallet-core` | 0.1, 0.2 | UNIT + SMOKE E2E | 1 wk |
| **2** | **M3.2** — Extract `@nulo/wallet-crypto` | Move the safe: AES-GCM, PBKDF2, passkey PRF. Must produce byte-identical keys. M2.6 vectors are the guard. | `m3/2-wallet-crypto` | 1, 0.3 | UNIT + SMOKE E2E (reg/unlock/recover) | 3-4d |
| **3** | **M3.3** — Extract `@nulo/extension-messaging` | Move the RPC pipes: `Service<T>`, `ServiceClient<T>`, error hierarchy, Zod helpers. Chrome runtime port plumbing. | `m3/3-messaging` | 1, 0.4 | UNIT + SMOKE E2E | 4-5d |
| **4** | **M3.4** — Extract `@nulo/aztec-runtime` | Move the Aztec engine: PXE client, WASM circuits, NuloAccount. Heaviest extraction. | `m3/4-aztec-runtime` | 1, 0.5 | UNIT + **NETWORK E2E (send-token full proveTx path)** | 1.5-2 wk |
| **5** | **M3.5** — Extract `@nulo/wallet-bridge` | Move the dApp protocol: dispatcher, scope enforcement, capability map, discovery queue. | `m3/5-wallet-bridge` | 1, 3, 0.6 | UNIT + **NETWORK E2E (dApp discovery + sendTx)** | 4-5d (+ 0.6 pre-refactor) |
| **6** | **M3.6** — Extract `@nulo/extension-ui` | Move the UI kit: pure Vue components, SCSS, fonts. Brutalist primitives only. | `m3/6-extension-ui` | 1 | UNIT (vue-tsc) + SMOKE E2E (visual) | 1 wk |
| **7** | **M3.7** — Boundary enforcement | Paint the lines: depcruiser rules, per-package `test:all` + `typecheck:all`, CI integration, vue-tsc scope update. | `m3/7-hardening` | 1–6 all merged | UNIT + NETWORK E2E (full regression) | 3-4d |

**Total estimate**: ~7-8 weeks for the full M3 arc, with each step ship-and-revert-safe.

---

## Dependency graph

```
                    master
                      │
                      ▼
    ┌─────────────── 0.1 (decouple Node globals) ───────┐
    │                     │                              │
    ▼                     ▼                              ▼
   0.2           0.3 / 0.4 / 0.5                        0.6
 (storage        (crypto / msg /                      (dispatcher)
  pretests)       pxe pre-refactors)
    │                     │                              │
    └─────────┬───────────┘                              │
              ▼                                          │
             M3.1 (wallet-core)                          │
              │                                          │
              ├──────────┬────────┬──────────┐           │
              ▼          ▼        ▼          ▼           ▼
             M3.2      M3.3      M3.4       M3.6       (M3.5 waits for M3.3)
           (crypto)  (messaging) (runtime)  (ui)
              │          │        │          │           │
              │          └────────┼──────────┼───────────┤
              │                   │          │           ▼
              │                   │          │         M3.5 (bridge)
              │                   │          │           │
              └─────────┬─────────┴──────────┴───────────┘
                        ▼
                       M3.7 (hardening) ← needs all 6 merged
```

**Parallelizable**: after M3.1 lands, the team can fan out on M3.2, M3.3, M3.4, M3.6 in parallel. M3.5 unblocks once M3.3 is in. M3.7 is the exit gate.

---

## Branching rules

1. **Always branch from `master`** for pre-refactor PRs (0.x). They land on master independently.
2. **Extraction PRs** (1-6) branch from the TIP of master AFTER their pre-refactor prerequisites are merged. Do not branch from the pre-refactor branches.
3. **No long-running feature branches.** Each phase should merge within its estimate window; stale branches accumulate merge conflicts as other phases land.
4. **Revert-safe commits.** Each PR should be a single logical change, squash-mergeable. If M3.2 goes wrong, `git revert` it and the tree is clean.
5. **Commit message prefix**: `refactor(m3/<n>): <what>` or `chore(m3/<n>-pre): <what>` for pre-refactors.
6. **PR title**: `[M3.<n>] <short summary>` — makes the timeline readable in GitHub.
7. **Don't push M3.7 until every M3.1-6 is on master.** Its `check:deps` config depends on the full 7-package state.

---

## Per-phase execution checklist

Each extraction PR follows this template:

```
☐ Pre-refactor PRs merged (for this phase's dependencies)
☐ New branch created from master tip
☐ Scaffold new package (package.json, tsconfig, vitest.config)
☐ Move files (commit after each logical group)
☐ Update extension imports (search-replace, verify each file)
☐ bun install (workspace resolution)
☐ bun run typecheck — zero errors in BOTH new package and extension
☐ bun run test in new package — all tests pass (moved + new)
☐ bun run test in extension — no regressions
☐ bun run build — clean Chrome + Firefox builds
☐ Load extension manually — unlock flow works
☐ [If NETWORK E2E tier] bun run test:e2e against local node — all pass
☐ [If NETWORK E2E tier] Manual send-token on local network
☐ [If M3.2/4/5] Re-run M2.6 crypto vectors + e2e regression suite
☐ Push, open PR, self-review diff
☐ Squash merge to master after approval
```

---

## Rollback strategy

Per phase:

| Phase | Rollback recipe | Blast radius |
|---|---|---|
| 0.x | `git revert <sha>` — pure-typecheck changes, no behavior delta | Zero runtime impact |
| 1 (wallet-core) | `git revert <merge-sha>` | Downstream phases (2-6) re-point imports; limited if phases haven't branched yet |
| 2 (crypto) | `git revert` + re-run M2.6 vectors to confirm recovery | CRITICAL if wallets shipped — same key derivation on revert (pre-refactor keeps bytes identical) |
| 3 (messaging) | `git revert` | Extension-only; RPC works on either shape |
| 4 (runtime) | `git revert` + manual QA of send flow | High — PXE path changes are subtle |
| 5 (bridge) | `git revert` | dApp integrations may notice; re-run discovery smoke |
| 6 (ui) | `git revert` | Visual regression surface; CSS regression patrol |
| 7 (hardening) | `git revert` — just CI/scripts; no code moves | None |

**Golden rule**: never revert M3.2 (crypto) in isolation once shipped to users. If the pre-refactor (0.3) keeps bytes byte-identical, then revert is safe in-dev; in production, prefer forward-fix.

---

## What to tell me at each step

When you're ready to start a phase:
- "Let's start M3.0 pre-refactors" → I create the `m3.0/decouple-node-globals` branch and begin.
- "Start M3.1" → I verify deps merged, create branch, execute the checklist.
- "Run smoke E2E for M3.2" → I build, load extension, walk through unlock/send.
- "Show the pass/fail state" → I report validation tier results per phase.

Do NOT ask me to execute multiple phases in one go — each is its own conversation slice so the diff is reviewable.
