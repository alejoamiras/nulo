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
- **Gates:** lint, typecheck:all, test:all, test:ci-gating, audit:vue and lint:actions exit 0, before and after the rebase onto `8a62b9f9` (no file overlap, no conflict). Phase 2 edited no Phase 1 test file. The new files contain no `console.` or `chrome.`.

## Shots

- **Three surface bugs, all in the harness file, none in the product:**
  - The export gates' shake watch bound the field of the route still leaving, so it never saw the class. The watch now observes the document and re-queries the wrapper, and the gate waits until one unlock field is mounted.
  - The popup document outlives a surface, so a shake watch left by a dark-theme error surface leaked into the light-theme auth probes about half the time. The probe now consumes the watch.
  - A 60 s lock poll never won the lock against siblings polling at 1 to 5 s; a 1 s poll did.
- **Chrome's onboarding tab has raster noise.** On every run, 1 to 17 pixels differ, always at x = 39 or x = 255, as a small blue-tinted step of at most 19 per channel, in both themes. The same pixels differ when a build is shot against itself, including the parent commit that carries no arc-23 code, and in arc 24's runs on unrelated code. A scratch classifier checks every DIFF row against those two columns.
- **Testid commit vs its parent, Chrome and Firefox:** every probe identical, Firefox pixel-identical, and Chrome's only differences are onboarding noise.
- **Refactor head vs the testid commit, Chrome and Firefox:** the same. Every probe, including each shake's duration, timing and keyframes, is identical.
- **Stability (each build shot against itself, Chrome and Firefox):** the refactor head, the testid commit and the parent show only onboarding noise on Chrome and are identical on Firefox.
- **Forced-diff heads (Chrome, the shake surfaces):** each reds exactly the probes it should.
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

## Risk carried

- **Change-password reveals current, new and repeat together** from one flag. Kept as today; listed in Drift.
