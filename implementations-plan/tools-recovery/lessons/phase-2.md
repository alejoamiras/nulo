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
