---
plan: harden-dedupe
tier: program (each batch NONE, light or mid; capped at mid)
driver: claude-code
claude_model: opus
codex_model: astra
foreign_reviewer: /codex xhigh (GPT-6 Astra)
code_review: off
eli5_mode: artifact
branch: harden-dedupe (integration); arcs stacked on it with gh stack
worktree: .claude/worktrees/harden-dedupe
base: origin/dev at 8cfee502
---

# harden-dedupe: ship the 2026-09-30 duplication findings

The program ships Q-01 to Q-27 from `audit/quality/2026-09-30-dedup-high/`, together with three bugs those refactors fix directly: B-08 via Q-05, B-09 via Q-04 and B-12 via Q-03 (from `audit/bugs/2026-09-30-ext-high/`). Every other bug or security item those runs found goes to follow-ups, never into code. [recon.md](recon.md) re-checks every finding against dev 8cfee502 and records the duplication baseline.

## Where the plans live

Each batch's plan lives at `implementations-plan/harden-dedupe/batches/<batch>/plan.md`. That makes two deliberate deviations:

- **One worktree for all batches.** Normally every plan gets its own worktree; here they share one because the arcs stack on a single checkout.
- **Batch plans are nested here** rather than kept as sibling `harden-dedupe-<batch>/` directories. The plans gate gives every top-level plan directory its own index line, Outcome block and archive move. With 25 siblings, that means 25 edits to a shared file, and each of them conflicts on every restack. Nested batches close with the program.

## Delivery model

**Branches and merging.**

- `harden-dedupe` is an integration branch cut from `dev`. It has no branch protection, so the program enforces the gates itself.
- Each batch is one arc branch with one PR, stacked with `gh stack` on base `harden-dedupe`.
- At most two arc PRs are open at a time. Later arcs are built ahead locally, which keeps the cost of every restack bounded.
- An arc PR opens ready for review, not as a draft, so the Firefox lanes run. It opens only once its Codex loop has converged and its local gates pass. The labels `e2e:extension-smoke` and `e2e:extension-network` are added after it opens, never through `gh pr create`.
- An arc that passes every gate is squash-merged into `harden-dedupe` without the owner.
- Before any `gh stack merge`, the range it would land is checked first. A bare number can resolve as a stack number, so the command never runs blind with `--yes`.

**The behaviour-alignment arc is never merged by the program.** It stays open at the top of the stack, one commit per owner call, so a single call can be dropped. Once the integration PR lands, that arc is retargeted to `dev`.

**When `dev` moves** (at the latest between arcs):

1. Merge `dev` into `harden-dedupe` with a signed merge commit, `chore: sync dev → harden-dedupe`. It must be signed because `dev` requires signatures on the final merge.
2. Restack each open arc by replaying only its own commits with `git rebase --onto <new parent> <old parent tip>`. Save the old tips first, compare range-diffs, then run `gh stack sync`. Never use `gh stack rebase`.
3. When a generated file conflicts (`auto-imports.d.ts`, `components.d.ts`, `.eslintrc-auto-import.json`, the complexity manifest), regenerate it instead of merging it by hand.

**Finish.**

1. Open one PR, `harden-dedupe → dev`, and leave it green and unmerged.
2. The owner merges it with a merge commit, the agreed one-off exception, so each arc's signed squash lands on `dev`.
3. Before that PR opens, the program plan closes (Outcome, lessons, follow-ups, archive) and a final combined-diff Codex review runs.

**Links.** A plan never links a file that only a later arc adds: the plans gate runs on every arc's head, and it reads plain-text plan paths too. So this index names later batches by bare slug.

## Gates (every arc, on its head SHA)

