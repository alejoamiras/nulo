# Phase 1 — implementation + review arc

## Review round (max severity) — REQUEST-CHANGES → all 9 applied

Verdict driver was empirically probed, not speculative: `tokenService.onTokenAdded.add(loadTokens)` dies because `EventHandler` invokes callbacks WITH the payload — the `TokenInfo` object lands in the loader's `isCurrent = fence.begin()` default parameter and TypeErrors after the first await, killing the listener permanently. Fix: arrow wrapper. **Lesson: a default-parameter fence makes every direct event registration of that loader a live grenade — wrap all listener registrations, and say why at the site.**

Second structural catch: one shared fence across journal/task/token loaders meant the standalone resnapshot path (begin() for the journal alone) silently superseded parked task/token loads — cross-cancellation starvation. Split into per-loader fences; the watcher begins all three.

Two pins were VACUOUS and had to be made discriminating (proved by revert-probe before/after):

- The captured-scope pin claimed "scope mutates after capture" but mutated nothing. Deterministic fix: gate the first `getAccounts`, swap what `getScope` returns mid-run while the LIVE scope stays matching, assert the post-await calls used the ORIGINAL values. Red against a live re-read at the `ensureDefaultAccount` site; green restored.
- The window-1 drift pin can't be driven through the real store watcher — Vue batches the profile flips, so the wait never resolves for the loser and the assertion passes vacuously (proved: reverting the immediate post-wait check stayed green). Fix: mock `awaitProfileActivation` (defaulting to the real implementation) and resolve it once while the winner is already installed — the continuation runs, the immediate check must stand down, `setLastActiveProfileId` must not fire. Red on revert. **Lesson: an interleave a framework's batching makes unreachable is pinned at the seam (mock the wait), not by fighting the scheduler.**

Reviewer-ratified deviations recorded in the plan ledger: single-watcher `awaitProfileActivation` over the specced `Promise.race` (the losing branch would leak its watcher for the full 30 s bound on every unlock), and no auth-side toast on `BootstrapFailedError` (the shell owns that toast; double-toasting rejected).

## Codex final-diff round 1 — CHANGES ×3, all adopted

- **Stale auto-import decls survive rebuilds**: unplugin-auto-import MERGES with the existing dts, so deleted symbols (`checkSentinel`, `checkNotificationsForShow`, …) persisted through every build under `@ts-nocheck`. Clean regeneration = delete the generated files and rebuild. **Lesson: after deleting auto-importable symbols, the dts must be clean-regenerated, not just rebuilt — and the removal grep must NOT carve out generated files.**
- **The truthy profile branch ignored the seq token the falsy branch already used**: a stale bootstrap could clear a newer run's `bootstrapFailure` record or toast over the winner. Fix reused the existing `profileEventSeq` as a compare-and-commit gate via the extracted `runFencedBootstrap` (test-less app.vue → extract, again). Codex's scenario was real; the fix was 3 guard lines + a factory seam.
- **Three "promised mechanisms" were silently revertible** (producer networkId stamp, stale-task drop across profile switch, fence recombination) — each got a pin proven red by revert-probe. **Lesson: a mechanism the PR body brags about needs a pin that reds when it's deleted; the reviewer greps the diff for claims without discriminating tests.**
- Ratified bare: `onConnected.add(resnapshotJournal)` — `EventHandler<void>.invoke()` passes undefined, defaults apply; a payload would be a compile error at the invoke site.

## Environment/tooling

- Vitest doesn't run the app's auto-import transform: `useToast`/`TOAST_DURATION` must be explicitly imported in components under test, or the suite reds on undefineds the app never sees.
- The battery is stage-resumable via marker files; after post-review source edits, ALL stage markers must be cleared — a stale `audit-ok` would skip re-validating the exact code being shipped.
- `pgrep -f` self-matches the shell carrying the pattern string in a compound command: verify with `ps -p <pid>` before treating a match as a competing suite.
