# Dedup ledger — `apps/extension` + the `@nulo/*` packages it imports

**Status:** review complete 2026-09-06 · implementation started 2026-09-07 (this file's phase table is the
live state).

A maintainability review, not a bug hunt. Fourteen Sonnet 5 cluster reviewers each read every non-test
source file in one cluster; jscpd 5.0.16 (min-tokens 40) ran over the same scope; the 16 largest claims
were re-verified by hand. Result: **92 findings, ~3,300 net lines recoverable** out of ~117k read (2.7%).
The services are tight and already audit-scarred; more than half the waste is copy-pasted Vue
`<style module>` CSS and page shells. The full table is [`ledger.md`](./ledger.md); the per-cluster
transcripts with quoted evidence are under [`reports/`](./reports/).

## Phases

Five PRs delivered as one **bottom-up stack** (`gh stack`): P1 is based on `dev`; each later phase is
based on the previous phase's branch, so work continues on P(n+1) while P(n) waits for review. Slug ==
worktree dir == plan dir == branch suffix (`worktree-<slug>`). Phase 1 needs no blueprint; the rest run
`/blueprint` at the tier shown, inside the phase worktree. **Merging is the owner's call, bottom-up
(`gh stack merge`); the implementing session never merges.** After a lower PR merges, the session runs
`gh stack sync` and gets the rest green again.

| # | Slug | Mode | Finding ids (see ledger.md) | ≈LOC | PR title (≤ 93 chars, becomes the squash subject) | Status |
|---|---|---|---|--:|---|---|
| P1 | `dedup-p1-delete` | direct + codex loop | M4 I6 B4 E3 E2 C4 I3 I4 | 325 | `refactor(extension): delete dead code and make the access-level map exhaustive` | open #561 · green |
| P2 | `dedup-p2-adopt-helpers` | `/blueprint light` | X2 X3 X6 X1 E1 H3 J5 H1 C3 C8 L4 K2 M7 G2 G3 D5 L6 | 287 | `refactor: adopt the shared helpers that call sites re-typed inline` | wip |
| P3 | `dedup-p3-service-wrappers` | `/blueprint mid` | D1 D2 D3 D4 G1 C1 C2 C5 C6 F1 F2 F3 E4 E6 B1 B2 B3 B5 A1 A3 H2 H4 X4 I1 I2 | 742 | `refactor(services): collapse the repeated wrappers in the service and utility layer` | ☐ |
| P4 | `dedup-p4-vue-shells` | `/blueprint light` | J1 J2 J3 J4 K1 K7 K4 K5 K6 K9 K10 K11 L1 L3 N6 N9 M2 M3 | 1,132 | `refactor(popup): share the page shells and style partials across pages and windows` | ☐ |
| P5 | `dedup-p5-vue-components` | `/blueprint mid` | N1 N2 N3 N4 N5 N7 N8 L2 L5 K3 K8 M1 M5 M6 I5 | 670 | `refactor(popup): shared field, list-sync and card pieces for popups and windows` | ☐ |
| — | deferred (Tier 4) | owner call | A2 A4 B6 C7 D6 D7 D8 E5 X5 | — | not in scope — byte-frozen ciphertext framing, KAT-pinned bit math, audit-hardened session and purge code | — |

