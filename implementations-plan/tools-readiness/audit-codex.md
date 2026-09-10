# Codex audit — tools-readiness (`/blueprint light`)

Foreign reviewer: GPT-6 Astra via `/codex`, effort `high`, read-only sandbox, cwd = this worktree at
`dev @ 94e412a6`. One session, resumed per round. The prompt named the files to read (plan, recon,
the readiness ledger, the two-products / complexity / testid rules, and the dispatcher, popup,
session, journal, fixture and playground code the plan touches) and asked for three legs —
adversarial/security, assumption attack, implementation critique — plus a check of Delivery,
Post-implementation and the seeds.

## Round 1 — plan v1

**Verdict:** `reject (with blocking findings: consent semantics are incomplete, several cells assert
nonexistent behavior, and delivery commands need correction)`

Sixteen findings. Each was verified against the tree before the call below; every claim held.

| # | Sev | Finding (codex) | Verified | Call → plan v2 |
|---|---|---|---|---|
| 1 | High | Session accounts are CAIP-10, available accounts raw hex; direct subtraction misclassifies (`dispatcher.ts:289,1396`) | yes | adopted — chain-scoped projection via `getSessionAccountAddresses`, `grantedAccounts` encoded as raw hex for the session's chain, cross-chain membership test |
| 2 | High | The decision path REPLACES the accounts grant (can revoke `canCreateAuthWit`) and rewrites aliases; CSS-disabled rows still toggle by keyboard (`dispatcher.ts:368-425`) | yes | adopted — membership-only widening adds without replacement; rider locked; aliases only for new addresses; native `disabled` + handler guard; keyboard tests |
| 3 | High | Rejection tracking re-prompts on every request; timing reveals that ungranted accounts exist (`dispatcher.ts:333`) | yes | adopted as documented pre-existing behaviour for every type — a per-session backoff is a follow-up, timing accepted (never discloses which) |
| 4 | Med | Keep coverage pure; don't overload `reRequested`; resolve the provisioning-loader contradiction; cover flag+membership | yes | adopted — `grantedAccounts` presence is the signal; `accountService.getAccounts` direct; combined case takes the field-diff path |
| 5 | High | `getAccounts()` returns an array, `parseGrantedAccounts` expects a grant; refresh needs completion guards and teardown ownership | yes | adopted — `parseAccountList` adapter; epoch/status/ops guards; empty or failed read is a no-op; listener owned by the `useWalletConnection` singleton |
| 6 | Med | `useTokenGrant`'s queue is private; outcomes must be distinguished | yes | adopted — `prompt-queue.ts` shared; `added n / unchanged / busy / failed` with honest copy (decline and nothing-new are indistinguishable) |
| 7 | High | 24b cannot end `done`: `awaitConsumable` rethrows on consumed; the relayer helper stages but cannot prove recovery | yes | adopted — surfaced to the owner (see Asks); product fix authorized: consumed-without-own-claim completes with a note; cell asserts the UI's own recovery after reload |
| 8 | High | 26d/31b assert recovery the product lacks (row opened before approval; `exiting` without hash hides FINISH); target the exit's second tx | yes | adopted — owner-authorized fixes (Discard/Retry for a hash-less deposit; Retry for a hash-less exit); `holdNext` targets the exit selector |
| 9 | High | The feed is shared; another granted account gets SWITCH, not a mismatch note; assert `disabled` without clicking | yes | adopted — cells 2 and 4 rewritten around SWITCH; cell 3 holds the Ethereum leg and asserts the native `disabled` row |
| 10 | Med | Duplicate symbols, non-checksummed and non-contract addresses pass the schema; permit nonce unverified | yes | adopted — 34b asserts fail-closed selection and no symbol merge; permits recorded whole and compared with the deposit calldata |
| 11 | Med | `simFrom` already drives `from`; receipts carry no sender | yes | adopted — no playground change; balance-based assertions |
| 12 | Med | `index.test.ts:223` stubs rows; 7 cells + 2 spares can't pair; competing seed scripts; `driveToConnected` answers the chooser | yes | adopted — real rows in the consent tests; `cells: 10`; a `spares` worker option + a one-seed file; `reconnectedAs` fails on a chooser |
| 13 | Med | Three shards unmeasured; Phase 2 promised the full suite but ran three files; armed-smoke command; playground typecheck | yes | adopted — two shards then measure; the full network suite alone at the arc-1 boundary; commands spelled out |
| 14 | Med | Idle tab B never enters the provenance branch; the dock overlays by design | yes | adopted — two racing sends; dock open, Escape, then confirm |
| 15 | High | Product-fix authorization was a silent Ask; `--adopt` does not exist; `submit --auto` drafts; re-watch after sync | yes | adopted — asked (owner: "Authorize the three product fixes in arc 3"); `gh stack init --base dev worktree-tools-readiness`; `--open`; re-watch rule |
| 16 | Med | Seed's "no turn ended waiting" conflicts with the three-round stop; owner merging is not the agent's | yes | adopted — seed reworded |

