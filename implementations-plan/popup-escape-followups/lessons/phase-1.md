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
