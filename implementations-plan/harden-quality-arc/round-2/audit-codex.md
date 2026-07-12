# Round-2 codex audits

## R6 (Q-02 arg guards) — pre-merge, SAFE TO LAND (`019f1f8f`)
codex xhigh reviewed the extraction before #244 merged: "SAFE TO LAND, zero behavior-changing findings" — independently verified listener-identity pairing, thunk TDZ-safety, reactivity shape, every must-stay divergence. Recorded in `plan.md` R3b/R6 rows.

## R7 confidence pass (`019f1fe5`) — BLOCK → (under reachability facts) SHIP-WITH-NOTES

**Initial verdict: BLOCK**, two HIGH findings:
1. Token/account arg-scoped + by-id RPCs trust caller-supplied `profileId` (`token/service.ts:94,214`; `account/service.ts:66,152`) — "a client that knows p2's id can read/mutate p2 rows"; the isolation test asserts `getTokens(p1.id)` not `getTokens(p2.id)` while p1 active.
2. dApp-session by-id RPCs (`dapp-session/service.ts:71,157,249,289`) load/update/delete by `sessionId` without an active-profile check.

**Main-agent verification (why this is NOT a round-2 merge blocker):**
- `updateToken`, `getDappSession(id)`, `updateDappSession`, `deleteDappSession`, account mutations are **NOT in `METHOD_REGISTRY`** → not dApp-dispatchable (`assertKnownMethod` throws). Grep = 0.
- The sole dApp→token path `isTokenRegistered` passes **`ctx.profileId`** (server-derived), not a dApp value (`dispatcher.ts:408`).
- dApp session resolution is by `(origin, chainId)` (`dispatcher.ts:340`); the one by-id read (`:950`) re-reads its own resolved session.
- The authoritative `../findings/Q-13/plan.md` (lines 14, 49, 52) ALREADY assessed this exact surface: "defense-in-depth, NOT dApp-reachable (confirmed), extension-Port-RPC reachable, **explicit accepted non-fix, owner decides**." The loop's owner-authorized change list scoped Q-13 to the **no-profileId by-id READ getters + revokeAuthwits + backup leak** — NOT the arg-scoped mutations or dapp-session. Closing those is a fail-open→closed change off the authorized list = a HARD LIMIT (halt+surface), not an autonomous fix.
- **Round 2 did not touch these methods** (`getTokens(profileId)`/`updateToken`/account-mutations/dapp-session are byte-identical to `dev`); R1 only ADDED guards to the by-id READ getters + split deleteToken + fixed the backup export leak + revokeAuthwits.

**Revised verdict (codex, after pushback with the 3 reachability facts): SHIP-WITH-NOTES.** codex confirmed all three facts verbatim and stated: "my BLOCK over-scoped extension-Port-RPC defense-in-depth into dApp reachability. Round 2 did not introduce a new dApp-reachable cross-profile exposure based on these paths. The remaining issue is pre-existing, owner-gated extension UI/internal RPC hardening, not a round-2 merge blocker."

**→ OWNER DECISION ITEM (surfaced, not a regression, not autonomously fixable):** whether to fail-closed the extension-Port-RPC arg-scoped/by-id surfaces (token/account `getTokens(profileId)`/`updateToken`/…, dapp-session by-id). Pre-existing on `dev`; not dApp-reachable; fixing = a fail-open→closed change beyond the round-2 authorized list. This is the natural round-3 candidate.
