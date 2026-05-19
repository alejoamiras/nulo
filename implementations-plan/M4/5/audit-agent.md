# M4.5 — Plan agent audit

Date: 2026-04-26

**BLOCKING**
- `EventHandler.add` does NOT await async listeners (`packages/wallet-core/src/utils/event-handler.ts:22-28`). `invoke()` calls each callback sync and discards the Promise. Plan's async `onConfigUpdated` (plan.md:127-143) becomes fire-and-forget. Don't defer — commit to: keep listener sync, dispatch via `void (async () => { ... })()` OR extend EventHandler.invoke to await async listeners under Promise.all + try/catch.

**SHOULD-FIX**
- Init-ordering Q3 — name file/line of SW boot sequence as verification target. Look at `packages/extension/src/wallet/runtime.ts` for service-start ordering. (Background services register RPC listeners in CTORS, before `services.start()` runs — see codex.)
- lockedAt migration ownership wording: M4.5 stays at session schema v1; M4.7-c's session migrator must accept BOTH `lockedAt`-present and `lockedAt`-absent as v1.
- Missing test: refresh observes new `lockedAt` in storage (current #3 only checks alarm registry).
- Missing test: stale alarm fires after `silentClose()` (post-restart silent-close path).

**NIT**
- Alarm naming `nulo:<service>:<purpose>` consistent with M4.4 (`nulo:offscreen:reap` vs `nulo:core:session:ttl`). No collision.
- Sequencing: M4.5 NOT blocked by M4.4 (alarms fire SW→SW). Right.
- 30s minimum + reactive fallback adequate.
