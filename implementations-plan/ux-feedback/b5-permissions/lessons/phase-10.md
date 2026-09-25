# Phase 10 · Parity and arc 5b gate

## P10.1 · Parity captures

Captured at `9892bfe8`, the chip fix below, in both browsers; A-19 is re-recorded at `8e64e1eb`,
its ring's fix. The captures come from a temporary e2e spec, `zz-b5b-parity.test.ts`. Each run
copies it into `tests/e2e/network/` and deletes it afterwards, and it is never committed. The spec
drives the real window over the playground at 400×800 in the dark theme, and every surface gets
its own connect. S1's exact data comes from `DetailsTable.stories.ts`'s S1 story, the exception
P10.1 records. The drawings are measured from `design/mocks/dist/nulo-feedback.html`, figure by
figure and `.fit` by `.fit`, in the same browser at 1x.

Everything lands outside the repo, in the program's handoff folder under `probes-b5b/parity/`:

- `manifest.json`: every surface beside its shot, in arc 5a's shape. It also holds what was
  verified, unreachable or held, what to recapture, the owner question, and how each of arc 5a's
  36 left-over shots is covered.
- `<browser>/captures.json`: the build's facts for each capture.
- `<browser>/measurements.json`: every row, group label, disclosure, Details row and account row
  paired with its drawing.

### Runs

Each run is retry-0 through one script: it copies the spec in, runs `e2e:agent`, deletes the spec
whatever the outcome, then runs `bun run e2e:reap`. Chrome runs prover on, Firefox proverless.

| Run | Code | Tests | What it showed |
|---|---|---|---|
| Chrome 1 | `83ac87ee` | 13 of 16 passed | S1 and A-8 picked Details rows by address; A-13 found no banner (lessons below). |
| Chrome 2 | `83ac87ee` | 18 passed | Adds A-17's details-only request and A-30's second contract. Every chip row 2px taller than drawn. |
| Chrome 3 | `83ac87ee` | 20 passed | A-5, A-31 and A-30 with A-32 get a connect each. A-4's data capture lost its badge: the spec had begun allowing A-4's address book. |
| Chrome 4 | `9892bfe8` | stopped in setup | Stopped to reject A-4's data request once before its capture. `bun run e2e:reap` reaped the owned run. |
| Chrome 5 | `9892bfe8` | 20 passed | The captures of record. |
| Firefox 1 | `9892bfe8` | 20 passed | The captures of record. |
| Chrome A-19 | `8e64e1eb` | 1 passed, 19 skipped | S2's test alone, into a separate folder. Only A-19's capture replaces its record. |
| Firefox A-19 | `8e64e1eb` | 1 passed, 19 skipped | The same. |

Every completed run's reap found nothing left.

### Results at `9892bfe8`

- Per browser: 42 captures, 60 shots and one verified request that must open no window (A-32).
  The S1 story adds one capture per browser, built at `83ac87ee`; under
  `components/composite/capabilities/` only PermissionRow has changed since, in its chip and its
  switch's transition. 48 surfaces pair with a drawing.
- **The S1-like window fits** in both browsers: its scroller is 690 of 690px, 0 overflow, and the
  document 800 of 800px. The story holds the drawing's 12 rows, the window the playground's 5.
- **Geometry**: 84 rows, 72 group labels, 34 disclosures, 39 Details rows and 26 account rows pair
  per browser. Each lands on its drawing within 0.01px, except A-17's details-only group (below).
- **The chip rows**: all 11 per browser land on the drawing, Firefox as Chrome.
- **Tab paths**, the same in both browsers: the S1-like window with Details open runs Details, the
  four named rows, the unknown row, then Reject, with no copy button on it (A-23). The story runs
  its 12 rows in the drawing's order.

### Differences that remain

None needs a change, and the manifest's `notes` carry each.

1. **Firefox's strip** is 35px against its drawn 36px: P9's pin (`da48c2b4`).
2. **The strip's separator** is drawn "/" and built "·". The spec keeps the strip as it is
   (`recon.md`, sweep note 9).
3. **The authorizations words**: S2 and S3 draw round 3's lines; the window shows round 4's
   (`06-auth-row-B`), which arc 5a built.
