# Phase 5 · Full gates, browsers, the sign-off captures

## Order

Step 1 ran first, then the codex loop (`phase-6.md`), then the merge of `dev`, then steps 1 to 5
again on the merged tree, then the captures. The browser half and the captures ran once, on
reviewed, merged code: a codex fix after the captures would have sent a signed-off surface back
to the owner (post-implementation step 3).

## Step 1, local gates

At `8e864ead` (after O1 (a)):

| Gate | Exit | Notes |
|---|---|---|
| `bun run lint` | 0 | |
| `bun run typecheck:all` | 0 | |
| `bun run test:all` | 1, then 0 | 3 timeouts in files this branch does not touch, below; the rerun: every workspace green, extension 7879 passed, 4 skipped, 8 todo |
| `bun run test:ci-gating` | 1, then 0 | 1 timeout, below; the rerun: 244 pass, 0 fail |
| `bun run build` | 0 | |

The timeouts, each a 5 s test timeout at a load average of 120 to 170 from other agents' runs:
`presto/client.test.ts` ("returns one PrestoClient per module instance") and
`content-message-relay.test.ts` (two cases) in `test:all`, both a cold dynamic import after
`vi.resetModules()`, which `follow-ups.md` already carries under `e2e-reliability-fixes` and
ux-feedback's technical list; `scripts/ci-cd/test-soak/cli.test.ts` ("no-json: a run that ends
without a report") in `test:ci-gating`, a spawned fixture. Each passed on the rerun (load 145 and
93).

At `11192069` (after codex round 2 and the merge of `dev`), load average 190 to 2234:

| Gate | Exit | Notes |
|---|---|---|
| `bun run lint` | 0 | |
| `bun run typecheck:all` | 0 | |
| `bun run test:all` | 0 | every workspace green; extension 7886 passed, 4 skipped, 8 todo |
| `bun scripts/ci-cd/plans/check.ts` | 0 | 5 report-only path-token findings, 0 enforced, none in a file this branch touches |
| `bash scripts/check-no-local-paths.sh` | 0 | |
| `bun run test:ci-gating` | 0 | 244 pass, 2 skip, 0 fail |
| `bun run build` | 0 | |

## Step 2, smoke

Built with the plan's flags and run at `--retry=0` with a JSON report. The 7 skips in each Chrome
run are the suite's own: 2 hard `test.skip` (`appearance`, `sw-resilience`'s strict-mode-off), 1
Firefox-only (`action-popup-layout`) and 4 behind an env flag (`_probe-console-capture` ×3,
`store-captures`).

