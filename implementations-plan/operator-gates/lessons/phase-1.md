# operator-gates — lessons (phase 1)

Round-3 plan 3. One codex session (fresh; blueprint audit → PR-a review → PR-b review).

## Consults

| Turn | Who | Ask | Verdict | Folded |
|---|---|---|---|---|
| 1 | codex | blueprint audit | conditional approve | (a) both ladders verbatim incl. the conditional committed-intent check, the sole `probeIdentity` await feeding `now`, and the candidate order digest → parse → record → readbacks (invalid manifest never rewrites the intent; a failed readback leaves the digest recorded — both pinned); (b) promote: symlink checks stay AFTER the FPC gate, the second candidate read is deliberate, per-target writes sequential with no rollback, receipt last; (c) missing-candidate matrix split three ways; (d) harness default-deny with one ordered event stream; one byte-exact green trace + per-failure cutoff assertions, table-driven variants, no re-pinning of the schema/zero-seed matrices; (e) seven essential cases added (FPC/derivation/re-verify failures stop mutation/writes/receipt; schema vs readback digest recording; first-target re-hash stops the second; receipt only after live verification); (f) a real temp-dir contract test for the fs fake; (g) a positive control for `vi.mock("node:fs")` under Bun before building on it; (h) `castPath` module cache kept invariant; (i) commit 1 is an export seam + pins, stated honestly; (j) shape: own `run`/`git`/`cast`/`fetch` mocked at the boundary, `verifyCandidate` split, one typed paths object, validators returning arrays/objects, an exact multi-failure report golden; (k) owner asks: `--drop-swap --restore-swap` together (receipt says RESTORED) and NaN balance/cap passing the cap test — characterized as-is, surfaced |

## Decision ledger

(filled after the audit)

## Lessons

(filled as the PRs land)
