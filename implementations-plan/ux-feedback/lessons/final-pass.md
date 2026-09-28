# Final cross-batch pass

A fresh codex session (GPT-6 Astra at high, `01a0da9a-…`) read the stack's net diff, from its
base `9f11de70` to its top. It looked for seams between batches, duplication across them and
drift from the spec, under the program's post-implementation rules.

## Round 1

Two minor findings:

> VERDICT: changes-requested — confidence: moderate

1. An account row's keyboard focus draws a tint and no ring (arcs 4 and 5b). Withdrawn as a
   defect: item 11's ring is for rows that open something, and an account row selects. Whether
   selection rows take the ring too goes to the owner, in arc 5b's PR.
2. Comments (arcs 5a and 5b). `dispatcher.ts`'s "Phase 3" line narrated the call below it, and
   `scope-enforcement.test.ts` said "NO LONGER". Both were fixed on arc 5a. The security ids
   (`F-01`, `F-004`) stay: they predate the stack and pair with the registry and its regression
   tests.

## The sync

The stack then moved onto `origin/dev` at `b15f5218`, five commits newer: the landing's Workers
deploy, npm publishing and a fix to it, the report-only plan-tree gate, and an import recipe.
Every arc's tree equals `git merge-tree --write-tree origin/dev` of its tip before the move. The
range-diffs show only round 1's fix, plus context that moved around the deleted line in two 5b
commits.

## Round 2

The same session, on the fix and all six rebased trees:

> **no new material findings**
>
> VERDICT: approve — confidence: high

It withdrew finding 1 as a defect, leaving the ring to the owner, and agreed the security ids
stay.

## Round 3

`d893ae95`, arc 5b's fold fix from its parity page's second reader, came after round 2. The same
session, resumed after a failed first attempt (`../b5-permissions/lessons/phase-10.md` § Codex
round 3), read it and the four no-change judgments listed there:

> **no new material findings**
>
> VERDICT: approve — confidence: high

## The stack-top gate

Two clean detached checkouts at `d893ae95`: the network files at retry 0, Chrome prover on, with
the `@requires-proverless` files run proverless, and Firefox proverless; smoke at its config's two
retries, which no test used. The flake bar is `cap-window` and the three network files P9 changed
(`cap-request-accounts`, `cap-request-basic`, `cap-request-rerequest`), three runs each.

| Step | Chrome | Firefox |
|---|---|---|
| `bun run lint` | exit 0 (1 s) | not browser-bound |
| `bun run typecheck:all` | exit 0 (39 s) | not browser-bound |
| `bun run test:all` | exit 0 (109 s) | not browser-bound |
| `bun run test:ci-gating` | exit 0 (33 s) | not browser-bound |
| `bun run build` | exit 0 (8 s) | not browser-bound |
| `bun run --cwd apps/extension build-storybook` | exit 0 (7 s) | not browser-bound |
| Network suite, retry 0, 102 files | prover on: exit 0; files 92 passed, 3 skipped of 95; tests 132 passed, 5 skipped of 137 (3,493 s). The 7 `@requires-proverless` files, proverless: exit 0; files 7 passed of 7; tests 18 passed of 18 (853 s) | proverless: exit 0; files 99 passed, 3 skipped of 102; tests 148 passed, 7 skipped of 155 (4,364 s) |
| Smoke (its build exit 0 / 0) | exit 0; files 38 passed, 3 skipped of 41; tests 157 passed, 7 skipped of 164 (827 s) | exit 0; files 39 passed, 2 skipped of 41; tests 153 passed, 11 skipped of 164 (1,074 s) |
| Flake bar, run 1 | exit 0; files 4 passed of 4; tests 8 passed of 8 (146 s) | exit 0; files 4 passed of 4; tests 7 passed, 1 skipped of 8 (169 s) |
| Flake bar, run 2 | exit 0; files 4 passed of 4; tests 8 passed of 8 (147 s) | exit 0; files 4 passed of 4; tests 7 passed, 1 skipped of 8 (171 s) |
| Flake bar, run 3 | exit 0; files 4 passed of 4; tests 8 passed of 8 (148 s) | exit 0; files 4 passed of 4; tests 7 passed, 1 skipped of 8 (170 s) |
| `bun run e2e:reap` | exit 0 | exit 0 |

