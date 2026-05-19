# M2.4 plan — codex xhigh audit

Run date: 2026-04-22. Plan file: `plan.md`. Tool: `codex exec -s read-only -c model_reasoning_effort=xhigh`. Tokens: 245,785.

## Verdict: **Go with 2 medium fixes.**

## Findings

**MEDIUM — BackgroundTickerPort under-specified**
As written it's mostly a renamed `ClockPort.setInterval` — doesn't yet justify a new port. Has an overlap bug: `onTick` is async but the next interval can still fire while a previous tick is in flight. Fix: make the contract explicit in plan + tests:
- `subscribe()` must be **serialized/coalescing** — at most one tick in flight at a time.
- Missed intervals collapse to **one pending tick** (not a backlog).
- `cancel()` prevents future delivery.

If you don't want the stronger contract, use `ClockPort` directly.

**MEDIUM — Plan misstates current TokenBalanceService behavior**
Plan claims (lines 22, 59, 330) that `onActiveProfileChanged` "clears cache + re-enqueues all balances". The real code at `token-balance/service.ts:148` **only swaps `profile` and reloads token metadata** on profile change. It does NOT clear balances, clear the queue, or re-enqueue all. Fix: correct the plan; decide explicitly whether profile-switch invalidation is preserved behavior or a deliberate M2.4 change.

## Per-question answers

**Q1**: `BackgroundTickerPort` justified only if it guarantees something ClockPort does not. Right guarantee: serialized/coalesced background ticks for async work. As currently specified, not justified.

**Q2**: Regression risk LOW if stored balances preserved and only scheduler changes. Silent session restore doesn't emit `onActiveProfileChanged` (profile/service.ts:54); `TokenBalanceService.init()` pulls profile, loads tokens, starts worker; `getTokenBalances()` returns persisted immediately. Real risk only if M2.4-a introduces the plan's incorrect "clear + re-enqueue" behavior.

**Q3**: "Just lifecycle" is the right cut for WindowManager. Passkey + dApp approvals have different payload storage + different settlement RPCs; if WindowManager owns popup RPC boundary too, you're building the higher-level `ApprovalPort` — a larger refactor.

**Q4**: Keep `BalanceProjector` on `ExecutionService.executeSimulateViews`. Gas-balance cache lives in `getGasBalances`, not in `executeSimulateViews` (execution/service.ts:973), so no cache coupling to preserve beyond the same simulation path. Going direct-PXE duplicates contract registration, artifact lookup, account registration, network/PXE selection.

**Q5**: Single `createNode(rpcUrl)` sufficient. NetworkService only constructs + caches; doesn't destroy or probe health through a separate abstraction (network/service.ts:89). Don't design for hypothetical.

**Q6**: Don't prevent multiple concurrent windows of same kind. PasskeyService + DappInteractionService key by request id, not kind. Wallet-sdk per-origin dedup is consumer policy, not window policy. Rule: **never key WindowManager state by `kind`; key by handle id**.

**Q7**: No duplication risk if layering clean. WindowPort = raw browser primitive (create/remove/onRemoved). WindowManager = higher-level coordination. Duplication only happens if WindowManager re-exposes raw APIs or bypasses WindowPort.

**Q8**: Split reasonable. 450 LOC has 3 real concerns — persistence / projection / scheduling-orchestration. Repo/Projector/JobQueue is the right stopping point. Don't split further.

**Q9**: Defer wallet-sdk popup as planned. That site is fire-and-forget verification UI (background.ts:135), not the shared "open / await settle / timeout+onRemoved" pattern. Forcing it into WindowManager now widens abstraction for little gain. Leave a follow-up task.

**Q10**: Blast radius MEDIUM, not catastrophic. Double-tick: duplicate `executeSimulateViews` calls, overlapping task state changes, extra events, unnecessary PXE/node load. Unlikely to corrupt durable state but can create noisy latency regressions — which is why Q1's serialized/coalesced contract matters.

## Notable disagreement with agent audit

- Agent flagged **BackgroundTickerPort JSDoc** misclaiming chrome.alarms swap-in. Codex didn't touch the JSDoc aspect; it's focused on the async-overlap contract. Both agree the port as written is under-justified — plan-fix must address both angles.
- Agent wanted WindowManager **demoted to plain injectable** (not Service<Methods>). Codex explicitly said WindowPort + WindowManager layering is fine and "just lifecycle" is the right cut. **Disagreement**: needs resolution in the iteration. My read: codex doesn't mind the Service shape, just cares that WindowManager doesn't own RPC to popups (which the plan already doesn't do). Agent's concern was about "RPC-addressable `settle/cancel` methods visible to any SW code" — that's a real footgun even if the shape is Service. Resolution: demote `settle/cancel` off the RPC surface (make them plain class methods) while keeping the Service shell if we want Events + RPC access for future consumers. Middle ground.

## Verdict summary

**Fix the 2 mediums + incorporate agent's chrome.alarms JSDoc finding + resolve the WindowManager Service-shape disagreement → Go.**
