# transport-ready-handshake: the spec rows

The parked arc's spec lives in two closed plans. Its rows are copied here verbatim on 2026-09-30, so they stay with the parked plan when those plans move to `archive/`. The sources remain the record of each row's history.

## Decision-ledger rows 1 and 6

From [deflake-round-4/fix-plan.md](https://github.com/alejoamiras/nulo/blob/9f11de70b13933be2d54c3eb79622b1ff2719aba/implementations-plan/deflake-round-4/fix-plan.md), § Decision ledger.

| # | Decision | Chosen | Rejected (why) | Source |
|---|---|---|---|---|
| 1 | Transport fork | Liveness-gated single-shot rollback (causal signal, exactly-once, caller-level) | (i) fable's Ready-handshake transport rework — architecturally complete but reworks the wire every surface depends on, +1 RTT on first call, protocol change, large blast radius vs ONE proven victim; LEDGERED as the follow-up transport-hardening design with fable's full mechanics (MessageType.Ready, sent-flag, arm-before-ready, F-09-gated ack, backoff, harness, AND the `chrome.runtime.lastError` read in onDisconnect that silences the per-respawn unchecked-lastError console churn — which the chosen fix deliberately does not touch). (iii-main) bounded retry loop — the banned bound-as-fix shape; codex+fable both rejected. (ii) boot-time auto-delete — user-visible contract change + destructive-on-boot; its machinery already exists as the torn-marker backstop. Fable's contradiction-check re-attacked and CONCEDED this row (no failure mode justifies pulling the rework forward) | codex primary; fable challenge recorded + conceded |
| 6 | Boot race (delegate not ready) | Covered by design (liveness ⇒ wired) | fable's awaitInitialized wait in deleteProfile — correct under (i), unnecessary under the chosen design; note kept for the transport-hardening follow-up | main |

## Recon § B: the messaging client surface

From [deflake-round-4/recon-fixes.md](https://github.com/alejoamiras/nulo/blob/9f11de70b13933be2d54c3eb79622b1ff2719aba/implementations-plan/deflake-round-4/recon-fixes.md). Its line numbers were exact at dev `3e3bd129`.

**No Port-side handshake exists.** service.ts:37-52 `onConnect` authenticates the
sender (F-09) and registers — it sends NOTHING back. `ClientState.Connected`
means "a Port object exists" (chrome.runtime.connect returns one synchronously
with no live worker); `ensureTransportReady` (client.ts:102-112) returns void the
instant state===Connected. base-service.ts has an `initialized` gate but it is
never surfaced over the wire.

**Shipped precedent for queue-behind-liveness (candidate i)**: the OFFSCREEN
sibling transport — `onReady()` overridable pre-request hook
(offscreen/client.ts:87-101) + `ensureOffscreenRunning()` single-flight with a
real ping/pong health probe (apps/extension/src/wallet/utils/offscreen.ts:283+,
123-140). No SW-ping equivalent exists today; building one is new infra.

**Fast-rejection reliers (the case AGAINST a blanket queue)**:
- fire-and-forget LoggerServiceClient.log from the offscreen console sniffer
  (offscreen/index.ts:36-43) — expects fast reject, swallowed by
  `isBenignSwDisconnect` (apps/extension/src/offscreen/is-benign-sw-disconnect.ts:23
  — NOTE: hardcodes "Client disconnected" instead of importing the constant;
  drift risk if the message contract changes).
- app.vue account-switch syncTransactions (per the e2e fixture comment
  extension.ts:171-178); e2e filters match the exact string.
- **External dApp contract**: wallet-sdk/error-envelope.ts:61-73 maps
  RpcDisconnectedError → transient retry-safe (-32603 + RPC_DISCONNECTED,
  deliberately NOT 4900). Fix must preserve retry-ability semantics.
- Queuing new calls silently converts today's fast benign noise into 60s hangs
  (DEFAULT_RPC_TIMEOUT_MS) unless the handshake resolves within the respawn
  window.

**Caller-level bounded-retry house precedent (candidate iii)**:
apps/extension/src/composables/importPreflight.ts:1-40 — per-attempt 5s timeout,
backoff [2000,4000], absolute shared deadline, explicitly commented for an
unresponsive SW. The existing template for a narrow flow-local retry.

**Test placement**: composition layer is the WRONG home (COMPOSITION-TESTS.md
D1-D6 govern the wallet service graph, not the wire). Home =
packages/extension-messaging client.test.ts (describe "port onDisconnect →
reconnect", L470-516 already pins churn basics) using
src/testing/transport-harness.ts — which needs ONE new primitive: a doomed-port
fake (mockClientPort L63-116 always attaches a live listener; leaving
connectServiceClient un-invoked simulates the respawn gap).

**Conventions/collisions**: next AUDIT letter+digit comment convention,
cross-linked to errors.ts; any NEW lifecycle EventHandler must be added to
`reservedEventNames` (client.ts:37, hardening.test.ts:156-164) or it becomes a
forgeable-event surface; every terminal path goes through settle()
(base-client.ts:230-246), never direct resolve/reject; PRESERVE the
synchronous-send fast path for steady-state Connected (client.ts:102-112 +
base-client.ts:104-110); connect() reentrancy is only guarded by the state
enum — a new Handshaking phase must gate the same way.

## The two open flake-ledger entries

From [e2e-deflake/flake-ledger.md](https://github.com/alejoamiras/nulo/blob/9f11de70b13933be2d54c3eb79622b1ff2719aba/implementations-plan/e2e-deflake/flake-ledger.md).

- **Two network tests still use the primitive that does not kill — NOW ONE
  (deflake-round-4): `backup-restore-sw-restart.test.ts` was rewritten on the real kill
  (`worker().close()` + `targetdestroyed` identity) with a rendezvous-anchored kill phase,
  and both its scenarios are green regression gates in the fix stack.
  `frozen-account-canary.test.ts` stage 5 REMAINS on the fake primitive.**
  `network/frozen-account-canary.test.ts` (stage 5) and
  `network/backup-restore-sw-restart.test.ts` — the latter's entire premise is a
  mid-restore crash which therefore never happens. Converting them to `worker().close()`
  changes what they exercise and needs its own network evidence run. HIGH value: until
  then, neither proves anything about a restart.

- **Crash-before-provision delete refusal (edge, fails closed).** With the map at
  `deleted(G1)`, `clearProfileState(G2)` is REFUSED by the different-gen guard —
  a crash after a re-import mints G2 but before provisioning leaves a state whose
  delete fails to the torn backstop until offscreen restart. Behavior pinned
  as-is in the fence-fix PR; full treatment belongs to the ledgered
  transport-hardening follow-up (fable fresh-audit find).
