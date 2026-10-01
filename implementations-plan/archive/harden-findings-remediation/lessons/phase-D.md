# Phase D — Discovery-flood rate limit (F-04, Medium) — MID

Branch: `fix/hf-d-discovery-flood` off `fix/harden-findings`.

## The bug (grounded)
`handleDiscovery` (`background.ts:461`) is the discovery intake:
- **Locked path** (`:475`): `discoveryQueue.enqueue(requestId, origin)` — **unbounded, no coalescing** (`discovery-queue.ts` stores bare requestIds). A locked wallet + a flooding dApp → unbounded queue + badge churn + a burst of popups on unlock.
- **Unlocked new-dApp path** (`:532+`): a connect popup per new `(origin,chainId)`. `pendingDiscoveryPromises` already coalesces **same-(origin,chainId)** popups (`:504`), but there is **no global or per-origin cap**, and **no chainId validation** before the popup.

## Fix
1. **`discovery-queue.ts` — cap + coalesce the locked queue.** `enqueue(requestId, origin, chainId): boolean`:
   - **Coalesce**: skip (return false) if `(origin,chainId)` already queued.
   - **Per-origin cap** `PER_ORIGIN_CAP`: reject if this origin already holds that many.
   - **Global cap** `GLOBAL_CAP`: reject if the queue is full.
   - Track `{requestId, origin, chainId}` per slot (currently bare `string[]`). `drain` unchanged except it reads the new shape. Reject → log + drop (the dApp re-discovers later; no popup owed).
2. **`handleDiscovery` — intake guards (unlocked path).**
   - **Reject unknown chainId before popup**: validate the resolved `chainId` (`:481 chainInfoToChainId(discovery)`) against known networks; unknown → `handler.rejectDiscovery` (no popup, no enqueue). *(verify at impl: the networkService lookup available in this scope, or thread a validator param.)*
   - **Global + per-origin cap on concurrent popups**: count live entries in `pendingDiscoveryPromises` (already keyed `origin|chainId`) globally + per-origin; over cap → reject.

> **Codex is DOWN campaign-wide — auth revoked.** `codex exec` returns `HTTP 401 refresh_token_invalidated` ("your refresh token was revoked. Please log out and sign in again") — the multi-machine OAuth-rotation case. This is why the F + C consults also produced nothing. Every remaining MID consult (D, G, I, E) proceeds on own judgment + is logged here per the AFK rule. **The DEEP unit L (crypto bearer redesign) needs codex** — if still revoked at L, STOP-and-surface for re-login rather than redesign crypto unreviewed. User was told to re-login (`codex login`, ~30s device-code).

## Open questions — RESOLVED on own judgment (codex auth-revoked; logged per AFK rule)
- **Cap values**: `GLOBAL_CAP = 32`, `PER_ORIGIN_CAP = 4`. A legitimate dApp needs a handful of concurrent discoveries at most; a flood is >4/origin or >32 total. Conservative — raise if a real dApp trips it.
- **Eviction**: **reject-new** at cap (never evict an existing pending — evicting could drop a legitimate earlier discovery the user was about to approve). Log every drop.
- **Where to enforce**: locked-queue cap + coalesce → `discovery-queue.ts` (owns the queue); unlocked-popup cap + unknown-chainId reject → `handleDiscovery` (owns the profile-check + chainId-resolution + popup).

## Invariants
- No dApp can push pending discoveries (queued + live popups) past the caps — per origin OR globally.
- Duplicate `(origin,chainId)` discoveries coalesce to one queue slot / one popup (locked AND unlocked).
- A discovery with an unknown chainId is rejected **before** any popup or enqueue.
- `drain` still processes the (now capped/coalesced) set correctly; stale-rejection (`STALE_MS`) preserved.

## Negative tests (wallet-bridge unit — `discovery-queue.test.ts`)
- `enqueue` past `GLOBAL_CAP` → returns false, size capped.
- one origin past `PER_ORIGIN_CAP` → rejected; a *different* origin still enqueues (isolation).
- duplicate `(origin,chainId)` → coalesced (size unchanged, returns false).
- `drain` processes exactly the accepted set; a rejected/coalesced dupe is not double-processed.

## Delivered vs deferred
**Delivered** (the primary flood mitigation):
- `discovery-queue.ts`: `enqueue(requestId, origin, chainId): boolean` — coalesce same-`(origin,chainId)`, per-origin cap 4, global cap 32; reject-new, log drops. Typed queue `{requestId, origin, chainId}[]`; `drain` adapted. The lone caller (`background.ts:487`) passes chainId (resolution hoisted above the profile check).
- `background.ts handleDiscovery`: per-origin + global cap on concurrent connect popups (`pendingDiscoveryPromises`, keyed `origin|chainId`) before the popup — the unlocked-path analog.

**Deferred: "reject unknown chainId before popup".** The current flow creates a DappSession for *any* chainId (no configured-chain requirement), so rejecting an unknown chainId risks breaking an add-network-during-connect path. That's a UX/security tradeoff codex would normally arbitrate — and **codex is auth-revoked**. Crucially, the **per-origin popup cap (4) already subsumes the garbage-chainId flood axis** (a dApp spamming fake chainIds gets ≤4 popups/origin), so the caps close F-04 without it. Left as a follow-up (revisit with codex + a check of whether unconfigured-chain connect is a real flow).

## Gate (plan.md Unit D): `bun run --filter '@nulo/wallet-bridge' test` (174, +4 discovery-queue) + `bun run test` + `bun run lint` + `NULO_E2E_PROVERLESS=1 bun run e2e:agent` (discovery is a dApp path). Layers: lint · unit · network-e2e.
