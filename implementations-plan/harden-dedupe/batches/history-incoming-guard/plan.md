---
plan: harden-dedupe / history-incoming-guard (arc 22b of the program, split from activity-feed)
tier: light
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/22b-history-incoming-guard, stacked on hd/22-activity-feed
---

# history-incoming-guard: History drops an incoming row stamped with another profile

Follow-up to activity-feed (arc 22), whose plan audit asked for it and whose Drift 5 moved it here. Home's incoming rows pass three scope checks: account, network, then profile. History's pass only the first two (`apps/extension/src/utils/activity-rows.ts:102-117`). History gets the profile check too. The program plan's Behaviour rule lists this guard under "decided per arc by its panel", under the route-2 criteria, so it ships alone in this arc.

## Change

Paths are under `apps/extension/src/`. Lines read 2026-10-03 at `6fd533a0`.

- **The fix.** `incomingInScope(inc, scope)` (`utils/activity-rows.ts:113-117`) gains a third check, `isForeignProfile(scope.profileId, inc.profileId)`, after the account and network checks. The two feeds then apply the same three checks in the same order.
- **Home is unchanged.** Home already calls `isForeignProfile` right after `incomingInScope` (`popup/components/modules/general/recent-activity-rows.ts:55-56`). Moving the check into `incomingInScope` deletes that inline line and changes nothing else. Home's reads stay: token, account, network, profile, then the sort key and `id`.
- **History**, `incomingRows` (`activity-rows.ts:102-109`), is unchanged. Its reads become account, network, profile, then the sort key and `id`, which is Home's order without the token.
- **Comments.**
  - `incomingInScope`'s TSDoc names the profile check.
  - `incomingRows`' comment, which repeated that contract, goes.
  - Home's helper comment (`recent-activity-rows.ts:49`) states the one invariant its order protects: the token check runs first, so another token's receipt never has its scope fields read.
- **Rejected:** adding the line inside History's loop instead. That keeps the same check sequence written out twice, which is the duplication arc 22 removed.

## Reachability

The guard never fires on a path a user can reach today.

- **The service query matches the profile exactly.** History's incoming list comes from `useIncomingTransfers` (`popup/pages/activity.vue:56-69`). That list holds only rows from:
  - `getIncomingTransfers(profileId, networkId, account)`, which filters on `r.profileId === profileId` (`wallet/services/incoming-transfer/repository.ts:93-96`, called at `service.ts:487`);
  - an `onUpdated` replacement that `inLiveScope` admits only on a matching profile (`composables/useIncomingTransfers.ts:116-128`).
- **Every record names a profile.** `profileId` is a required string (`wallet/services/incoming-transfer/spec.ts:125`).
- **A profile switch empties the list first.** The composable's scope key includes the profile id. A `flush: "sync"` watcher empties the list the moment it changes (`useIncomingTransfers.ts:148-155`), and a read that finishes for an older key is dropped (`:80`, `:87`, `:94`).
- **Both sides read the same id.** The page passes `appStore.profile?.id` to both the composable's scope and `buildActivityRows` (`activity.vue:65-66`, `:117`). Every row in the list therefore names the profile `buildActivityRows` compares against.
- **An empty or unknown profile id shows no incoming rows at all.** The composable's scope needs a truthy profile id (`activity.vue:65`), so no read happens and the list stays empty. When the scope's profile is unknown, `isForeignProfile` keeps every row.

So no reachable state shows different rows, and no pixel moves. The same rows also feed `arrivals.present` (`activity.vue:126`), which sees the same records as before.

## Assumptions

**Facts** (read 2026-10-03 at `6fd533a0`): the sites and reads above. `isForeignProfile` is at `activity-rows.ts:71-73`. `incomingInScope` has two callers, History's `incomingRows` and Home's `tokenScopedIncomingRows`.

**Inferences:** the computed `activityRows` now also tracks each record's `profileId`. Nothing writes that field in place: an update replaces the whole element (`useIncomingTransfers.ts:127`). So the new dependency never triggers on its own.

**Asks:** none.

## UI impact

None. No template, style or copy changes. The zero-diff gate re-captures the activity-feed surfaces that render incoming and empty rows:

