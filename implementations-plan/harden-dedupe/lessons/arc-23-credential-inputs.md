# Arc 23, credential-inputs: lessons log

## Plan

- **Plan audit:**
  - Codex: REVISE, one blocker.
  - Opus: REVISE, no blocker.
  - The coordinator reconciled both; the batch plan's Decisions record every finding's disposition.
  - The blocker: a toggle that emits the negated prop (`update:hidden(!hidden)`) reads a stale prop on a second click in the same task, so two clicks leave the field revealed. The toggle emits a payload-free `toggle` and each host keeps `X = !X`.
- **`NewPasswordFields` was dropped.** Nine required props for about the lines it saved, one more component boundary around a password, and no help with owner call 4.

## Build

- **The testid commit came first** and is the shots base for the refactor, so the refactor diff carries no attribute changes. The shot surfaces fall back to a structural toggle selector on the parent, which has no testids, and the probes locate toggles structurally so both sides record the same thing.
- **`Input` binds no native `autofocus` or `maxlength`.** It focuses in `onMounted` and enforces the cap in its handlers, intercepting paste only when `maxLength` is set. The pins assert both attributes absent, read `activeElement` after mount, and dispatch real `paste` events.
- **VTU's `emitted("input")` also records native events** bubbling through the root. The pin counts native `Event`s whose target is an `HTMLInputElement` instead of asserting the key is absent.
- **The passkey encrypt-pair spike was not attempted.** It needs a passkey profile, a virtual authenticator, a WebAuthn ceremony and a profile deletion on both browsers. `export/full.vue` keeps its own keyframes, as the plan's Deferred allows.
- **Unit mutation run:** a scratch script applies each mutant and restores each file from memory, never with git.
  - 29 mutants. One survived the first run: auth's toggle moved from `#suffix` to `#bottom` still sat inside the field root, which was all the helper checked.
  - The helper now also requires the button's parent to be the input's row, not the root. That pin is green against the pre-refactor hosts and kills the mutant. All 29 red.
- **Gates:** lint, typecheck:all, test:all, test:ci-gating, audit:vue and lint:actions exit 0 after each rebase (onto `8a62b9f9`, `9aefac6e` and `11c70403`; none shares a file with this arc). Phase 2 edited no Phase 1 test file. The new files contain no `console.` or `chrome.`.

## Shots

- **Three surface bugs, all in the harness file, none in the product:**
  - The export gates' shake watch bound the field of the route still leaving, so it never saw the class. The watch now observes the document and re-queries the wrapper, and the gate waits until one unlock field is mounted.
  - The popup document outlives a surface, so a shake watch left by a dark-theme error surface leaked into the light-theme auth probes about half the time. The probe now consumes the watch.
  - A 60 s lock poll never won the lock against siblings polling at 1 to 5 s; a 1 s poll did.
- **Chrome onboarding noise at 1x: stale LCD fringes.**
  - At 720 px and 1x, Chrome differed by 1 to 17 px on onboarding surfaces even base against base: always at x = 39 or x = 255, a blue-tinted step of at most 19 per channel.
  - A probe of `elementsFromPoint` found nothing painted there; the pixels sit one column left of text that starts at x = 40 and x = 256 (the step cells, a section label, an input's text). Their rows moved between runs with the content. They are the left LCD fringes of text the route change moved, which fall outside the rect Chrome invalidates and so survive as stale specks.
  - Fix, in this batch's surface file only (`run.ts` copies only `surfaces/<batch>.ts`, so no other batch is affected): the onboarding tab is shot at 2x, like the popup and arc 24's onboarding. After the reach, it lets its transitions end and repaints the whole canvas with a root background toggle, which keeps focus.
  - The repaint alone gave a zero Chrome stability run. Arc 24 found 2x alone did too. Both are kept.
  - The round-1 classifier that accepted any change in those two columns is retired: every result below is zero diffs.
- **Coverage added in round 2:** masked captures of the full-backup decrypt field and password pair on both import hosts, and onboarding's decrypt field masked and revealed. Plus the focused name field in each of the four name hosts, valid and in the error state. Focus is held per surface: an own no-op `blur` on that one input, so the spec's pre-capture blur skips it and no other surface or batch changes.
- **Tightened checks**, each with a negative case that runs on the state before its action:
  - wrong-password lines: their exact text, absent before the submit;
  - the name alert: the exact "Profile name is required." as the shake wrapper's next sibling, absent before;
  - the shake: a `_shake_` CSS-module class, absent before the submit;
  - stored profiles: the same key set after a name-error submit, not just the same count;
  - change-password's mismatch hint: the exact text, after the exact length-rule hint on the empty pair;
  - leaving auth: the exact home hash, not already there before the unlock;
  - toggles: exactly one candidate button.
- **Stub audit: none to fix.** The batch installs no port stub and holds no answer. Every state comes from the real worker:
  - the wrong-password lines come from real unlock and verify calls with a wrong password;
  - the name errors come from real validation;
  - the profile count is the real store.
  The two backup fixtures are files a user can pick, read by the production parser:
  - 16 zero bytes in base64 is classed `encrypted` (`utils/full-backup-helpers.ts:47`: at least 13 bytes, first byte 0), which shows the decrypt field;
  - `{"data":{"profile":{"type":"password","name":"Imported"}}}` is `plain` with `profileType` "password" (`:44`, `:83`). It passes the unrecognized-file guard (`composables/useFullBackupImport.ts:478`) and shows the new-password pair.
- **Final runs, on the rebase onto `11c70403`, Chrome and Firefox, both themes:** the testid commit against its parent, the head against the testid commit, and the head against itself are all ALL IDENTICAL: 39 surfaces, 78 shots and probes per browser.
- **Forced-diff heads** (round 1, Chrome, the shake surfaces) each red exactly the probes they should:
  - `shake_password` at 0.35 s: auth, change-password and the export gate.
  - `shake_name` at 0.45 s: the four name-error surfaces.
  - Roles swapped, and `composes` deleted: auth plus the four name hosts.

## Code review round 1: CONVERGED

- **Codex (GPT-6 Astra, xhigh): no blocker, no should-fix, no nit.** It confirmed:
  - all eight toggles invert host state synchronously;
  - password inputs stay inline, and name forwarding and focus delegation add no await;
  - attributes, labels and field linkage are unchanged, with no new logging, storage or credential-bearing state;
  - the strengthened placement pin catches the `#bottom` mutant, and both new components meet the ten-case minimum;
  - the six migrated keyframes match their originals, and `create.vue` and `export/full.vue` are unchanged.

## Code review round 2 (screenshot evidence): NOT CONVERGED, all adopted

- **Blocker: the zero-diff gate was unmet.** A noise diagnosis is not pixel identity, and the classifier bounded neither the step nor the rows. Fixed at the cause (Shots above), and rerun to zero.
- **Should-fix: masked full-backup toggles, and the onboarding decrypt field.** Added.
- **Should-fix: focus never captured.** Added per surface.
- **Nit: comparison bundles carried another run's report.** Each run now keeps only its own report and captures.
- **Coordinator sweep: loose reach checks.** Tightened, as listed above.
- The code itself stayed CONVERGED, with no product regression found.

## Risk carried

- **Change-password reveals current, new and repeat together** from one flag. Kept as today; listed in Drift.
