# Phase 2 — the shared port fake

## What landed

- `packages/extension-messaging/src/testing/port-registry.ts`: `FakePort`, `PortRegistry`
  (`manual` / `microtask` answering, `hold` + `answerHeld`, `deliver`, `remoteClose`, snapshot
  `closeAll`, `sendMock(name)`), `connectStub`. `index.ts` barrel exports only this module;
  `package.json` gains `./testing`.
- `transport-harness.ts`: the three client-direction maps and `mockClientPort` are gone; the helpers
  are one-line delegates (`deliver` / `closeAll` / `sendMock`). Server side, the sendMessage broker
  and the logger helpers are untouched.
- `port-registry.test.ts`: two contract cases.

## Decisions made while building

- **One send mock per connection, not per name for ever.** `open(name)` starts a fresh `vi.fn` when
  the name has no live port. The old harness deleted the mock on disconnect and re-created it on
  reconnect, and `lastRequestId()` / call-count assertions read per connection; ports that are live
  together under one name share the mock.
- **Envelope validation throws a plain `Error`**, not a vitest `expect`. Either is caught by the
  client's send `try/catch` and surfaces as a rejected request; a plain error keeps the module free of
  assertion state and reads correctly in the rejection message.
- `sendMock(name)` throws `hasn't been opened` when no client connected yet — the behaviour
  `capturePortMessage` had.

## Result

No existing test needed a change: all 226 prior messaging tests (the AUDIT A5 send-failure block,
the reconnect block, `hardening.test.ts`, `service.test.ts`) pass on the registry-backed harness.

## Gate

`bun run lint` exit 0 · `bun run typecheck` exit 0 · messaging `tsc --noEmit` exit 0 ·
`bun --cwd packages/extension-messaging test` 13 files / 228 tests passed.