`cap-window` and `window-placement` passed in both browsers, and both execution canaries
(`frozen-account-canary`, `passkey-execution-canary`) passed prover on inside Chrome's network
suite. The Firefox canaries stay open until CI's `Firefox / Run / canary / real-proving` job on
the stack top's head shows the substantive tests passed, retry 0, with Presto enforced and native
proofs in the server log. The restack after the gate changed only `implementations-plan/`: outside
it, the stack top's tree is `d893ae95`'s.

## The second sync

The stack then moved onto `origin/dev` at `e476e919`, one commit newer: #698, which untracks the
plan transcripts, pins their links and enforces the plan-tree gate. Outside `implementations-plan/`
it changes 11 files, docs and the gate, none of them product code. The gate refuses a link to a
file the tree does not hold. So each arc now names the later batches' plans as text, and the next
arc's first commit restores the links; `912190f9` also folds the mocks' nested ignore file into
the plans ignore file. A codex session at high (`01a0df2b-…`) read the move: "Material findings:
no", high confidence for the rewrite. The stack-top gate then ran on that top, `bcfb0806`, the
same way as below, and every step on both browsers exited 0.

## A CI-only Firefox failure

CI's Firefox smoke then failed #703 on arc 4's contact-row test, which no local run did. The cause
and the fix are arc 4's (`../b4-snackbar-rows-arrivals/lessons/phase-7.md`). Firefox's BiDi can
leave a link's new tab unannounced, so the fix finds the tab through the classic handle list
instead. It changes no product code.

## Two flakes on the push that carried the fix

Two other checks failed on that push. Each was investigated, treated as a flake and rerun once.
Neither the earlier failures nor the passing reruns rule out a timing change from the stack.

- #702's Chrome smoke, `onboarding-tab`. The first attempt died in the launch fixture's setup
  with `frame got detached`, and both retries ran with the fixture undefined: vitest 4.1.10
  marks a test-scoped fixture initialized before its setup resolves (`chunk-artifact.js:353-354`
  in `@vitest/runner`), so its in-test retries cannot recover from a setup that throws, while a
  job rerun starts fresh. A standalone repro gives the same three attempts. That setup's only
  such wait is the liveness wait on the scratch page, which on Chrome is the popup. On a fresh
  wallet the popup redirects to the onboarding tab and calls `window.close()`, and Chrome honours
  the call. A probe replaying the launch lost the scratch page in 4 of 4 launches once the worker
  answered the popup's first lookup, and in none of 6 when the popup booted against a cold
  worker. That is the supported hypothesis, not an established CI cause: the error's code path
  also covers a browser disconnect. The stack changes neither the scratch page nor the redirect;
  arc 4's popup connects two more service clients at boot, whose effect on this timing is
  unmeasured.
- #703's Firefox network, `send-picker`. After Home showed the imported ALT balance (line 28), no
  ALT row was visible within 15 s of the click on the picker's trigger (line 35). Dev's nightly
  failed the same way on 2026-09-26 without these stack changes (run 36230567767 on `b15f5218`,
  same shard and line), and the test passed on #704, whose tree holds #703's, and in every local
  battery. Its mechanism is not known.

A codex session at high (`01a0dfb2-…`) read the first: sound as a mechanism, with high
confidence in the vitest defect and moderate confidence in the CI trigger, and one rerun plus a
follow-up is the right response rather than a fix inside this stack. It corrected the follow-up:
the onboarding page is not guaranteed safe as a scratch page either, because its asynchronous
read of the flag can race the fixture's write. Its second round cut this record's wording back
to what the evidence shows, and its third found all seven corrections addressed: "Material
findings: no". Both follow-ups are in the plan.

## The stack-top gate, on the fix

Two clean detached checkouts at `490ca181`: the network files at retry 0, Chrome prover on, with
the `@requires-proverless` files run proverless, and Firefox proverless; smoke at its config's two
retries, which no test used. There is no flake bar here; the fix's own is in arc 4's lessons.