The first Chrome run (`8664ffa3`, load average 475 over 5 minutes) failed 1 of 164:
`rows.test.ts` "Home's first activity row…", `expected 'nothing' to be 'tx-card'` at its icon
press. The file passed 3 of 3 alone. Root cause, reproduced with a throwaway probe that holds the
`token-balance` port's `getTokenBalances` until the icon's centre is read: Home's token card
settles after the activity row turns visible. Before its balances land it is its 32px header
(the ghost rows wait 300 ms), and settled empty it is 139px, so the row moves down 107px. The test
reads the icon's centre as soon as `goBackTo` sees `tx-card` visible, and presses it in a later
evaluate: when the balances land in between, the point falls on the token card's empty state,
whose ancestors carry no testid ("nothing"), exactly the failure. The ghost-row state (111px) moves
the row 28px and still hits. Nothing here is this branch's: the token card, the balances read, the
row and the test's helpers are untouched (the branch's Home feed still waits for its token lookup
before loading rows, as `dev` did). A genuine flake under load, so the suite was rerun. The fix
(after `goBackTo`, wait for Home's token card to settle before measuring the icon) belongs to
`e2e-reliability-fixes`, which took it with this root cause; it is not fixed on this branch.

The first Firefox run failed 1 of 164 at a browser launch: `onboarding-tab.test.ts` "presto
available renders the connected card…", `BiDi socket ws://127.0.0.1:10080/session/… failed to
open` (`fixtures/browser/bidi-attach.ts:125`), with Firefox logging "WebDriver BiDi listening on
ws://127.0.0.1:10080". Root cause: 10080 is on the WHATWG Fetch spec's bad-port list, and Node's
built-in WebSocket (undici, Node v24.21.0) refuses a bad port before opening any connection. A raw
TCP listener on 10080 saw 0 connections from `new WebSocket("ws://127.0.0.1:10080/…")`, against 1
each on 10079 and 10081. `scripts/e2e/resolve-ports.ts` `reservePort()` draws uniformly from
[10000, ephemeral floor − 512), where 10080 is the only bad port, so each Firefox launch has about
a 1 in 22,000 chance of drawing it for geckodriver's `--websocket-port`. A harness flake,
independent of this branch, so the suite was rerun. It was reported with this root cause; the fix
(keep the bad ports out of the window) is not this branch's.

| Run | Exit | Cases | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| Chrome, first | 1 | 164 | 156 | 1 (`rows`, the token-card race) | 7 |
| Chrome, rerun | 0 | 164 | 157 | 0 | 7 |
| Firefox, first | 1 | 164 | 152 | 1 (`onboarding-tab`, port 10080) | 11 |
| Firefox, rerun | 0 | 164 | 153 | 0 | 11 |

Against Chrome, Firefox also skips the 4 `import-dead-rpc` cases (CDP Fetch interception, no BiDi
equivalent) and one more `sw-resilience` case (`skipIf(isFirefox)`), and runs the Firefox-only
`action-popup-layout` case, which passes.

## Steps 3 and 4, network e2e and the flake bar

One file per run at `NULO_E2E_RETRY=0`, each report removed before its run and checked with the
plan's `jq -e` after it. Chrome proves, except `incoming-arrival` (`@requires-proverless`);
Firefox is proverless. `incoming-public-transfers` ran three consecutive times per browser, the
flake bar, since C7's block lives in it.

| File | Chrome: passed/cases, seconds | Firefox: passed/cases, seconds |
|---|---|---|
| `send-picker` | 1/1, 116 | 1/1, 117 |
| `fee-methods` | 8/8, 418 | 8/8, 340 |
| `transfers` | 1/1, 249 | 1/1, 158 |
| `tx-sendTx-sponsoredFpc` | 1/1, 121 | 1/1, 121 |
| `incoming-transfers` | 2/2, 90 | 2/2, 98 |
| `incoming-public-transfers` #1 to #3 | 1/1 each; 216, 231, 199 | 1/1 each; 211, 223, 222 |
| `incoming-arrival` | 7/7, 412 | 7/7, 413 |

All 18 runs exited 0 and passed the `jq -e` check: 0 failed, 0 skipped.

## Step 5, reap

`bun run e2e:reap` ran after every smoke, network and capture run, and once at the end. Every
output kept reads "nothing to reap — no owned run, no orphaned data dirs, no orphaned Firefox
launches": the 4 smoke and 18 network logs, the final capture run on each browser, and the last
reap. The earlier capture runs' logs were overwritten.

## Step 6, captures

A throwaway spec, `tests/e2e/network/_captures-ux-owner-picks.test.ts`, copied in for the runs and
removed after the last, never committed. It ran through `e2e:agent`, proverless at retry 0, at the
popup's 360×600 (the execute window keeps its own size: 400×600 on Chrome, 400×767 on Firefox),
and shot each state in both themes by setting the document's `theme` attribute. The exception is
the Send token card's first 300 ms, time for one screenshot, dark. A fiat line needs a price: the
e2e build prices every sandbox token as USDC (`VITE_NULO_E2E_PRICE_MAP=1`), and the spec seeds a
fresh USD quote (15-minute TTL) before the Home, History and cold-open shots.

| Runs | Steps failed | Cause |
|---|---|---|
| Chrome 1 and 2 | the huge outgoing send; the hand-added sponsor | 1 and 2 below |
| Chrome 3, Firefox 1 | none | 3 below |
| Chrome 4, Firefox 2 | none | the final set |

1. The huge outgoing send (123,456,789 TST out, for the compact form on a terminal row) never got
   a fee estimate, because the Send page refuses the amount: its validator strips only the first
   grouping comma (`send-amount.ts:51`, `.replace(",", "")`). A probe of `validateSendAmount`
   accepts "1,234.5" and "999,999.9" and refuses "1,000,000" and "123,456,789.5". The bug is
   `dev`'s. The owner approved "Fix now, own PR" on 2026-09-29, so it is fixed in
   `fix/send-amount-exact`, together with `AmountCard`'s float regrouping. The step was dropped;
   units pin the compact form on terminal rows.
2. The hand-added sponsor step set `#/popup/send` right after a reload, and the start-up route
   won: the page stayed on `#/popup/general` and `send-from-type` never appeared. The spec now
   waits for Home's Send button and clicks it.
3. Framing only. Shot 14 was taken in the page's own theme, light, under a `-dark` name. Shot 10,
   Home beside the cold-opened History, framed Home's top instead of its failed-send row. The
   final runs set dark for 14 and scroll 10 to the row.

Seen in shots 16 and 17, and `dev`'s: Send's balance corner reads "124,457,554.40000001 TST" for an
exact 124,457,554.4, since `AmountCard.vue:154` formats a float with `comma(…, ",", 8)`. Reported;
it is in `fix/send-amount-exact`'s scope, where the owner approved exact digits cut at 8 places.

Not captured:

- **Nulo's sponsor missing** (row 9's second half, row 11). `FpcService.getFpcs` re-registers and
  stores a missing protocol sponsor on every read (`fpc/service.ts`), so a deleted row is back
  before a card lists sponsors. The state needs a failed discovery, which the e2e cannot force
  without a product hook. Units pin it: `fee-helpers.test.ts`, `FeeSettingsCard.test.ts` ("only
  one added by hand: nothing is selected"), `OperationCard.fee.test.ts` ("Select method") and
  `send.integration.test.ts` ("no gas and only one added by hand, never picked", the "Get private
  gas" button).
- **Send after a profile, network or account switch** (row 7's second half).
  `refetchIdentityScopedState` clears the tokens and sets `tokensLoading` before its read, so the
  page renders the first-load state of shots 14 and 15. `send.test.ts` pins it ("A to B: B's load
  shows neither A's token nor its balance…").
- **Revoke authorizations and the authwit registry** (row 9). Both render the same
  `FeeSettingsCard` as Send and the execute window.
- **A huge outgoing amount on a terminal row** (row 3): item 1 above.

## The last merge of dev, and the final gates

`dev` at `f51ec001` (the grant check's address-case fix) merged as `79e834b9`, just before these
gates. Only the curated `index.md` and `follow-ups.md` changed on both sides. `follow-ups.md`
merged cleanly. `index.md` conflicted and keeps dev's lines, with this plan's line under them. At
`79e834b9`, load average 50 to 69:

| Gate | Exit | Notes |
|---|---|---|
| `bun run lint` | 0 | 1893 files, 29 warnings and 3 infos, as before the merge |
| `bun run typecheck:all` | 0 | |
| `bun run test:all` | 0 | every workspace green; extension 7944 passed, 4 skipped, 8 todo |
| `bun scripts/ci-cd/plans/check.ts` | 0 | the same 5 report-only path-token findings, 0 enforced |
| `bash scripts/check-no-local-paths.sh` | 0 | |
| `bun run test:ci-gating` | 0 | 244 pass, 2 skip, 0 fail |
| `bun run build` | 0 | |

The e2e was not rerun here: the merge's only conflicts were in the curated docs, and CI reruns the
e2e on the merged tree. That rerun matters, because the merge brings in `wallet-bridge`'s changed
scope checks, which the dApp flow in `tx-sendTx-sponsoredFpc` passes through.

## Step 7 and the gate

The PNGs and a one-line-per-file index went to the driver, who publishes the sign-off Artifact
(step 7). The gate's last clause, the printed Artifact URL, is the driver's, so P5 takes its ✓ when
that URL is in.
