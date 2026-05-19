# E2E stabilization + speed audit — parallel-claude plan

Drafted from a from-scratch investigation of the repo state. Mergeable with
the primary investigator's plan; deliberately opinionated where my reading
of the evidence diverges from the dossier.

## TL;DR

- **The smoke suite IS green on hosted CI today** (run `25859472562` at
  06:38 wall, 59 pass / 8 skip). The "quarantine" in PR #77 succeeded —
  the question is whether the skipped tests now belong in the suite at
  all or should be deleted/replaced.
- **The network suite has NOT actually been re-quarantined under load** on
  hosted CI. Recent network runs all *skip* every test because the PR
  didn't carry the `e2e:network` label and the path filter didn't trigger
  (`.github/workflows/pr-network-e2e.yml:65-79`). The 18 `test.skip` in
  the network suite are paper-only on CI; they were the right call on
  local but **we have ~zero CI signal that they're actually broken now**.
- **The R1 (PXE serialization) / R2 (RPC abort) framing from
  `plan-reconciled.md` was largely wrong** — `phase0-findings.md` already
  proved the real cause was the missing `ensureDefaultAccount` in the
  network-switch watcher. That fix is **still in place**
  (`packages/extension/src/popup/app.vue:131-162`). So when we un-skip,
  most network tests should pass.
- The smoke flakes are **two specific tests** with two specific causes
  that need fixing, not "popup-internal navigation race" as the skip
  comments claim. The skip comments are wrong about the cause.
- "We have a lot of timeouts to wait for stuff" is **partially correct**:
  576 timeout invocations, but only ~15 fixture-level fixed sleeps. The
  biggest wall-time sinks are not the small `setTimeout` calls — they're
  the slow steady-state of `hookTimeout: 300_000` for fixture setup and
  the multi-minute `tokenReadyExtension` cycle.

## Phase 0 — Baseline reality check

**Goal**: separate "the quarantined test passes if un-skipped" from "the
quarantined test still breaks" without doing any code change.

### 0.1 — Inventory the actual quarantines vs the dossier

| File | Test | What dossier said | What the code says today | Action |
|---|---|---|---|---|
| `appearance.test.ts:70` | "theme persists across navigation away and back" | "popup-internal navigation race" | Uses `navigateByHash` to `/about`. **The sibling `animations toggle persists across navigation` test (line 25) is NOT skipped and does the SAME `navigateByHash` to `/about` and back.** If the navigation race were real, the sibling would flake too. | Re-classify. Different cause. |
| `security.test.ts:79` | "auto-lock TTL change persists across navigation" | Same as above | Same navigateByHash to /about. But this test is the *third* in a file-scoped fixture chain after a password rotation + lock + unlock. Probably state pollution, not navigation. | Re-classify. |
| `contacts.test.ts:91` | "delete contact" | "popup-internal waitForToast race" | **The current `deleteContact` helper has NO `waitForToast`** (`helpers.ts:382-385` — it just waits for the row to disappear). The skip comment is stale. The actual final assertion is `consoleErrors).toEqual([])` — brittle to teardown noise. | Re-classify. |
| `sw-resilience.test.ts:52,93,125,186` | 4 SW-respawn tests | "Puppeteer 'Navigating frame was detached' on SW respawn" | Tests stop SW via CDP, then `openPopup` → relies on `waitForLiveness` (line 24) + `waitForHash`. The respawn timing is genuinely racy on hosted CI. | Confirm. |
| `passkey-backup.test.ts:167` | "passkey full-backup export" | "hosted GH Actions 5-10x slower; 90s timeout still blew past" | The test asserts CTAs become enabled within 90s. CI failure log shows ~290s before fail. **Real**: 11-service backup chain + SHA hash is genuinely slow on hosted runners. | Confirm but reclassify as "slow product chain, not a test flake". |

### 0.2 — Cheap rerun matrix

Don't push to CI. Run **each smoke quarantine alone**, locally on Linux
(via Lima or a CI runner image), to determine the failure mode. Each
test runs in <60s so the whole inventory is ~8 minutes:

