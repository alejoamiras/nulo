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

_pending_
