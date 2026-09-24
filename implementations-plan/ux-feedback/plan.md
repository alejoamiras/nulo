---
plan: ux-feedback
kind: program — one blueprint per batch, one gh stack
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
same_family_leg: Agent, model fable (fallback opus)
tier_cap: mid
eli5_mode: artifact
budget: "never blueprint more than mid, to keep our credits safe" (owner)
design: implementations-plan/ux-feedback/design/spec.md
artifact: https://claude.ai/artifact/SgFiFtDsLtsku8CFre4CsF
---

# UX feedback program

Builds every decision from the user-testing proposal (items 1–12 and the tooltip map) as five
batches on one stack of six PRs. Each batch is its own blueprint, capped at `mid`. The design is
[`design/spec.md`](design/spec.md); the mocks it quotes rebuild from [`design/mocks/`](design/mocks/).

## Owner's brief

> "split this in batches (that make sense, so its not one PR per change) and give me a goal that
> goes through those batches and blueprints (with an appropiate level each of them) and decides
> with Codex interactions on open asks. Basically delivering a stack where all of this has been
> worked on (gh stack) and fixed. Adjusting obviously all needed e2es and creating more where
> needed. We need to be extra (extra extra extra) sure this works and quality is not lost in the
> process. We can create new tests if needed, and we shall adjust the ones needed. I'd say never
> blueprint more than "mid", to keep our credits safe. And let's also be very clear about changes
> needing to look the same to the ones worked on the artifact (reference the artifact because
> previously ive left you doing frontend work that turned up to look very different from what we
> had agreed upon)." (2026-09-23)

## Outcome & Quality Bar

For whom: someone opening Nulo for the first time, and anyone connecting a dApp to it, who reads
every word on a 360px popup and a 400px window.

Excellent means:

1. **It looks like the artifact.** Every changed surface matches its shot in `design/spec.md` at 1×:
   same components, order, icons and words. A difference exists only because the owner chose it.
2. **Nothing regresses.** Every existing gate stays green on Chrome and on Firefox, and every
   behaviour change has a test that fails without it.
3. **The permission window tells the truth.** Each row describes what the dispatcher enforces;
   Off = ask keeps apps working and never signs silently.
4. **Keyboard, screen reader and reduced motion work**: focus order, focus rings, the fee's
   spoken text, snackbar announcements, the arrival without motion.

Good enough: surfaces the spec does not list stay as they are; follow-up 4B and every rejected
option stay out.

## Batches

| ✓ | # | Batch | Items | Tier | Arc branch(es) | Plan |
|---|---|---|---|---|---|---|
| ✓ | 0 | Program setup | round 5 drawings, stack init | — | on arc 1 | this file ([lessons](lessons/phase-0.md)) |
| ✓ | 1 | First run and wording | 1, 3, 5, 7, 8 | light | `feat/ux-1-first-run-wording` | [b1-first-run-wording](b1-first-run-wording/plan.md) |
| ☐ | 2 | Window placement | 4 (A) | light | `feat/ux-2-window-placement` | [b2-window-placement](b2-window-placement/plan.md) |
| ☐ | 3 | Tooltips and glossary | 2, 9, T | mid | `feat/ux-3-tooltips-glossary` | [b3-tooltips-glossary](b3-tooltips-glossary/plan.md) |
| ☐ | 4 | Snackbar, rows, arrivals | 10, 11, 12 | mid | `feat/ux-4-snackbar-rows-arrivals` | [b4-snackbar-rows-arrivals](b4-snackbar-rows-arrivals/plan.md) |
| ☐ | 5 | Permissions | 6 | mid | `feat/ux-5a-authorization-confirm`, `feat/ux-5b-permission-window` | [b5-permissions](b5-permissions/plan.md) |

A row gets ✓ only when its plan has every phase ✓, its arc loop converged, and its parity
evidence is published (below). Order is the stack order: batch 1 changes the first-run flow that
every e2e fixture drives, batch 4 replaces the toast that `waitForToast` reads, and batch 5 needs
batch 3's dotted term and glossary.