- History: `activity-page`, `activity-page-end`, `activity-empty`;
- Home: `home-feed`, `home-feed-end`, `home-feed-dapp`, `home-feed-dapp-end`, `home-empty`;
- the token page: `token-feed`, `token-feed-end`, `token-feed-empty`.

Base `6fd533a0` against this arc's code head, on Chrome and Firefox in dark and light, then a `--stability` run.

A state where the guard changes the output (an incoming row from another profile in History's list) cannot be staged, because no reachable state holds one (see Reachability). The unit test is what proves the guard.

## Phases

### Phase 1: red, test only

`utils/activity-rows.test.ts`:

- The drift pin "an incoming record stamped with another profile is kept under a known scope" is inverted. A record stamped `p2` is dropped, beside an otherwise identical kept `p1` record.
- A new row: a scope with the account and network known but no profile keeps the `p2` record.
- New rows for the empty id, which `isForeignProfile` treats as a known id (`activity-rows.ts:72`). Each is beside a kept control:
  - under scope profile `""`, a `p2` record is dropped;
  - under scope profile `p1`, a record stamped `""` is dropped.
- The incoming read-order pin becomes:
  - a record that fails on account: `["accountAddress"]`;
  - fails on network: `["accountAddress", "networkId"]`;
  - fails on profile: `["accountAddress", "networkId", "profileId"]`;
  - kept: `["accountAddress", "networkId", "profileId", "blockTimestamp", "discoveredAt", "id"]`;
  - kept, with a block time: `["accountAddress", "networkId", "profileId", "blockTimestamp", "blockTimestamp", "id"]`;
  - kept under an all-unknown scope: `["profileId", "blockTimestamp", "discoveredAt", "id"]`, because `isForeignProfile` takes both ids as arguments, as the tx pin's unknown-scope row already shows.

`recent-activity-rows.test.ts` is not edited. Its known-scope profile row and its read-order row already pin Home, and they must stay green unchanged through Phase 2.

The inverted pin, the empty-id rows and the read-order rows fail on `6fd533a0`. Every other row passes, the unknown-profile row included. Commit `test: pin that history drops an incoming row stamped with another profile`.

### Phase 2: green

Make the change above, leaving both test files untouched. Commit `fix(activity): drop history's incoming rows stamped with another profile`.

**Mutants.** Each is applied by hand, its result recorded in the lessons file, and the file restored from a scratch copy.

| # | mutant | expected killer |
|--:|---|---|
| 1 | the guard removed from `incomingInScope` | History's inverted pin; Home's known-scope profile row |
| 2 | the wrong row field compared (`inc.networkId`) | the kept `p1` controls on both feeds |
| 3 | the wrong scope field compared (`scope.accountAddress`) | the kept `p1` controls on both feeds |
| 4 | the profile check moved before the account check | both read-order pins |
| 5 | Home keeps its inline guard as well (a second read) | Home's read-order pin |
| 6 | the guard negated: `!isForeignProfile` | every kept-row assertion |
| 7 | the guard skipped under an unknown scope profile: `scope.profileId && isForeignProfile(…)` | History's unknown-scope read trace |
| 8 | an empty scope id treated as unknown: `scope.profileId \|\| undefined` | History's empty scope-id row |
| 9 | an empty row id treated as unstamped: `inc.profileId \|\| undefined` | History's empty row-id row |

**Validation gate:**

- the program's gates (`lint`, `typecheck:all`, `test:all`, `test:ci-gating`, `audit:vue`), all exit 0;
- Phase 2 leaves every `*.test.ts` byte-identical;
- the shots above, ALL IDENTICAL in both runs.

## Post-implementation

1. **Codex code review** (GPT-6 Astra, xhigh), resuming the plan-audit session. It runs until CONVERGED, with at most 5 rounds, and each round is logged in `lessons/arc-22b-history-guard.md`.
2. **Delivery** is the program driver's job: push, then open a ready PR stacked on `hd/22-activity-feed` with the behaviour-change text below in its body.

## Results

- **Red then green.** On `6fd533a0`, 3 of the 22 tests in `activity-rows.test.ts` fail: the inverted pin, the empty-id rows and the read-order rows. After the fix (`456b747f`), all 38 tests in the two row files pass, plus `activity.test.ts`. `recent-activity-rows.test.ts` is byte-identical.
- **Mutants:** all 9 killed. The killing tests are in `lessons/arc-22b-history-guard.md`.
- **Gates:** all five program gates pass at `456b747f` and again at the code head `82dcb85d`. The only change between those two commits is to comments.
- **Shots, base `6fd533a0` against the code head `82dcb85d`:** 68 of 68 identical on Chrome and Firefox, dark and light. That is 44 shots across the 11 surfaces plus 24 computed-style probes. The `--stability` run (base against itself) was also 68 of 68 identical. An earlier run against `456b747f` was also 68 of 68 identical.
- **Codex code review:** CONVERGED in round 1, with two nits; one was adopted and one declined with its reason. Round 2 confirmed CONVERGED with no findings.

## Delivery

One arc, `hd/22b-history-incoming-guard`, stacked on `hd/22-activity-feed`. Code review: off; the Codex fix loop is the review.

## Decisions (delegated)

### Route 2: History's incoming profile guard

The program plan's route-2 criteria, one by one:

- **Invisible:** no pixel, copy, dApp wire code or message, or persisted byte changes on a realistic path. Reachability shows that every row in History's incoming list already names the active profile. The zero-diff shots cover every feed surface that renders incoming rows.
- **Strictly safer:** it only adds a refusal, of a row the profile scope already says is wrong. Nothing is relaxed, and Home's checks and their order are unchanged.
- **Red-then-green:** the inverted pin, the two empty-id rows and the updated read-order rows in `activity-rows.test.ts` fail on `6fd533a0` and pass after the fix.
- **Pre-cleared?** No. The Behaviour rule lists it under "decided per arc by its panel". Activity-feed's plan audit (Codex) recommended it by this route (that plan's Decisions, item 6), and this arc's plan audit decides it.

