# Phase 6 · Browser proof and the arc gate

Every run below is on `fc3b0787` (after `origin/dev` at `0fa5a2cb` was merged in) unless it says
otherwise. The merge touched none of the files the red run swaps; its `fee-helpers.ts` change is
the bridge URL only.

## Running the suites here

- `e2e:agent` is a root script (`bash apps/extension/scripts/e2e/agent.sh`, which moves into
  `apps/extension` itself), so it runs from the repo root, with file paths relative to
  `apps/extension`. From `apps/extension`, `bun run e2e:agent` reports "Script not found".
- The network config defaults to 2 retries and the smoke config hardcodes 2. Every proof run here
  sets `NULO_E2E_RETRY=0` (network) or passes `--retry 0` (smoke).
- Every sandbox boot logs `[aztec-node] Error: Address already in use (os error 98)`, then comes up
  and serves the run.
- Firefox writes its own privileged `JavaScript error: resource://gre/...` lines (conduits, form
  handler, backup service) to the log throughout. None reaches the page: every case that asserts
  empty `consoleErrors` and `pageErrors` passed.

## The new case (C3)

- Green first, Chrome, prover on, retry 0, before the dev merge: 2 of 2 passed, none skipped; the
  new case took 7.9 s.
- Red on the unfixed P1 sources (`usePopupEntity.ts`, both authwit popups and `DropdownRoot.vue`,
  copied from `624117cd` over the branch and restored from a scratch copy afterwards):
  - Run 1: the first key, Enter on a focused priority button, set `aria-busy` on Send, so the
    unfixed popup started the toggle. The case then waited for the toggle in one 600-second
    `waitForFunction`. One wait is one protocol call, and the toggle outlasted the connection's
    300-second protocol timeout, so the case failed with
    `ProtocolError: Runtime.callFunctionOn timed out` instead of its own message.
  - Fix (`fc3b0787`): the wait polls in short reads and logs which key started the toggle.
  - Run 2: `Enter on a priority button started the registry toggle; letting it finish`, then
    `AssertionError: Enter on a priority button started the registry toggle: expected true to be
    false`. 1 failed, 1 passed (the Escape case), none skipped. That toggle finished within 20 s.
- The held-Enter step has its own red. On `624117cd` the case fails at its first key and never
  reaches the held Enter, so a probe removed only the Send button's `@keydown.enter` repeat guard
  in `ChangeAuthwitsRegistryPopup.vue` (a scratch copy restored it; `git status` clean after).
  Chrome, retry 0: the Escape case passed. In the new case, the priority-button and menu Enters
  passed, then `A held Enter carried onto Send started the registry toggle; letting it finish` and
  `AssertionError: A held Enter carried onto Send started the registry toggle: expected true to be
  false`. 1 failed, 1 passed, none skipped. Chrome's native button activates on a repeated Enter
  keydown; the guard is what stops it.

## Network e2e (step 4)

`NODE_OPTIONS=--dns-result-order=ipv4first NULO_E2E_RETRY=0 bun run e2e:agent` with
`popup-escape-layered.test.ts`, `authwit-lifecycle.test.ts` and `token-add-auto-trust.test.ts`.

- Chrome, prover on (WASM: no Presto server listens here): exit 0. Test Files 3 passed (3), Tests
  4 passed (4), none skipped, 248.9 s.
  - `authwit-lifecycle.test.ts`: 1 of 1 passed (114.2 s): grant, consume, revoke, consume refused,
    registry off and back on, all through the fixed popups.
  - `popup-escape-layered.test.ts`: 2 of 2 passed; the new case took 7.8 s.
  - `token-add-auto-trust.test.ts`: 1 of 1 passed (25.9 s): a real token add reaches the fenced
    auto-trust.
- Firefox, `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1` (the proverless build stamp checked):
  exit 0. Test Files 3 passed (3), Tests 4 passed (4), none skipped, 232.7 s.
  - `popup-escape-layered.test.ts`: 2 of 2 passed; the new case took 8.6 s. Its Enter recorder
    matched, so WebDriver BiDi sends `repeat: true` for a second `keyDown` of a held key.
  - `authwit-lifecycle.test.ts`: 1 of 1 passed (84.0 s).
  - `token-add-auto-trust.test.ts`: 1 of 1 passed (30.7 s).

## Flake bar (step 5)

`popup-escape-layered.test.ts`, retry 0; run 1 per browser is the step-4 run above.

| Browser | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Chrome, prover on | 2 of 2, none skipped | 2 of 2, none skipped, 79.6 s | 2 of 2, none skipped, 78.5 s |
| Firefox, proverless | 2 of 2, none skipped | 2 of 2, none skipped, 80.7 s | 2 of 2, none skipped, 89.3 s |

The new case took 7.8 to 8.6 s in every run.

## Smoke e2e (step 3)

The migration-fixture build per browser with the flags CI's smoke build sets
(`VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1
VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:<browser>`), then
`NULO_E2E_BROWSER=<browser> NULO_E2E_MIGRATION_FIXTURE=1 bun run --cwd apps/extension test:e2e
--retry 0`.

- Chrome: exit 0. Test Files 38 passed, 3 skipped (41); Tests 157 passed, 7 skipped (164);
  1091.6 s. The skips: `_probe-console-capture.test.ts` (3, needs its probe flag),
  `action-popup-layout.test.ts` (1, Firefox only), `store-captures.test.ts` (1, needs
  `STORE_CAPTURES`), and one `test.skip` each in `sw-resilience.test.ts` and `appearance.test.ts`.
