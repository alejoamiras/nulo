# enter-gate-and-ping [light]

Arc D of the discovery-fixes follow-on (parents: `implementations-plan/popup-enter-handler-unification/plan.md` discovery 1, `implementations-plan/fix-cold-wake-discovery-loss/plan.md` out-of-scope finding 2). Both behavior changes owner-authorized by the arc goal.

## D1 — EditProfile submit-validity unification

The (BUG PIN) from arc C: Enter submitted the UNCHANGED profile name right after opening — the submit button was gated on `isStartedEditing`, but `handleUpdateProfile` (the Enter path) checked only `isAvailableToUpdateProfile`, whose `isUnchanged`/`isCollision` guards BOTH require `isStartedEditing`, so pre-edit they could never block.

Fix: `isStartedEditing` moved INTO `isAvailableToUpdateProfile` — one submit-validity source shared by the button and the Enter path (the button's redundant `|| !isStartedEditing` dropped). The warning-display predicates keep their `&& isStartedEditing` so nothing flashes on open. The (BUG PIN) test flipped into a regression pin: `changeProfileName` NOT called pre-edit. EditProfile suite 10/10.

## D2 — ping passthrough

From arc A's recon: the SDK's dApp side sends unencrypted PING control messages as an in-flight liveness heartbeat, and the vendored `BackgroundConnectionHandler` answers PONG — but our zod boundary (`content-script-validator.ts`) omitted `"ping"` from `CONTENT_SCRIPT_MESSAGE_TYPES`, so every heartbeat died at the validator and the dApp silently degraded to its legacy-peer path (dead-wallet detection waits the full dead window instead of a heartbeat round-trip; safe by SDK design, slower UX).

Fix: `"ping"` added to the enum (the validator's own header documents this exact maintenance path). Pins:
- Validator unit: a ping envelope validates (the exact regression).
- **Ping→pong reachability** (`ping-pong.test.ts`): the REAL vendored handler, fake transport, session seeded directly into its private `activeSessions` map (establishing one for real requires full ECDH — the network suite's job): a validator-passed ping for an active session → PONG on `sendToTab` to the session's tab; an unknown-session ping is silently ignored (upstream's safe default). Deliberately reds if upstream reshapes `activeSessions`/`handlePing` — it pins the vendored behavior the validator change relies on. Found en route: upstream `handleMessage` drops non-tab senders before its type switch (the pin's fake sender must carry `tab.id`).

**Not done (per the goal):** the cold-wake relay is untouched — pre-attach pings stay droppable by design (the SDK tolerates missing PONGs; buffering them would be overengineering).

## Validation

- `bun run audit:vue` green; wallet-sdk suite 9 files / 72 tests; EditProfile 10/10.
- Armed smoke: local run per `_smoke-e2e.yml` env + the PR carries `e2e:smoke`.
- Single codex xhigh end-diff pass (light tier) — see ledger.

## Audit ledger

- **Armed smoke: GREEN** (fixture-stamped build + `NULO_E2E_MIGRATION_FIXTURE=1`, per `_smoke-e2e.yml`): 112 passed / 6 skipped.
- **Codex xhigh end-diff (light tier): `approve`, first pass, no conditions.** Independently confirmed: D2 opens no session oracle or amplification (pages cannot submit raw internal envelopes; no `externally_connectable`; PONG goes blind to the session's own tab; unknown ids allocate nothing; relay pre-attach admission still drops non-discovery types); the private-map pin's structural coupling is the accepted trade-off for its stated purpose; D1's gate has no other consumers and reset/collision flows hold; the diff contains nothing beyond the two sanctioned changes.
- **New discovery (codex, pre-existing, NOT worsened by this diff):** `isProfileUpdateInProgress` is a loading flag, not an Enter re-entrancy guard — repeated Enter can start concurrent profile-name submissions. Recorded for the owner report; candidate for a tiny follow-up (early-return on the in-progress flag in `handleUpdateProfile`).
