# Phase 7 — wallet loss, two tabs, viewports (arc 3) + the arc-3 boundary

## What landed

- `l1-wallet.spec.ts` 26d: the router transaction never answers (the hold parks once it arrives —
  `holdsArmed() === 0`); after the reload the row is `depositing`, "never confirmed on Ethereum",
  Discard-only, and Discard asks the wallet for nothing (signatures and transactions counted from
  BEFORE the reload).
- `exits.spec.ts` 31b: a private exit's one `sendTx` is swallowed — the burn lands, the page never
  learns the hash; after the reload the row is `exiting` with the interrupted copy, Discard, no
  FINISH, nothing re-runs, the credit charged once.
- `activity.spec.ts` 40: two tabs, two actors. Tab 2 sends a fresh token so its send opens with the
  grant prompt — the only wallet call before a record exists — and that prompt is held; tab 1
  files its record; tab 2 renders it in its own journal and still sits on its provisional prompt;
  the grant is released; each stepper's `data-id` is its own actor's record; both land; both feeds
  list both.
- `spike.spec.ts`: 390 px and 1024 px — the dock overlays as a dialog, opens, closes on Escape, the
  deposit still lands.

## Gate (retry 0)

| Command | SHA (tree) | Result |
|---|---|---|
| `bun run --cwd apps/tools test` | `fd88cfda` | 98 files, 1287 tests passed; exit 0 |
| `bun run test:all` | `0d7be4e6` | exit 0 — 12 workspaces, every suite passed (extension 470 files / 5763 tests, tools 98 / 1287, bridge-core 49 / 444, wallet-bridge 10 / 276, …) |
| `bun run lint && bun run lint:actions` | `0d7be4e6` | exit 0 / exit 0 |
| `bun run e2e:tools -- --shard=1/2` ∥ `--shard=2/2` (own sandboxes, retry 0) | `1d5c7d18` | shard 1: 33 passed, 1 failed (cell 40); shard 2: 28 passed, 3 failed (24c, 24b, viewports) — 61/65; the four failures were test-side (below) |
| `bun run e2e:tools -- specs/recovery.spec.ts specs/activity.spec.ts` ∥ `specs/spike.spec.ts` (the changed files, own sandboxes, retry 0) | `fd88cfda` | recovery 4/4 (24a, 24c, 24b, 25) and spike 6/6 (viewports included) passed; activity 2/3 — cell 40's second tab reconnected to the remembered wallet and stalled at `verifying` |
| `bun run e2e:tools -- specs/activity.spec.ts` (own sandbox, retry 0) | `8815188c` | 2/3 — tab 2's fresh connect stalled the same way; the trace showed the wallet frame failing `requestCapabilities` on an OPFS pool already held by tab 1's frame of the same profile |
| `bun run e2e:tools -- specs/activity.spec.ts` (own sandbox, retry 0) | `7b4aaa78` | 2/3 — tab 2 (selfpay) connected; the held grant raised its wallet frame over the rail and `openSend` could not click the Send tab |
| `bun run e2e:tools -- specs/activity.spec.ts` (own sandbox, retry 0) | `6bbaa298` | 2/3 — a forced click under the raised frame did not switch the section |
| `bun run e2e:tools -- specs/activity.spec.ts` (own sandbox, retry 0) | `0d7be4e6` | 3/3 passed (cell 40: 58.6 s); exit 0 — every one of the suite's 65 cells is green on this tree |

## Codex loop (arc 3) — converged at round 5 (two past the three-round stop; surfaced to the owner)

| Round | Verdict | Findings → call |
|---|---|---|
| 1 | reject | (1) the dropped submission never returned its hash (the base `sendTx` waits for PROPOSED) — pending receipt answered; (2) 24b never funded private gas credit — funded, exact credit asserted; (3) cell 40's `Promise.all` guaranteed no ordering — restructured (below); (4) 26d's one-`eth_sendTransaction` wait could be the approval — `holdsArmed`, counters captured before the reload; (5) 34b snapshotted the tiles before the list arrived — waits for its tile; (6) four comments — trimmed. All adopted, `fdb18b45`. |
| 2 | reject | cell 40 sequential confirms still bypassed the guard (tab 2's baseline already held record 1) — tab 2 parked on its grant (the only wallet call before a record), releasable holds added to the test wallet, `7f6edec8`. |
| 3 | reject | (1) the fresh-token receipt shows the token amount net of the gas slice, not "100" — asserts the symbol; (2) tab 2 was not shown to have observed record 1 — waits for its journal card in tab 2's own dock, `9e64ee0f`. |
| 4 | reject | the Activity tab is a page (`v-show`), so tab 2's receipt would be hidden — `openSend(tab2)` before the release, `1d5c7d18`. |
| 5 | **approve** | — |

Rounds 3–4 were the same cell's test mechanics, not product findings; the loop ran on rather than
shipping a cell that could pass for the wrong reason. Transcripts in this session's CODEX_DIR.

## Lessons

- A `context.newPage()` shares the first tab's `localStorage`, and the remembered wallet in it
  reconnects on its own — `connectAztec` waits for a picker that never opens. A second tab (or a
  second viewport pass on one page) cannot open the picker: tab 2 forgets the `:preferred-wallet`
  key and connects on its own; the viewport pass clears storage between widths.
- One wallet profile per page: the embedded wallet's store is an OPFS pool on the profile's origin,
  and a second frame of the same profile fails `requestCapabilities` with "SQLite-OPFS pool … is
  already in use" (the page then sits in `verifying` for ever). A second tab connects to ANOTHER
  profile — its own origin, its own store. The trace's console (per page) is where this was
  visible; the runner forwards only the first page's console.
- A token-only confirm prices its claim against the hub in preflight, so a `simulateTx` hold on the
  hub armed before the confirm parks the preflight and stands the review down; arm it once the
  record exists.
- A card with `data-attention` set narrates its note in the rail's failed phase (`journalStep`);
  `journalAttention` renders only soft notes and a blocked reason.

## Codex cross-arc pass — converged at round 2

| Round | Verdict | Findings → call |
|---|---|---|
| 1 | conditional approve | (1) the arc-2 boundary was evidenced on a tree that included arc 3's test wallet — the full tools suite re-run on arc 2's own tip, 58/58; (2) the forced chooser's Continue stayed enabled while the confirm silently refused under the gate — disabled with a hint, tested; (3) a stale comment on the paused path — replaced. All adopted, `5da57ede` (arc 2). |
| 2 | **approve** | — |

