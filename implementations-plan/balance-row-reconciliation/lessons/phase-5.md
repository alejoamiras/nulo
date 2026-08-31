# Phase 5 — regression sweep + docs

The sweep now runs on every profile activation, so the question this phase answers is
whether an extra boot-path pass disturbs anything across the whole suite.

## Results

| Gate | Result |
|---|---|
| `bun run audit:vue` | **exit 0** — 393 test files passed, 2 skipped (392 before; the new diff module is the +1) |
| Armed source smoke | **exit 0** on re-run — 31 passed, 1 skipped |
| Unarmed artifact-mode smoke | **exit 0** — 29 passed, 3 skipped |
| `NULO_E2E_PROVERLESS=1 bun run e2e:agent` | **exit 0** — 73 passed, 2 skipped, **zero failures** |

73 network spec files passing is the real evidence: every one that activates a profile now
runs both sweeps, and none noticed.

## The one failure, and why it was not ours

The first armed-source smoke run failed `sw-restart-network.test.ts` with:

```
Error: stopServiceWorker: the service-worker target was still alive 15s after close()
```

That is the documented CDP flake fingerprint, but this diff *does* add work to `init()`, so
it could not be assumed. Two independent signals settled it:

1. **The same spec passed in artifact mode 7.2s later**, on the same build machinery and the
   same code.
2. **The armed re-run passed** — 31/32, exit 0.

Flake, not breakage. Re-run rather than neutralised, per the repo's policy.

## Both smoke modes, deliberately

`audit:vue && test:e2e` exercises **neither** the armed source build nor artifact mode — the
lesson #485's phase-4 recorded. Both were built and run explicitly here.

## Docs

`ARCHITECTURE.md` gains a token-balance entry covering: the one-row-per-pair model and why a
missing row is invisible while an `updatedAt === 0` row spins forever; the create-only sweep
and its two call sites; why create-only (unexplained rows may be foreign, pre-restore, or
mid-purge, and the schema carries neither profile nor chain); the single `maxHoldMs: null`
lock over every id-allocating path; why `restore()` shares the lock but not the ensure path;
and that the key-identity guard must be `"numeric"`.
