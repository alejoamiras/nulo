# Opus subagent audit — v3 plan (parallel popups)

Dual-audit pair with codex (`audit-codex.md`). Both verdicted **needs-revision**. Codex went sharper on the load-bearing claim and falsified it (HAS-A-HOLE); opus said HOLDS-with-caveat but independently found the dead-hook wiring bug, which reframes the whole effort. Both findings folded into plan v2.

---

**Verdict: needs-revision.** Not a blocker — the design is directionally sound and the load-bearing claim survives the hard cases. But the plan rests on a factual premise about the *current* baton wiring that is **wrong in production**, and that error changes the framing of the whole refactor. Fix the premise, close two real gaps (silent-path release point, claim-vs-cancel-vs-mutex ordering), and it ships.

## The load-bearing claim: HOLDS (with one caveat the plan must state)

**Claim:** the exec-mutex is UX-only; correctness comes from (a) `Fr.random()` nonce sealed into `txRequest` and (b) per-call `chainGuard.write()`.

I tried to break it via the build/build race and could not produce corruption. [NOTE: codex DID produce a falsification — stale private-note selection + NO_FROM-has-no-nonce. Codex's HAS-A-HOLE supersedes this section. See audit-codex.md #1/#2.]

The crux sub-question — is there a window where T1 and T2 are both past baton-release, neither holds the exec-mutex, both entering `buildAndEstimateTxRequest`? **Yes, that window exists** in v3 by construction. What serializes them? **Only the per-call `chainGuard`** — and the chainGuard releases *between* each PXE call. So `buildStandard` is **not atomic**; two concurrent builds freely interleave at PXE-call granularity.

[Opus assessed the interleaving as harmless because the only check-then-act it traced was the idempotent contract-register. Codex traced deeper — into private-note/FPC selection during simulate — and found a real stale-read → on-chain-reject path. Treat codex's finding as authoritative: the mutex is correctness-relevant.]

The pin opus recommends regardless: **a test asserting two concurrent `buildStandard` calls on the same account produce two distinct nonces and two independently-valid txRequests.**

## The factual error that reframes the plan (opus's primary contribution)

The plan assumes PR #53's `onTxRequestFinalized` early baton-release **fires in production**. **It does not.**

- `background.ts:223` passes `{ releaseFifo, queuedJournalId }` to `handleWalletMessage`.
- `handleWalletMessage` forwards that object as `DispatchHooks` to `dispatch` (background.ts:539).
- `dispatch` reads `hooks.onTxRequestFinalized` (dispatcher.ts:426) — **a field that does not exist on the object**. It's `releaseFifo`. So `onTxRequestFinalized` is `undefined`, and the explicit release at `execution/service.ts:1783` is a **no-op in production**.
- The dispatcher test passes a hand-built `{ onTxRequestFinalized, ... }` with the *correct* field name, so it's green. The production name-mismatch is uncaught because `DispatchHooks` fields are all optional.

[VERIFIED independently by the main agent against all four files — confirmed true.]

**Consequence:** today the baton releases ONLY via the safety-net `.finally(releaseFifo)` at handler completion. Concurrent sendTx is **already serialized end-to-end** — T2's handler (incl. popup) doesn't start until T1's handler fully completes (prove + submit + journal). The "popup #2 waits for popup #1's full prove" behavior the user is complaining about is *exactly this dead-hook bug*.

v3 Step 1 must: (a) correct the field wiring so the early-release path is reachable, (b) add an integration test driving the real `onWalletMessage → dispatch → executeAztecSendTx` chain asserting the release point, (c) re-derive D1/D5/D6 against the corrected baseline.

## Do I still hold my v2 "no mutex" position? — Withdrawn.

The plan is right that `withPxeWrite` alone cannot keep T2 visibly Queued (nothing holds T2's journal stage). A real FIFO abortable mutex is easier to make cancel-correct and starvation-free than a journal-watch loop, and keying it to the chainGuard `(profileId, chainId)` makes the lock-order story trivially clean. **I withdraw the "no mutex" recommendation.** The plan won on engineering ergonomics. [And codex's falsification shows the mutex is outright correctness-required, not merely ergonomic.]

## Per-item findings

1. **Mutex necessary? — P1.** Chainguard suffices for per-call correctness; does NOT hold T2's journal stage at Queued. Mutex is the cleanest way. Keep it.
2. **Key `(profileId, chainId)` vs incl. account — agree, P2.** Per-account under-serializes: two accounts on one chain share the PXE runtime + chainGuard, so proving is already serialized at the runtime layer; a per-account exec-mutex would let two lifecycles overlap at the UX layer while the chainGuard silently serializes — the "both pending, one secretly blocked" confusion. `(profileId, chainId)` correct. (This reverses opus's own v2 take, which argued for incl. account.)
3. **Cancel-while-waiting (D5) lock order — P1.** During the wait there is NO controller for T2 (claim-helper registers the controller, and claim runs *after* acquire). So `cancelJob` finds no controller → not a deadlock but a **delayed cancel** (T2's promise doesn't reject until T1 finishes). Fix: register a pre-acquire AbortController keyed by `queuedJournalId` BEFORE `mutex.acquire`, thread its signal into acquire, claim-helper reuses it (claim-helper.ts:141 currently always `new AbortController()`). Lock order exec→journal consistent; no deadlock.
4. **Reaper (D6) — P2, prefer flag BUT careful.** `reaperExempt` flag cleaner than churning `updatedAt`, BUT the flag MUST gate only the *periodic* reap, NOT the boot sweep (reaper.ts:130 unconditional). If the flag exempts records from the boot sweep too, a waiting T2 becomes immortal across restarts. [Codex prefers heartbeat-updatedAt over the flag precisely to avoid restart-semantics complications. Plan v2 adopts heartbeat.]
5. **Silent-path baton release (D1) — P2.** The "permanent block" worry is unfounded — the safety-net always fires on completion. Keep the safety-net regardless. The real question is where the *new* release fires on the silent path: right before `executeOperations` (service.ts:305, after the queued→pending fast-forward). [Codex agrees: silentInteraction just before executeOperations.]
6. **Simpler design? — near the floor.** One simplification to weigh: collapse `onInteractionApproved` into the exec-mutex-enqueue point (baton governs entry into the exec-mutex queue, not popup approval) — one ordering primitive instead of hook+mutex. Weigh against D1; may not survive the popup-lifecycle (popup approval is what unblocks T1's `await interaction()`). [Codex's #4 clarifies interaction() resolves at window-handle-settle, not approval — which makes the separate approval seam necessary. So this simplification is rejected; keep the explicit approval hook fired from approveInteraction/silentInteraction.]
7. **SW-restart — P2, already handled.** Boot sweep terminalizes BOTH (T1 → sw_restart_post_prove, T2 → stuck/lost). In-memory mutex GC'd with dead SW. Document as expected; do NOT assert resumption. Correct wording: restart *fails* the record immediately, not "ages out."
8. **E2E wall-time (E2 prove×2) — P1, do it now.** The existing concurrent-sendtx test rejects-before-prove specifically to fit budget; its TODO admits the approval-path companion is unbudgeted. fee-methods was split to `network-e2e-heavy` precisely because multi-prove blows the per-file budget. **Budget E2 for heavy from the start.** Keep E1 (popup-boundary, reject-before-prove) on the standard matrix — it pins I1, the actual UX regression guard.

## The one thing before approval

**Fix and pin the dead-hook finding first.** The plan is built on the belief that PR #53's `onTxRequestFinalized` early release is live; it is not. Until the implementer knows the baton currently releases only at handler completion, every reasoning step about "moving the release earlier" is anchored to a phantom. Step 1 of v3: correct the wiring, add the integration test that would've caught it in #53, re-derive against the corrected baseline.

**Implementer file refs:** dead hook — `background.ts:223` (passes `releaseFifo`) vs `dispatcher.ts:426` (reads `onTxRequestFinalized`); cancel-ordering — `claim-helper.ts:141` (fresh controller post-claim); silent-path release — `dapp-interaction/service.ts:305`; boot-sweep carve-out — `reaper.ts:130,174`; chainGuard write has no self-timeout (proving safe) — the rw-guard's force-release timer is armed only by readers.
