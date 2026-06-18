# Follow-up: auth-registry persistence-path Mediums (post-impl codex audit)

Source: codex post-impl security audit of the Phase 4–5 auth-registry trust-point change
(session `019edb4d-b6a3-7332-b10c-e9d1faa088da`, branch `fix/measure-f1-authwits` @ 003ff063).

**Verdict: NO Critical/High.** `opts.from` authorization is solid (rejects explicit `from`
outside the session-authorized set; omitted/NO_FROM resolve only to session accounts; mirrors
`handleGrantPublicAuthwit`; no cross-profile storage leak). Three Medium correctness holes in the
post-send pending/reconcile/cap path remain — all ship-acceptable (rare edges, none affect e2e
reliability: authwit-lifecycle 10/10 + full suite 3/3 green), tracked here for a follow-up PR.

## M1 — terminal-status race leaves a stuck `pending:true` row
`execution-coordinator.ts:175` sends BEFORE `recordPendingAuthwits` writes the row;
`transaction/service.ts:236` emits the terminal update once; `auth-registry/service.ts:164`
reconciles only rows that already exist; `auth-registry/service.ts:348` skips `pending` rows in
sync forever. If the tx goes terminal before the post-send write, reconcile misses the row → it
stays `pending:true` → UI shows a mined grant as perpetually pending (not a false confirmed row,
but a false LIVE row).
FIX: after `recordPendingAuthwits()`, re-check tx status and replay reconcile if already terminal
(or persist the pending row before any terminal update can be observed).

## M2 — crash window: landed grant lost from the revocation index (already deferred = codex #4)
`dapp-send-executor.ts:240,398` write the pending row only AFTER a successful send. A SW/browser
crash between broadcast and that write loses a landed grant from the only local revocation index
→ unrevocable from this wallet UI. The "pending row IS the durable record" claim is false with the
current ordering.
FIX: a journal/WAL entry keyed by `txHash` written at/before broadcast, replayed on init; OR write
the pending row pre-broadcast and delete it on `sendTx` failure.

## M3 — 256-cap bypassable under concurrent grants
`auth-registry/service.ts:122` (`assertWithinCap`) is a snapshot check. The standard
`send_transaction` path (`dapp-send-executor.ts:193`) does NOT take the `ExecutionLane.acquireSlot`
flow that `aztec_sendTx` does, so two concurrent approved grants can both pass `255+1≤256` and
record to 257. The cap is a flood defense (generous at 256), so the overshoot is minor.
FIX: route `executeSendTransaction()` through the same `ExecutionLane.acquireSlot()/claimOrCreateJournal()`
flow as `executeAztecSendTx()`, OR an auth-registry reservation lock spanning cap-check → durable write.

## Disposition
Loop bar is "address high/critical" — none found. The 3 Mediums are documented follow-ups (a
separate PR), NOT blockers for the Network-e2e-required flip (they're wallet-behavior edges that
don't affect the e2e gate's reliability). M2 was already a known deferral from the Phase-5 design.

## /harden security (narrow) — corroboration + 2 new findings (2026-06-18)
The narrow /harden (2 Claude agents + prior codex) CONFIRMED M1/M2/M3 (M2: Claude argued High, I
calibrated Medium — rare crash-durability, not an attacker breach). The authz (opts.from) is SOLID
(triple-confirmed). Two NEW items:
- **M4 (Medium) — restore inflates the index with stuck pending rows.** `restore` (service.ts:417)
  writes `pending:true`/`txHash` verbatim; a backup taken mid-in-flight-grant restores a row that
  never reconciles (no matching onTransactionUpdated), is invisible to syncAuthwit (skips pending),
  yet counts toward the cap. FIX: restore should reject pending rows OR immediately re-verify them.
- **M5 (Low) — cross-account UI event leak.** `onAuthwitAdded` emits the full Authwit; `useEntityCrud`
  (authwits/index.vue:50-51) adds any emitted row without filtering by active account → account B's
  row can render in account A's list. UI-integrity only (storage is per-account-keyed; revoke acts
  on the correct account). FIX: filter incoming events by `entity.account === appStore.account.address`.
Full report: audit/security/2026-06-18-authregistry/report.md.
