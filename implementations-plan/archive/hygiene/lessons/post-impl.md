# Post-implementation · the codex loop

One loop over the whole diff (`origin/dev...HEAD`), started once P8 was green at `b0f3ff48`.
`/code-review` is off. Codex ran as `/codex high` (GPT-6 Astra), session
`01a0ef27-d6ed-7863-b72a-3b2a06c386ac`, with automatic approvals in a writable sandbox, since the
build host cannot run the read-only one: the prompt forbade writes, and `git status` was clean
after each round. Every prompt carried the adversarial ask, this plan's two checks and both
required paragraphs verbatim.

## Round 1: changes required, 4 material, 2 nits

Each claim was checked against the tree before it was acted on.

| # | Severity | Finding | Checked | Resolution |
|---|---|---|---|---|
| 1 | material | `incoming-arrival`'s second calm call waits for the exact figure the first ended on; a quote refresh between the calls moves it for good, a 30 s timeout on a wallet that behaves | holds. The e2e seed prices only `usd-coin` while `allCoingeckoIds()` also asks for `aztec`, so wherever CoinGecko answers, `refreshIfStale` and the 3-minute alarm fetch, and `mergeMonotonic` replaces the $1 seed. The build host got 403, so no run of this plan saw a refresh. The looser wait loses nothing: a price landing is not an arrival, so `createBalanceCount` never counts it | accepted, `02bdb603`: both calls wait for the first priced figure; flake ledger row 43 says so |
| 2 | material | `recent-activity-handlers.ts`'s header: both builders take a getter and read a ref at click time | holds: `buildCancelHandler` and `buildFocusHandler` take services, and their handlers receive the card's job id | accepted, `67b3432a`: the header is deleted |
| 3 | material | `RecentActivityView.vue:51` and `:459` give terminal records a browser-session lifetime | holds: the journal is in `chrome.storage.local` (`operation-journal/service.ts:91-102`), the view applies no time window, and `gc.ts` evicts only succeeded records | accepted, `7690e28d`; the same claim in `recentlyTerminalJournalOps`'s doc, outside the swept blocks, changes with them so the file does not contradict itself |
| 4 | material | `operation-journal/spec.ts:238`'s queued-transfer example | holds: its literal would not parse (`initialStage` is `{ stage }`), and `inFlightJournalOps` has no stage filter, so a scoped queued transfer would render as an awaiting card | accepted, `24dca78f`: the paragraph is deleted; the rule paragraph above it stays |
| 5 | nit | line citations in blocks the sweep rewrote point elsewhere | holds: `incoming-transfer/spec.ts:84` is `blockTimestamp`, `reaper.ts:192` the restart reason; `reaper.test.ts:102` and `:136` are right | accepted, `aa3df963`: `IncomingTransferPending.accountAddress` and `classifyReapKind` by name |
| 6 | nit | `hardening.test.ts:138`'s banner repeats its `describe` | holds, but the file gives every `describe` a banner in that form (`:55`, `:105`) | rejected: deleting one breaks the file's convention, and all three is outside this PR |

After the five fixes: the touched unit files and the recent-activity directory, 14 files, 296
passed; `bun run lint` exit 0; the production diff 129 lines in 10 files, all inside comments.

### Finding 1's evidence

Finding 1 changes an e2e file, so P3's held-price probe ran again on the new code (its uncommitted
generator re-anchored on `waitForPricedHero(page)`), then the file's flake bar. The probe holds
every price reply and quote broadcast from just before each return to Home and releases them
itself 1.5 s after the first request; `-t "with animations off"`, proverless, retry 0.

| Run | Result | Each call's read |
|---|---|---|
| Chrome | passed, exit 0 (198 s) | first call "$1,000.00" after a 1,522 ms wait (hold 1,500 ms); second "$1,006.00" after 1,511 ms (hold 1,500 ms); 5 requests and 5 replies held each time |
| Firefox | passed, exit 0 (162 s) | "$1,000.00" after 1,558 ms (hold 1,501 ms); the second call is Chrome-only |

The flake bar, the whole file at retry 0 with `NULO_E2E_PROVERLESS=1`, three consecutive runs per
browser (wall time includes the sandbox boot and the build):

| Run | Exit | Tests passed / failed / skipped | Wall time |
|---|---|---|---|
| Chrome 1 | 0 | 7 / 0 / 0 | 448 s |
| Chrome 2 | 0 | 7 / 0 / 0 | 492 s |
| Chrome 3 | 0 | 7 / 0 / 0 | 500 s |
| Firefox 1 | 0 | 7 / 0 / 0 | 471 s |
| Firefox 2 | 0 | 7 / 0 / 0 | 413 s |
| Firefox 3 | 0 | 7 / 0 / 0 | 431 s |

`bun run e2e:reap` after the bar: exit 0, nothing to reap. No fix touched `tests/e2e/fixtures/**`,
so P8's smoke legs did not need a rerun for the loop; the final gate reruns them on the head.

## Round 2: no new material findings, approve with fixes

The resumed session reviewed `b0f3ff48..HEAD`, the whole diff where the fixes change its reading,
and my dispositions above. Its one nit: flake ledger row 43 cited this file before it was
committed; this commit resolves it. Codex's closing lines: "NO NEW MATERIAL FINDINGS", "VERDICT:
approve with fixes". The loop converged in two rounds; the only finding rejected is round 1's
sixth.