```bash
# Per-test reproduction. Use Linux-like environment.
bun run --cwd packages/extension vitest run --config vitest.e2e.config.ts \
  tests/e2e/appearance.test.ts -t "theme persists"
bun run --cwd packages/extension vitest run --config vitest.e2e.config.ts \
  tests/e2e/security.test.ts -t "auto-lock TTL"
bun run --cwd packages/extension vitest run --config vitest.e2e.config.ts \
  tests/e2e/contacts.test.ts -t "delete contact"
bun run --cwd packages/extension vitest run --config vitest.e2e.config.ts \
  tests/e2e/sw-resilience.test.ts
bun run --cwd packages/extension vitest run --config vitest.e2e.config.ts \
  tests/e2e/passkey-backup.test.ts -t "modal appears"
```

For each, capture: pass/fail, wall time, the first error line, and the
state of `consoleErrors`/`pageErrors`.

The cheapest CI signal is: temporarily un-skip ALL the smoke quarantines
on a throwaway PR labeled `e2e:smoke` (or with no label so the path
filter triggers them), and use **5 reruns** of the Smoke workflow to
estimate the per-test flake rate. Hosted CI run takes ~10 min × 5 = 50
min of CI time; cheaper than guessing.

### 0.3 — Network suite reality check

The network workflow on the PR-77 merge ran but **all 67 tests
skipped** — confirmed in run `25859472608` log:

```
Test Files  44 skipped (44)
      Tests  67 skipped (67)
   Duration  20.53s
```

That's because the PR didn't touch any of the network-filter paths so the
`decide` job set `run=false`. So **there is no recent CI run that exercises
the actual network suite under load**. To establish a baseline:

1. Temporarily un-skip every `test.skip` in `tests/e2e/network/` and the
   `test.skip` on the contacts-sender test (test 1 at line 37).
2. Open a throwaway PR with the `e2e:network` label OR rebase onto a
   network-path-touching change.
3. Capture: pass count, fail count, flake count via the `multi-account-from`
   /`meta-getChainInfo` retry signal.
4. If pass rate is ≥ 64/66 (matches the `full-suite-findings.md` baseline),
   the quarantines were defensive and we can un-skip cleanly. If not, we
   have new regressions, and `phase0-findings.md` needs a v2.

**Anti-scope of Phase 0**: don't fix anything. The output is a categorized
inventory: green-on-rerun, red-on-rerun, or genuinely-flaky.

---

## Phase 1 — Smoke stabilization

### S1 — `appearance.test.ts:70` + `security.test.ts:79`

**My hypothesis** (challenging the skip comments): NOT a navigation race.
The sibling `animations toggle persists across navigation` test uses the
same `navigateByHash` → `/about` → back and doesn't flake. The actual
flakes are:

- **appearance**: between the **`setTheme(page, "light")`** and the
  subsequent `navigateByHash`. `setTheme` writes a config flag via the SW
  RPC; under hosted CI the SW round-trip can take seconds, and the
  navigateByHash fires before the theme has been *persisted*. When we come
  back, the theme reads from storage and is still "system" (or whatever
  was prior).
- **security**: the test depends on the file-scoped fixture surviving the
  *previous* test, which rotated the password AND locked the wallet. The
  third test re-enters via `ensureUnlocked(page, NEW_PASSWORD)`, but the
  active SW session may still be using the OLD passhash because
  SessionManager async clears the in-memory bearer. The `openPopup` lands
  on `/popup/auth` instead of `/popup/general`, and the `waitForHash`
  times out.

**Fix surface** (one PR, ~2 hr):

1. `appearance.test.ts:75` — replace `await setTheme(page, "light")` with
   a deterministic wait for the theme write to land in storage. Add
   `await waitForToast(page, "Theme")` if there's a toast, OR
   `page.waitForFunction(() => chrome.storage.local.get("nulo:ui:theme")...)`
   for the actual persisted value.
2. `security.test.ts` — restructure `auto-lock TTL` test to either:
   - **(preferred)** use `registeredExtensionPerTest` instead of
     file-scoped — eliminates the password-rotation contamination
   - or explicitly assert `await waitForHash(page, "#/popup/general", 30_000)`
     with a longer timeout after `ensureUnlocked`.

Both tests have a clean signal to wait for — the skip is masking missing
synchronization, not a real product bug.

**Validation**: smoke run, locally + 3× CI runs. Pass criterion: 3/3
passes on each test in isolation, 5/5 passes in the full smoke run.

### S2 — `contacts.test.ts:91` "delete contact"

**The skip comment is stale** — `deleteContact` doesn't use `waitForToast`
anymore (helpers.ts:332-385). The actual brittle assertion is on
`consoleErrors`. The non-skipped sibling test
"delete-confirm has no unregister-sender toggle for a non-sender contact"
(line 103) does the same flow and passes.

