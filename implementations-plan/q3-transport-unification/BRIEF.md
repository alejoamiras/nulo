# Q3 — Unify the forked background/offscreen RPC transports (@nulo/extension-messaging)

## Task
De-fork the two parallel RPC transport stacks in `packages/extension-messaging/src/` into a single shared service-core. Source: `/harden quality` finding Q3 (run 2026-06-11-ultra-50b45d).

## Surface (current dev, 973 lines, 4 files)
- `background/client.ts` (263) + `offscreen/client.ts` (297): both own a request map, id allocation, timeout, A6 JSON-fallback parse, and a logging quartet.
- `background/service.ts` (226) + `offscreen/service.ts` (187): both own validate/unwrap/invoke/sanitize/respond + a byte-identical `ensureInitialized()`.
- **Error-contract divergence (the latent bug):** `background/service.ts:90` builds a structured `WalletError.toPayload()` payload; `offscreen/service.ts` has NO WalletError path — it rejects with plain strings / client-side timeouts. Equivalent transport failures surface with incompatible error contracts.
- Consumers: 40+ background consumers; offscreen serves PXE (`packages/aztec-runtime/src/pxe/*`). The public client/service shapes are consumed broadly — preserve them.

## Approved scope (user clarifying answers)
1. **FULL shared service-core**: shared helpers (response-decode, timeout bookkeeping, JSON fallback, ensureInitialized) + **error-contract unification** (offscreen rejects with typed `WalletError` like background) + a single shared **request-correlator / service-core** base class that BOTH transports extend. (The biggest of the three options.)
2. **Validation layers**: typecheck/lint/unit + smoke e2e on every phase; the error-contract / behavior phases ALSO gate on **network e2e** (full RPC incl. PXE offscreen). Real commands: `bun run lint`, `bun run --cwd packages/extension-messaging typecheck`, `bun run --cwd packages/extension-messaging test`, `bun run --cwd packages/extension test` (consumers), `bun run test:e2e` (smoke), `e2e:network` label / `bun run e2e:agent` (network).
3. **Characterization tests FIRST**: pin current transport behavior (request/timeout/JSON-fallback, BOTH current error contracts) with unit tests BEFORE extracting — extension-messaging currently has only `errors.test.ts`, the transports are unit-test-free. NUANCE (user): do NOT necessarily pin discovered bugs as bugs — if characterization surfaces a real bug, FIX it (don't preserve it verbatim). Flag each such fix.
4. **/harden security** post-impl on the messaging boundary.

## Hard constraints
- Public RPC client/service signatures consumed by background + PXE-offscreen consumers must stay compatible (or changes are explicit + migrated).
- The offscreen string→typed-WalletError change is a RATIFIED behavior-alignment (constraints registry #13), not incidental — call it out + cover with tests + network e2e.
- The 3 `nulo-schema-patch.ts` copies are out of scope (pinned house contract).
- Repo norms: Bun, Biome, `noExplicitAny` error, layer-import bans (wallet-core has chrome.* banned), conventional commits, squash-merge to dev, network-e2e is mid-flaky (sync to latest dev incl. de-flake commits before judging).

## What to produce (independent phased plan)
Incremental phases, each independently shippable + revertible, each ending with a concrete **Validation gate** (real commands + pass criteria + layers). Include a **Security & Adversarial Considerations** section and an **Assumptions** section (Facts/Inferences/Asks). Sequence: characterization tests → shared helper slices → shared service-core base (both transports extend) → error-contract unification (offscreen → typed WalletError) → consumer/e2e validation. Identify ordering, the smallest-safe first step, and the riskiest phase.

## CORRECTION (verified post-brief — Plan subagent caught this)
The "transports are unit-test-free" claim above is WRONG. Rich contract suites already exist in the EXTENSION package (they import the extension-messaging transports):
- `packages/extension/src/wallet/base/background/client.test.ts` (449 lines — pins RpcTimeoutError/RpcDisconnectedError/WalletError/A5/A6/disconnect).
- `packages/extension/src/wallet/base/offscreen/client.test.ts` (387 lines — pins telemetry + the CURRENT string rejections).
extension-messaging's own dir has only `errors.test.ts`. So Phase 0 = relocate/extend these (gate the refactor from within extension-messaging) + add the service-side gaps (ensureInitialized timeout, A6 tiers, keepalive) — NOT write-from-scratch.

Other verified deltas (Plan subagent):
- A6 fallback DIVERGES: background `trySendJsonFallback` is 3-tier (sends structured error on stringify-failure); offscreen swallows (service.ts:133-136) → latent hang bug → FIX in Phase 3 (align to 3-tier), don't pin.
- `packages/extension/src/offscreen/is-benign-sw-disconnect.ts:24` = `reason instanceof Error && reason.message === "Client disconnected"` → offscreen's current STRING reject fails it (latent bug); the typed flip must PRESERVE `.message === "Client disconnected"` exactly (also pinned by e2e `.includes("Client disconnected")`).
- PXE offscreen consumers re-parse via Zod + do NOT string-match offscreen rejections (safe to flip). Only hard breakage = offscreen client.test.ts string assertions (6 sites) → migrate same-PR.
- Telemetry must stay an OFFSCREEN-subclass concern (don't force onto background). Riskiest correlator drift = timeout ownership (background inside-entry vs offscreen sidecar `requestTimers` map) + reconnect (port-only — don't give sendMessage auto-reconnect).
- 2 ASKS: (1) error codes for send_failed/timeout — default reuse RpcTimeoutError (timeout) + RpcDisconnectedError (disconnect+send-failed, message-preserved); (2) is extension-messaging's test wired into CI? (no turbo wiring seen — gate explicitly).