4. **Data**: the playground's contracts (Details counts and addresses), accounts (SANDBOX, the
   addresses) and network (Local Network, so U4's contract-code row says "on Local Network").
5. **Pairing**: a partial fit shows rows the build has beyond it. U6's "Requested operations" is in
   the window's text, outside the group reader. A-17 draws adding and details-only in one group,
   and each capture holds one, so the details-only group is shorter by the adding row and its
   border. A-23 draws every Details row closed; its capture has one open. U5 and A-11 draw the
   field's value as text; the window's is the input's value, recorded as the alias.

### A-19's ring, fixed in `8e64e1eb`

The Toggle primitive's `transition: all 0.2s ease` carried the row's focus ring. Right after Tab
the ring read 3px at 0 offset, and it settled on the drawn 1px at 2px within 400ms, in both
browsers. The drawn switch transitions only its background and border colour
(`design/mocks/src/nulo.css:443`), so its ring appears at once. "main" chose the drawing's
transition, a local rule on the row's switch, as parity work like the chip.

At `8e64e1eb` the ring reads 1px at 2px right after Tab, in PermissionRow's story and in the
window, in both browsers. The change moves nothing a still capture shows (the earlier A-19 shots
already held the settled ring), so only A-19 is re-recorded.

### Not captured

- A-14's three states: unreachable over the e2e's one node (reasons in the manifest).
- A-28: arc 5a's reason stands, no deterministic failed write.
- A-23's copy snack and A-28's error snack: recaptured after arc 4's snack change.
- A-27: the unknown row's spoken name is held for the owner.

### Gate at `8e64e1eb`

Run once from the worktree root at `8e64e1eb`, with only this file's edits uncommitted and no
scratch spec in the tree. The counts equal P9's gate: both fixes are CSS alone.

| Command | Exit | Notes |
|---|---|---|
| `bun run lint` | 0 | 29 warnings and 3 infos, all pre-existing; `complexity-baseline check OK` |
| `bun run typecheck:all` | 0 | 15 workspaces |
| `bun run test:all` | 0 | extension 7,700 passed, 4 skipped, 8 todo (593 files, 3 skipped); wallet-bridge 423; design 393; aztec-runtime 250, 2 skipped; wallet-core 247; extension-messaging 229; wallet-crypto 120; third-party-notices 66; legal 54; landing 40; resolve-asset 14; wallet-sdk-schema-patch 11; passkey-rp 5, 6 skipped |

### Held for the restack

P10.2 to P10.6 (the local gates, the whole network suite, the canaries, the flake bar and the
reap) run once, on the stack SHA, after "main" restacks 5b onto the new 5a. 5b then gains
`FULL_WIDTH_WINDOWS`, the A-23 and A-28 snack recaptures, and `window-placement` against batch
4's snack.

### Lesson: the drawings page renders in quirks mode

`design/mocks/dist/nulo-feedback.html` has no doctype, so its `document.compatMode` is
`BackCompat`. Quirks mode's line-height calculation gives a line that holds only an inline-level
box (inline-flex, inline-block, an image) no strut, so that line is the box's margin box. The
extension renders in standards mode (`CSS1Compat`), where the same line also takes the strut of
the inherited font.

So an inline-level element alone on its line measures shorter in the drawing than in the build,
and the difference sits below it. PermissionRow's chip was one: every chip row was 2px taller than
drawn. `9892bfe8` makes the chip block-level (`display: flex; width: fit-content`), which lands it
on the drawing in both browsers. The probe's numbers are in that commit's body.

Before reading a geometry delta against these drawings as a build defect, check whether it sits on
such a line. The mocks stay as they are: the owner signed off on what that page shows.

### Lessons for the capture flows

- **Details rows are keyed by section and position** (`known-0`, `unknown-1`, `any`), not by
  address. Pick a row by what it shows.
- **An open popup page can miss a network switch.** In the A-13 capture's first attempt, the
  window's "Switch wallet to Local Network" did not reach the home page opened before it. That
  page still showed Testnet, so `switchToNetwork` on it back to Testnet changed nothing, and the
  next window found the wallet on Local Network, with no banner. A fresh popup page switched it.
  Open one before switching again.
- **An Allow clears a type's rejection.** For a re-request to carry "previously denied", the last
  answer of its type has to be a rejection.
- **Line counts from range rects misread inline boxes.** A dotted term, or a label split across
  spans, whose top is 1px off its line reads as a second line, on both sides. Compare heights.
  Rows compare net of the 1px top border that a row after another carries.

## Codex fix loop

### Round 1

Codex (GPT-6 Astra, high effort), session `01a0da5d-0956-7ce0-945d-cfc609a529f4`, read
`a3629ac3..d4d73633` read-only, with no build or e2e run. Its verdict: changes-requested,
confidence high, six minor findings.

| # | Finding | Verdict | Fix |
|---|---|---|---|
| 1 | The Details table merges addresses case-blind, while `method-scope-checkers.ts:39` compares them exactly. | Rejected. A case-blind merge can only overstate reach, which is the table's invariant. The checker's exact compare predates the arc and fails closed. It goes to the program's follow-ups at the stack move; only the comments change. | `8058a2b4` (comments) |
| 2 | An unknown Details row is named by its address alone, and its column marks are hidden. | Accepted. Its name gains its columns, "{address}: {columns}", as a named row's does. Which form of the address it reads stays with the owner (A-27, a `test.todo`). | `f564fac6` |
| 3 | A selected, disabled account row's rename link still opens its field by Tab and Enter. | Accepted. `startRename` returns on a disabled row, and the link is aria-disabled and out of the Tab order. Nothing drawn changes. | `b5b5c037` |
| 4 | No test changes a switch while a submit is pending. | Accepted. The deferred-resolution pin flips the authorizations, data and unknown switches after approve() starts and checks the sent answer. | `0023f38b` |
| 5 | The fit check finds its scroller through `body *`, and two row checks collapse duplicates through `Object.fromEntries`. | Accepted. The scroll area carries `cap-scroll-area`, and the two specs compare row arrays in order. | `ede44e94` |
| 6 | Comments that are inaccurate or narrate. | Accepted. The details table states its display rule, two component headers go, and five review tags go while their invariants stay. | `8058a2b4` |

Each new test was run against the code before its fix. Finding 2's fails on the old table.
Finding 3's fails on the old row's missing aria-disabled, and on the opened field with only the
guard removed. Finding 4's fails on all three switches when the answer is read from them lazily.

Codex on the builder's calls, in the prompt's order:

| # | Call | Codex |
|---|---|---|
| 1 | Held accounts named only from the wallet's records, from the dispatch snapshot | Agree, high |
| 2 | A `contracts` capability that grants nothing is a no-op | Agree, high |
| 3 | "Nulo knows" fails closed when the fee-payer derivation throws | Agree, high |
| 4 | The Details table's rows and columns | Disagree, high: finding 1 |
| 5 | `data-fills-window` cannot leak to another route | Agree, high |
| 6 | The strip separator's `line-height: 14px` | Agree, moderate: Chrome rests on the recorded captures |
| 7 | The rename link as a button above the row's target | Disagree, high, on a disabled row: finding 3 |
| 8 | The answer is fixed once approve() starts | Agree, high; finding 4 adds the proof |
| 9 | The block-level chip and the colours-only switch transition | Agree, high |
| 10 | The e2e keys, connects, fit bound and helpers | Disagree, high, on the checks' assurance: finding 5 |

### Gate at `8058a2b4`

Run once from the worktree root at `8058a2b4`, the last fix, with a clean tree. The extension's
two new passes are findings 2 and 3; finding 4 extends a test, and every other count equals the
gate at `8e64e1eb`. The e2e are the three files finding 5 changed, each browser once, retry 0.

| Command | Exit | Notes |
|---|---|---|
| `bun run lint` | 0 | 29 warnings and 3 infos, all pre-existing; `complexity-baseline check OK` |
| `bun run typecheck:all` | 0 | 14 workspaces, and landing's pretypecheck |
| `bun run test:all` | 0 | extension 7,702 passed, 4 skipped, 8 todo (593 files, 3 skipped); the other workspaces as at `8e64e1eb` |
| The three files, Chrome, prover on | 0 | 7 passed; 143 s |
| The three files, Firefox, proverless | 0 | 6 passed, 1 skipped (reduced motion is Chrome's alone); 173 s |
| `bun run e2e:reap` after each | 0 | nothing to reap |

Each run's Aztec node printed `Address already in use (os error 98)` once while starting, then
reported ready, as in phase-4.md and phase-5.md.
