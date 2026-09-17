# Phase 10 — Arc 2 e2e, docs, and the Arc 2 review loop

## Docs
- `ARCHITECTURE.md`: a new "Incoming public-scan health" entry (outcomes, episodes, backoff, the epoch
  fence on every poll, persisted announce state, the read model) and the seeding entry corrected to ONE
  batched metadata read.
- `implementations-plan/index.md`: this plan, plus the proposed follow-up `incoming-tip-first-scan`
  (the scan floor / tip-first read the owner moved out of this plan).

## Foreign review (codex, GPT-6 Astra, `high`) — one session, resumed

### Round 1 — `reject`, 9 findings, all accepted
| # | Sev | Finding | Fix |
|---|---|---|---|
| 1 | High | A backoff gate clamped on hydration was never written back: a worker restarting faster than the clamp recomputed it from its own clock and never reached the gate | `hydrate` persists (and awaits) its repair |
| 2 | High | Retry bypassed the scheduler's epoch fence: between a rebuild's bump and its commit it scanned old-profile targets under the NEW epoch | targets carry their install epoch; `pollPublic` refuses a stale one — interval, install kick and Retry alike |
| 3 | Med | A stall only a reader saw could recover without an event | announce before and after the scan, and in the read |
| 4 | Med | The `warn` was once per worker wake, not once per stall | announced prefixes persisted with the episodes |
| 5 | Med | A valid page followed by a dropped one reported `progress` and erased the streak | dropped anywhere ⇒ `no-progress`; the valid prefix still commits |
| 6 | Med | Token-mode flip not watched; a pending Retry leaked across scopes | token mode in the watch key; retry generation + reset on scope change |
| 7 | Low | Two success outcomes without commit confirmation | EOF honours the commit result; `finishReconciliation` returns it |
| 8 | Low | `failures` at `MAX_SAFE_INTEGER` disabled the backoff | saturates at `FAILURES_CAP` |
| 9 | Med | Decoding equivalence of the batched metadata read unproved | tests through the REAL helper (nested private returns, short results) |

This supersedes two earlier notes: phase-6's "a dropped page after an advance is progress" and phase-7's
in-memory announce map.

### Round 2 — `reject`, 2 new findings, both accepted
| Sev | Finding | Fix |
|---|---|---|
| High | My own round-1 addition — restamping surviving targets on the two bump-only paths (token / account delete) — re-authorised the target BEING deleted while its teardown was parked, so a Retry could scan it under the new epoch and recreate its cursor and episode | restamp deleted; both deletes rebuild the scheduler set AFTER their wipe, outside the lock |
| Med | `getIncomingSyncHealth` announced at one clock read and answered from another; straddling the ten-minute threshold split the answer from the baseline | the getter returns the snapshot it announced |

Also closed: the fast-arm shortage shape (`[]`) is pinned through the real helper, and
`fetchTokenMetadata` refuses an empty or missing slot by rule rather than by a decoder's TypeError.

**Side effect, intended:** the rebuild closes a gap that predates this plan — after a token or account
delete the surviving scan intervals (fenced by the epoch they were born in) went silent until the next
rebuild or worker restart. Two older tests had stubs that kept listing the row the real service deletes
before it emits; they now mirror the real order.

### Round 3 — all functional fixes confirmed; one Low
A new `logWarn` passed `error` positionally. Fixed, together with the arc's two other new log lines.

### Confirming pass — converged
> approve
>
> no new material findings

**Lesson:** the round-2 High was introduced by a round-1 fix I added on my own initiative to soften a
consequence of the reviewer's fix. A patch that "re-authorises" anything inside a teardown deserves the
same interleaving test as the teardown itself — writing that test first would have caught it.

## Cross-arc pass (a FRESH codex session over the net diff from `dev`) — converged
Fresh pass: `approve`, "no new material findings", moderate confidence, with four stated verification
limits (repo-wide deletion completeness, arc 1's independent tree, the unchanged batching helper,
completion artifacts). The resumed pass received the evidence — a tracked-files search for every removed
identifier (three hits, none live: the release changelog, an archived audit snapshot, an unrelated
comment in the other product), arc 1's own gate results, and the helper's body:

> approve
>
> no new material findings
>
> Confidence: high for the reviewed cross-arc seams.

It judged the twins (`useSeedStatus` / `useIncomingSyncHealth`, the two hostile-blob parsers, the scope
keys) correctly left apart: "their policies differ materially … a shared abstraction would add policy
switches."

## Environment notes
- The harness killed both background jobs once on a system-wide low-memory signal (no kernel OOM, no
  orphans; the session's own peak was ~31 GB). The network suite was resumed for the specs that had not
  run, on the same commit and build.
- The SSH agent socket hung mid-session, blocking `ssh-keygen -Y sign`. Commits were signed with the same
  passphrase-less key by emptying `SSH_AUTH_SOCK` for the commit command only; git config untouched.

## Gate (as written in plan.md)
`dev` moved by three PRs (#610, #611, #613) touching files both arcs touch, so both arcs were rebased onto
it before the gate (one conflict: both sides appended to `implementations-plan/index.md`; no code
conflict) and the WHOLE gate was run on the rebased arc 2 head:

- `bun run audit:vue` — exit 0 (511 files, 6412 tests, then build; the tree stays clean — the auto-import
  stubs for `useIncomingSyncHealth` are committed)
- `bun run test:e2e` (armed build) — exit 0: 32 files passed, 1 skipped; 123 tests. Run as three
  foreground parts against one armed build.
- `bun run e2e:agent`, complete network suite, proverless — 91 spec files (three arrived with the rebase):
  89 passed, 0 failed, 0 retried, 2 skipped by their own env gates (`_probe-warmup-effect`,
  `tx-sendTx-delegated-authwit`). Run as 12 foreground chunks, each its own `e2e:agent` run (build +
  sandbox + playground), every chunk `exit 0`. Chunks were bin-packed from arc 1's per-file timings to stay
  under the 10-minute foreground cap.
- `bun run baseline:rescore` — exit 0; `scripts/complexity-baseline/manifest.json` and `biome.json` are
  untouched by the stack; zero new `biome-ignore lint/complexity` lines.
- Also on that head: `bun run test` exit 0, `bun run lint` exit 0; no file under `apps/tools/**` or
  `packages/bridge-core/**` in the stack's diff.
- Not run locally: the prover-ON canary (CI's `canary` shard owns it).

Why foreground chunks: the harness killed every long BACKGROUND run of this phase on a system-wide
memory-pressure signal (PSI `full avg10` near 19 % while this session's own cgroup sat near 1 % and 300 GB
was available — another tenant of the box). Foreground commands are not subject to it.
