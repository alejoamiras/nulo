---
plan: popup-escape-followups
tier: light, without a plan audit (the owner scoped the run as "a single PR + codex iteration loop")
driver: claude-code
status: in review 2026-09-23 — all three fixes applied and validated locally; codex post-impl loop converged (conditional approve → approve → approve, 3 rounds); PR into dev opened, NOT merged (the owner decides)
eli5_mode: none (owner-scoped run)
code_review: off
budget: codex high, at most 3 rounds
merge: the owner's call — the authorisation that merged #675 does not carry over
follow-up of: popup-escape-closes (#675)
---

# popup-escape-followups — the three follow-ups #675 left

## Goal

Three small fixes found while landing popup-escape-closes, on one PR with a codex iteration loop. The owner, 2026-09-23: "afterwards please let's work on those three follow-ups on a single PR + codex iteration loop. They are all small enough."

1. **The `webdriver-ownership.test.ts` flake.** It fails `quality-status`, a required check on `dev` and `main`, on a loaded runner.
2. **A Firefox preview build on every extension PR.** `pr-quick.yml` built Firefox only when a diff touched Firefox build files, so the preview comment usually linked Chrome alone.
3. **`PasskeyCeremonyDialog`'s Escape.** It cancelled the ceremony but left the key unhandled, and Chrome's toolbar popup closes the whole wallet on an unhandled Escape.

## UI impact

| Surface | Before | After |
|---|---|---|
| The in-page passkey dialog ("Waiting for passkey…") in Chrome's toolbar popup: unlock, new profile, import, full-backup export | Escape cancels the ceremony and Chrome closes the whole wallet | Escape cancels the ceremony and the wallet stays on the page it was on (the unlock form, the export agreement gate) |
| The same dialog in a tab (onboarding, a wallet opened as a page) | Escape cancels | unchanged |
| Firefox's toolbar panel | closes on every Escape (Mozilla bug 1443758, WONTFIX) | unchanged |
| The PR preview comment | a Firefox link only when the diff touched Firefox build files | Chrome and Firefox links on every PR that builds the extension |

Nothing is drawn differently; the dialog keeps its copy ("press Escape to cancel").

**Owner sign-off (recorded):** popup-escape-closes listed "`PasskeyCeremonyDialog`'s Escape, which cancels without marking the key handled" among its follow-ups (plan.md § Delivery, owner's manual smoke). On 2026-09-23 the owner wrote: "afterwards please let's work on those three follow-ups on a single PR + codex iteration loop."

## Root causes

1. **Bun's `spawn` returns while the child is still inside execve.** Until the kernel has set up the new image, `/proc/<pid>/environ` reads empty, so a marker scan misses a live child. Read straight after `spawn()`, 1 990 of 2 000 reads came back empty on Bun 1.4.2 and none on Node 24.12. The unit suite runs on Bun (`bun --bun vitest`) and the e2e harness on Node. The module's full `/proc` scan usually outlasts the execve (0 misses in 300 on an idle host), which is why only a loaded runner fails. Pinned to one CPU next to three busy loops, 2 of 10 runs of the file failed: a fresh child missing from its owner's scan, and a release that took a mid-exec child for gone.
2. **`build-firefox` ran only on a `firefox-touching` filter** (manifest, the Firefox build scripts, the notices floor) or on PRs to `main`, so most PRs skipped it and the preview comment reported Firefox as "not built for this change".
3. **The dialog's window keydown handler cancelled without `preventDefault()`.** popup-escape-closes made that the rule for everything that acts on an Escape (CLAUDE.md § Keyboard & focus order); the dialog predates it.

## Change map

| File | Change |
|---|---|
| `apps/extension/scripts/e2e/webdriver-ownership.test.ts` | `spawnMarked` returns only once the child shows its marker, and its eight call sites await it. A new case swallows the signals of a launch that outlives SIGKILL and pins the retry of a failed send, one send per phase, the escalation, and the kept profile and record |
| `apps/extension/tests/e2e/fixtures/browser/ownership.ts` | `releaseLaunch` deletes the profile and the record only once the stop loop has seen the launch gone. `stopOwned` sends each marker-carrying process its signal once per phase and rescans on every poll, so one that was inside execve is signalled when it shows. It calls the launch gone after two empty scans a poll apart, as a best effort: nothing bounds how long an exec reads empty |
| `.github/workflows/pr-quick.yml` | the `firefox-touching` filter, its two outputs and its compute branch are removed; `build-firefox` runs on `build-chrome`'s condition |
| `scripts/ci-cd/behavior-gating.test.ts` | pins `build-firefox`'s condition to `build-chrome`'s; the notices test's `firefox-touching` expectation goes with the filter |
| `scripts/ci-cd/preview-comment.ts`, `CI.md` | the wording that called a skipped Firefox build normal goes |
| `apps/extension/src/components/passkey/PasskeyCeremonyDialog.vue` | the Escape handler calls `preventDefault()` before cancelling, and leaves an Escape alone once the ceremony has settled |
| `apps/extension/src/components/passkey/PasskeyCeremonyDialog.test.ts` | the Escape case dispatches a cancelable key and asserts `defaultPrevented` |
| `apps/extension/tests/e2e/helpers/pointer-probes.ts` | `pressEscape` moves here from `network/popup-escape-layered.test.ts`; its reader is added per press, just before it, so it runs after listeners a page mounts between presses |
| `apps/extension/tests/e2e/passkey-backup.test.ts` | the export-cancel case asserts the dialog's Escape came back handled |
| `.claude/skills/e2e-testing/SKILL.md` | the `pressEscape` pointer follows the move |

## Security & Adversarial Considerations

- **Ownership teardown.**
  - Nothing widens what is signalled or deleted: a process is signalled only if it carries the launch's marker, re-read just before the signal (unchanged).
  - Deletion now waits for the stop loop's verdict, two empty scans a poll apart; before, a single final scan could authorise it.
  - A launch that outlives SIGKILL keeps its profile and record for the next run's sweep.
  - Still best effort: a descendant no scan ever sees, inside execve across both scans, is not signalled and cannot be shown gone. Proving its absence would take cgroups or pidfds.
- **CI.** One more build job per extension PR, with the same permissions and artifact path as the Chrome build: no new secret, no new token scope, no store upload. The cost is runner minutes.
- **Escape.** The key is a user keydown in the extension's own document; a dApp page cannot synthesise it. `preventDefault()` suppresses only the browser's default action (closing the toolbar popup); a cancel still resolves to `UserRejectedError`, which every host treats as a silent return, and nothing is approved by Escape. Once the ceremony has settled, the handler leaves Escape to the browser: the page must not swallow an Escape nothing acts on.

## Validation

| Gate | Result |
|---|---|
| Ownership file, 10 runs pinned to one CPU with three busy loops, before the fix | 2 of 10 runs failed |
| The same, after the first fix / on the final code | 0 of 20 / 0 of 20 |
| Ownership file | 14/14; the SIGKILL-survival case fails if a thrown `kill` counts as sent, or if a sent signal is repeated |
| `bun run lint:actions` | clean |
| `bun run test:ci-gating` | 148 pass, 2 skip, 0 fail |
| `PasskeyCeremonyDialog.test.ts` | 11/11; with the `preventDefault()` removed, the Escape case fails (`expected false to be true`) |
| `bun run audit:vue` | exit 0 on the final code (7 059 tests, build) |
| smoke `passkey-backup.test.ts` + `popup-stack.test.ts`, Chrome | 5/5 |
| network `popup-escape-layered.test.ts` with the moved `pressEscape`, retry 0 | 1/1 |

`lessons/phase-1.md` has the probes and the commands.

## Post-implementation

`code_review: off`. A fresh `/codex high` session reviews the net diff from `5b447f45`, then is resumed until a round brings no new material finding (at most three rounds). Each round is logged in `lessons/phase-1.md`.

**Converged in three rounds.**

1. Conditional approve. The deletion gate and the signal retry were adopted; the pid/start-time veto and the dialog's keyboard modality were declined (see *Follow-ups*).
2. Approve, with two Low findings, both adopted.
3. Approve, with no new material findings.

## Follow-ups (not taken)

- **The passkey dialog does not trap focus.** A keyboard user can Tab to a control behind the overlay mid-ceremony and open a `Popup` there. One Escape then closes that popup and also cancels the ceremony, because the popup's trap listens on the document and the dialog on the window. No host builds that composition. Making the dialog modal for the keyboard changes how it behaves, so it waits for the owner's call.
- **Teardown's residual.** A descendant that no scan ever sees, inside execve across two scans a poll apart, is neither signalled nor shown gone. A real bound needs cgroups or pidfds, declined for a test harness.

## Delivery

One branch (`worktree-popup-escape-followups`), one PR into `dev`, opened after the codex loop converges: `gh pr create` with no labels, title of 93 characters or fewer. The body carries the UI-impact table and the owner's go-ahead. Watch `gh pr checks --watch`. **Do not merge**: report green and stop; the owner decides.