### Batch scopes

- **1 · First run and wording** (light). Item 1 `DEFAULT_ACCOUNT_NAME`; item 3 V4 fee line and
  labels (spoken text included); item 5 first run without a name field, profile "Main", second
  profile prefilled "Profile 2"; item 7 lock chip A1; item 8 privacy-strip glyphs. UI impact:
  onboarding create page, popup header, fee card and menu (popup and dApp execute window),
  Home fee labels, send review strip, New Account naming.
- **2 · Window placement** (light). Item 4 A for all four dApp windows, the size-only retry.
  UI impact: where the windows open and their height; nothing inside them.
- **3 · Tooltips and glossary** (mid). Item 2 `Tooltip.vue` fix; item 9 glossary module, Settings →
  App → Glossary page, the dotted-term component, the CLAUDE.md rule; from the tooltip map, Home's
  two dotted definitions and two icon labels, and the two rule-6 texts (round 5 U8/U9). The
  permission window's two dotted terms and the Alias ⓘ removal ship with its redesign in batch 5,
  on the component and glossary keys this batch adds. UI impact: every tooltip's placement, Home
  fee labels and balance split, Settings → App, the new Glossary page, the dApp identity block
  warning, the import recovery-phrase note.
- **4 · Snackbar, rows, arrivals** (mid). Item 10 A′ in `@nulo/design` and every call site; item 11
  the row rules across every list; item 12 B, the arrival once per receipt with the per-account
  seen marker, and the elsewhere-snackbar. UI impact: all toasts, every list row's hover/focus,
  Home and History on a new receipt.
- **5 · Permissions** (mid, two arcs). Arc 5a: the per-app authorizations flag with Off = ask
  routed to the existing confirmation window, defaults (Off on "any contract"; unknown Off), the
  grant model without per-card unticking, the confirmation window's vocabulary (U6), the settings
  page (U7). Arc 5b: the redesigned permission window (S1, S2, S3, Details table, round-5 U1–U5,
  U10). UI impact: the permission window, the authorization confirmation window, Settings →
  Connected apps.

## Program setup (row 0)