1. CI: `quality-status`, `extension-smoke-e2e-status`, `extension-network-e2e-status`, `extension-smoke-e2e-firefox-status` and `extension-network-e2e-firefox-status`. **Five green names are not enough.** An aggregator passes on a skipped suite, so the lessons log records the head SHA, the run attempt and the shards that actually ran and passed, including both browsers' prover-on canaries.
2. Local, before the PR opens: `bun run audit:vue`, `bun run test:all`, `bun run test:ci-gating` (which includes `check:plans`) and `bun run lint:actions`. Run `bun run build` before the final check, and inspect the regenerated declaration files.
3. When the arc touches it: `build-storybook` (stories), the build plus the third-party notices output (fonts, assets), `mount-all.test.ts` (deleted components), wire-shaped fixtures (any approval window), and `bun run baseline:complexity` (an accepted function).
4. **Codex fix loop** on the arc diff: adversarial review, no over-engineering, no scope creep. At most 5 rounds; past that the arc is parked.
5. **UX:** see § Screenshots.

A red check is either a genuine flake, re-run once and logged, or real breakage, which gets fixed. A check is never made advisory and never skipped.

**Planning per batch.** A LIGHT or MID batch runs `/blueprint <tier>` in `batches/<batch>/`. Its questions go to the panel (Codex xhigh plus one Opus agent), never to the owner, and land in the plan's "Decisions (delegated)" section with both answers and the call.

**Complexity.** A shared helper that absorbs today's differences takes a strategy object, not a stack of boolean flags, so it stays under cognitive complexity 15. A new acceptance needs owner sign-off, so it parks the arc. So does an anchor move that needs the `baseline:move-approved` label, since only the owner applies it.

## Screenshots

- **What is compared.** Each UI arc is captured at its immediate parent and at its own head: the same routes, deterministic data, a fixed viewport, fonts loaded and animations off. That runs on Chrome and Firefox, in dark and light theme, across every state the change reaches.
- **The pass condition** is a zero pixel diff from the program's harness. An eyeball comparison does not count. Any non-zero diff is a refactor bug.
- **Where the shots live.** They are saved under `implementations-plan/harden-dedupe/shots/<batch>/`, which `.git/info/exclude` keeps out of git (so the repo carries no binaries). They are published in the program's Artifact.
- **Coverage.** An arc counts as "logic only" yet still touches a `.vue` file still gets the touched screens captured.
- **The landing.** It imports `@nulo/design`'s `base.css`, so any edit to that file also screenshots the landing.

## Behaviour rule

Every dedup arc preserves behaviour. Where copies disagree today, the shared helper takes the difference as a strategy or parameter, so each consumer keeps its current behaviour.

There are three allowed exceptions, each by its own route:

1. **Scoped bug fixes, in their own arc.**
   - B-08 is fixed in estimate-reuse. Its user-visible effect: a transient fee read now rebuilds the estimate instead of failing the send. The PR body says so, and the final report lists it.
   - B-12 is fixed in row-lifecycle. It needs two separate red-then-green regressions: an import racing a profile deletion, and a patch racing a chain purge.
2. **An invisible, strictly safer fix, in its own arc,** under written criteria:
   - *invisible* means no change to pixels, copy, dApp wire codes or messages, or persisted bytes on a realistic path;
   - *strictly safer* means it only adds a cleanup, or a refusal where today's result is wrong, and never relaxes anything;
   - it carries a red-then-green test and an entry under Decisions and in the PR body.

   Pre-cleared:
   - the LogsViewer timer is cleared;
   - the `window.id` guard is added to the json and logger windows;
   - Q-03(d)'s three-field row gate;
   - Q-19's empty-name guard.

   Decided per arc by its panel, under the same criteria:
   - the BalanceView add-dedupe;
   - each Q-18 epoch re-check point;
   - History's incoming profile guard.

   Explicitly excluded, so today's behaviour is kept:
   - the Q-21 keyval lookup. A fresh listing could delete a store created after boot, which is the cross-profile corruption the boot snapshot exists to prevent (`pxe/service.ts:217-220`);
   - Q-15's base64 decode strictness. Lenient to strict turns a garbled restore into a thrown error;
   - the adapter's userinfo policy.
3. **Everything else a user could see** goes to the behaviour-alignment arc, as delegated work pending owner sign-off.

## Batches

The order runs from mechanical and low-risk up to the riskiest, and each helper lands before its consumers. The UI column marks arcs that touch `.vue` or CSS, which carry the zero-diff screenshot gate.

