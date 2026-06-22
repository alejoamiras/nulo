# Q3 transport unification — MAIN draft (plan #1 of 3)

Independent plan by the main agent. To be consolidated with codex + Plan-subagent drafts.

## Architecture decision
Template-method extraction. A shared abstract **request-handling core** owns the common flow; transport mechanics are abstract hooks the two stacks implement.

- **Shared service core** owns: validate envelope → `unwrapParams` → invoke `requests[method]` → `jsonSanitize` → build response (incl. unified `errorPayload`) → A6 JSON-fallback → `ensureInitialized` (the byte-identical 30s/500ms poll) → logging quartet → `backup`/`restore` defaults.
- **Transport hooks (abstract):** receive-wiring (`onConnect`+Port vs `onMessage`), send-mechanism (`port.postMessage` vs `runtime.sendMessage`), client tracking (port array vs none), keepalive (offscreen-only 20s ping), message routing (offscreen from/to).
- **Shared client core** owns: request map + id allocation, timeout bookkeeping, response decode (incl. `resultIsJson` → `JSON.parse`), error reconstruction (`walletErrorFromPayload` → typed `WalletError`/`Error`). Transport hooks: connect/send mechanism, disconnect handling.
- Reuse `errors.ts` `toPayload`/`walletErrorFromPayload` (already tested) for the unified error path.

## Phases (incremental, each shippable+revertible)

### Phase 0 — Characterization tests FIRST (safety net)
Add unit tests for BOTH transport stacks pinning current behavior: request/response correlation, id allocation, timeout shape (background `RpcTimeoutError` vs offscreen string), A6 JSON-fallback (`resultIsJson` round-trip), `ensureInitialized` timeout, and **both current error contracts** (background → `WalletError` instance via `walletErrorFromPayload`; offscreen → **plain string** reject). Mock `chrome.runtime` Port + onMessage. Per user: the offscreen string-reject is the TARGET of Phase 3 — pin it here as "current", flip the test in Phase 3. Any *incidental* bug found → FIX it (don't pin), flag in lessons.
**Validation gate:** `bun run lint` + `bun run --cwd packages/extension-messaging typecheck` + `bun run --cwd packages/extension-messaging test` (new transport tests green). Layers: typecheck·lint·unit.

### Phase 1 — Shared client helpers
Extract response-decode (incl. `resultIsJson`), timeout bookkeeping, request-map/id-allocation into a shared client core both `background/client.ts` + `offscreen/client.ts` use. Behavior-preserving — KEEP offscreen's string-reject for now (flips in Phase 3). Transport-specific connect/send stay in each subclass.
**Validation gate:** lint + em typecheck + em test (Phase-0 tests still green) + `bun run test:e2e` (smoke). Layers: +smoke.

### Phase 2 — Shared service core
Extract abstract `ServiceCore` base owning the request-handling flow + `ensureInitialized` + logging + A6 fallback, with abstract transport hooks. `background.Service` + `offscreen.Service` extend it, overriding only transport bits. Error contract STILL divergent here (offscreen errorPayload behind an overridable hook that's a no-op for now) — pure structural dedup.
**Validation gate:** lint + em typecheck + em test + smoke + **network e2e** (`e2e:network` label — the core underpins all RPC incl. PXE offscreen). Layers: +network-e2e. RISK: medium.

### Phase 3 — Error-contract unification (RISKIEST)
Offscreen service builds `errorPayload = error instanceof WalletError ? error.toPayload() : undefined` (mirror background:90). Offscreen client reconstructs via `walletErrorFromPayload` + rejects with **Error/WalletError instances** (replace the 4 string `reject(...)` sites: client.ts:72,110,206,237 — add an offscreen `RpcTimeoutError` analog). FIRST audit + migrate PXE offscreen consumer catch sites (`packages/aztec-runtime/src/pxe/*` + any `packages/extension/**` offscreen caller) that depend on string-shape rejections. Update the Phase-0 offscreen-error characterization test to the new contract.
**Validation gate:** lint + em typecheck + em test (flipped offscreen-error test) + `bun run --cwd packages/extension test` (migrated consumers) + smoke + **network e2e** (full RPC incl. PXE error paths). Layers: all. RISK: HIGH (behavior change + consumer migration).

### Phase 4 — Consumer sweep + cleanup
Remove now-dead divergent code, final full consumer test + network e2e, reconcile index.
**Validation gate:** lint + `bun run --cwd packages/extension test` + `bun run --cwd packages/extension-messaging test` + smoke + network e2e + `bun run --cwd packages/extension build`. Layers: all + build.

Smallest-safe first step: **Phase 0**. Riskiest: **Phase 3**.

## Assumptions
**Facts (verified):**
- 4 forked files, 973 lines; `ensureInitialized` byte-identical (background service.ts:187-199 = offscreen 158-170).
- Error divergence: bg service builds `errorPayload` (service.ts:90); offscreen service builds `error` string only (84-95). bg client rejects typed via `walletErrorFromPayload` (client.ts:112); offscreen client rejects plain strings (client.ts:72,110,206,237).
- `errors.ts` has `toPayload`/`walletErrorFromPayload` (tested in errors.test.ts).
- A6 JSON-fallback present in both (bg `trySendJsonFallback`; offscreen inline 113-137).
- extension-messaging has NO transport unit tests (only errors.test.ts); test script `vitest run --passWithNoTests`.
**Inferences (challenge):**
- The transport hooks fully isolate Port-vs-onMessage differences (offscreen keepalive + from/to routing may resist a clean base).
- PXE offscreen consumers that depend on string rejections are FEW + migratable (unverified — Phase 3 audits).
- A single shared correlator preserves background's port-disconnect reject + offscreen's SW-death timeout semantics.
**Asks (surfaced):** none open — scope/validation/tests/harden all answered by the user.

## Security & Adversarial Considerations
- **Trust boundary:** the transports are the wallet's RPC boundary (popup↔SW, SW↔offscreen-PXE). Unifying must not widen what crosses it — `jsonSanitize`/`jsonStringify` sanitization on results must be preserved exactly (no new leak path).
- **Error-contract change:** offscreen errors becoming typed could surface MORE error detail (code/details) to consumers than the prior bare string — confirm no sensitive data in `WalletError.details` reaches an untrusted surface (dapp boundary). The dapp-facing dispatcher already shapes errors separately (out of this package), but verify.
- **Input validation:** keep the envelope validation (`type`/`content`/`requestId`/`method in requests`) verbatim in the shared core — it's the gate against malformed messages.
- **No crypto / no new deps.** Behavior-alignment only.
- **Adversarial:** collapsing two correlators risks an id-collision or timeout-leak across transports; the A6 fallback must stay per-transport-correct; SW-death handling differs (offscreen keepalive) and must not regress.
