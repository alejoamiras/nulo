# Phases 2–3 — measurement campaign

## Campaign mechanics

- Driver: a halt-on-red bash loop in tmux (`isd-campaign`), 5 iterations ×
  {proverless, prover-on} alternated, both files per run
  (`backup-restore-integrity` + `profile-reimport-matrix`),
  `NULO_E2E_RETRY=0 NULO_E2E_STAGE_LOG=1`, records to a real-disk cache dir
  (TMPDIR-aware default honored; explicit `NULO_E2E_STAGE_LOG_OUT`).
- Per-run wall ≈ 2.7 min (agent.sh preamble+build ≈ 5s — vite builds this
  app in ~4.2s on this box with a hot page cache, three back-to-back builds
  deep; sandbox boot inside vitest globalSetup ≈ 40s; tests ≈ 108s).

## Recorder validated in the wild (run 1, integrity/proverless)

First real record: baseline `""` → `restoring:profile` 128ms → `networks`
5ms → `tokens` 1.5ms → `services` 7.5ms → `finalizing` 410ms →
**`chain-sync` 14.04s** → `finished` + 214ms seam. `restoring:account-state`
in `unobservedStages` (Vue-coalesced — exactly as recon predicted for a
near-instant stage). Attribution (file/test/ordinal/mode/retryEnv) correct;
two per-fork files per run, 3 records/run (integrity ×1, matrix ×2).

## Verifications that were worth the paranoia

1. **"Prover-ON green in 2.5 min" looked like a silent all-skip** — it
   wasn't: 2 files / 5 tests genuinely passed; the surprise was build speed
   (vite `✓ built in 4.21s`, authoritative line) and boot-in-globalSetup.
   Arming verified per-run: the PROVERLESS banner + BUILD_STAMP grep appear
   ONLY in proverless logs; the prover-on log has neither.
2. **Near-identical test durations across modes** (~108s both): local
   proving cost on THESE flows hides under chain/mined waits (integrity) or
   doesn't exist (matrix sends no proofs). Recorded as an envelope caveat —
   local-mode symmetry is NOT evidence about CI/testnet proving cost.

## Campaign result

COMPLETE 2026-08-18T19:36:38Z — 10/10 runs attempt-1 green, alternated, ~27
min wall. 30/30 records complete + attributed; digest output committed in
envelopes.md. Headline: chain-sync 13.7-14.2s (integrity only, 3.2x inside
its 45s budget); every other stage sub-second; account-state coalesced in
30/30; seam 110-214ms; modes statistically identical.
