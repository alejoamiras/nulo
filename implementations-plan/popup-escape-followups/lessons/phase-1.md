# Phase 1 — the three fixes (2026-09-23)

## Follow-up 1: the `webdriver-ownership.test.ts` flake

**Reproduction.** A script ran the file ten times with vitest, its workers, the spawned processes and three busy loops all pinned to one CPU (`taskset -c 7`), so the spawned children's execve was starved the way a loaded runner starves it. The pinning also left other agents on the host untouched. Two of the ten runs failed:

- *"a process is owned by the marker it inherited, not by its number"*, where a fresh child was missing from its owner's scan (`expected [] to deeply equal [ <pid> ]`);
- *"a caller-supplied profile survives release, and the record is still cleared"*, where release took a child that was still mid-exec for gone (`expected true to be false`).

**Probes** (scratch scripts, not committed):

| Probe | Bun 1.4.2 | Node 24.12 |
|---|---|---|
| `/proc/<pid>/environ` read straight after `spawn()` returns, 2 000 spawns | 1 990 missing the marker, every one of them **empty** (not the parent's environ) | 0 missing |
| The module's `ownedProcesses(marker)` straight after `spawn()`, 300 spawns, idle host | 0 missed | — |

Reading: Bun's `spawn` returns while the child is inside execve, and the kernel publishes the new image's environ bounds late in the ELF load, so the file reads empty until then. On an idle host a full `/proc` scan takes long enough for the child to finish its execve before the scan reaches it; on a starved CPU it does not. The unit suite runs on Bun (`bun --bun vitest`); the e2e harness that owns real launches runs on Node, whose spawn returns after the exec.

**Fix.**

- The test's `spawnMarked` polls with the file's existing `until` helper until the child shows its marker, and throws if it never does.
- `waitForExit` in the module now needs two empty scans a poll apart. A real launch's descendants exec too (Firefox starting its content processes), and a single empty scan of a tree that is still exec'ing is not proof it is gone.

**After:** the same pinned script, 20 runs: 0 failed.

## Follow-up 2: Firefox preview on every extension PR

The whole `firefox-touching` path is removed:

- from `pr-quick.yml`: the filter, the `firefox-touching` and `needs-firefox-build` outputs, the compute branch and its three env lines (the other `BASE_REF`, in a later step, stays);
- from `behavior-gating.test.ts`: the notices test's expectation.

`build-firefox` now has `build-chrome`'s `if`, pinned by a new behaviour-gating case. `preview-comment.ts`'s header and `CI.md` lose the "a skipped Firefox build is normal" wording; the comment still renders a skipped target as "not built for this change" for a PR that builds neither.

Gates: `bun run lint:actions` clean; `bun run test:ci-gating` 148 pass, 2 skip, 0 fail.

## Follow-up 3: the passkey dialog's Escape

- **Fix.** `handleKeydown` returns early for anything that is not Escape and for a ceremony that has already settled. Otherwise it calls `preventDefault()`, then cancels.
- **Test.** The unit case dispatches a cancelable Escape and asserts `defaultPrevented`.
- **Mutation check.** A script deleted the `preventDefault()` line, ran the file and restored it. The Escape case failed (`expected false to be true`) and the other ten passed. The file came back byte-identical.
- **Helper move.** `pressEscape` moved to `helpers/pointer-probes.ts` for the smoke `passkey-backup.test.ts`. Its reader is now registered per press, just before the press, rather than once per page. A window listener registered at an earlier press would run *before* one the page mounted since (the dialog's own handler is a window listener mounted mid-test) and read `defaultPrevented` too early.

## Post-implementation codex loop (2026-09-23)

`code_review: off`. One codex session (`gpt-6-astra`, high), resumed twice, reviewed the net diff from `5b447f45`. Before the loop:

- `bun run audit:vue` exit 0 (7 058 tests, build);
- the smoke `passkey-backup.test.ts` and `popup-stack.test.ts`, 5/5;
- the network `popup-escape-layered.test.ts` with the moved helper, 1/1.

### Round 1 — conditional approve

| Finding (severity) | Verified | Disposition |
|---|---|---|
| `releaseLaunch` threw away the post-SIGKILL wait's result, so one transiently empty final scan could still authorise deleting the profile and the record (Medium, pre-existing) | yes: the trailing `ownsProcess` check was a single scan after both waits | adopted: the stop result gates deletion, and the trailing scan is gone |
| Two scans are a heuristic. Nothing bounds an exec's empty read, and `signalOwned` misses a mid-exec child, which costs the whole grace or leaves an orphan (Medium) | yes, by construction | signalling half adopted: `signalOwned` and `waitForExit` merge into `stopOwned`. It signals each marker-carrying pid once per phase, on whichever poll first finds it, and re-reads the marker before each signal. The docstring says best effort. The pid/start-time veto for already-observed members was declined: it covers only a process a scan already saw that then re-execs, it needs zombie handling (a SIGKILLed child keeps its start time until reaped), and it leaves the never-observed descendant as unprovable as before without cgroups or pidfds |
| A `Popup` under the ceremony dialog closes with it on one Escape (Low, pre-existing) | yes: the popup's trap listens on the document and the dialog on the window, and `preventDefault()` stops neither | declined here. No host builds that composition, since every ceremony starts from a page control. It is reachable only by tabbing behind the overlay, because the dialog does not trap focus. Making it modal is a behaviour change for the owner, recorded as a follow-up |
| Comments: "it shows again a moment later" promised a timing, and the backup test's comment narrated (Low) | yes | adopted |

The new case, "a launch that outlives SIGKILL keeps its profile and its record", passes on the pre-fix code too, because the live process stays visible to the old final scan. It pins the contract of the branch where a launch outlives SIGKILL. A deterministic reproduction of the transient empty scan would need stubbing the module's own reads.

### Round 2 — approve, two Low findings

| Finding | Verified | Disposition |
|---|---|---|
| A `kill` that threw still counted as sent, so that pid was never retried within the phase | yes | adopted: `signalIfOwned` returns `true` only after `kill` succeeds |
| The new case covered retention, not the retry or the once-per-phase send | yes | adopted: the case fails its first send and asserts `["SIGTERM", "SIGTERM", "SIGKILL"]`. Mutation-checked: counting a thrown `kill` as sent fails it (`["SIGTERM", "SIGKILL"]`), and dropping the dedup fails it (28 signals). The file came back byte-identical |

Both declines held as scope decisions. Codex noted that the claim "never-observed descendants dominate" is unmeasured.

**A contaminated contention run.** The 20-run contention pass on the round-1 code was still running when the mutation check swapped the module in place. Its one failure, run 18 with 28 signals, was the dedup mutant, timestamped inside the mutation window. That pass was discarded and rerun on the final code: 0 of 20 runs failed. `bun run audit:vue` on the final code: exit 0 (7 059 tests, build). Lesson: never mutate a file that a background run is executing.

### Round 3 — approve, no new material findings

Converged.
