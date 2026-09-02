# Arc 2 — quality loop

## `/code-review low --fix`

Same shape as arc 1 (one fresh Sonnet reviewer over `git diff worktree-tools-rename...HEAD -M`, defects only, the by-design keep list spelled out). It grepped the tree for every old symbol (zero hits), checked all eight `App.vue` comparison sites and that nothing persists the tab id, confirmed the `promotion.test.ts` regexes still match the renamed error strings, confirmed nothing in-repo parses `live-intent.ts`'s promotion-summary keys, ran biome on the touched files and the touched suites (80/80 app, 14/14 promotion, 8/8 jsdom smoke).

Verdict: **clean — no findings.** One sub-threshold style nit noted ("the Drip tab drips its own tokens" is mildly repetitive); left as is. No code-review commit for arc 2.

## Codex round 1 (fresh session `01a05f4c-7bdf-7e62-a0b3-fe837b40d205`, xhigh)

"No Critical or High findings." Four material findings (1 Medium, 3 Low), all verified and adopted:

| # | finding | disposition |
|---|---|---|
| 1 | M — lessons substituted unit tests for the plan's "forget leaves neither key" browser check | done in the browser: a second throwaway spec called `forgetPreferredWallet()` via the dev server's module graph after a legacy-key reconnect → both keys null (lessons/phase-4.md) |
| 2 | L — `App.vue:18`, `network.ts:55`, `capabilities.ts:197` said mainnet hides the Drip tab / omits its grants; the button is unconditional and the app always supplies the drip tokens | comments corrected; `capabilities.test.ts` describe relabelled "bridge+fuel-only shape" (commit `3ab1845f`) |
| 3 | L — `incoming-transfers.test.ts` header claimed runtime coverage of the naming helper the test never exercises | header + inline comment reduced to what the test proves (mount-without-error smoke) |
| 4 | L — plan/review tags in five touched comments (`Plan-v2 §3`, `D-8/D-19`, `DP6`, `HIGH-1`, `D-1 pin`, `Invariant (audit)`) | tags removed, invariants kept |

Rejected: nothing.

## Codex round 2 (resumed, fix diff `3ab1845f`)

Three Low leftovers of round 1's own cleanup, all comment-only, all adopted in `c6bb7964`: the `buildCombinedManifest` doc comment still described the omission path as "mainnet" (now: shipped shape vs optional bridge+fuel-only); the incoming-transfers header/title still claimed the audit provenance and the untested scenarios (now: wiring-smoke wording, title renamed); two doc lines that restated their function (`defaultTab`, `__resetDripForTests`) deleted and the three cited review-history fragments in `live-intent.ts` removed. Four more `(review finding #N)` fragments in `live-intent.ts` sit on lines the rename never touched and were left alone (out of scope).

## Codex round 3 (resumed, fix diff `c6bb7964`)

One Low, comment-only: the incoming-transfers header still enumerated the two scenarios the test never exercises. Collapsed to the two facts the test proves (`60ad688b`). No functional finding in any round; the third round was the plan's hard stop for material churn, and this was not that — a one-line confirmation resume followed.

## Codex round 4 (resumed, confirmation on `60ad688b`)

Verbatim: **"no new material findings"**. Arc 2 converged.
