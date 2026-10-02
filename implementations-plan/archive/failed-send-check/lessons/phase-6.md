# Phase 6 · The owner's sign-off

`LESSONS_FILE=implementations-plan/failed-send-check/lessons/phase-6.md`

Open: the owner has not answered O1, O3, O4 or the blanket sign-off. The branch builds (a) of each.

## Option (b), capture only

Three local branches off the branch head, one commit each, never pushed or merged:

- `capture/failed-send-check-o1-b`: a checked send keeps the red failed card and State "Failed";
  only the journal page's words report the outcome.
- `capture/failed-send-check-o3-b`: a dApp send proven never sent reads "Not completed" / "This
  app's transaction couldn't be completed. Nothing was sent."
- `capture/failed-send-check-o4-b`: the nothing-sent snack keeps "Simulation failed, transaction
  not sent".

The (b) pictures come from one build with the three applied together: each touches its own surface,
and each picture shows only its own ask's.

## How each state was reached

On a live wallet against the local network, Chrome, 360x600:

- **Live**: nothing sent (a shield to an off-curve address fails its simulation); not confirmed
  (the background's first broadcast of a public send is held back and fails, so the row fails at
  `submitting` with a hash the node has not seen); sent (the held request is then delivered, the
  node includes it, and the open journal page answers without a reload, which is B2); status
  unknown (relaxed security mode, the background stopped while the proof gate holds a send); the
  playground send that fails simulation (O3: the execute window's Confirm stays enabled after the
  estimate fails, and the send fails at `simulating`); B1 on Firefox, prover on, no Presto.
- **Seeded** (a row copied from a real send's and written to `chrome.storage.local`, labelled
  seeded): nothing sent at `proving`, reverted, unconfirmed, interrupted, B3 and B4.

## Notes

- The node's JSON-RPC methods are namespaced `aztec_` (`aztec_sendTx`, `aztec_getTxReceipt`) at
  `@aztec/stdlib` 5.2.0. A first pass that held back `node_sendTx` held nothing, and the send
  went through.
- A card's link is a stretched sibling (`RowTarget`), not its container: read a card's text from
  its `tx-terminal-card` root.
- The interrupted pictures are seeded. In the capture, with only the old popup page open after the
  background was stopped in relaxed mode, the Terms review sheet covered Home and the held row was
  still at `proving` 60 s later. A probe that opened a new popup page after the stop saw the
  restarted background fail the same kind of row within 3 s (`from: "proving"`,
  `sw_restart_post_prove`), so the boot sweep holds on this branch; the sheet is outside this diff.
- Under (b) a checked send's card reads "Transaction failed", so the capture's card waits take the
  option's words; the first (b) pass waited for (a)'s and timed out on every checked state.
- B1: on Firefox, prover on, no Presto, Home read "Proving in browser…" with no snack at +30 s,
  +61 s and +90 s, and "Transaction submitted" at +115 s.
- B4 before is the base build (`85c4d20f`) on History: the seeded failed private send reads
  "Transaction failed" and its seeded change note "Received privately +99". B4 after seeds only
  the failed row, checked `sent`: A6 writes no incoming record for the send's own change note,
  which `incoming-transfer/service.scenarios.test.ts` proves, so the picture seeds the state A6
  leaves.
