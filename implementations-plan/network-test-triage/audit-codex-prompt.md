I'm triaging 18 failing e2e tests in a Chrome-extension Aztec wallet (`@nulo/extension`). I've already written a categorization plan, and I want you to **independently re-do the analysis from scratch** and challenge mine. Be critical — I'd rather catch a misread now than three PRs deep.

## The repo

`(project root)` — a Bun-workspaces monorepo. The relevant package is `packages/extension/`.

## My plan to audit

Read `implementations-plan/network-test-triage/plan.md` end-to-end first. It cites exact file paths and line numbers — verify them. The plan groups the 18 failures into 5 root-cause clusters (A–E) and assigns each cluster a tentative category (a) real bug, (b) bad test, (c) stale test, or (d) niche.

## What I want you to do

1. **Re-do the categorization independently.** For each of the 5 clusters, read the cited test file + the cited wallet code and form your own opinion before reading mine. Don't trust my summaries — verify them.

2. **Specifically challenge Cluster C (contacts-sender migrate).** I claim the wallet code at `packages/extension/src/popup/components/popups/EditContactPopup.vue:199-230` (`applySenderDelta`) explicitly intends to migrate the sender registration when the contact's address changes (truth table 1 1 1 → add(new), delete(old)), so the failing tests are NOT over-spec'd as the user previously believed — they're testing intended behavior. **Verify this.** Read the function. Read its callsites. Read `packages/extension/src/wallet/services/account-state/service.ts` to confirm `addSender` / `deleteSender` exist and do PXE writes. If you agree with my read, say so. If you find evidence the migrate behavior is in fact unwanted (e.g., a comment somewhere saying "we keep old senders intentionally"), find it.

3. **Find better hypotheses for Cluster A (importToken cascade, 11 victims).** I propose two alternatives — A1 (parseTokenInterface > 60s) and A2 (isComplete: false short-circuit). What am I missing? Specifically:
   - Read `parseTokenInterface` at `packages/extension/src/wallet/services/token/service.ts:312-400`.
   - Read `isTokenComplete` at `packages/extension/src/wallet/services/token/utils.ts:18-27`.
   - Read the popup helper `importToken` at `packages/extension/tests/e2e/fixtures/helpers.ts:326-362`.
   - Is there a third failure mode I'm missing? What about tasking subsystem timeouts, PXE block sync stalls, or service-client connection drops?

4. **Find tests I miscounted or miscategorized.** STATUS.md (`implementations-plan/parallel-e2e-isolation/STATUS.md:80-84`) breaks the 18 down as: 14 importToken-cascade (8 transfers + 5 fee-methods + 1 token-management) + 3 contacts-sender + 1 data-registerSender. My plan reworks that into 11 tokenReady + 3 feeJuiceImported + 2 contacts-migrate + 1 contacts-chip + 1 data-registerSender = 18. Verify my count.

5. **Suggest a more efficient Phase 0.** My phase 0 has 5 separate diagnostic runs totaling ~65 min. Can these be combined into fewer runs without losing signal?

6. **Surface anything I glossed over** in the fixtures or helpers that could be the actual culprit. The fixture bodies live at `packages/extension/tests/e2e/fixtures/extension.ts:285-558`.

## Format

Respond in **under 700 words**. Structure:

1. **Verdict** (one line): does the plan look correct, partially correct, or fundamentally wrong?
2. **Per-cluster review** (A, B, C, D, E): one sentence agreeing or disagreeing + specific evidence (file:line) when disagreeing.
3. **Things you found that I missed.**
4. **What looks fine** — only after genuinely trying to break it.

The user asked for a critical audit, not validation. Feel free to push back hard. If the plan is wrong, say so — I'd rather scrap it now than after I've gone down the wrong rabbit hole.

## Context that may help

- The repo has `CLAUDE.md` at the root and a more detailed `packages/extension/tests/e2e/README.md` describing the e2e setup.
- The parallel-isolation work is on branch `chore/e2e/parallel-agent-isolation`; that work is done and proven (concurrent two-worktree runs passed). The 18 failures predate that work and are NOT regressions from it.
- "Known issues / context" lives in `implementations-plan/parallel-e2e-isolation/STATUS.md`.
- The related tasks/tools have these conventions:
  - Tests are file-scoped fixtures (`{ scope: "file" }`); a fixture failure cascades into all tests in the file.
  - Default chrome.* / Puppeteer behavior in this repo is wrapped in `clickByTestId` / `closeStuckPopup` / `patchPagePolling` — those helpers are NOT relevant to the 18 failures (those failures are above the helper layer).
- The wallet uses `@aztec/accounts/schnorr` upstream account contract — there's no custom Noir source.
