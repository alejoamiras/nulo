# Phase 6 · The owner's sign-off

O1, O2 and the blanket were decided on 2026-09-29 under the owner's delegation (plan § P6) and
applied in P7 (`phase-7.md`), which re-captured O1 (b).

## Captures

- Every row of the capture list is pictured, from P5's flow on the local test network: O1 (a),
  (b) and (c), O2 (a) and (b) with the envelope each option sends, B1 and B2 before and after. The
  PNGs and their index (each file with the strings it shows) stay outside the repo and go to the
  owner's decision page.
- Builds: (b) and every "after" shot at the branch head; every "before" shot at `85c4d20f`
  (detached); O1 (a), O1 (c) with the arrival check, and O2 (a) on the local-only branches
  `capture/dapp-grants-O1-a`, `capture/dapp-grants-O1-c` and `capture/dapp-grants-O2-a`, one commit
  each on top of the branch, never pushed. The O1 (c) run asserted that the refused send left no
  record before it took the History shot.
- One capture run per build, through `e2e:agent` with a capture spec that is never committed.

## Attempts

- The first run of the (b) build failed on its own selector: a failed journal record renders in
  History as `tx-terminal-card`, not `tx-card`. The spec was fixed and the run repeated.
- The first log-viewer shots were unreadable: the PXE's lines on the local network (genesis-hash
  mismatch and stale-anchor errors) filled the window. The shots were retaken with
  the viewer's Source filter on "Wallet Sdk", the refusal's source, the level filter untouched, and
  with the viewer open before the refusal so its line lands in view.