**PR body text:**

> ### Behaviour change (route 2): History drops an incoming row stamped with another profile
>
> Home's incoming rows pass an account, a network and a profile check. History's passed only the first two. `incomingInScope` now applies all three, in that order, for both feeds. Home's own inline profile check is folded into it with no change to Home's reads.
>
> - Invisible: no pixel, copy, wire or persisted byte changes on a realistic path. History's incoming list comes from a profile-equality query, a profile switch empties it synchronously, and every record names a profile. So no reachable state holds a row the guard would drop. The activity-feed zero-diff shots (History, Home and the token page, Chrome and Firefox, dark and light, plus a stability run) prove the pixels.
> - Strictly safer: it only adds a refusal, and relaxes nothing.
> - Red-then-green: `activity-rows.test.ts` pinned History keeping a foreign-profile incoming row. That pin is inverted, and a read-order row adds the profile read. Both fail on the previous code and pass now. Home's pins pass unchanged.

## Plan audit

### Codex round 1 (GPT-6 Astra, xhigh): REVISE

No reachability blocker: Codex found no realistic path where History's list holds a record from another profile (high confidence). It confirmed Home's reads and Vue dependencies are unchanged, and that the change meets route 2. Two test findings, both adopted:

1. **Should-fix: the block-time read-order assertion** (`activity-rows.test.ts:301`) also gains `profileId`. Left as it was, Phase 2 would stay red. **Adopted:** listed in Phase 1.
2. **Should-fix: three mutants survived the proposed rows.** They were `scope.profileId && …` (no profile read under an unknown scope), `scope.profileId || undefined` and `inc.profileId || undefined`. The last two would relax `isForeignProfile`'s empty-id semantics. **Adopted:** an unknown-scope read trace and two empty-id rows in History's test, and mutants 7 to 9. Home's test file stays untouched.

### Code review, Codex round 1: CONVERGED

No material finding: Codex reproduced the three base failures and the nine kills, and saw Home's Vue dependency traces unchanged.

- **Nit, adopted:** `incomingRows`' comment repeated the contract and was deleted. Home's helper comment now states its ordering invariant (`82dcb85d`).
- **Nit, declined:** shortening the scope comments in `RecentActivityView.vue` (about line 108) and `activity.vue` (about line 104). They predate this arc and are no less accurate after it, and a route-2 arc does not edit `.vue` files for no behaviour.

### Code review, Codex round 2: CONVERGED

No findings.
