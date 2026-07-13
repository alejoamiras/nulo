# Codex plan audit — backup-restore-residuals

## v1 (against plan v1) — VERDICT: `reject`
Blockers: (1) tombstone repair fails open; (2) balance fence non-atomic; (3) multiple resurrection writes unfenced; (4) wrong audit base.

Findings (folded into plan v2's decision ledger):
1. **Critical — D-D tombstone repair discards a pending deletion.** Two-phase delete writes the tombstone THEN deletes the profile row THEN purges. A crash before purge + a corrupt tombstone → `repairOrphaned` sees "profile absent" → drops it → tx/auth/balance/PXE data remains, id reusable. "Absent ⇒ nothing to purge" is backwards during phase-2. → telemetry only, no drop.
2. **Critical — balance fence non-atomic.** `balance-job-queue.ts:138-153` shares no lock with `TokenBalanceService.purgeForTokens` (`token-balance/service.ts:227-237`): isCurrent passes → purge deletes → `repo.set` afterward. → shared balance-write lock across projection/purge/create/restore; check while held.
3. **Critical — capture must reject `isReserved` atomically with epoch.** `isCurrent` (`profile-deletion-state.ts:67-75`) compares only epochs; a job enqueued after `beginDeletion` captures the new epoch → stays "current"; corrupt tombstones hydrate reserved-with-epoch-0. → `isLive = !isReserved && isCurrent`.
4. **High — omitted writers.** detached `onTokenAdded`/`onAccountAdded`→`createTokenBalance`→`repo.set` (`token-balance/service.ts:156-168,198-209`, fire-and-forget via `EventHandler.invoke`), `TokenService.restore` (`token/service.ts:567-587`), `TokenBalanceService.restore` (`token-balance/service.ts:296-317`). Must be fenced for D13 COMPLETE.
5. **High — `updateToken` purge-safe but not vs `clearChainState`** (`token/service.ts:94-102` deletes without the token lock). Also `updateToken` does NOT "already hold the epoch"; capture explicitly. No independent `registerToken` (delegates to `addToken`).
6. **High — `addToken` journal ordering.** Journal op created before the lock/fence (`token/service.ts:153-170`); coordinator purges journals before tokens (`coordinator.ts:119-121`) → stale add leaves a post-delete journal row.
7. **Medium — identity via authoritative ownership.** `(id,token,account)` all recur; compare the live token's `profileId`. `getTokenRaw` is active-profile-gated → false-skip after a profile switch → need an internal owner resolver.
8. **Medium — inline, not a guard helper** (a helper can't give atomicity; the leaf lock is the choke point; throw-vs-skip is caller policy).
9. **Low — concurrency proof.** The e2e only polls eventual state; add deterministic pins w/ hold-points for reservation-era enqueue, delete-between-check-write, detached creation, restore writers, callback suppression, successor reuse. Coordinator-only test ≠ "tombstone retained" (needs ProfileService integration).
10. **Operational — wrong base** (HEAD `dff435f` lacked the mechanism; `dev`=`fb61a63` has it). Rebased.

## v2 (against plan v2) — final fresh-context pass — VERDICT: `reject` → escalate to `deep`
`v2 closes: [1 yes, 2 yes, 3 NO, 4 yes]`. Two NEW criticals:
- **C1 — leaf purge not lock-atomic with its writers.** `token/service.ts:549 purgeForProfile` snapshots at :552 OUTSIDE the lock, then locks per-row in `_deleteTokenById`. A writer's in-flight `tokens.set` is missed by the snapshot even with an isLive check → row survives. FIX: purge holds the leaf lock across the ENTIRE snapshot-and-delete.
- **C2 — writer set still incomplete.** Also unfenced: account `createAccountInternal` (`account/service.ts:108`, writes `:125` after `NuloAccount.new` pause), incoming-transfer trust (`onTokenAdded:440`→`:458-462`, detached), operation-journal `createOperation:160`/transition (`:235`→`:303`). "Every writer" was false.
- Medium: `balance-projector.ts:64,:114` still active-gated `getTokenRaw` → profile-switch false-skip (declare policy + pin). isLive itself has no TOCTOU with a whole-purge leaf lock (linearizable).

→ v3 (DEEP): atomic-purge refactor per leaf + isLive gate on the FULL 5-leaf writer set + switch-skip policy.

## v3 (against plan v3) — DEEP double audit (codex + Opus) — VERDICT: `reject` (dual-confirmed) → STOP + SURFACE
Both legs independently rejected v3 with overlapping blockers. This is the 4th round finding MORE, and both conclude the true scope is a wallet-wide deletion-concurrency + lock-ordering redesign, NOT one PR.

**codex v3:** (1) writer set misses `changeAccountName`/visibility, `setTrustAllow/Reject`, `onTokenDeleted` trust, `setOperationMeta`; (2) ~every deletion root also has create-after-purge paths (contact, dapp-session, fpc, network, auth-registry, tx-restore, PXE/account-state); (3) **snapshot-timing** — `coordinator.snapshot` reads token IDs BEFORE `beginDeletion`, so the purge PREDICATE is incomplete (a fenced token.restore between snapshot and beginDeletion writes Tnew with isLive true; balance purge filters only old IDs → survives) — "leaf-lock linearization cannot fix an incomplete purge predicate"; (4) **ABBA deadlock** deleteNetwork N→T vs addToken T→N + self-deadlock (`purgeForProfile` outer-lock + `_deleteTokenById` re-enter); (5) account-secret window real; (6) switch-back stale-balance; (7) "deep is correct; one PR is not."

**Opus v3:** confirms the token↔network ABBA (Phase-3 `clearChainState`-takes-token-lock is the new edge; `addToken` holds TOKEN→`getNode` NETWORK vs `network.purgeForProfile`/`deleteNetwork` holds NETWORK→`purgeChain`→`clearChainState` TOKEN; 5-min force-release); FPC is a 6th leaf (add vector + snapshot-outside-lock purge); account "atomic purge via per-tuple serialization" is UNIMPLEMENTABLE (serializePerTuple ≠ a Lock; purge takes no lock → needs a NEW account-wide Lock); self-re-entrancy traps; operation-journal only has a GLOBAL transitionLock → atomic purge stalls every unrelated transition system-wide incl. the surviving profile's tx FSM. Account fence is LIVE (window `:111`→`:125` real). Confirms isLive, tx reference, dup-token-id, tombstone-telemetry sound.

**Conclusion:** "finish the 2 deferred fences to zero-resurrection" cascades into fencing ~10 services + a new account-wide lock + lock-free inner token delete + createTokenBalance-granularity balance lock + a token↔network lock-order redesign + a snapshot-after-beginDeletion fix + cross-leaf deadlock tests — a multi-PR architectural project with real deadlock risk. The parent arc's DEFERRAL was the correct pre-production call. STOPPED per the AFK scope-expansion hard limit; surfaced to the user for a scoping decision. Full Opus transcript: subagent a756fb5fcead94773.
