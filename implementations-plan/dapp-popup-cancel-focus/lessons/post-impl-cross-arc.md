# Final cross-arc integration pass

Fresh codex session (GPT-6 Astra, `high`, read-only) over the net diff `git diff origin/dev...HEAD -- apps packages`
from the arc-2 branch, asked specifically about the seams between the arcs, duplication across arcs,
drift from plan.md, the adversarial ask, and the no-over-engineering + comment-quality rules.

## Stall (2026-09-05 19:11 → 20:48)
The first attempt (dir `codex-S8IaKowF`) read the diff for ~18 minutes, then went silent: no log
events after 19:29, 0 % CPU, no response file, for 78 minutes. Killed (this session's own process) and
relaunched fresh. Lesson: a `run-codex.sh` whose `log.jsonl` stops growing for more than ~15 minutes
while the process sits at 0 % CPU is a dropped model connection, not thinking — kill and relaunch
rather than wait on the 10-minute tool timeout cycling.

## Round 1 — session `01a073f9-1a09-7680-810a-9c55d5a7e0d5` — `findings` (two Low, no cross-arc bug)
1. **Duplicated fixture**: arc 2's focus-RPC suite copied `seedQueued` from arc 1's journal-cancel
   suite. Adopted: hoisted to file scope in `service.test.ts`, both suites reuse it.
2. **Comment narration**: the `RecentActivityView` one-liner over the client instantiation deleted;
   the card docblock keeps only the accessibility constraint (why no ARIA role, which control is
   accessible); the manager's pre-create guard now reads "A timeout or cancel during the bounds lookup
   must prevent creation" — the invariant that ties arc 1's reconciliation to arc 2's lookup.

Codex confirmed the seams: both journal scans select the same interaction (each then applies its own
guard); a cancel during the bounds lookup cannot orphan a window (`_settle` deletes the handle before
rejecting, so the pre-create identity check skips creation, and a create already started is removed by
the post-create check); focus after cancellation finds no handle (the handle disappears before the
`finally` deletes the record), and an update already issued races removal only into a `false`; the
implementation matches plan.md except the two documented deviations (no ARIA role + sibling button;
the layout's `actionCount` reservation); no new dependency, permission or crypto surface. Codex could
not run vitest in its read-only sandbox (EPERM on a temp dir) — conclusions are from source.

Re-validation: `src/wallet/services/dapp-interaction src/components/composite/activity
src/wallet/services/window-manager src/popup/components/modules/general` → 16 files, 245 tests, exit 0;
biome clean; extension typecheck 0 errors.

## Round 2 (resumed) — `clean`
"Verified through `cfc1d85f` … No remaining material findings across cancellation/focus ordering,
journal lookup consistency, plan alignment, or wallet security boundaries." Codex ran 9 suites (227
tests) itself this time. The owner's macOS Space-switch check stays the one open item. Cross-arc pass
converged after two rounds; delivery follows.
