# Phase 2 — the reply, its fences, the spec green

## What landed

- `apps/extension/src/wallet/services/wallet-sdk/stale-session.ts` — `staleSessionVerdict(envelope, tabId,
  sessionKnown)`, `sessionKnownTo(handler, sessionId)`, `sessionDisconnectedMessage(sessionId)` and the wire
  literal `SESSION_DISCONNECTED`. **Deviation from the ledger's sketch:** `sessionKnown` is a predicate
  `(sessionId) => boolean`, not a boolean, so the handler lookup runs only for the two session-bound types and
  only when the envelope names a session (the table test pins that the predicate is never asked otherwise).
- `background.ts` — `buildContentTransport(logger, sessionKnown)` shares one `sendToTab` between the SDK and the
  reply; the wrapper body moved to `admitContentMessage` (top frame → schema → `replyIfStale`), which also
  retired the `noExplicitAny` suppression the old inline listener carried. The reply is logged at `debug` as an
  object argument (`type`, `session: describeExternalId(...)`).
- `background.transport.test.ts` — 13 cases on the real `initWalletSdkHandler` + real SDK handler, the relay
  stubbed to hand back the listener, `chrome.tabs.sendMessage` a mock returning a promise, the live session
  established through the real ECDH key exchange (`@aztec/wallet-sdk/crypto` works under the jsdom
  environment — probed before writing the test). The "handler not yet assigned → forward" row of the plan's
  table is a property of `sessionKnownTo` (table test), since `initWalletSdkHandler` binds the handler before it
  attaches the listener and the wrapper never runs without one.
- `test-services.ts` — `fakeSdkServices` extracted from `background.admission.test.ts`'s inline stub so the two
  boots share one service graph.
- `ping-pong.test.ts` — the wire literal read from the installed SDK's source through `@nulo/resolve-asset`; a
  real `ContentScriptConnectionHandler` posts nothing for a disconnect whose port it lacks, holds a port only
  from `discovery-approved` on, and drops it on the disconnect that names it.

## Gate

- `cd ROOT && bun run lint` → exit 0 (30 pre-existing warnings, 5 infos, complexity baseline OK);
  `bun run typecheck` → exit 0.
- `cd ROOT && bun run test` → exit 0: `Test Files 544 passed | 3 skipped (547)`, `Tests 6881 passed | 4 skipped |
  7 todo (6892)` (the skips are the repo's pre-existing `skipIf(!ENV)` real-data suites).
- Touched files alone: `stale-session`, `background.transport`, `ping-pong`, `background.admission` → 4 files,
  40 tests passed.

### Mutation checks (each applied, run, reverted)

| Mutation | Result |
|---|---|
| (a) the stale check moved **above** the subframe check in `admitContentMessage` | `background.transport.test.ts`: 1 failed / 12 passed — "a subframe's message is dropped before anything else — its dead session gets no reply" (`expected "vi.fn()" to not be called at all, but actually been called 2 times`) |
| (b) `SESSION_DISCONNECTED` changed to `session-disconnected-mutant` | `ping-pong.test.ts` + `stale-session.test.ts`: 3 failed / 13 passed — the source-literal pin, the content-script port pin (the real handler ignores the mutant type, so the port stays held: `expected 1 to be +0`), and the wire-shape pin |
| (c) `replyIfStale` disabled in the wrapper | `background.transport.test.ts`: 7 failed / 6 passed — every disconnect-dependent case (both unknown-session types, the repeat, receiver-gone, the chosen dead id, the missed disconnect, the iframe-flag case) |

### E2E (proverless, `--retry=0`, alone on the host, one detached script: network Chrome → network Firefox → smoke Chrome → smoke Firefox)

Network, the seven listed files:

| Browser | Result | `inflight-call-background-death` — time to rejection after the kill | Wall |
|---|---|---|---|
| Chrome | exit 0, `Test Files 6 passed \| 1 skipped (7)`, `Tests 9 passed \| 1 skipped (10)` — the skip is `firefox-background-restart` (whole-file on Chrome, named by the gate) | in flight **2 203 ms**, idle-cold **5 013 ms**, idle-up **12 ms** | 221 s |
| Firefox 153.0.4 | exit 0, `Test Files 7 passed (7)`, `Tests 10 passed (10)`, 0 skipped | in flight **5 833 ms**, idle-cold **5 251 ms**, idle-up **252 ms** | 303 s |

Every file green on both: `inflight-call-background-death` (3), `cold-wake-discovery` (1),
`connect-locked-queue-sw-restart` (1), `balance-row-reconciliation` (1), `session-reconnect` (2),
`lock-cancels-dapp-send` (1), `firefox-background-restart` (1, Firefox). The idle-up numbers (12 ms / 252 ms,
far under the 5 s heartbeat) are the end-to-end proof that the `secure-message` branch answers, not a PING; the
idle-cold numbers sit at one heartbeat, as the design predicts (the waking call is dropped pre-attach, the next
PING is answered). Nothing reached the 15 s owner stop; alternative C stays unneeded.

Smoke (build first, `NULO_E2E_MIGRATION_FIXTURE=1`), `sw-resilience` + `sw-restart-network`:

| Browser | Result | Skips (both declared in-file) |
|---|---|---|
| Chrome | exit 0, `Test Files 2 passed (2)`, `Tests 5 passed \| 1 skipped (6)` | `test.skip` "strict mode OFF (opt-out)" (`sw-resilience.test.ts:137`) |
| Firefox | exit 0, `Test Files 2 passed (2)`, `Tests 4 passed \| 2 skipped (6)` | the same, plus `test.skipIf(isFirefox)` "an open popup outlives the kill" (`:65` — Firefox will not end an event page under an open extension page) |

Noise seen, not a finding: the aztec node's boot log prints `[aztec-node] Error: Address already in use (os error
98)` on both legs (one of its secondary listeners), then comes up on its registry-claimed port and serves every
file; Firefox's usual Gecko console lines (`FormHandlerParent`, `ConduitsChild … closed conduit`).

## Notes

- The transport test needs no `@vitest-environment node`: jsdom here keeps Node's `crypto.subtle`, so the real
  ECDH exchange runs under the extension's default environment (probed with a throwaway test first).
- The `handleEncryptedMessage` spy is placed on the SDK prototype **before** `initWalletSdkHandler` runs, because
  `serializeDecryption` binds the instance method at init; a spy installed later would never see the call.
- The spec is committed byte-for-byte as it ran red in Phase 1 and green here.
