# Arc 0 — retention gate: codex review loop

Branch `log-safety/00-retention-gate`. Session `01a044b6-2ea4-7503-8219-a5e6163603fe`,
`CODEX_DIR=/home/homelab/.cache/tmp/codex-BcqXSNEA`. Four rounds; converged.

**Convergence quote (round 4):** *"No material issues remain. This branch has converged."*

## Round 1 — 5 findings, all applied

| # | Finding | Verdict |
|---|---|---|
| 1 | `clear()` didn't purge the persisted copy, so a restart resurrected cleared logs | **applied** — moved the purge down from arc 4, where I'd originally put it; it's a retention concern and belongs here |
| 2 | Purge not serialized against an already-started flush | **applied** (see round 2 — the first fix was insufficient) |
| 3 | A boot that fails before `config.load()` never settles retention | **partly applied** — `finally` covers a rejected load. The pre-config migration-gate case is ACCEPTED: `persistEnabled` is still the constructor default there, so nothing new is written; the only residue is a stale key the next successful boot purges. Codex accepted this tradeoff explicitly in round 2. |
| 4 | `runtime.test.ts`'s logger fake lacked the new method — 2 tests broken | **applied** |
| 5 | The e2e log-trail helper assumes unconditional persistence | **documented, not automated** (see rejections) |

**My error, worth recording:** finding #4 existed because I committed after running typecheck, lint
and one focused test file — not `test:all`. The full suite would have caught it immediately. Run the
full gate before committing, not a subset that happens to cover the file you edited.

## Round 2 — 3 findings, all applied

- **`flushInFlight` was a single overwriteable slot.** The timer clears the moment a flush *starts*,
  so a later log could fire a second flush while the first was pending, and a purge awaiting only
  the newest promise could be overtaken by the older write. Replaced with ONE serialized FIFO chain
  (`storageOps` / `enqueueStorageOp`) carrying every `set` and `remove`. Side effect worth knowing:
  writes can no longer overlap at all, and a hung write now delays later ops — inherent if late
  resurrection must be excluded.
- **`clear()` had no completion semantics.** Now returns the purge promise; `ILoggerStore.clear()`
  widened to `void | Promise<void>`; `LogViewerService.clearLogs()` awaits it, so the RPC no longer
  acknowledges success while the copy is still on disk.
- **The e2e probe genuinely asserts a populated trail.** My first fix was wrong — it used a helper
  private to `journal.ts` that runs in page context where the `@/` alias doesn't resolve. Reverted
  and documented instead.

## Round 3 — 1 material finding, applied

**The race test didn't discriminate.** It completed each write before starting the next, so it
passed against the very implementation it was meant to pin. Rewritten to hold the first write open,
prove the second QUEUES rather than starting, and check the removal stays blocked behind both.

**Verified rather than assumed:** temporarily reverted `enqueueStorageOp` to the old un-serialized
form, re-ran — the test FAILED — then restored the queue and it passed. A regression test that
cannot fail against the bug is worse than no test, because it reads as coverage.

## Rejections, with reasons

- **Automating the e2e probe's developer-mode toggle** (rounds 1–4). Codex's suggestion (drive
  Advanced Settings by test id) is a real fix, but the probe is opt-in, skipped by default, and
  characterises console capture rather than gating anything. Documented as a precondition instead.
  Codex accepted: *"test-infrastructure debt, not a material defect in this branch."*
- **Settling retention on a pre-config boot failure.** Accepted as bounded, reasoning above.

## Durable lesson

A "cheap" fix to an ordering bug is usually one layer too shallow. The purge went through three
rounds — cancel the timer, then track the in-flight write, then serialize the whole queue — because
each fix addressed the case in front of it rather than the invariant. The invariant was always
"removal must be ordered after every write", and only a total order gives that.
