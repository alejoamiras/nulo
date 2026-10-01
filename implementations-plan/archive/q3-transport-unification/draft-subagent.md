# Q3 transport unification — PLAN-SUBAGENT draft (plan #2 of 3)

Independent plan by the Plan subagent (default model; fable slot substitute). Caught the brief's wrong "transports are unit-test-free" premise (verified true).

## Distinctive contributions vs main draft
- **Tests already exist** (`extension/src/wallet/base/{background,offscreen}/client.test.ts`, 449+387 lines, importing `@nulo/extension-messaging/*`). Phase 0 = relocate/extend into extension-messaging + add service-side gaps — NOT write-from-scratch.
- **A6 divergence is a latent bug**: background 3-tier `trySendJsonFallback` (structured error on stringify-failure) vs offscreen 2-tier swallow (service.ts:133-136) → potential silent hang. Fix-not-pin in Phase 3 (align offscreen to 3-tier).
- **`is-benign-sw-disconnect.ts:24` constraint**: `reason instanceof Error && reason.message === "Client disconnected"`. Offscreen's current string reject fails it (latent bug); the typed flip must PRESERVE `.message === "Client disconnected"` exactly (also pinned by e2e `.includes("Client disconnected")`).
- **PXE consumers safe**: re-parse via Zod, no string-match on offscreen rejections (verified no `.includes("Offscreen")` in aztec-runtime/src or wallet/services). dApp `error-envelope.ts` discriminates by `instanceof` then `.message` — flip doesn't widen the dApp oracle (PXE errors are SW-internal, don't transit `toWalletResponseError`).
- **Telemetry stays offscreen-subclass** (don't force a telemetry surface onto background) — base exposes an `onTerminal(id,status,detail)` hook; background passes no-op.
- **Helpers (Phase 1) BEFORE base-class (Phase 2)** — pure-function extraction is the cheapest equivalence proof, de-risks the class merge.

## Phases
- **P0 — Characterization lift-and-shift** (smallest-safe): port the substance of the extension's transport client.test.ts INTO extension-messaging (it has fake-browser setup; add a local port/sendMessage harness). Pin current offscreen string rejections verbatim (flip in P3). Add service-side gaps (ensureInitialized timeout, A6 3-tier-vs-swallow, keepalive presence). Gate: `bun run --cwd packages/extension-messaging test` + typecheck + lint. Unit only. No prod code → trivially revertible.
- **P1 — Shared pure helpers** (`src/core/`): `decodeResult(result, resultIsJson)`, `buildErrorResponseContent(error)→{error,errorPayload?}`, `trySerializeWithJsonFallback`, `ensureInitialized`. Wire background to `buildErrorResponseContent` now (prove equivalence); offscreen adopts in P3. Gate: +`bun run --cwd packages/extension test` (consumers). Unit+consumer.
- **P2 — Shared service-core base** (RISKIEST per subagent): `RequestCorrelator`/`ServiceCoreBase` parameterized over transport seam (send + subscribe/unsubscribe) + divergent policies (reconnect: port-yes/sendMessage-no; telemetry: offscreen-only; per-method timeout: offscreen hook). Unify timeout on inside-entry model, DELETE offscreen's sidecar `requestTimers` map. Keep A5 captured-port guard port-only. Gate: +`bun run test:e2e` (smoke — first control-flow change). Unit+consumer+smoke.
- **P3 — Error-contract unification** [registry #13]: offscreen service adopts `buildErrorResponseContent` (emits errorPayload) + background's 3-tier A6 (bug fix). offscreen client: `errorPayload ? walletErrorFromPayload : new Error(error)`; timeout→`RpcTimeoutError`, disconnect→`RpcDisconnectedError` with `.message` preserved as "Client disconnected", send-failed→`RpcDisconnectedError` cause-tagged; reject type `(error:string)`→`(error:unknown)`. LOCKSTEP same-PR migrate the 6 string assertions in `extension/.../offscreen/client.test.ts` → `toBeInstanceOf`. Gate: + network e2e (`e2e:network`/`e2e:agent`, judged only after syncing to latest dev incl. de-flake). All layers. RISK HIGH.
- **P4 — Cleanup + consumer-test relocation**: delete dead duplication, unify keepalive as optional base feature. Gate: full suite + green network-e2e re-run.

## Riskiest drifts (adversarial)
1. Timeout/timer ownership (inside-entry vs sidecar `requestTimers`) — naive merge → stray reject after success / double-settle. Tripwires: `offscreen/client.test.ts:180,277` + `background/client.test.ts:431` (timer-clears, late-response-dropped).
2. Reconnect — don't give sendMessage the port's auto-reconnect (`client.ts:91`) → infinite loop. Port-only override.
3. A6 collapse → adopt 3-tier (strictly safer); pin stringify-failure→structured-error (not swallow).
- Cut: don't globalize request-id / `uid` (transport-private). Don't unify telemetry into base.

## Security
- Offscreen telemetry sanitizer (`telemetry.ts:87-99` allow-list) must keep running post-flip: typed `WalletError.message`/`details` are richer + user-influenceable → `recordTerminal` must pass only static detail category, never `error.message` (test `offscreen/client.test.ts:347` pins `not.toContain("rm -rf")`).
- `walletErrorFromPayload` reconstructs by code, falls back to base WalletError for unknown — no eval/proto risk; `details` stays opaque `unknown`.
- /harden security post-impl.

## Asks (subagent, defaults chosen)
1. Codes for send_failed/timeout → default: reuse RpcTimeoutError (timeout), RpcDisconnectedError (disconnect+send-failed, message-preserved).
2. Is extension-messaging test wired into CI? (no turbo wiring seen) → gate explicitly.