| Step | Chrome | Firefox |
|---|---|---|
| `bun run lint` | exit 0 (1 s) | not browser-bound |
| `bun run typecheck:all` | exit 0 (15 s) | not browser-bound |
| `bun run test:all` | exit 0 (96 s) | not browser-bound |
| `bun run test:ci-gating` | exit 0 (30 s) | not browser-bound |
| `bun run build` | exit 0 (8 s) | not browser-bound |
| `bun run --cwd apps/extension build-storybook` | exit 0 (6 s) | not browser-bound |
| Network suite, retry 0, 102 files | prover on: exit 0; files 92 passed, 3 skipped of 95; tests 132 passed, 5 skipped of 137 (3,503 s). The 7 `@requires-proverless` files, proverless: exit 0; files 7 passed of 7; tests 18 passed of 18 (854 s) | proverless: exit 0; files 99 passed, 3 skipped of 102; tests 148 passed, 7 skipped of 155 (4,342 s) |
| Smoke (its build exit 0 / 0) | exit 0; files 38 passed, 3 skipped of 41; tests 157 passed, 7 skipped of 164 (816 s) | exit 0; files 39 passed, 2 skipped of 41; tests 153 passed, 11 skipped of 164 (1,054 s) |
| `bun run e2e:reap` | exit 0 | exit 0 |

Both execution canaries passed prover on inside Chrome's network suite, and `cap-window`,
`window-placement` and `rows` passed in both browsers. The Firefox canaries again wait for CI's
`Firefox / Run / canary / real-proving` job on the stack top's head. The job must show the
substantive tests passed, retry 0, with Presto enforced and native proofs in the server log. The
commit that records this changes only `implementations-plan/`: outside it, the stack top's tree
is `490ca181`'s.

## The owner's stack sign-off

The owner answered the stack's sign-off page on 2026-09-28
(<https://claude.ai/artifact/WD1NGANFrHcE7fsrJKXPMp>, its `answers` store): the fee line when the
account pays, "Fine as it is"; tooltip text, "Pass 4.5:1"; a receipt with fiat values off, "No
chip when fiat is off"; Home's received row, "Keep today's row"; the dApp window width, "Only the
permission window at 400px". Everything else was signed off as built ("Everytihng else looks
good."), with two changes from the note. Three changes landed, each on its own arc:

- arc 3: the new tooltips' text is `--txt-body`, pinned at 4.5:1 in both themes (batch 3's P5);
- arc 4: the onboarding import opens no success snack, and its component test pins that through
  the real import flow (batch 4's P8);
- arc 5b: the permission window's groups run "Always asks you first", "If you allow, it can",
  "Without asking, it can" (batch 5's P11).

Every restack replayed the commits above it patch-identically (`git range-diff`, all `=`), and
every commit on the stack is signed. A codex session at high (`01a0e7ab-…`) read the changes:

- round 1, "No material findings; three comment/documentation nits", all three taken;
- round 2, "No material findings or further nits.";
- round 3, on arc 4's pin, "No material findings; one minor coverage gap", taken;
- round 4, "No material findings or further nits. The previous coverage gap is closed."

The gate ran on `df1849a2` in two clean detached checkouts: the network files at retry 0, Chrome
prover on with the `@requires-proverless` files proverless and Firefox proverless, and smoke at its
config's two retries, which no test used. Every step exited 0 on both browsers but Firefox's
network suite, whose one red file was the known `send-picker` flake (the plan's Follow-ups); run
alone in a third clean checkout, that file then passed three times. The table, the flake and the
two unit tests that timed out under host load on earlier tops are in
[batch 3's P5 log](../b3-tooltips-glossary/lessons/phase-5.md).
Both execution canaries passed prover on in Chrome's network suite; the Firefox canaries
wait for CI's `Firefox / Run / canary / real-proving` job on the stack top's head.
The commits that record this change only `implementations-plan/`: outside it, the stack top's
tree is `df1849a2`'s.

Nine passages in the gate records, from batch 2's to this file's own two above, said every e2e
file ran at retry 0. Smoke's config pins `retry: 2` (`apps/extension/vitest.e2e.config.ts`), and
`NULO_E2E_RETRY=0` reaches only the network config, so the full smoke suites ran at two retries;
the smoke flake bars ran through a scratch retry-0 config. The passages now say so. In the gates on
`4c20a006`, `023ca03c`, `d893ae95`, `490ca181` and `df1849a2`, no smoke test passed on a retry: the
repo's retry reporter (`tests/e2e/retry-error-reporter.ts`) printed nothing. The earlier gates'
smoke logs were not checked.