**Fix surface** (one PR, ~30 min):

1. Update the test to match the sibling pattern — drop the
   `consoleErrors` assertion or filter for benign disconnect errors
   (`isBenignPasswordChangeError`-style helper).
2. OR delete the test as redundant. The "delete row + non-sender confirm
   toggle absent" test (line 103) plus the "edit contact name" test (line
   58) cover the add+delete CRUD; this test contributes a `deleteContact`
   helper exercise that should be moved to the helper's unit tests.

**My lean**: keep the test, fix the assertion. The user-visible "delete a
contact via the row affordance" path deserves explicit coverage.

**Validation**: 3× local + 3× CI runs.

### S3 — `sw-resilience.test.ts` 4 tests

**The claim**: "User-visible lock/unlock + strict-mode contracts are
already covered by security.test.ts + registration.test.ts."

**My read**:

- **Test at :52 (lock → kill SW → unlock → /popup/general)**. NOT
  redundant. The lock/unlock paths in `security.test.ts` don't kill the
  SW — they only test the in-page Lock button. This test catches storage
  migration regressions and SW init bugs that the lock/unlock test won't.
- **Test at :93 (strict-mode ON: unlock → kill SW → expect lock screen)**.
  Has NO equivalent in `security.test.ts` or `registration.test.ts`.
  Strict-mode contract is exactly this: SW death wipes session ⇒ next
  popup must lock. **Deleting this is a real coverage regression.**
- **Test at :125 (strict-mode OFF: bearer survives SW death)**. Also no
  equivalent. The strict-OFF contract is the inverse — bearer DOES
  persist, lock screen is NOT shown.
- **Test at :186 (regression pin for liveness write timing)**. Pins
  commit `c67e4f0`. Without it, any future runtime regression to setInterval-only
  semantics will resurface as a different test's flake — exactly the kind
  of pin we want.

**My recommendation**: **Don't delete any of them.** Fix the underlying
helper. The flake is in `waitForLiveness` (line 24-36) after stopping
the SW. The 30s timeout is fine; the issue is that after `Runtime.terminateExecution`,
the next `openPopup → page.goto(popupUrl)` races the SW respawn. CDP's
"frame detached" error is the symptom of the SW killing the test's
popup connection mid-navigation.

**Fix surface** (one PR, ~3-4 hr):

1. `stopServiceWorker` (line 10-20): after `Runtime.terminateExecution`,
   poll until `chrome.storage.session.get("nulo:liveness")` is **undefined**
   (proves the session storage was wiped — SW genuinely died). Currently
   the function returns immediately and `openPopup` races.
2. `openPopup` after SW respawn: the `openPopup → about:blank → openPopup`
   double-load pattern (extension.ts:676-678) already retries; add a third
   retry guarded by `isTargetDetachError` (which already exists for
   `clickByTestId`).
3. Don't add a `data-testid` — the fix is at the puppeteer-CDP edge.

**Validation**: 5× local + 5× CI runs. Tolerance: 0 flakes.

### S4 — `passkey-backup.test.ts:167` "modal appears + status card"

**The claim**: hosted GH Actions is 5-10x slower than local; 90s timeout
still blew past.

**My read** (partially challenging):

- 290s elapsed in the failed run before the test hit the 90s `waitForFunction`
  for `download-btn` to become enabled. So the **product chain** (11-service
  backup() loop + SHA hash) genuinely takes >90s on the runner. Local
  takes 10-15s.
- 5-10x is plausible for argon2 + WASM-heavy ops on a 2-vCPU shared
  runner.
