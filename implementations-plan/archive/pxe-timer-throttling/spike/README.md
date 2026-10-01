# Spike — where the Firefox slowness comes from, and what removes it

2026-09-21, `dev` at `67d13b23`, one Linux host, headless Firefox and Chrome unless a row says headed; one
run per timing arm, five sends per arm in the confidence round. Raw records: [`results.jsonl`](./results.jsonl).
The harness is [`spike.patch`](./spike.patch) (`git apply` it onto that commit to re-run): a timer probe
imported first in the offscreen entry, a background self-test, three gated specs (timings, lifetime,
suspension / mid-proof), a launch toggle that leaves each browser's own throttling on, an env-gated frame
host and an env-gated heartbeat switch. Firefox's background is terminated through the suite's privileged
`chromeScript`: `ExtensionParent.GlobalManager.getExtension(id).terminateBackground()`.

"Masked" = the three `dom.*timeout*` prefs the Firefox e2e fixture sets. One dApp `sendTx` per arm.

## Timing arms

| Arm | Host | Throttling | Timers | Proving | sendTx | Late timer ms | RPC batches |
|---|---|---|---|---|---|---|---|
| A | window | masked | native | off | 3.0 s | 138 | 32 |
| B | window | **real** | native | off | **25.7 s** | 37,889 | 40 |
| C | window | real | worker shim | off | 3.0 s | 32 | 33 |
| D | Chrome offscreen | Chrome's timer throttling on | native | off | 3.8 s | 43 | — |
| E0 | window | masked | native | real | 65.7 s | — | 28 |
| E1 | window | **real** | native | real | **88.3 s** | 40,046 | 42 |
| E2 | window | real | worker shim | real | 66.9 s | 202 | 35 |
| **F1** | **frame in background page** | **real** | native | off | **2.2 s** | 8 | — |
| **F2** | **frame in background page** | **real** | native | real | **65.7 s** | 417 | 26 |

Self-test inside the PXE page, average per hop:

| Context | `visibilityState` | native `setTimeout(0)` | worker-owned timer | `MessageChannel` |
|---|---|---|---|---|
| Firefox minimized window, real throttling | `hidden` | ~1,000–1,200 ms | 0–0.2 ms | 0–0.02 ms |
| Firefox frame in the background page | `visible` | ~1 ms | 0 ms | 0.02 ms |
| Firefox background page itself | `visible` | ~1 ms | — | — |
| Chrome offscreen document | `visible` | 0.02–0.8 ms | 0.05 ms | 0.01 ms |

## What it shows

1. **One call site dominates the slowdown.** Nearly all the lateness traces to `@aztec/foundation`'s JSON-RPC
   client (the rest is the 20 s keepalive interval firing late, which costs nothing):
   `setTimeout(sendBatch, batchWindowMS)`, with `createAztecNodeClient` defaulting `batchWindowMS` to 0
   (`@aztec/stdlib/dest/interfaces/aztec-node.js:371`, `@aztec/foundation/dest/json-rpc/client/safe_json_rpc_client.js:61,162`).
   Every node call pays one timer tick; in a hidden Firefox window a tick is about a second.
2. **The prover is not slowed by the hidden window** (E2 vs E0), only the node calls around it.
3. **Chrome is not exposed**: its offscreen document reports `visible`. (Short run; the suite's other two
   backgrounding flags stayed on.)
4. **A worker-timer shim works** (C, E2) but replaces global timers in the engine host, fragments RPC
   batches slightly (28 → 35 in the proving arm), needs a dead-worker fallback, and leaves the window.
5. **Framing the PXE page in the background page removes the cause**: the frame inherits `visible`, native
   timers are native again, batching is untouched, and the numbers equal the masked baseline.

## Proving round (frame host, real throttling, masking prefs off)

| Check | Result |
|---|---|
| Full Firefox smoke, retry 0 | 128 passed, 16 skipped — same counts as the window host with masking |
| Full Firefox proverless network suite, retry 0 | 86 files / 117 tests passed, 10 / 15 skipped, 45 min |
| Idle 6 min with the dApp tab open | background page and PXE frame both survive (same creation time, same instance) |
| Idle 5 min with no tab and a live PXE host (arms L5-*) | both hosts: same background, same PXE instance |
| Firefox force-terminates the background (`extension.terminateBackground()`) | both hosts: the background restarts on the next event. Frame host: zero frames, no PXE responder — nothing left behind. Window host: the old PXE window lives on, orphaned, until a new one supersedes it |
| …then unlock → reload the dApp → reconnect → `sendTx` (arm L7-iframe, status asserted) | **frame host: passes** — 7.4 s from unlock to the dApp's result, exactly one new frame, a new PXE instance |
| …same sequence on the window host, real throttling (arm L5-window) | reaches the execute window on a new PXE window, then fails the helper's 10 s "approvable" budget (`feeMethod: null`) — the fee estimate is what the throttling slows; the slowness itself, not a lifecycle fault |

