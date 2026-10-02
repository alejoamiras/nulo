# Phase 5 — Q4b gas-balance-reader module

## Landed
- `gas-balance-reader.ts`: `${networkId}:${accountAddress}` TTL cache, single-flight dedup, two-call compute (public balance_of_public + PrivateFPC balance_of) with identical log lines + error degradation; `invalidateAccount` (endsWith semantics) + `clear` primitives.
- Facade keeps the event subscriptions at their init registration positions (order load-bearing), now targeting the module; `getGasBalances` delegates after `ensureInitialized` (gate placement verified safe — no caller bypasses the facade).
- `gas-balance-reader.test.ts` (8): cache hit / TTL / forceRefresh / single-flight / per-account vs full invalidation / PrivateFPC second call / error degradation. Stale 8-tuple docblock from the P2 parity nit fixed here.
- Facade: 2,082 → 1,995 lines.

## Gates
- Unit 2,300 · typecheck clean · codex parity: **confirmed** — incl. the getChainId service-call-count neutrality check and ensureInitialized placement.
- e2e: cumulative P3+P4+P5 clean run (67/69, zero failures) — fee-methods + gas-balance card green on this tree.

LESSONS_FILE=implementations-plan/execution-decomposition/lessons/phase-5.md
