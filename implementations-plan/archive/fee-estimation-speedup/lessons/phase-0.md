# Phase 0 — Preflight: gh-stack + baseline

## gh-stack

- `gh extension install github/gh-stack` → installed clean (gh 2.96.0). CLI fully functional locally: `init` / `add` / `submit` / `sync` / `view` / `unstack`.
- **Stack-vs-fallback decision**: attempt the native stack at PR-A submit time (`gh stack init` on branch A → `add` B, C → `submit`). The disputed enablement question (public-preview changelog vs codex's private-preview doc read) only bites at `submit`; testing it earlier would mean scratch PRs against the real repo — noise for no information we can act on sooner. **Fallback pre-authorized and documented**: classic chained PRs — PR A `feat/fee-est-quick-wins → dev`, PR B based on A's branch, PR C based on B's branch; retarget each to `dev` as its parent squash-merges. Either path satisfies the plan; the goal condition ("three stacked PRs opened against dev") is met by both shapes.
- Branch naming for the stack: PR A rides the worktree branch's content on `feat/fee-est-quick-wins`; B `feat/fee-est-sponsored-fastpath`; C `feat/fee-est-dapp-reuse`.

## Baseline (pre-change, dev @ worktree base)

- `strategies-structural.test.ts`: 5 tests green. Pinned call counts today: `fj` = buildStandard ×1 / simulateTxTask ×1; `fpc` = ×2 / ×2 (PREEXISTING then EXTERNAL, per-pass identity pinned); dApp adds the discovery build+sim ahead of the strategy (not covered by this file — unit-pinned in `dapp-send-executor.test.ts`).
- Full gate baseline: `bun run lint` exit 0 (33 pre-existing warnings on dev — not introduced here, left untouched); `bun run typecheck:all` all packages exit 0; `bun run test` 302 files / 3748 tests passed, 2 skipped.

## Gate result: PASS (typecheck/lint/unit)