Rejected: none. Confirmed sound by codex: hidden accounts filtered at `account/service.ts:170`;
session-scoped reads disclose nothing ungranted; the dropped three-strike handling exists; the
test-only fault surfaces are isolated; no new dependencies or cryptography; the arc split keeps the
two suites independent.

## Round 2 — plan v2

**Verdict:** `reject (with blocking findings: unsafe hash-less retries, ambiguous consumed-message
detection, and incomplete consent/refresh guards)`

Nine findings, all verified against the tree. Two of them shrank the product fixes: the card already
offers Discard on both hash-less shapes (`BridgeJournalCard.vue:169-186`) and the engine already
refuses a hash-less withdraw as `unknown-outcome` (`useBridgeJournal.test.ts:701`), so the real gaps
are reconciliation and attach, never resubmission.

| # | Sev | Finding (codex) | Verified | Call → plan v3 |
|---|---|---|---|---|
| 1 | High | A missing hash does not prove nothing was broadcast; re-signing with fresh nonces duplicates a deposit or a burn; keep the engine's `unknown-outcome` protection | yes | adopted — no resubmission anywhere: the deposit fix reconciles by L1 content (`findDepositByContent`), the exit fix attaches an identity-checked tx id; `unknown-outcome` stays; Discard's copy states the unknown outcome; "no resubmission path" added to the hard limits |
| 2 | High | Records carry no replayable plan (exit: no originating account or authwit nonce, `useHubExit.ts:365-380`); policy pins prove buttons only | yes | adopted — replay dropped so no plan is needed; every fix carries an engine pin (found / attached / refused / never-runs) beside the policy row |
| 3 | High | A consumed error can come from the fuel setup (`useSend.ts:445-452`); a fee stop returns before probing (`:379`); `completeDeposit` wipes the note (`:707-715`) | yes | adopted — the consumed error is the trigger, `recordMessageConsumed` (the record's own claim) is the proof; the fuel case pinned as NOT completed; the note set after the wipe |
| 4 | High | `grantedAccounts` was set only on the membership path; a re-prompt after a decline or a flag change already enters the delta and would lose locking; a flag-only approval must not force sharing; keep the concurrent-revocation test | yes | adopted — `grantedAccounts` on every path where the session holds a grant; classification by flags, not delta origin; empty-addition approval on a flag change; revocation re-checked under the lock, pinned |
| 5 | High | `retryCapabilities` and selection never move `s.epoch` (`:740`); `useWalletConnection` has no dispose (`:158-170`, `:216-220`); reuse the `{alias,item}` entry parser | yes | adopted — completion check by `s.accounts` identity + selection + status; the listener installed once at module init for the page's lifetime; `parseAccountList` extracted from `parseGrantedAccounts` |
| 6 | Med | Re-check busy inside the shared queue; honour `retryCapabilities() === false` (`:734-739`) | yes | adopted — both; `false` → `busy`, never `unchanged` |
| 7 | Med | Reload re-applies the remembered account (`chooseGrantedAccount:838-846`), so `reconnectedAs(B)` cannot establish B; SWITCH only selects; a rediscovered hash-less claim is skipped by `resumeActionFor` (`:1449`) | yes | adopted — cell 2 reconnects as A then switches to B; CLAIM clicked in cells 2 and 24b |
| 8 | Med | Fees are Fee Juice, not the token; the Permit2 approval tx precedes the deposit tx (`useSend.ts:695`) so a generic hold catches it; count per method; specify a private exit for the single-credit charge | yes | adopted — separate balance assertions; allowance pre-established and `holdNext` matched by `to`; per-method counters; 31b private |
| 9 | Med | `NULO_E2E_RETRY=0` (the network config defaults to 2, `vitest.e2e.network.config.ts:46`); re-run local gates after a rebase; the seed must require passing checks | yes | adopted — retry 0 on every network command; local gates before any re-watch; seed reworded |

Rejected: none. Confirmed sound by codex: the CAIP projection, the pure coverage boundary, the shared
queue extraction, the corrected feed semantics, actor allocation, staged shard sizing, the Permit2
calldata comparison, the corrected stack commands.

## Round 3 — plan v3

_pending_
