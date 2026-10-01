# Phase 5 — `contractsReady`, envelope-aware errors, send gates

**Status:** ✓ gate green — `bun run test:tools` 1446/1446 (102 files) · `bun run --cwd apps/tools typecheck` exit 0 · `bun run lint` exit 0 · `bun run build:tools` exit 0 (extra, not required by the gate).

## Gate (as written, in order)
| Command | Exit | Detail |
|---|---|---|
| `bun run test:tools` | 0 | 102 files, 1446 tests, 0 fail |
| `bun run --cwd apps/tools typecheck` | 0 | `vue-tsc --noEmit && tsc --noEmit -p tests/browser/tsconfig.json` |
| `bun run lint` | 0 | 32 warnings / 5 infos (pre-existing, non-failing), complexity-baseline check OK |

`typecheck:all` (the whole-repo superset) also runs clean; `build:tools` is green as a sanity check beyond the gate.

## What shipped
- **`createAztecWalletSession.ts`** — `contractsReady: ref(false)` on `SessionState` and the returned session (exposed after `hiddenAccountsCount`, before `error`). Set `false` in `wipeToIdle`, at the top of `finishSetup`, and in `retryCapabilities` before `requestCapabilities`; set `true` only after `await registerContracts` resolves **and** `isStale(s, flowEpoch)` passes. New epoch-fenced `reregisterContracts(s)`: no-op `false` when `!wallet.value` or `activeFlowEpoch !== null`; otherwise claims the flow, clears readiness, re-registers, re-checks staleness before publishing (stale → `false`, no state touched), fresh → `contractsReady = true` + release + `true`; on throw mirrors `finishSetup`'s catch (`error = normalizeError`, `status = "error"`, readiness stays false, release) and rethrows. Added `export type AztecWalletSession = ReturnType<typeof createAztecWalletSession>`.
- **`errors.ts`** — category `"chain-desync"` + copy `"Your wallet's view of the network was behind. Try again."`. `ENVELOPE_CATEGORY` maps `PXE_STALE_ANCHOR → chain-desync`, `CONTRACT_NOT_REGISTERED → contract-not-registered`. `walletErrorCodeOf(err)` (exported for Phase 6) parses the message JSON, and if that yields a string parses **once more** (two levels, never deeper — extension transport wraps the envelope object once, the wallet-sdk iframe transport JSON-encodes the message string again), accepting only an object with a string `data.walletErrorCode`. `normalizeError` consults it first, then falls through to the unchanged substring rules. Extracted `isCapabilityRejection(lc)` so the added envelope branch keeps `normalizeError`'s cognitive score at exactly its accepted 21.
- **`useWalletConnection.ts`** — `SETUP_PENDING` const + `contractsReadinessRefusal(session)`: status-first (`status !== "connected"` → session's own normalized error message, fallback `"Connect your Aztec wallet first."`), then `!contractsReady` → `SETUP_PENDING`, else `undefined`. Structural param type (not `Pick<AztecWalletSession, …>`) so plain-object test args typecheck.
- **Gates wired** — `performSend` after `ensureSendGrant`; `performExit` after the `isGranted` check (extracted `exitGuardRefusal(plan, d)` to keep cognitive ≤ 15); `drip()` before `inflight` (reads the singleton via `useWalletConnection()`). No UI added — the existing "Retry connection" button (`AztecWalletPanel.vue:77,94`, a fresh `connect()`) is the recovery for a failed-registration `error` state.

## Tests (inline)
- `createAztecWalletSession.test.ts`: `contractsReady` false→true across setup, false again on a mid-setup disconnect, **false-during / true-after** across a quiet `retryCapabilities`; `reregisterContracts` returns false while a flow is live, true + one `registerContracts` call otherwise, false with untouched state on an epoch bump during its await, and `status:"error"` + rethrow on rejection with a fresh `connect()` recovering. `contractsReady` reset before the second connect needed `stream = makeStream()` re-init (fixed).
- `createAztecWalletSession.pins.test.ts`: surface pin updated 30 → **32 members**, `contractsReady` + `reregisterContracts` in order.
- `errors.test.ts`: both codes → their categories from **both** transport shapes; non-JSON and code-less JSON fall through; three-level nesting → undefined; `walletErrorCodeOf` direct.
- `useSend.test.ts` / `useHubExit.test.ts` / `useDrip.test.ts`: error-state refusal is the session message, connected-not-ready is `SETUP_PENDING`, proceeds when ready. `useWalletConnection.test.ts`: 4 direct `contractsReadinessRefusal` cases.

## Notes / dead ends
- **Node-env test files can't `importOriginal` `useWalletConnection`** — under `@vitest-environment node` its module load touches `localStorage`. `useHubExit.test.ts` and `useDrip.test.ts` therefore reproduce the two-line readiness predicate **inline** in a sync mock over the same session stub; `useSend.test.ts` (also node env) spreads the real export via `async (importOriginal)` because its mock is already async. The live copy is unit-tested in jsdom (`useWalletConnection.test.ts`) so the inline reproduction is pinned against the real one by construction.
- **Complexity**: adding envelope branches to `normalizeError` would have pushed its stamp past the accepted 21; offset by extracting `isCapabilityRejection`, leaving it exactly 21 (verified `bun run baseline:rescore`). `performExit` exceeded cognitive-15 from the readiness gate; fixed by extracting `exitGuardRefusal(plan, d)`. No new acceptances, no manifest change.
- **Lint**: the only red at the end was three **formatter** diffs (not lint-rule violations) in the node-env test files; `biome format --write` cleared them. The 32 warnings / 5 infos predate this arc and do not fail `bun run lint`.

## Carry-forward to Phase 6
- `walletErrorCodeOf` is the structured-code reader `retryOnUnregistered` keys off (the code only, never the substring category). `reregisterContracts` is the recovery it calls; its `false`-when-a-flow-is-live contract is what makes the retry a no-op during an in-flight setup.
- `AztecWalletSession` type is exported for the helper's `session` param.