- Firefox: exit 0. Test Files 39 passed, 2 skipped (41); Tests 153 passed, 11 skipped (164);
  1274.2 s. The skips: `_probe-console-capture.test.ts` (3), `store-captures.test.ts` (1),
  `import-dead-rpc.test.ts` (4, `CHROME_ONLY.cdpFetch`), `sw-resilience.test.ts` (2: its
  Chrome-only case and its `test.skip`) and `appearance.test.ts` (1, `test.skip`).

## Local gates (step 2)

- `bun run lint`: exit 0; 29 warnings and 3 infos, as on `dev`; complexity-baseline check OK.
- `bun run typecheck:all`: exit 0.
- `bun run test:ci-gating`: exit 0; 244 passed, 2 skipped, 0 failed, 17 files.
- `bun run test:all`: exit 0. The extension: 598 files passed, 3 skipped; 7843 tests passed,
  4 skipped, 8 todo. Every other workspace passed with none failed.
- `bun run build`: exit 0, and `git status` stayed clean, so the generated auto-import files match.

## Reap (step 6)

`bun run e2e:reap`: exit 0, "nothing to reap — no owned run, no orphaned data dirs, no orphaned
Firefox launches".

## The owner's captures

The sign-off captures of the two authwit popups (idle and loading, Chrome, 360×600) came from a
scratch spec copied into `tests/e2e/network/` for one run and deleted afterwards. Nothing of it is
committed.

## Codex round 1

Session `01a0ea74-cd47-76e0-a830-14c1b14ffc98` (gpt-6-astra, high, read-only), over
`origin/dev...dc52464d`. Verdict: changes requested. Two findings, both accepted.

1. **Major, confidence high** (`token/service.ts`, the last fence before `onTokenAdded`). The fence
   deleted the add's row by id whenever the profile's epoch had moved. If the watchdog displaced
   the add during its last network check, a deletion's purge and a same-id restore (`restore`
   allocates with `nextNumericId`) could both run first, and the delete then took the restore's
   row. Verified against `Lock.withLock`, whose `isCurrent` argument exists for exactly this, and
   against `restore`. Accepted: the fence deletes only while the add owns the lock
   (`assertCurrentBeforeEmit`); the row predates that deletion, so its purge removes it otherwise.
   Inline, the nested `if` took the lock callback to cognitive complexity 18, so the check moved
   into its own method.
   - Red first: the watchdog test now purges the profile and restores a token that reuses the
     add's id (asserted). On the unfixed code: `AssertionError: expected [] to have a length of 1
     but got +0`, the restored row deleted; 1 failed, 21 passed. Fixed: the token directory, 8
     files and 128 tests, passed.
   - The owned branch has its own test (a deletion during the last check with the lock held: the
     row is compensated, nothing is emitted). Red on a probe that never deletes (`expected 1 to be
     +0`), restored from a scratch copy; green on the fix, the token directory at 129 tests.
   - The add's two earlier compensations have the same shape. They are older than this plan, and
     there the row can postdate the purge's snapshot, so skipping the delete can orphan it: F-7.
2. **Nit, confidence high** (`incoming-transfer/service.ts`, `unhideLocked`). Its comment promised
   the activity feed updates atomically, but the loop writes and emits one record at a time and
   stops at the first refused write. Accepted with other words than codex's (its text restated
   `kept`'s scope, which the loop's own comment already gives): the comment now states the
   partial stop.

Commits: `1ccfe4e8`, `358adcb0`.

## Codex round 2

The same session, resumed with the round-1 fix diff, the reasoning behind the ownership gate, F-7,
the adversarial ask and both rules verbatim, over `origin/dev...4d3c9885`. Verdict: approve, no new
findings. On the gate (confidence high): the earlier post-set check establishes that the row
predates the deletion and the purge rereads tokens under the token lock; a displaced add skips the
delete, and an owned add issues it with no await in between. It found nothing else material in the
whole branch diff and called F-7 a distinct, documented pre-existing risk. The loop converged.

## The final gate, on `00e5b013`

P6's gate again after the loop, with `origin/dev` still at `0fa5a2cb`. Every command as above.

- Network, the three files, retry 0: Chrome, prover on, exit 0, 3 files and 4 tests passed, none
  skipped (242.4 s); Firefox, proverless, exit 0, 3 files and 4 tests passed, none skipped
  (233.4 s).
- Flake bar, `popup-escape-layered.test.ts`: 3 of 3 per browser, each 2 of 2 with none skipped
  (runs 2 and 3: Chrome 80.5 s and 80.4 s, Firefox 99.0 s and 91.3 s).
- Smoke, retry 0: Chrome exit 0, 38 files passed and 3 skipped, 157 tests passed and 7 skipped;
  Firefox exit 0, 39 files passed and 2 skipped, 153 tests passed and 11 skipped. The same skips
  as the first run.
- `bun run lint` exit 0 (29 warnings, 3 infos); `bun run typecheck:all` exit 0;
  `bun run test:ci-gating` exit 0 (244 passed, 2 skipped); `bun run test:all` exit 0 (the
  extension 598 files passed and 3 skipped, 7844 tests passed, 4 skipped, 8 todo; every other
  workspace green); `bun run build` exit 0 with `git status` clean; `bun run e2e:reap` exit 0,
  nothing to reap.