| # | batch | findings | tier | why this tier | UI |
|--:|---|---|---|---|---|
| 1 | dead-code | Q-26 (a, b, c), except the activity-protocol coordinator; plus the audit import and this plan | NONE | deletion of unreachable code, each item proven unreachable | yes |
| 2 | design-tokens | Q-23 (a): one dark block; hairline and scrim tokens declared at today's exact values in `token-contract.ts` | LIGHT | `@nulo/design` only; no consumer edits; deliberate `base.css` hash bump | yes (landing too) |
| 3 | visual-shells-a | Q-22 (a, b, c); Q-23 (b) token adoption in the files it touches | LIGHT | settings rows, record cards, toolbar button; CSS only | yes |
| 4 | visual-shells-b | Q-22 (d, f, i); Q-23 (b) sweep of the remaining literal sites | LIGHT | detail pages, shimmer, snack card; CSS only | yes |
| 5 | error-registry | Q-20 | LIGHT | one package; `instanceof` identity and wire codes byte-exact | no |
| 6 | dapp-grant-planning | Q-19, Q-01 (c), then Q-11; batch refusal set unchanged | MID | consent planning in `wallet-bridge`; one owner for `dispatcher.ts` | no |
| 7 | chain-id | Q-01 (a) | MID | the composite chain id across aztec-runtime and the extension | no |
| 8 | execution-guards | Q-01 (b), Q-02 (a, b, c) | MID | `ChainInfo` binding, selector binding, class-id integrity; one pass over the execution files | no |
| 9 | network-endpoints | Q-04 (a) service and popup sites, (b) with B-09 kept behind a parameter, (c), (d), (e) | MID | network service, a new wallet-core leaf, the aztec-runtime transport allowlist | yes (endpoint popups, copy kept) |
| 10 | fee-strategies | Q-05 (a), the strategy half of (b); Q-24 (a) | MID | `fee/*` and `FeeSettingsCard` predicates | logic only |
| 11 | estimate-reuse | Q-05 (c), the reuse half of (b); Q-10; Q-04 (a) execution sites; B-08 | MID | snapshot producers, reuse ladders, persisted tx records | no |
| 12 | row-lifecycle | Q-03 (a, b, c without the config loop, d); B-12; Q-27 (b, m, n) | MID | persisted rows, deletion fences, imported-key wipe | no |
| 13 | profile-rows | Q-17 (a, b, c) | MID | MAC inputs and credential rows | no |
| 14 | incoming-arms | Q-18; Q-27 (l) | MID | concurrency: each epoch re-check point | no |
| 15 | async-primitives | Q-16; Q-15 (e): the record guards and their migrations (its panel moved the lenient base64 decoder definition to byte-primitives; byte-primitives' panel then dropped the hex decoder, which has one runtime site) | MID | wallet-core, extension-messaging, aztec-runtime; secret-export pages | logic only (zero-diff logger shots) |
| 16 | byte-primitives | Q-15 (a to d), except the two `wallet-crypto` secret boxes | MID | frozen blob paths; per-site decode strictness kept | logic only |
| 17 | pxe-idb | Q-21 (blocked-delete policy and keyval lookup as named parameters); Q-27 (k) | MID | deletion of persisted shared databases | no |
| 18 | restore-wiring | Q-25 | MID | the data-recovery contract behind the `never` casts | no |
| 19 | dapp-windows | Q-07; Q-27 (a, c) | MID | the trust-confirmation window's hostname check; execute window | logic only |
| 20 | popup-plumbing | Q-13 (a, b); Q-09 (a, b) with today's validation; Q-22 (g); the profile-name half of Q-27 (f) | MID | 25 popups plus the incoming-trust queue | yes |
| 21 | balance-snapshot | Q-12; the token-row half of Q-27 (f) | MID | stale-scope fences; a wrong fence shows another account's balances | yes |
| 22 | activity-feed | Q-06 (a to d) with today's scoping; Q-22 (e) | LIGHT | Home and Activity rows and empty states | yes |
| 23 | credential-inputs | Q-08; Q-14 (c) | MID | shared credential controls across onboarding, popup and security flows | yes |
| 24 | import-shells | Q-14 (a, b) | MID | moves the method tablist out of L4 so onboarding can import it | yes |
| 25 | behaviour-alignment | the owner calls below, one commit each | MID | changes what users see; delegated, pending owner sign-off; never merged by the program | yes |

### Owner calls (the behaviour-alignment arc)

Five calls, each with before and after screenshots and a recommendation, then one blanket sign-off line:

1. **B-09.** An edited Local Network endpoint reads "InvalidChain" and is left out of backups. The fix shows its real status and includes it in a backup. The evidence covers the restored backup's contents as well as the badge.
2. **Q-06.** History shows operations from other networks, which Home hides. Under the same call: History's empty-amount gate, which shows "0" for an empty amount where Home shows nothing.
3. **Q-09.** Contact-name uniqueness compares the untrimmed name but saves the trimmed one, so "Alice " slips past as a duplicate.
4. **Q-08.** Two of the four new-password forms lack `autocomplete="new-password"`. The evidence shows real password-manager behaviour first.
5. **Accessibility.** Reduced motion on the shake and the shimmers, and `:focus-visible` on the five toolbar buttons.

There is one non-UI yes/no line under the blanket sign-off: delete the dead activity-protocol coordinator (471 lines), or keep it for wiring.

**Kept as today, no call:**

- the duplicate-URL wording (Q-04 parameter);
- the shake durations;
- the tablist labels (Q-14 prop);
- no Enter shortcuts added to onboarding import;
- `:last-child` versus `:last-of-type`, and `overflow-wrap`, per consumer;
- the light-theme hairline value and the scrim alphas (Q-23, exact values);
- the NFKC difference in `EditProfilePopup`;
- the Q-07 error copy per window;
- the userinfo policy;
- the Q-21 keyval policy;
- Q-15's decode strictness.

### Deferred or dropped, with reasons

| item | reason |
|---|---|
| Q-24 (b), the FeeSettingsCard mode split | low confidence; worth doing only as an owner-visible plan |
| Q-27 (g), mint vocabulary | crosses #748's transfer recognition; an owner UI call |
| Q-27 (h), fee formatting | an owner UI call |
| Q-27 (i), the crypto box scaffolds | byte-frozen; low value for the risk |
| the two `wallet-crypto` secret-box sites in Q-15 | same reasoning as Q-27 (i) |
| Q-27 (d, e) | they host bugs B-14(b) and B-21, which are out of scope; deduping now preserves those bugs inside new helpers |
| Q-22 (h), the disclosure toggle | it sits in the approval windows, where the 2026-09 approval-card regression happened; a 10-line CSS dedup is not worth that risk |
| Q-22 (j), `SecretCountdownClose` | couples a secret-flow control to the design package's Button for little gain |
| Q-03 (c)'s config restore loop | recon rates it low value |
| retiring Q-21's rc.2-era sweep | a scope call; deduped with named parameters instead |
| Q-11's batch-refusal widening (`grantPublicAuthwit`) | a security change, not a dedup; the descriptor field, if any, is named for the refusal, not for popup gating, so the derived set cannot widen by itself |
| Q-27 (j) | already resolved on dev (#751) |
| Q-17 (d), Q-03 (e) | excluded by the audit itself |

Every deferred item becomes a follow-up when the program closes.

## Decisions (delegated)

### Batching panel (Codex xhigh and Opus, 2026-10-02)

**Both agreed:**

- **The residue arc is dissolved.** Its items moved to the arcs that already edit their files, which saves one CI hour and one unrelated review.
- **Q-01 (c) moves into dapp-grant-planning.** That arc then owns every edit to `dispatcher.ts`; otherwise Q-11 moves those lines and the next arc moves them again.
- **Q-04's four execution-side sites, Q-10 and Q-05 (c) form one estimate-reuse arc.** They rewrite the same snapshot producers. The fee strategies split off as their own arc.
- **Tokens are declared first and adopted later.** Each later arc swaps the literals in the files it already touches, and the last shell arc sweeps the rest.
- **Q-27 (d, e) are deferred,** since their bugs are out of scope.
- **The alignment arc is never auto-merged.**
- **Pixel-identical means a zero-diff harness,** not inspection.
- **`base.css`'s hash pin is bumped deliberately.**
- **Merging depends on suites that actually ran at the reviewed SHA,** not on green aggregator names.

**Disputed, and the call:**

- **Arcs 7 and 8.**
  - Codex: Q-01 plus Q-02 (a) together.
  - Opus: Q-01 (a) alone, then Q-01 (b) with all of Q-02, because Q-01 (b)'s `ChainInfo` literals and Q-02's guards are neighbouring hunks in the same seven execution files.
  - **Opus**, on the file evidence.
- **Tiers.** Codex wanted pxe-idb, restore-wiring, credential-inputs, popup-plumbing and design-tokens at MID; Opus wanted pxe-idb and balance-snapshot at MID.
  - **All raised to MID except design-tokens.** It stays LIGHT because it edits `@nulo/design` alone, with byte-identical values.
- **B-08.**
  - Codex: route it to the alignment arc, since it is observable.
  - Opus: keep it in its arc; the owner scoped it in and it involves no design choice.
  - **Opus.** It changes an operation's outcome, not a screen's presentation, and the brief scopes it into Q-05. The plan's claim that it is "not visible" is corrected.
- **B-09.**
  - Opus: fix it in its own arc and show it as information on the owner page.
  - Codex: route it to alignment.
  - **Codex.** It changes a displayed status and what a backup contains, which is exactly CLAUDE.md § UI changes. The extra cost is one small commit, because the unified status function already takes the local-kind parameter.
- **Owner calls.**
  - Codex chose: B-08, B-09, Q-06, Q-09 and autocomplete.
  - Opus chose: Q-06, the light hairline and accessibility, plus two yes/no lines.
  - **Merged into the five above:**
    - B-08 left (see its call above).
    - The light hairline is kept as today, since no realistic screenshot shows it wrong.
    - Q-09 and autocomplete stay, because they change validation and autofill outcomes on screens people use.
- **The "invisible, strictly safer" route.**
  - Codex: drop it.
  - Opus: keep it under written criteria.
  - **Kept, with Opus's criteria and Codex's exclusions.** Codex's Q-21 point is right: a fresh listing can delete a store created after boot. So Q-21, Q-15's decode strictness and the userinfo policy are excluded by name.
- **Batch plans as siblings or nested.**
  - The brief named `harden-dedupe-<batch>/` siblings.
  - Opus showed the plans gate turns that into 25 index lines and 25 archive moves in one shared file.
  - **Nested.** A layout choice, not a scope change.
- **Order.**
  - Codex: run visual and mechanical work earlier.
  - **The shell arcs move up to 3 and 4, right after the tokens.** The pxe-idb deletion moves later.

### Process

- **No per-batch ELI5 pages.** The blueprint protocol gives every plan an ELI5 page. With 23 batches, that would be 23 throwaway pages nobody reads during a driverless run. The program's single Artifact explains each batch instead, and every batch plan records `eli5_mode: none`.
- **Stack order follows readiness, not the table's numbering.** An arc whose files no earlier unmerged arc touches may land ahead of it. error-registry (5) landed before visual-shells-a (3) and visual-shells-b (4), and its plan records why. The numbers stay as labels.
- **The approval gate is the panel's.** A batch plan's own Codex audit, plus an Opus pass on MID batches, stands in for the owner's approval of the plan. Only the behaviour-alignment arc waits on the owner.

## Batch plans

Each LIGHT or MID batch gets `batches/<batch>/plan.md`; this index names each batch by its slug and links it once that batch's arc has landed.

- [design-tokens](batches/design-tokens/plan.md): landed as #762.
- [error-registry](batches/error-registry/plan.md): landed as #763.
- [visual-shells-a](batches/visual-shells-a/plan.md): landed as #764.
- [chain-id](batches/chain-id/plan.md): landed as #765.
- visual-shells-b: in review.
