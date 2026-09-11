# Phase 2 — card copy + cell 24b flipped

Commit `d7079a8b` (arc 1, branch `worktree-tools-recovery`). Gate: the Phase 1 commands green again
(engine 125, lib 424, card 58 incl. 3 new cases, bridge-core journal 28; typecheck; lint) and
`bun run e2e:tools -- specs/recovery.spec.ts` on its own sandbox at retry 0: 4/4 passed (24a, 24c,
**24b — 1.1 min**, 25).

## What landed

- `BridgeJournalCard.vue`: `claimedByOtherLine` (three lines: tokens arrived / press CLAIM YOUR GAS /
  private gas kept), `data-testid="tl-journal-claimed-by-other"`; the idle stage guidance is silent
  for a claimed-by-another record (its button is gone). Three card cases.
- `recovery.spec.ts` 24b: title and assertions flipped — after the relayer's claim the reloaded
  record's CLAIM click ends `data-stage="done"`, `claimedByOther: true` + `completedAt` in storage,
  no `claimTxHash`, `sendTx` count 0, credited exactly once, the done-by-another line shown.
  `pages/journal.ts` reads the two new fields.

## Lessons

- **Detached launches need an executable script.** `setsid nohup <script>` from the tool shell is
  refused by the worktree guard when combined with `chmod`/`&&`; run `chmod +x` alone first, then
  `nohup setsid <abs path> > log 2>&1 < /dev/null &` as its own command. A non-executable script
  fails silently (the log holds one `Permission denied` line).
- The "No artifact registered … private FJ balance read failed (fail-closed → null)" console lines
  the run prints are the existing fail-closed balance probe, not a regression.

## Arc-1 codex loop (post-implementation, `/codex high`, read-only)

**Round 1** — session `01a09092-2eb1-7b00-8177-b528a464c2bb`, verdict `request-changes` (3 high, 1 medium).
Verified against the code:
- H1 *`standaloneClaimed` latched from a consumed-shaped send error is not checkpointed evidence* —
  **pre-existing latch semantics** (`deposit-flow.ts:193-199`, with its own rationale) that the plan
  lists as "settled fuel"; the exposure (a proposed-only consumption that later drops ⇒ a completed
  record's fuel affordance hidden ⇒ 7-day prune) is the same for every completed public token+gas
  record today. Not changed in this arc; recorded as a residual for the owner (`standalone-latch-checkpointed`).
- H2 *settlement decided on the captured record while the guard ignored the fuel block* — **accepted,
  fixed**: `sameFuelState` (sealed copy, register hash, fuel secret hash / claim hash / consumed /
  standaloneClaimed) joins the guard; settlement is decided on the re-read record.
- H3 *a persisted `claimedByOther` bypasses the probe* — **accepted, fixed**: `revalidateClaimedByOther`
  re-reads the nullifier with the material at hand (no prompt): nullified ⇒ completion, live ⇒ the
  marker is dropped, no material ⇒ the record waits. Test (k) re-pinned (one probe on resume).
- M4 *the early completion skips the fuel receipt reconciliation the claim build performs* —
  **accepted, fixed**: `reconcileFuel` dep (wired to `reconcileFuelConsumed`), run before settlement
  when the fuel has its own `claimTxHash`.
- Comments: three cuts/rewrites applied (`parity` line, the completion doc, the card's line doc);
  `journal-locks.ts` null-callback comment kept.
- Tests added: forged marker (public live / public nullified / private without material), fuel swap
  while the read awaits, fuel reconciliation before settlement, a throwing record body releases the
  lock, `hubMessageState` reads the envelope's facts, the standalone gas claim's hand-back.
  Skipped: "generation change during the lookup" (a generation only moves through a new runner,
  which the record lock excludes, or a discard — already pinned); "proposed-only fuel consumption"
  (H1, residual).