- BUT: the `passkey full-backup export: Escape during modal resets agreement
  gate` test (line 215, which **doesn't** wait for the chain to complete)
  passed in 22s. So the modal+status card UI portion is fast; what's slow
  is the actual backup chain.

**Fix surface** (one PR, ~4-6 hr):

1. **Don't fix the test, fix the chain.** Profile the 11-service backup
   loop. The candidates:
   - PBKDF2 iterations being applied 11 times instead of once
     (`PasswordSecretBox` derive cost)
   - Sequential service calls where parallel calls would work
   - SHA hash on the whole envelope at the end (one big buffer)
2. If the chain is genuinely 90s+ on shared CI, bump the test timeout to
   180s (vitest test option) AND add per-step diagnostic logs so the next
   regression has timing signal.
3. **My strong lean: do the profiling FIRST**. If the chain is
   reproducibly fast on a beefier runner (4-vCPU), the answer is
   "GitHub-hosted shared runners are the wrong substrate for this test"
   — gate the test behind a `RUNNER_TIER=fast` env var and skip on
   shared runners. That's a one-line change.

**Validation**: profile the chain. Decide based on the data, not the
guess.

### S1-S4 order of operations

S2 first (smallest), then S1 (low-risk synchronization fixes), then S3
(real bug in helper), then S4 (the heaviest — perf investigation).

---

## Phase 2 — Network stabilization

### 2.1 — Re-verify the actual root cause

The dossier's R1 (PXE-guard serialization) + R2 (RPC disconnect cancel)
were **superseded** by `phase0-findings.md`. The real unifying cause was:

> `switchToLocalNetwork` does not wait for the popup's account state to
> be populated for the new network.

PR #70 fixed this in `app.vue:131-162` by calling `ensureDefaultAccount`
after the network-switch re-fetch when accounts is empty. **That fix is
still in place today** (verified via Read on the file).

The PR #70 fix also hardened:

- `helpers.ts:switchToNetwork` — waits for `nulo:ui:activeAccount` to
  CHANGE, not just be truthy
- `helpers.ts:addContact` — waits for the sender chip before closing
  the popup
- `Toggle.vue` — exposes `data-toggle-disabled` for deterministic waits
- `contacts-sender.test.ts` — uses `AztecAddress.random()` instead of
  hand-rolled hex

All of those landed and are present in the current code.

### 2.2 — Un-skip the network quarantine

Since the wallet/helper fixes are in place, the network `test.skip`s
land as paranoia, not real signal. The plan:

1. **Phase 0 from this plan** — un-skip all 18 network `test.skip`s on a
   throwaway PR with the `e2e:network` label. Single CI run.
2. Categorize what fails (if anything) using the rerun matrix:
   - 0 failures → land the un-skip as PR #1 of this stabilization push,
     close the chapter
   - 1-3 failures → triage each individually, almost certainly a new bug
     (PR #74 / pr-8c is the most recent intrusion into the network path)
   - 4+ failures → trigger a new root-cause investigation modeled on
     `phase0-findings.md`

### 2.3 — Rotating flake under cumulative load

`full-suite-findings.md` documented this honestly: under 43-file full
suite, 2-3 tests rotate as flaky each pass. `multi-account-from` and
`meta-getChainInfo` are tagged with `retry: 1` because they were the
most frequent victims.

Options for handling rotating flakes:

| Option | Cost | Risk | My take |
|---|---|---|---|
| A. Smaller test groups (split into 2-3 separate sandboxes) | per-PR sandbox spawn overhead doubles (currently ~1 min, would be ~3 min) | Loses cross-test coverage of cumulative-state interactions | Skip unless we have an explicit per-PR runtime budget |
| B. Per-file sandbox restart | ~30s × 43 files = 21 min added | Same loss of cross-test signal | Skip |
| C. Wait for `@aztec/aztec.js` IndexedDB→KV migration | 0 from us | Upstream timing unknown | The cleanest answer if it lands soon |
| D. Accept and use scoped retries | 0 dev cost; ~30-60s added per retry | Hides real regressions if retry rate climbs | What we're doing now |
| E. Add `retry: 1` to MORE tests (e.g. every dappConnectedExtension test) | 0 dev cost | Hides real regressions | Avoid |

**My recommendation**: ship the un-skip + keep the retry-1 on the two
known offenders. Re-evaluate in a month based on the actual flake rate
under regular PR traffic.

### 2.4 — Order of operations

PR sequence:

1. **PR 1**: un-skip the 18 network tests. Single review. If green on CI,
   land. If not, hold and investigate.
2. **PR 2**: smoke un-skip (S2 first; then S1 split into two sub-PRs;
   then S3; then S4 if profiling permits).
3. **PR 3**: documentation update — refresh `tests/e2e/README.md` ("Known
   failures + triage") to reflect the new state.

---

## Phase 3 — Speed audit

### 3.1 — Inventory the actual time sinks

The user's hypothesis: "we have a lot of timeouts to wait for stuff."
Numbers from `grep`:

- **576 `timeout:` invocations** across all e2e test files
- **~75 `await new Promise((r) => setTimeout(r, N))`** explicit sleeps
- **Smoke testTimeout**: 60s per test, 90s per hook
- **Network testTimeout**: 30s per test, 300s per hook
- **`retry: 2`** on every smoke test (so worst-case 3× the per-test budget)

Top timeout values (count):

| Value | Count | Where typically used |
|---|---|---|
| `5_000` | 118 | `waitForSelector` (DOM mount) |
| `10_000` | 83 + 23 | hash + popup waits |
| `15_000` | 44 + 13 | post-mutation, navigation |
| `30_000` | 20 + 16 | service-bound waits (SW round-trips) |
| `90_000` | 18 | passkey-backup, fee-juice import |
| `60_000` | 15 + 6 | importToken, FPC auto-discovery |
| `120_000` | 12 + 3 | transfers, big flows |
| `180_000` | 11 + 2 | transfer test wrappers |
| `300_000` | 3 | hookTimeout — feeJuice fixture |
| `360_000` | 2 | "balance shows minted tokens" |

The 5s timeouts dominate the **count**. The 60-360s timeouts dominate
the **wall time** when a flake hits them.

### 3.2 — Categorize each tactic

| Tactic | Justified | Padding | Over-budget polling | Parallelizable |
|---|---|---|---|---|
| `waitForSelector` 5s for popup mount | Yes — that's a reasonable upper bound for Vue mount | — | — | — |
| `waitForHash` 5s | Yes for steady state. Currently 5s default in `extension.ts:698`. | — | The smoke flake at `security.test.ts:46` blew the 5s because of password-rotation state contamination. Bump to 15-30s after lock/unlock. | — |
| `waitForToast` 5s | Default works; many sites already pass `30_000`/`60_000` for network-heavy ops | — | — | — |
| `new Promise(r => setTimeout(r, 200))` in `navigateToSettings` | Mostly padding for Vue mount after route change | Yes (×11 sites) | Replace with `waitForSelector` for a known post-route element | Yes |
| `setTimeout(r, 5_000)` in `sendTransfer` and `sendTransfer.refresh` | Sync padding for PXE balance update | Yes (the comment says "give PXE a moment") | Replace with explicit balance poll | No |
| `setTimeout(r, 1_500)` in `tokenReadyExtension` (refresh loop) | Sync padding between refresh attempts (was 5_000, tightened to 1_500 in PR #70) | Justified — necessary because PXE sync is asynchronous | — | — |
| `setTimeout(r, 5_000)` in `feeJuiceImportedExtension` | Same as above | Justified | Same fix as `tokenReadyExtension` — bring down to 1_500 | — |
| `protocolTimeout: 300_000` on Puppeteer launch | Safety net for argon2 + bb.js | Yes (way too generous) | — | — |
| `hookTimeout: 300_000` | Required for `tokenReadyExtension` fixture cycle | Justified | — | — |
| `retry: 2` on every smoke test | Hides real bugs; was added in PR #77 | Yes | Drop to `retry: 1` for stable tests; `retry: 2` for the genuinely racy SW tests once they're un-skipped | — |

### 3.3 — Biggest wins (ranked)

1. **`navigateToSettings` `setTimeout(r, 200)` × 11** (helpers.ts:110).
   Replace with `waitForSelector` of the next route's known testid (every
   settings sub-page has one). Saves **~2.2s per test that navigates
   settings ≥10 times**. Across the suite: ~30-40s wall, but more
   importantly removes a guess for a determinism win.

2. **`refreshBalances` `setTimeout(r, 500)` + `setTimeout(r, 2_000)`**
   (helpers.ts:437,445). The 500ms after opening the menu and the 2s
   after clicking refresh are pure padding. Replace with a waitForFunction
   on `[data-testid="balance-loading"]` going from true→false (need to
   expose that, but tiny SFC change).

3. **`tokenReadyExtension` cold-PXE balance poll** (extension.ts:329-344).
   Already tightened in PR #70 (1.5s × 40 = 60s). The real saving here
   is to drop the early loop iterations when the balance lands —
   currently it's already doing that. **No further win available** unless
   the wallet's `refreshBalances` SW round-trip is the bottleneck (likely
   it is).

4. **`sendTransfer` 5s post-fee-estimation sleep** (helpers.ts:604).
   Comment says "Give PXE a moment to fully sync after fee estimation".
   That's a real concern. Verify by removing the sleep and running the
   transfer suite — if proveTx errors with stale-anchor messages,
   restore. If green, save 5s × 5 transfer tests = **25s**.

5. **`retry: 2` on every smoke test** (vitest.e2e.config.ts:38). Real
   bugs fail 3× in a row anyway; flakes pass on 1 retry usually. Drop to
   `retry: 1` smoke-wide. Saves **~10 min cumulative** on hosted CI
   when a small flake hits (currently a flake retries twice = 3 runs).

### 3.4 — Surface side effects

A sleep replaced by a state-driven wait CAN expose a race. The candidates:

- `sendTransfer`'s 5s post-fee-estimation sleep — if PXE sync is racy
  and the test machine happens to be fast, we'll catch a real bug we've
  been masking. **Good outcome**.
- `navigateToSettings` 200ms — if Vue route-change is racy with `mounted`
  hook firing, we'll see test failures right after `navigateToSettings`
  returns. **Likely safe** because all callers immediately use
  `waitForSelector` after.
- `refreshBalances` 2s — if the SW round-trip for refresh is sometimes
  flaky, removing the padding will surface it. **Mixed outcome** —
  the right answer is to gate on an explicit signal from the SW.

### 3.5 — Anti-scope of speed audit

- Don't rewrite the helpers. Surgical changes only.
- Don't introduce a "wait for next tick" or "wait for Vue nextTick"
  helper unless the data demands it. Most callers already follow up with
  a `waitForSelector`.
- Don't ship the speed audit and the un-skip in the same PR — separate
  signal.

---

## Phase 4 — Lock-in

### 4.1 — Promote smoke to required on dev?

CI.md says smoke is "currently advisory; will become required once the
smoke fixture-cleanup follow-up PR lands."

My read: smoke has been green on the last ~8 CI runs of PR #77.
Promoting now is safe IF AND ONLY IF the un-skip Phase 1 PRs go green
first. Sequence:

1. Land un-skip-everything-that's-actually-green (Phase 1 + 2.2).
2. Run 10 PRs through the gate.
3. If 0 flakes, flip the branch protection rule to require Smoke.

### 4.2 — Documentation

Files to update:

- `packages/extension/tests/e2e/README.md` — "Known failures + triage"
  section: drop, replace with link to this plan or its successor.
- `CLAUDE.md` — no change needed; the gate description is accurate.
- `CI.md` — flip smoke from advisory to required.
- `tests/e2e/network/transfers.test.ts` etc. — drop the
  `// biome-ignore lint/correctness/noUnusedVariables: kept for un-skip`
  comments once `test.skipIf(!hasConfig)` is restored.

### 4.3 — Follow-up tracking

Open issues for the items we decide to defer:

- "Passkey full-backup chain is 5-10x slower on hosted CI" — keep as
  paper trail even if we ship the timeout bump
- "Rotating flake on cumulative network load" — track until aztec.js
  IndexedDB migration lands

---

## Specific challenges I want to make explicit

1. **The user's "we have a lot of timeouts to wait for stuff" hypothesis**:
   **Partially right, mostly miscalibrated**. The big timeout values are
   the right ones for the operations they wrap (token import is genuinely
   slow). The optimizations are in the small `setTimeout` sleeps in
   helpers, not in the per-test budgets. Maybe **~30-60s wall-time
   savings** across the smoke suite if we replace 5-10 padding sleeps
   with state-driven waits. Not the big lever the user thinks it is.

2. **PR #77's claim that passkey-backup is "hosted CI 5-10x slower"**:
   **Probably correct**. The 290s wall on a 90s timeout is overwhelming
   evidence the product chain itself doesn't fit. But it deserves
   profiling before we accept that framing — there may be a real perf
   bug masked by the slowness.

3. **PR #77's claim that 4 SW-respawn tests are redundant with
   `security.test.ts` + `registration.test.ts`**: **Largely wrong**.
   The strict-mode-ON and strict-mode-OFF tests are unique. The "regression
   pin for liveness write timing" is exactly the kind of test pin
   CLAUDE.md endorses. Only the first test (lock → kill SW → unlock) has
   significant overlap with the manual-lock test in security.test.ts —
   and even that catches SW init regressions the in-page test won't.

4. **"Popup-internal navigation race" framing in PR #77's skip
   comments**: **The comments are wrong about the cause**. The cited
   `wallets-architecture-research/nulo/self-analysis.md:427` is in this
   repo (`packages/`'s sibling at `/wallets-architecture-research/`). It
   characterizes the appearance/security/contacts flakes generically.
   The actual mechanisms are different per test (state contamination,
   stale skip comment, etc.).

---

## Questions for the user

1. **Phase 0 baseline approach** — do you want me to do the
   un-skip-then-rerun on a throwaway PR (slow CI feedback) OR run
   each test locally in a Linux container (fast feedback, less
   representative of the real CI substrate)? My lean: throwaway PR with
   the network label, 1 round of un-skip-all.

2. **PR strategy** — given the dossier+plan-reconciled+phase0 history
   shows we've been bitten by "one big fix-all PR vs N small per-cluster
   PRs", which way for this round? My lean:
   - PR A: un-skip network tests (re-enable `test.skipIf(!hasConfig)`)
   - PR B: smoke-S2 (delete contact: assertion fix)
   - PR C: smoke-S1 (appearance + security: synchronization fixes)
   - PR D: smoke-S3 (SW respawn: helper hardening)
   - PR E: smoke-S4 (passkey-backup: profile + decision)
   - PR F: speed audit (small sleep → state wait conversions)
   - PR G: lock-in (smoke required on dev; docs)

   7 PRs is more than I usually like, but each one is independently
   reviewable and can land in isolation.

3. **Passkey-backup**: do you want me to **profile the chain** before
   touching the test, or is "GitHub-hosted runners are too slow for
   crypto-heavy chains" already an acceptable framing? Profiling is ~4
   hours; the test-level fix is 30 minutes.

4. **SW-resilience tests**: PR #77 says they're "excellent locally for
   development." Is there a half-step like "run sw-resilience nightly
   only" that we should adopt instead of "always run or never run"?
   GitHub Actions supports scheduled workflows.

5. **`retry: 2` smoke-wide**: drop to `retry: 1` (my preference, surfaces
   real flakes faster) or keep at `retry: 2` (current, conservative)? I'd
   want to know how often retry-2 actually saves a build vs masks a
   genuine flake worth fixing.

6. **Branch-protection lock-in**: flip Smoke to "required on dev" after
   un-skip is green? Or keep it advisory until we've burned 20+ green
   runs?

---

## Out-of-scope skips found while inventorying

Two pre-existing network `test.skip`s NOT introduced by PR #77 and NOT in
the dossier. Mentioning so the merge pass treats them correctly:

- `network/batch-partial-failure.test.ts:29` — marked
  `ARCHITECTURAL-MISMATCH(canonical 2D-D3)` in the comment above the
  test. Real fix is in `wallet-bridge` (emptyBatchResult per-method
  shaping). NOT this PR's surface area; defer.
- `network/connect-locked-queue.test.ts:19` — `TODO(network-playground)`:
  "discovery queue drain timing is brittle (90s timeout); needs a
  deterministic 'queued' signal from the extension before unlock". Pre-
  existing, predates PR #77. Defer to a follow-up unless we naturally
  fix the 'queued' signal as part of S3 (SW respawn helper).

So total network skips today = **20** (18 PR-#77 + 2 pre-existing
out-of-scope). The Phase 2.2 un-skip targets only the 18.

## Things I didn't get to investigate

- **Did NOT run** the actual smoke or network suite locally. The
  baseline rerun matrix in Phase 0 is the natural place to do that, and
  it's the first action of the plan.
- **Did NOT profile** the passkey-backup chain. Phase 1's S4 is where
  this happens.
- **Did NOT verify** the SW-respawn flake's actual frequency on hosted
  CI. The skip happened pre-emptively; we don't have a CI count of
  "out of N runs, sw-resilience flaked M times".
- **Did NOT look** at the `vitest.e2e.all.config.ts` path (which is
  what `test:e2e:all` runs). That mode would surface cross-suite
  state pollution. Worth a Phase 0 look if we want to validate the
  smoke + network unification story.
- **Did NOT examine** the `EXTENSION_PATH` env variable's downstream —
  the release workflow uses it (per `_smoke-e2e.yml` + the smoke setup),
  and any speed audit needs to respect that path.
- **Did NOT cross-check** whether the speed-audit changes interact with
  the parallel-isolation work in PR #69 (`scripts/e2e/agent.sh`).
  Parallel worktrees own their own `dist/chrome`, so the smoke-side
  changes should be isolated, but worth confirming.
