# Codex xhigh audit — verdict: ship with changes

Session `019e1901-015b-72e1-8be2-fe3ebc61681a`. Response in `/var/folders/p9/.../codex-mTHfuoAC/response.md`.

## P1

1. **`phase [0-9]` grep arm catches LIVE runtime phase docs, not just historical milestones.** Examples:
   - `packages/wallet-core/src/base/index.ts:62` — service startup phases ("run in phase 0 (parallel); each subsequent phase starts only after…").
   - `packages/wallet-core/src/base/topology.ts:47` — runtime phase topology.
   - `packages/extension/src/wallet/services/profile/service.ts:143` — runtime phase docs.
   
   These describe live behavior, not milestones. Stripping them is a regression.
   
   Also missing from grep: `15` `PR-\d+` hits not paired with M-tags; `1` `Stage D` (`wallet/utils/index.ts:11`); mixed tokens like `PR-10 / AUDIT A12` (`storage/migrate.ts:18`).
   
   **Fix:** Split the scan into TWO passes — (a) historical tags (`M…`, `PR-…`, `Stage …`, `pre/post-…`, plan paths), (b) semantic runtime phases. Explicitly whitelist runtime `phase 0/1/2/3` documentation.

2. **The four cleanup buckets miss two real comment shapes.** Sampled 10:
   - 4 KEEP-drop-tag, 3 REWORD, 1 REPLACE-or-drop, **2 don't fit any bucket**.
   - Non-fit cases:
     - `wallet/services/execution/execution-coordinator.ts:3` — mixes a live class contract with PR-scope narration. Need a `split-block` rule (keep the contract, drop the PR narration).
     - `wallet/config/config.ts:13` — mixes removable milestone with keeper `AUDIT A1`. Need a `strip-historical-preserve-audit` rule.
     - `wallet/services/dapp-session/service.ts:78` — mixes removable `PR-10` with live security rationale.
   
   **Fix:** Add to §3:
   - `split-block` — when a comment contains both a removable tag and live invariant prose, split into two comments or trim the tag-paragraph only.
   - `strip-historical-preserve-audit-token` — when `AUDIT [A-Z]\d` is co-located with milestone tags, keep the audit token, drop the milestone.
   - `out of scope` — runtime phase terminology (`phase 0/1/2/3` describing parallel-startup behavior).

3. **CLAUDE.md rewrite drops three load-bearing rules.** The plan's target sections miss:
   - **`data-testid` preservation rule** (`CLAUDE.md:118`) — e2e selectors depend on testid stability.
   - **Lint-suppression discipline** (`CLAUDE.md:178`) — `noExplicitAny` + `biome-ignore` format.
   - **Account-contract + destructive-migration context** (`CLAUDE.md:184` + `:194`) — would-be regressors will re-break these.
   
   **Fix:** Re-add `testid preservation` as a named CLAUDE section. Keep a short `biome-ignore` / `noExplicitAny` rule. Move account-contract + migration facts into `ARCHITECTURE.md` or package READMEs **before** compressing CLAUDE.

4. **ARCHITECTURE.md TOC incomplete for actual behavior.** Missing:
   - **Offscreen health / recreate path** (`packages/extension/src/wallet/utils/offscreen.ts:206`).
   - **Storage versioning + destructive wipes** (`packages/extension/src/wallet/storage/migrate.ts:1`).
   - **dApp-session auto-approve lifecycle** (`packages/extension/src/wallet/services/wallet-sdk/background.ts:289`).
   - **Strict-mode restore semantics** (`packages/extension/src/wallet/services/profile/session-manager.ts:196`).
   - **Concurrency model — rw-guard** (`packages/wallet-core/src/utils/rw-guard.ts:21`).
   - **Capability bundles**: belong in playground README, NOT root architecture (`packages/playground/src/lib/bundles.ts:1`).
   
   **Fix:** Add subsections for offscreen lifecycle, storage versioning, session lifecycle, strict security mode, concurrency/serialization. Keep capability bundles in playground README.

5. **Commit 3 is review-hostile.** Semantics-heavy rewrite ≠ mechanical codemod; every comment needs judgment for invariant loss. The plan acknowledges size and waves it away.
   
   **Fix:** Keep one PR, split comment cleanup by package OR by risk area. If insisting on three commits, add a package-by-package checklist to the PR description and accept slower review.

## P2

6. **Cross-ref + validation policy:**
   - **`M6/conventions.md` should NOT remain a live cross-ref.** Contains stale Histoire/Lost Pixel/branch-naming guidance (`implementations-plan/M6/conventions.md:142`, `:177`). Absorb still-current rules into CLAUDE.md; drop the rest.
   - **`audit:vue` excludes `tests/e2e/**`** (per `packages/extension/vitest.config.ts:68`). Smoke suite is the only gate that exercises edited e2e files. Confirm `bun run test:e2e` runs in validation.
   - **`build-storybook` builds the WHOLE book** (`packages/extension/package.json:29`); "spot-check one component" is wrong wording. Run the full build.
   - **"No test changes" is misleading** when comment-only edits inside `.test.ts` and `tests/e2e/*.test.ts` are in scope. Reword to **"no behavioral test changes"**.

## What the plan got right

- Moving cross-package architecture out of CLAUDE.md.
- WHY/invariant comment rule.
- `implementations-plan/README.md` to quarantine milestone vocabulary.

## Cuts from scope (don't sweep)

- **External strings** containing fork history (e.g. `Legacy Faucet` user-facing strings). Not historical tags.
- **Live compatibility-boundary version refs** (e.g. "pre-0.11.0 wallets are not migratable"). Stay.
- **Volatile facts mirrored from `tests/e2e/README.md`** (`46 / 66 passing`, verified-concurrent-run port table). Do NOT mirror into new READMEs — they will rot.