**A test error worth not repeating (arms L-*, L2-*, L3-*).** The first three restart runs "failed on both
hosts identically" — no execute window, then no connect popup. Cause: a background death drops the session
by design (strict security mode), the wallet comes back locked, and a locked wallet queues dApp requests
instead of opening windows. Those specs never unlocked. Arm L3 also reconnected from an origin the wallet
had already approved, which auto-approves with no popup. The recipe that works is `frozen-account-canary`
stage 5: unlock, reload the dApp page, reconnect, re-request the granted bundle. The earlier "idle 4 min with
no tab" row compared two absent PXEs and proved nothing; L5 replaces it.

**Sender shapes, as Firefox delivers them to the background** (READY from the PXE page): frame host —
`{ contextId, documentId, envType, id, origin, url }`, no `tab`, no `frameId`; window host — the same plus
`tab` and `frameId: 0`. Both carry the page URL with its `?instance=` query.

## Confidence round (real throttling throughout)

**Spread — five sends per arm, click to the dApp's result (arms V-*):**

| Host | Sends, in order (first is cold) |
|---|---|
| minimized window (V7-window) | 27.9 · 26.7 · 19.1 · 23.8 · 18.3 s |
| frame in the background page (V9-iframe, 20 s between sends) | 5.0 · 1.5 · 1.8 · 1.7 · 1.5 s |

Every send asserted status `ok`. The ranges do not overlap; the single-run arms above were representative.

**Two harness errors the reviewer and the re-run caught.** `waitForPgResult` resolves on status `error` as
well as `ok`, so the first confidence round's "ok" meant "settled" (arms L5 / S / M / V). Round 7 asserts
status and reproduces every recovery result. It also exposed the first frame spread (V-iframe) as
refusals: the first send deploys the account, and the wallet refuses another first transaction until it has
synced (`DUPLICATE_INITIALIZATION` — "wait for network sync, then retry"). The frame host is fast enough to
fire the second send inside that window; the window host never was. V9 spaces the sends.

**The heartbeat is load-bearing, and natural suspension recovers like a forced one (arm S-iframe).** A wallet
built without the 10 s heartbeat, no extension page and no dApp tab open, idle for two minutes: Firefox
suspended the background by itself, and the frame went with it — a live frame does not keep its background
alive. Then unlock → reconnect → `sendTx`: status `ok` in 7.1 s on one new frame (arm S7-iframe).

**Background terminated mid-proof (frame: arm M7-iframe, killed 5 s into the journal's `proving` stage, all
checks asserted; window: arm M-window, killed 15 s after approval, before the harness asserted status):**

| | frame host | window host |
|---|---|---|
| the dApp's pending `sendTx` | unsettled after 120 s | unsettled after 180 s |
| PXE after the termination | gone with the background | old window alive, orphaned, still `hidden` |
| unlock → reconnect → `sendTx` | **status `ok`**, 67.8 s (a real proof), one new frame; journal: interrupted op `failed`, recovery `succeeded` | fails the helper's 10 s "approvable" budget — throttled fee estimate |
| transfers on chain | 0 before recovery, 1 in total — no additional transfer observed from the interrupted send | 0 |
| windows open at the end | 4 | 6 — hidden windows accumulate |

The interrupted call that never settles is host-independent (the dApp's channel dies with the background);
noted, not chased here.

**Headed Firefox under Xvfb, no window manager (arms H-*):** the frame reports `visible`, native
`setTimeout(0)` 0.8–4 ms, sends 5.2 · 2.4 · 2.0 s. The minimized window reports `hidden`, native
`setTimeout(0)` ≈ 1,000 ms, and its send fails the same 10 s budget. Headed behaves like headless.

## Not measured

macOS and Windows (Firefox also lowers a background content process's OS priority — immaterial here on
Linux); a real desktop session (the owner's headed check covers it); idle beyond six minutes (the lifetime
contract makes it a recovery question, which is measured); the full prover-ON heavy lanes (CI runs them on
the PR — one real proof and one mid-proof recovery are measured here).
