# P3 — stacked dual balances + gates (lessons)

## 2026-06-10 — P3 COMPLETE (`4cbd5b5`)
- The Aztec panel now stacks BOTH balances (`Public: X` / `Private: Y`) with `data-active` + highlight following the toggle — visibility never depends on it (the arbitrated F5 (a) design, unanimous across all three reviewers). The Ethereum side keeps its single line; the flip keeps the stacked pair on whichever side is Aztec.
- `bridgeBalanceL2` testid retired for `bridgeBalanceL2Public`/`bridgeBalanceL2Private`; validation still binds to the ACTIVE balance only (`l2Balance` per toggle, untouched).
- Tests reworked: both-visible-without-toggling pin, active-flips pin, stacked-pair-follows-the-flip pin. Suite 190 ✓, smoke 9 ✓, build ✓.
- Gates: `bun run audit:faucet` exit=0 · `bun run audit:vue` exit=0 (both in the transcript).

LESSONS_FILE=implementations-plan/bridge-ux-feedback/lessons/phase-3.md
