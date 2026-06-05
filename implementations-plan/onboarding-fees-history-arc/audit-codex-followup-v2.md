Verdict: Approve-with-changes

## Remaining concerns
- High — Trust-state model is still underspecified for bursty first receives — `plan.md:367-375` — v2 splits state across a `trusted-incoming` boolean, hidden records, and a separate blocked set, but does not define what happens when many notes from the same new contract arrive before the popup resolves, or when a previously blocked contract is later allowed. Replace this with one persisted enum per `(profileId, chainId, contract)` such as `unknown | pending | trusted | blocked`; while `pending`, queue or suppress all notes for that contract, then apply Allow/Reject deterministically to the queued set.
- Medium — Discovery trigger is internally inconsistent — `plan.md:30`, `plan.md:281-286`, `plan.md:393` — parts of the plan still describe “scan on every completed watched-token refresh” even though 4a explicitly switched to a `NoteService.watchNotes` poll loop. Collapse the language to one trigger model or the implementation will accidentally build both.
- Medium — One poll handle per `(account, contract)` can become a timer fan-out problem — `plan.md:283-286`, `plan.md:325-326` — if a profile watches many tokens/accounts, N independent 30s loops will wake the SW and PXE repeatedly. Coalesce into one scheduler per `(networkId, account)` with contract batching or singleflight polling.
- Low — The 60s recent-tx-hash ring buffer is fine only as best-effort — `plan.md:342-345` — keep correctness anchored on outgoing-tx lookup, journal `progress.txHash`, and late-delete on `onTransactionAdded`. Proof duration is not the right sizing input; SW restart persistence is the real limit. `60s` is acceptable if documented as opportunistic. If you want extra slack, extend to `2-5m` and bound by entry count.

## New issues introduced by v2
- Medium — First-receive persistence is now a real data-model change, but the plan does not unify where that state lives — `plan.md:373-375` — avoid a boolean on `Token` plus a separate blocked set. Use one persisted trust-state source, and cover backup/restore plus profile-delete semantics in tests.
- Low — The all-fee-only BUG PIN should stay a BUG PIN for this PR — `plan.md:121-123`, `plan.md:165-166` — do not “fix” it inside the shared-helper extraction. If you want a different fallback UX (`undefined` -> caller shows `Transaction`), do that as a separate behavior change with explicit consumer updates.

## Confirmations (only what passed verification)
- Previous critical 1 is addressed: the shared helper really needs 7 sites, and the newly added `operation-planner.ts` plus `app.store.ts` sites are both real (`execution/service.ts:894`, `app.store.ts:128-138`).
- Previous critical 2 is addressed: `StepIndicator.vue` is currently hard-coded to 4 cells, and I found no runtime consumers outside onboarding pages plus generated `types/components.d.ts`.
- Previous critical 3 is mostly addressed: raw `NoteDao` does expose the needed identity/order fields, `NoteService` currently strips them, and a parallel `getNotesRaw` is a clean fix.
- The dependency declaration concern is closed: `ServiceCollection` really supports `readonly dependencies`, so adding it to `IncomingTransferService` is correct.
- The corrected route conventions are right: existing pages are file-routed as `tx/[id].vue` and `tokens/[id].vue`; `journal/[id].vue` matches the codebase.
- `incomingTransfersVisible` default `true` is reasonable for Production given first-receive gating; default `false` would effectively ship the feature dark.
- Keeping `getNotesRaw` parallel to `getNotes` is the cleaner separation; I would not widen every existing popup caller to the raw-note shape.

Saved at [audit-codex-followup-v2.md](./audit-codex-followup-v2.md).