**Status values** (the implementing session writes the first two; the owner's merge produces the third):
`☐` not started · `wip` in the worktree · `open #<PR> · green` PR open, every required check passing,
codex loop converged, waiting for the owner · `✓ #<PR>` merged by the owner (the session flips it when
`gh pr view` reports MERGED).

Why this split: P1 is deletions only. P2 is "import the helper instead of re-typing it" — mechanical,
spans packages but changes no behaviour. P3 is TypeScript in the service and utility layers, where the
reviewers found real audit trails, so it gets the dual (codex + fable) audit. P4 is CSS partials and
page-shell components with every `data-testid` preserved verbatim. P5 is Vue components and composables
whose extraction changes rendering paths, so it gets the dual audit too.

## Rules for every phase

- **Scope is the phase's finding ids, nothing else.** A finding that turns out wrong or unsafe on contact
  is skipped and logged in lessons (id + why); nothing is substituted for it. Never pull in a Tier-4 id.
- **Zero user-visible behaviour change.** Every `data-testid` stays verbatim. No copy changes.
- **Complexity budgets:** no new `biome-ignore`, no new acceptance. If a refactor brings an accepted
  function under budget, delete its directive and run `bun run baseline:complexity` in the same PR.
- **Layer bans** (`biome.json` `noRestrictedImports`, the L0–L6 / C0–C1 model, the package order
  `wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension`) decide
  where a shared piece lives. The ledger's Refactor column already respects them.
- **Comments** follow CLAUDE.md "Code-comment style": say what the code can't; no plan or phase
  references in code.
- **Local gate before a PR is opened** (run from the repo root of the phase worktree, quote the exit codes):
  `bun run lint && bun run typecheck:all && bun run test`. Do not run e2e locally; CI runs smoke and
  network. When asking codex to review, say explicitly: *do not run the vitest e2e configs* (its
  global-setup kills the Chromes another gate owns).
- **Codex fix loop** (`/codex high`): the phase's net diff + this README's rules + an adversarial /
  security ask + no-over-engineering + comment-quality. Apply accepted fixes, commit, RESUME the same codex
  session with the fix diff, repeat until a round reports no new material findings — quote that line.
  Still churning after 3 rounds → surface and hold.
- **PR** only after the loop converged. P1: `gh stack init` on its branch, `gh stack submit`. P2–P5:
  `gh stack add <branch>` when the phase starts, `gh stack submit` when its loop converged. Conventional
  title from the table. Body: ids addressed, ids skipped with reasons, net LOC, the local-gate output.
- **Babysit:** `gh pr checks <n> --watch`. Red = flake → re-run once; red again → fix or hold. Never
  weaken a gate, never `--admin`, never `continue-on-error`.
- **Green** → set the row to `open #<n> · green`, `agent-worktree status <slug> "..."`, print
  `LESSONS_FILE=implementations-plan/<slug>/lessons/phase-N.md`, start the next phase on top.
- **Never merge.** `gh pr merge`, `gh stack merge` and the merge API are the owner's, whatever the
  checks say. After the owner merges a lower PR: `gh stack sync`, re-run `gh pr checks` on the rest,
  flip the merged row to `✓ #<n>`, `agent-worktree done <slug>` for it.
- **Lessons:** every codex consult with its verdict, every skipped id, every flake and re-run.

## Owner decisions (2026-09-07)

- **Merging is mine.** Green + codex-converged means "ready for me", nothing more. The session's job ends
  at five open, green, stacked PRs plus a wrap-up listing them bottom-up.
- **Blueprint approval gate (P2–P5) is pre-approved** when: the final codex audit verdict is approve, or
  conditional-approve with every condition adopted into `plan.md`; the plan's scope ⊆ the phase's ids;
  no Tier-4 id was pulled in; no user-visible change is planned. Anything else: hold and surface.
- **Pre-answers to blueprint's Phase 0 questions** (do not block on `AskUserQuestion`; use these):
  tier per the table · `code_review: off` · recon: 0 extra agents (the ledger and `reports/` ARE the
  recon; skip the reuse sweep) · foreign-reviewer effort `high` · delivery: this stack, one arc per phase
  · worktree homing yes, slug from the table, based on the previous phase's branch (this instruction is
  the standing authorization for `EnterWorktree` on the `dedup-*` slugs) · ELI5 companion: append one
  paragraph to this README's phase row instead of publishing a new artifact.
- **Feature removal:** none. The only deleted component (`FeeJuiceCard`) has zero importers.

## Operating notes (machine + repo memory)

- Signing is non-interactive on this machine; keep `commit.gpgsign` on.
- Check `codex login status` before starting. Logged out → hold and surface immediately; the
  foreign review is mandatory, a same-family pass does not replace it.
