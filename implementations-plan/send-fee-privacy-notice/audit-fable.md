# Fable audit — round 1 (plan rev 1)

Same-family review leg (`Plan` subagent, top-tier Claude model), read-only, run in parallel with the
codex round. Findings condensed from the reviewer's report; every factual claim was re-checked against
the tree before adoption. Dispositions are in `plan.md` § Decision ledger.

**Verdict: conditional approve** — conditions S1, S2, S3, F1, V1, V2 fixed in the plan before coding;
A1 put to the owner. Recommended build: the hybrid.

## Security

- **[High] S1 — a failed FPC-list read looks like "PrivateFPC not registered".**
  `FeeSettingsCard.vue:328` sets `registeredFpcs = entry.fpc.data ?? []`; with no data,
  `privateFeeJuiceOption` (`fee-helpers.ts:203`) returns "not available" with `fpc: null`. Rev 1's hold
  fired only when `method.fpc` was set, so the walk continued to `fj`. The notice would render, but an
  unread state caused the public fallback. Fix: an `fpcListKnown` input; `hold` when false.
- **[High] S2 — with unread balances `fj` is never disabled.** `gasBalances` undefined →
  `buildFeeMethods` disables nothing (`fee-helpers.ts:179-181`). Settings fail closed so nothing leaks,
  but the rule is broken and the smoke assertion would fail. Fix: `fj` eligible only on a non-null,
  non-"0" string balance.
- **[Medium] S3 — the origin watcher collides with the baseline-identity check.**
  `userPickedDuringInit` is a reference inequality (`:330`); `recommit` snapshots its baseline before
  an await (`:498-499`). A watcher write during either await reads as a user pick and skips the
  reconcile — a liveness bug. A real mid-init pick under one origin also survives a flip to the other.
  The watcher fires on every open of a public-only token (`send.vue:124`, `:133`). Fix: no-op unless
  init is complete and nothing is in flight; record the slot on each pick.
- **[Medium] S4 — two readers of the saved record missing from the change map**: the prefill
  (`:425-426`) and the reconcile read (`:332`).
- **[Low] S5 — two quick picks in different slots can lose one** (independent read-modify-writes,
  `:191-194`). Fix: serialize.
- **[Low] S6 — `feePayerNotice` undefined for a `null` destination under a private origin.** Must
  still render; default to the private → private wording.

## Facts

- **[High] F1 — rev 1's claim that `resolveSavedSelection` drops disabled rows is false on first
  load.** `methods` has no balances until the gate opens (`:81-85`); the reconcile (`:332`) runs before
  `isInitComplete = true` (`:337`); the comment at `:296-301` and the test at
  `FeeSettingsCard.test.ts:1349-1354` pin it. "First not-disabled" would pick `private_fpc` whenever
  registered and the headline fallback would never fire. Opening the gate earlier breaks that test.
  Fix: resolve against an explicit `buildFeeMethods(registeredFpcs, gasBalances, …)`.
- **[Low] F2** — the reader already retries a thrown leg once (`gas-balance-reader.ts:215-231`); a
  structural null is cached for the TTL as not-failed.
- **[Low] F3** — `price-fixture.test.ts:26` also uses `feeJuiceImportedExtension`.

## Inferences

- **[High] I3 false** — the smoke build arms the seed flags with an empty list
  (`tests/e2e/README.md:57`); no token → `isBlockedTransfer` true (`send.vue:101`) → `SendTypesCard`
  not rendered (`:547`). Only the default private origin is observable in smoke.
- **[Medium] I1** — a forced read recomputes because `forceRefresh` bypasses the reader cache
  (`gas-balance-reader.ts:73`), not because of the stale mark. A forced ensure sets `stale: true` at
  start (`balances.store.ts:478-482`) and a failed one commits `degraded` for every subscriber
  (`:188-191`) — not "contained". The snippet omitted the required `legs` (`:560`).
- **[Medium] I2 unsafe** — see S3.

## Asks

- **[Medium] A1** — the execute window and the authwit popups change behaviour even though their code
  does not: today a pick on Send governs them and vice versa. Owner must see it.
- **[Medium] A2** — the reused degraded copy says "retrying in the background", untrue once the
  capped re-reads are spent; and rev 1 never said `hold` sets `error`, which `commitFromEntry` clears
  on any non-degraded commit (`:343-345`).
- **[Low] A3** — unconfirmed whether the bridge URL offers a private-gas path.

## Implementation

Build the hybrid: pure `fee-privacy.ts`, the row inline, two-slot storage. Drop
`FeePrivacyNotice.vue` (one consumer; budgets are per function, so template rows cost nothing). Reject
outline B's "ignore saved `fj`". Simpler storage: leave the flat key untouched, add a second key
`{ [address]: { private?, public? } }`. Hold re-read: a plain `ensure({ legs: ["gas"] })` then an
explicit recommit, one delayed attempt, counter reset per identity; clear any timer ahead of
`releaseSubscription`.

## Validation gates

- **[High] V1** — `-- --retry=0` does not set retry; the documented form is
  `bun run test:e2e --retry=0 <file>` (`.claude/skills/e2e-testing/SKILL.md:436`).
- **[High] V2** — the smoke plan cannot work as written; re-scope to the default private origin.
- **[Medium] V3** — `git diff --stat` cannot show deletions inside test bodies; use
  `git diff -U0 -- <file> | grep '^-[^-]'`.
- **[Medium] V4** — smoke can pass against a stale build; rebuild first.
- **[Low] V5** — the network test is achievable by hand-picking `fj`.

## Looks fine

The notice as a pure function of `(origin, method)`; hostile stored-record parsing; the takeover gated
on a non-null origin with `send.vue` the only `needsFeeJuice` consumer; link reuse; L4 placement
against the `biome.json` bans; two primitive props; the testids and `data-notice-shape`; no migration
needed; `audit:vue`, `e2e:agent`, `e2e:reap` exist; Sponsored-first.