1. `git switch -c feat/ux-1-first-run-wording` (from this worktree's `origin/dev` base; the root
   clone's local `dev` may be behind), `gh stack init feat/ux-1-first-run-wording` to adopt it,
   then commit this folder there (`docs(plans): ux feedback program, design spec and mocks`).
2. Draw round 5 (U1–U12, see [Round 5](#round-5-the-undrawn-states)), rebuild, check the page
   (no console errors, no horizontal scroll at 1400px and 400px, every new picker renders), and
   republish the artifact at its URL; notify the owner.
3. Firefox e2e prerequisites, missing on this machine today: geckodriver at the version and both
   SHA-256 pins in `.github/actions/setup-geckodriver/action.yml` (verify the tarball and the
   extracted binary, install to `~/.local/bin`), and `bun x puppeteer browsers install firefox`
   from `apps/extension`.
4. Validation gate: `python3 implementations-plan/ux-feedback/design/mocks/build.py` and
   `node implementations-plan/ux-feedback/design/shots.mjs` exit 0; the artifact publish result is
   in the transcript; `geckodriver --version` prints the pinned version; the Chrome and Firefox
   smoke runs in [Local gates](#local-gates) pass on the untouched base, so every later red is
   this program's.

## Local gates

The commands every batch gate and the final pass quote. `<b>` is `chrome` or `firefox`.

| Layer | Command |
|---|---|
| Lint | `bun run lint` |
| Types | `bun run typecheck:all` |
| Unit + component, every workspace | `bun run test:all` |
| CI-gating scripts | `bun run test:ci-gating` |
| Build | `bun run build` |
| Smoke e2e (does not build) | `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:<b>`, then `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e` |
| Network e2e, Chrome (builds itself) | `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent [files]`, prover on, excluding files marked `@requires-proverless` (`agent.sh` refuses them), which run separately with `NULO_E2E_PROVERLESS=1` |
| Network e2e, Firefox (builds itself) | `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent [files]`, proverless, as CI's Firefox shards run |
| Execution canaries, prover on (batch 5) | Chrome: the Chrome network command with `tests/e2e/network/frozen-account-canary.test.ts tests/e2e/network/passkey-execution-canary.test.ts`. Firefox: CI's Firefox canary job (below) |
| Storybook (when stories change) | `bun run --cwd apps/extension build-storybook` |

After the last Firefox run of a session, `bun run e2e:reap`.

**Proving modes (amended 2026-09-24, decided with `/codex high`, session `01a0d4da-73b1-…`).**

- **Why the Firefox network gate runs proverless.** Batch 1's first Firefox network run was prover on. Without Presto, the wallet proves in WASM. Both execution tests of `imported-account-execution` failed in `waitForToast`, with `script.callFunction timed out`.
- **The proven cause.** Firefox's BiDi session had Puppeteer's default 180 s protocol timeout, while `sendTransfer` waits 300 s for the toast. Batch 1 sets Firefox's budget to 300 s, as Chrome's already is.
- **An unproven cause.** That WASM proving holds the shared extension process is plausible but not established; a prover-on diagnostic run is recorded in batch 1's lessons.
- **What CI runs.** CI runs every network spec except the four canaries proverless on both browsers. So proverless is Firefox's gate mode here. Chrome keeps prover on, which is stricter than CI. The flake bar runs in each browser's gate mode.
- **Where the Firefox canaries run.** They cannot run locally: the local `presto-server` is 1.1.1 (CI pins 1.1.2), and its bb lookup needs a GitHub token this program may not handle.
- **What counts as Firefox canary evidence.** Batch 5's evidence is CI's `Firefox / Run / canary / real-proving` job on its PR, for the exact head revision. It must show:
  - the substantive canary tests passed;
  - retry 0;
  - Presto enforcement on;
  - native proofs in the server log.

  A skipped or fallback run does not count, and CI success is never reported as a local pass. The row stays open until that evidence exists, and the final pass repeats it on the stack top.

## How each batch runs

1. Run `/blueprint <tier>` for the batch against its scope above. Phase 0 is answered below, so
   no `AskUserQuestion`: record the pre-answers in the batch plan and start at Phase 0.4.
2. Homing: this worktree (`.claude/worktrees/ux-feedback`) is the program's home; the batch plan
   is nested at `implementations-plan/ux-feedback/<batch>/`. Do not create another worktree.
3. Recon: one reuse-sweep agent (plus at most one subsystem mapper on `mid`), seeded with
   [`recon-test-impact.md`](recon-test-impact.md) and the batch's section of the spec.
4. Audits per tier (`light`: codex; `mid`: competing outline, codex and fable in parallel, fresh
   codex pass on the ledger). Every audit prompt includes the adversarial and security asks, the
   batch's section of `design/spec.md`, and the parity rule: "flag any planned UI that differs
   from the spec or invents a state it does not draw".
5. Approval gate: the standing approval below, or hold.
6. Implement on the batch's arc branch, phase by phase, each phase closed by its validation gate.
7. Arc boundary: the codex fix loop until a round has nothing material (three rounds at most), then
   the parity evidence, then `gh stack add <next arc branch>`.

### Phase 0, answered for every batch

- **Success**: the batch's items built exactly as `design/spec.md` says, parity evidence
  published, every gate below green.
- **Who and what excellent looks like**: the program's Outcome & Quality Bar, plus one line per
  batch written into its plan.
- **Scope**: the batch's items only. Out: everything else, follow-up 4B, rejected options,
  `apps/tools/**`, `packages/bridge-core/**`, the `@aztec/*` line.
- **Constraints**: pre-production, so no storage migrations (CLAUDE.md); Bun 1.4.2; the account
  freeze untouched; complexity budgets hold with no new acceptance.
- **Quality bar**: production.
- **Validation layers**: typecheck and lint, unit, component, smoke e2e on Chrome and Firefox,
  network e2e on Chrome and Firefox wherever the batch touches dApp windows, network or PXE paths
  (batches 2, 4, 5 at least), Storybook build wherever stories change.
- **Surface vs delegate**: UI decisions go to the owner (the spec and round 5); technical
  decisions go to codex and are logged.
- **`/code-review`**: off.
- **`/harden`**: not scheduled. Batch 5 changes when Nulo signs silently; recommend
  `/harden security` before v1.0.0, the owner's call.

## Open asks: who decides

- **Owner only**: anything a user sees that `design/spec.md` does not quote or draw: a new string,
  a new state, a layout change, a different icon. Those come from round 5 or a message from the
  owner, quoted in the batch plan. A codex or fable verdict never settles one.
- **Codex** (`/codex high`, back and forth until a defensible decision, logged in the batch's
  `lessons/phase-N.md` and decision ledger): implementation, architecture, test design, security
  trade-offs, anything the user cannot see. Codex is advisory: it cannot override the spec, the
  owner's instructions, CLAUDE.md or the batch's scope; a conflict is surfaced and held.
- **When a technical choice changes what the user sees** (for example which authorization requests
  Off = ask covers, which decides how many windows open): codex decides the mechanism, and the
  visible consequence is stated in the PR body for the owner.

## Standing approval

Per the brief ("decides with Codex interactions on open asks … delivering a stack"), a batch plan
passes its approval gate without the owner when all of these hold, recorded in the plan:

1. Phase 0 is this file's pre-answers (or a later owner message, quoted).
2. Codex's final verdict is `approve`, or `conditional approve` whose conditions are applied and
   confirmed by a resumed codex pass.
3. On `mid`, the fable verdict meets the same bar.
4. No Ask is open: technical Asks decided with codex and logged; UI Asks answered by the spec, a
   round-5 pick, or listed as **sign-off pending** for the PR.
5. The plan's `UI impact` lists only spec surfaces, round-5 picks, or sign-off-pending items.
6. Nothing outside the batch's scope.

Otherwise the program holds: send a PushNotification naming the blocker and stop until the owner
answers.

## Parity gate (every batch with UI impact)

1. **Strings**: each spec string is asserted on its surface by a component test (dApp windows take
   wire-shaped fixtures: `0x` + 64-hex fields, real addresses).
2. **Screenshots**: rebuild the mocks and render the batch's shots with `design/shots.mjs`; build
   the extension; capture every changed surface in the e2e browser at the mock's size (popup
   360×600, dApp window 400×800, the same sample data where the fixture allows); publish one
   private Artifact per batch that puts each capture beside its shot.
3. **Compare**: the driver and, on `mid`, the fable leg read both images and list every visible
   difference. A difference sample data does not explain gets fixed, or goes to the owner.
   Codex cannot see images; it reviews the code and the string tests.
4. **Evidence**: the Artifact URL is printed in the transcript and linked from the PR body, next to
   the owner's sign-off quotes for that batch's surfaces (below).

## Tests

- **Adjust, don't loosen.** A test that fails because the spec changed a string or flow gets the
  spec's new value; a test that fails for any other reason is a bug to fix. Never delete a test
  or an assertion to go green; a deleted test needs a named replacement in the same commit.
- **Selectors by `data-testid` only**; new interactive elements get one; existing testids survive
  every refactor (CLAUDE.md).
- **Flake bar**: every new or changed e2e file passes three consecutive retry-0 local runs on Chrome
  and on Firefox before its batch closes. A flake is root-caused, never retried away.
- **Minimum new tests** (each batch's plan adds its own on top):
  - 1: first run creates "Main" with no name field (smoke, both browsers); second profile
    prefilled "Profile 2"; `registerProfile` (a first profile, so no field under the spec's rule)
    and `createAndActivateProfile` (a later one: clear the prefilled field before typing) follow
    the new flow; the first account of each network is
    "Account 1" and `NewAccountPopup` continues the numbering (unit); fee line per V4 state with
    its spoken text (component); privacy-strip glyphs (component).
  - 2: placement maths for the corner, the short-screen height and the rejected-position retry
    (unit), on both paths (`WindowManager` and `openVerifyWindow`); a network e2e asserting a
    dApp window opens at the corner (Chrome; Firefox where the driver exposes window bounds,
    otherwise stated in the plan).
  - 3: `Tooltip.vue` flip/shift/cap at both edges (component); every glossary key referenced by a
    dotted term exists (unit); the Glossary page lists the nine entries (smoke); the two rule-6
    texts are visible without hover (component).
  - 4: success hides after 6 s and waits while hovered or focused; an error stays until ×;
    polite/assertive roles (component); `waitForToast` updated, not bypassed; the arrival plays
    once per receipt and never with reduced motion; the elsewhere-snackbar never names a sender.
  - 5: Off = ask sends each authorization through the confirmation window and On signs in scope
    silently (dispatcher unit + network e2e via the playground's `createAuthWit`); "any contract"
    defaults Off; unknown defaults Off and is never granted by default; Connect grants what the
    window shows and nothing else (unit on the grant builder); the window renders S1, S2 and S3
    from wire-shaped requests (component); the prover-ON execution canaries stay green.

## Round 5: the undrawn states

`design/spec.md` § Undrawn states lists U1–U12. Program setup draws them into the artifact as
round 5, in the same generator style (`design/mocks/gen_*.py`), each with the recommended option
drawn and pickers in the `picks` store, publishes it, and sends the owner a PushNotification.
Batch 1 needs U11 and U12; batch 3 needs U8 and U9; batch 5 needs U1–U7 and U10; batches 2 and 4
need none. A batch
reaching one of those surfaces reads the picks first; if the owner has not picked, it builds the
recommended option and lists the surface under **sign-off pending** in its PR body. The owner's
pick always wins, even after the PR is open.

## Delivery

- **Stack**: arc 1 is adopted at program setup, then `gh stack add <branch>` at each arc boundary,
  in the order of the Batches table. Six arcs, six PRs, trunk `dev`.
- **Commits**: conventional, lower-case subjects, signed (this machine signs without prompting);
  PR titles at most 93 characters. Program setup commits this folder on arc 1.
- **Push** arc branches as checkpoints (`gh stack push`); no PR before every loop converges.
- **Open the PRs once**, after the final cross-batch pass: `gh stack sync`, then
  `gh stack submit --auto --open` (ready, not draft, so the Firefox lanes run), then add
  `e2e:extension-smoke` and `e2e:extension-network` to each PR after it exists (a label at creation
  cancels the e2e runs), then `gh pr edit` each body: summary, UI impact, the owner's sign-off
  quotes for its surfaces, sign-off-pending surfaces, the parity Artifact link, the test evidence.
- **Checks**: watch every PR (`gh pr checks <n> --watch`). A red check is a flake (re-run) or real
  breakage (fix on the owning arc, `gh stack sync`); never made advisory, never worked around.
- **Never merge** (`gh stack merge` and `gh pr merge` are the owner's).

## Final cross-batch pass

After batch 5's arc loops converge: a fresh codex session over the net diff from `origin/dev` to
the stack top, asking for seams between batches, duplication across them, and drift from the
spec, with the rules below; loop until clean. Then every row of [Local gates](#local-gates) on
the stack top, smoke and network on both browsers, the full network suite (no file filter).

## Post-implementation rules (every codex prompt, initial and resumed)

- *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
  extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
  problem. If code works and is clear, leave it alone."*
- *"Audit the comments for value per character. Flag any comment that narrates what the code
  visibly does, restates its line, references implementation plans / phases / reviews, or spends
  a paragraph where a sentence works — and flag places where a non-obvious invariant or
  constraint deserves a comment it doesn't have. Comments are permanent context every future
  reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
- Arc map: "this is arc N of 6; later arcs build X on it", so seams reserved for later arcs are
  not flagged as dead code.

## Hard limits

No merging; no force-push except `gh stack sync` on this stack's own branches; no publishing,
releases or deploys; no secrets; no `--admin`; no `@aztec/*` bump; nothing outside the batches'
scope; a red gate is never made advisory. Five failures on one step: stop, reassess with codex,
continue on the agreed path.

## Owner sign-off record

Picks from the artifact's `picks` store (2026-09-23), with the owner's words where given in chat:
i1 A; i2 "A only"; i3 A, then i3b/i3c V4 ("3 => V4"); i4 "A + B", "B (one connect window) is a
follow-up arc, not this one"; i5 A; i6 A, then round 3 ("I love it, but the rectangles look like
checkboxes. But I love the idea of the table.") and round 4 ("6 => B, Off = ask, unknown Off.
That's freaking awesome."); i7 A, then A1 ("Let's keep A1 for now."); i8 B ("Takes the least
height."); i9 dotted terms plus glossary, "Authorizations" ("9 => Authorizations."); tips "All of
it" ("Everything else sounds pretty good", without the "sponsor" tooltip); i10 A′ ("The timer bar
on the snackbar looks weird."); i11 A; i12 B. Round-5 picks are appended here as they arrive.

## Follow-ups (not this program)

- 4B, one connect window that turns into the emoji check after Allow: its own blueprint (it
  touches the verify path); round 1's "A + B" drawing is its design.
- The extension's testnet default "Test USDC" (`default-tokens.ts`) points at `0x1c81…e9ae`,
  which `apps/tools/public/testnet-bridge.json` no longer lists: its "Test USDC" is another
  address. A mirror fix for the `aztec-update` skill, noticed while drawing item 6.

## Seeds

Recommended: `/goal`. Fallback: `/loop 15m`. Both run from this worktree.

```
/goal Deliver implementations-plan/ux-feedback/plan.md end to end. Done when the transcript shows all of: (1) every row of plan.md's Batches table ✓, each backed by its batch plan (implementations-plan/ux-feedback/<batch>/plan.md) with every phase ✓, each phase's validation gate reported passing, and LESSONS_FILE=implementations-plan/ux-feedback/<batch>/lessons/phase-N.md printed per phase; (2) a quoted codex re-review with no new material findings for each of the six arcs and for the final cross-batch pass; (3) the round-5 artifact publish result, and a parity Artifact URL for every batch with UI impact; (4) gh stack view showing the six-PR stack, opened only after every loop converged, and gh pr checks for each PR with every check finished and none failing; (5) on the stack top, every command in plan.md's Local gates table reported exit 0, smoke and network e2e on Chrome and on Firefox. While working: never blueprint above mid; decide technical asks with /codex high instead of waiting for me; build no UI state that design/spec.md or my round-5 pick doesn't define (use the recommended option and mark it sign-off pending); never merge.
```

```
/loop 15m Drive implementations-plan/ux-feedback forward, never idle. Each firing: 1) read plan.md, the current batch's plan.md and lessons (authoritative, not the chat), git status, git log --oneline -5, gh stack view; rebuild the task list if empty. 2) If CI or a long e2e run is in flight, confirm it progresses and use the wait to review the diff or prepare the next phase. 3) No task in hand: take the next step from the current batch's plan (or start the next batch's /blueprint at its tier with the Phase 0 pre-answers); after each edit run lint plus the touched tests; commit; gh stack push. 4) Stuck or facing a decision: UI → design/spec.md, then my round-5 pick, then the recommended option marked sign-off pending, and a UI question none of those answers → hold and notify me; anything else → /codex high until a defensible decision, logged in lessons. Hard limits stay hard. 5) Same step failed 5 times: reassess with codex. 6) Phase gate passes: mark ✓, print LESSONS_FILE, advance; at an arc boundary run the codex loop and the parity evidence, then gh stack add the next arc. 7) All batches ✓: final cross-batch pass, full local gate, then Delivery per plan.md (submit --auto --open, labels after, bodies, checks), then the wrap-up report and stop.
```