- In a worktree session Bash refuses heredocs and `cd` chains: write scripts to the session scratchpad
  and run them by absolute path. The tool shell's cwd persists and parallel calls race on it: prefix
  every command with `cd <absolute dir> &&`.
- Anything over ten minutes runs in tmux (`tmux new-session -d -s <name> "<cmd>"`), polled.
- Network e2e must run alone on the host; that is another reason not to run it locally here.
- On a linked stack, workflow files come from a merge ref that includes current `dev` while smoke builds
  the PR's head SHA: if `dev` gains a gate mid-stack, `gh stack sync` before reading a red as real.

## Seeds

Use exactly one per session; they do not compose. Start the session in the root clone on `dev`
with the permission mode you intend, AFK authorization given.

**Recommended — `/goal`** (completion is transcript-observable):

```
/goal Every row P1–P5 in implementations-plan/dedup-ledger/README.md's phase table reads `open #<PR> · green` (or `✓ #<PR>` once I have merged it), each backed in the transcript by: the phase's local gate (`bun run lint`, `bun run typecheck:all`, `bun run test`) reporting exit 0 in the phase worktree; a codex fix loop over the phase's net diff (`/codex high`, adversarial + no-over-engineering + comment-quality ask, fixes committed, the same session RESUMED for re-review) that converged — the converging pass's "no new material findings" quoted; for P2–P5 a `/blueprint <tier from the table>` run inside the phase worktree under the README's pre-answers whose final codex audit reached approve (or conditional-approve with every condition adopted) and whose plan.md phases are all ✓; `LESSONS_FILE=implementations-plan/<slug>/lessons/phase-N.md` printed per phase; the phase's PR opened only after that phase's loop converged, as a bottom-up stack (P1 based on dev, each later phase based on the previous phase's branch, submitted via `gh stack`, the table's conventional title ≤ 93 chars) with `gh pr checks <n>` showing every required check passing — a red check re-run once as a flake, then fixed, never neutralised, never `--admin`; NO merge command (`gh pr merge`, `gh stack merge`, the merge API) run by this session under any condition — merging is mine; after any lower PR I merge, `gh stack sync` run and every remaining PR green again; phases done strictly in order P1→P5; no Tier-4 (deferred) id touched; every skipped id logged in lessons with its reason; a final wrap-up posted listing the five PRs bottom-up, ready for my `gh stack merge`.
```

**Fallback — `/loop 15m`** (interval-driven):

```
/loop 15m Drive implementations-plan/dedup-ledger forward, phase by phase (P1→P5), never idle. Each firing: 1) Reality check — read README.md's phase table and the current phase's lessons (authoritative, not the chat); `git status`, `git log --oneline -5`; `gh stack view`; open PRs? `gh pr view <n> --json state,statusCheckRollup` (no --watch); one I merged? `gh stack sync`, flip its row to `✓ #<n>`. 2) No phase in flight → start the next on top of the previous phase's branch: home into the slug's worktree, P1 direct / P2–P5 `/blueprint <tier>` with the README's pre-answers; implement only the phase's ledger ids. 3) After each meaningful edit run `bun run lint` plus the touched package's tests; commit small, conventional, signed. 4) Diff complete → local gate (`bun run lint && bun run typecheck:all && bun run test`) → `/codex high` fix loop, resuming the same session each round, until a round reports no new material findings → `gh stack submit` with the table's title → `gh pr checks --watch`. 5) Red check: flake → re-run once; red twice → fix or hold. Green → set the row to `open #<n> · green`, print `LESSONS_FILE=…`, `gh stack add` the next branch. NEVER merge: `gh pr merge`, `gh stack merge` and the merge API are mine. 6) Stuck, or a decision you would normally bring to me → `/codex high` with full context, decide, log it in lessons; five failures on one step → reassess with codex. Hard limits: never `--admin`, never main or release branches, never a Tier-4 id, never a user-visible change, never weaken a gate. All five rows `open … green` → write the wrap-up (the five PRs bottom-up, what shipped per phase, skipped ids, every contentious codex call with the options and why) and stop.
```
