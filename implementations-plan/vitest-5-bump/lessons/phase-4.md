# Phase 4 — review loop, then the PR (2026-09-22)

The diff under review is everything from `25062c06` (dev at plan time) to the Phase 3 evidence commit
`43bc6407`; the plan is v5 (`plan.md`), the reuse map `recon.md`. `code_review: off` — `/code-review` was not
run; the codex loop is the review. Every round is GPT-6 Astra at `high`, read-only sandbox
(`approve-for-me` on this host, which cannot start `bwrap`).

## Round 1 — fresh session `01a0c9cc-1aed-71c2-a5c1-04a9b2088f47`

Verdict: **conditional approve — no implementation blocker found; evidence and plan-compliance corrections
remain. Confidence: high.** Five findings, none touching an executable byte:

1. should-fix — `lessons/phase-1.md`: the maintainer comparison the gate bypass required was omitted.
2. should-fix — `lessons/phase-3.md`: "not a vitest-5 regression" exceeds the evidence; a load-dependent timing
   regression is not excluded by passing alone + 9/10.
3. nit — `lessons/phase-3.md`: "330 runs per engine" is wrong (180 committed, 370 across attempts), and "one red"
   hides matrix #1's deterministic reds.
4. nit — `lessons/phase-1.md`: "the assertions never ran under vitest 4" is false — v4's `recordAsyncExpect`
   auto-awaited and warned.
5. nit — `lessons/phase-2.md`: the extension doctor aggregate ran twice, the plan said three.

Checked and fine (codex's own list): no weakened assertions, skips, longer timeouts or runtime-config opt-outs;
all six `vi.when` rewrites preserve the production calls' behaviour; no `clearMocks` / vitest#10373 masking;
15 successful compares and landing's 30 problems recomputed independently, every compact equal to its
full-report projection; all 32 compacts bound to `93b95f06`, vitest 5.0.1 and HEAD's lock hash; the top commit
adds Markdown and baseline JSON only; dispatch `35746293931` confirmed at that SHA; the reporter change
disclosed; fourteen manifests bumped, jsdom unchanged; no `bunfig.toml` commit, no personal absolute path, no
complexity suppression, no provenance comment.

Driver verification before folding: (1) `npm view` for the four versions — maintainers identical per package
across both versions, `_npmUser` `GitHub Actions` on all four; recorded as version-record snapshots (corrected in round 2: the registry does carry a `maintainers`
snapshot per version record, so the comparison is snapshot-to-snapshot, and it does not exclude an intervening
ownership change). (2)–(3) accepted as written. (4) confirmed in
`@vitest/expect` 4.1.10 `dist/index.js` (`recordAsyncExpect`, the `was not awaited` warning). (5) accepted as
a deviation: nothing from doctor ships (D4), and a third single-sample row under a 1-minute load above 100
would not be comparable to the first two.

All five folded (plan ledger R4-1..R4-5). No executable change → Phase 3 stands; no re-run.

## Round 2 — resumed, same session

Verdict: **conditional approve — no new implementation blocker; one factual correction and one bookkeeping
correction remain. Confidence: high.**

1. R4-1's wording was wrong in the other direction: the registry **does** expose `versions[<v>].maintainers`
   (vitest 0.1.0 lists `patak, antfu`; 5.0.1 the five recorded names). Codex confirmed both maintainer sets
   and all four `GitHub Actions` publisher records. Reworded in `lessons/phase-1.md`, the ledger and above:
   the compared version records report identical maintainer sets and publisher identities; that does not
   establish an immutable ownership history or exclude an intervening change. Driver-verified with
   `npm view vitest@0.1.0 maintainers.name` → `patak, antfu`.
2. R4-2..R4-5 faithful to the findings.
3. **No new material finding in the executable diff** — tests, the reporter change, the baseline-path change,
   the Biome exclusion, the manifests and the lockfile re-read; no test weakening, runtime workaround or
   unrelated dependency drift; the revisions do not invalidate the measured executable tree.
4. Bookkeeping: the plan's fail-closed rule (PR HEAD may differ from the matrix commit only by `**/*.md` and
   the baseline JSONs) does not literally admit the tracked `eli5.html` companion, which changed after the
   matrix. Recorded as a narrow exception (R4-7): the companion is documentation (HTML/CSS/text, never
   executed by any gate), and a matrix re-run would validate nothing about it.

Convergence: a resumed pass with **no new material findings**, quoted above — the loop stops here (round 2 of
a hard maximum of 3).
