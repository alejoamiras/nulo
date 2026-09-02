# operator-gates — lessons (phase 1)

Round-3 plan 3. One codex session (fresh; blueprint audit → PR-a review → PR-b review).

## Consults

| Turn | Who | Ask | Verdict | Folded |
|---|---|---|---|---|
| 1 | codex | blueprint audit | conditional approve | (a) both ladders verbatim incl. the conditional committed-intent check, the sole `probeIdentity` await feeding `now`, and the candidate order digest → parse → record → readbacks (invalid manifest never rewrites the intent; a failed readback leaves the digest recorded — both pinned); (b) promote: symlink checks stay AFTER the FPC gate, the second candidate read is deliberate, per-target writes sequential with no rollback, receipt last; (c) missing-candidate matrix split three ways; (d) harness default-deny with one ordered event stream; one byte-exact green trace + per-failure cutoff assertions, table-driven variants, no re-pinning of the schema/zero-seed matrices; (e) seven essential cases added (FPC/derivation/re-verify failures stop mutation/writes/receipt; schema vs readback digest recording; first-target re-hash stops the second; receipt only after live verification); (f) a real temp-dir contract test for the fs fake; (g) a positive control for `vi.mock("node:fs")` under Bun before building on it; (h) `castPath` module cache kept invariant; (i) commit 1 is an export seam + pins, stated honestly; (j) shape: own `run`/`git`/`cast`/`fetch` mocked at the boundary, `verifyCandidate` split, one typed paths object, validators returning arrays/objects, an exact multi-failure report golden; (k) owner asks: `--drop-swap --restore-swap` together (receipt says RESTORED) and NaN balance/cap passing the cap test — characterized as-is, surfaced |

| 2 | codex | PR-a review (read-only) | conditional approve → (pending) | production split equivalent: ladder + sole await, candidate order, promote's distinct intent snapshot and byte read, FPC before symlinks, bridge-first writes, receipt after live verification; two BLOCKING harness gaps: (1) run/git/fetch events ignored `opts` (cwd, stdio, the live verifier's `BRIDGE_MANIFEST` env) and fetch validated only the method — record structured events, default-deny `resolveBin`, key fetch on URL + parsed request; (2) the overlay's `rmSync` never cleared a symlink marker, so the `rm → wx` recovery of a pre-planted tmp symlink was uncharacterizable — clear it, add that pin and the real-fs remove-then-exclusive-create case |

## Decision ledger

- **Harness hardening lands as a THIRD commit** (not a rewrite of commit 1): the hardened pins are
  run against BOTH the pre-refactor `live-intent.ts` (checked out from commit 1 into the working
  tree, then restored) and HEAD, so the "pins identical across the refactor" contract still holds
  for the final pin file.
- **`checkSide` at 19 after the first split** — the generator inserted a directive, which is the
  signal to cut deeper, never to ship: rows/engine, failed-run re-derivation and observations
  became three validators that `checkSide` concatenates in the original order.

## Lessons

(filled as the PRs land)
