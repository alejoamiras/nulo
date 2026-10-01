# Phase 7 — Full gates (+ the RPC-transport bug the smoke gate caught)

## Final gate results (all on the final code, transcript-verified)

| Command | Result |
|---|---|
| `bun run audit:vue` | exit 0 |
| `bun run test:all` | exit 0 |
| `bun run test:e2e` (armed build, CI recipe) | **exit 0 — 78 passed / 6 skipped / 0 failed** |
| `bun run build:firefox` | exit 0 |

**Bundle delta** (chrome dist, clean `build:chrome`): baseline `77,015,160` → final `77,694,284`
= **+679,124 bytes (+0.88%)**. Exactly ONE artifact copy in the eagerly-loaded bundle (the
vendored one; marker-count verified); the npm copy exists only as a never-fetched lazy chunk.

## Arc 1 — smoke runs against an UNARMED build fail the fixture-arming contract

`bun run test:e2e` against a plain `audit:vue` build reds
`backup-migration.test.ts`'s arming contract BY DESIGN. The CI recipe is
`VITE_NULO_E2E_MIGRATION_FIXTURE=1 build:chrome` + `NULO_E2E_MIGRATION_FIXTURE=1 test:e2e`
(`_smoke-e2e.yml`) — replicate it locally.

## Arc 2 — the integrity coordinator (correctly) rejects fabricated test fixtures

Three synthetic-backup fixtures fabricated account rows that don't derive from their master —
under the new invariant those ARE foreign backups, so finalizeRestore withheld them. Fixed the
FIXTURES (not the invariant): `deriveNuloAccountAddress` helper in `import-drivers.ts` (real
frozen path); `import-paths` + `backup-migration` synthetic backups now carry real derived
addresses; the passkey round-trip carries the register-time account ROW verbatim (address AND
chainId/index/type — an address alone under the wrong chainId still won't re-derive).

## Arc 3 — the ONE remaining red was a REAL product bug, not flake, not env rot

`passkey-backup.test.ts` export test: deterministic red, ALSO red at baseline `cff0ba2`
(clean-worktree proof), local-only (`skipIf CI`) so CI never saw it. Codex consult
(session `019f814a-5acf-77f3-aba2-79d9b525610d`): do NOT skip (that's gate neutralization);
bounded diagnostic first. The dig — instrumentation lessons below — landed on a GENERAL
RPC-transport bug:

- `wrapParams([id, undefined, credentialData])` → `{0, 1: undefined, 2}`;
- `jsonSanitize`'s `JSON.stringify` DROPS undefined-valued keys → `{0, 2}`;
- the DoS-hardened `unwrapParams` stopped at the first key GAP → service received `[id]` —
  **every argument after a mid-position `undefined` silently discarded**.

`exportPlain(id, undefined, credentialData)` (passkey full-backup export) was therefore broken
in ALL environments; the export page's two silent catches (same toast + `router.go(-1)`) hid it.
Fix: gap-tolerant `unwrapParams` within the existing 256-arity DoS bound (wire-compatible; the
hostile-sparse cases keep their exact prior behavior — pinned), + 6 regression tests
(`utils.test.ts`, incl. the full `jsonSanitize` wire-path pin), + stage-tagged `console.error` in
both export catches (user copy stays generic). Tracked + closed as issue #301. Smoke → 78/78.

## Debugging lessons (hard-won, transferable)

1. **The page-console capture channel is DEAD under the e2e CDP layer** — only browser-origin
   messages (e.g. WebAuthn warnings) arrive; app `console.log/error` lines are lost. Every
   "nothing was logged" conclusion built on `page.on("console")` is unsound. Durable in-page
   diagnostics: write to `chrome.storage.local` and read it back via `evaluate`.
2. vue-router captures `history.*` by reference at creation — late-installed wrappers see
   nothing; `router.afterEach` (in-app) is the reliable navigation trace, and `redirectedFrom`
   plus a `router.push`-wrapper distinguishes pushes from history traversals (`go(-1)` shows as a
   navigation with NO push).
3. A `test.skipIf(CI)` local-only test is an UNWATCHED gate — it rotted for months. If a test is
   worth keeping, it needs at least one environment that actually runs it.
4. The baseline-worktree check (clean tree at the plan's base SHA) converts "is this my
   regression?" from argument to fact in ~5 minutes.
5. `full.vue` is a plain-JS SFC — no TS casts in TEMP instrumentation.
6. The repo rule held up: the red gate was neither flake nor neutralizable — it was a shipping
   bug. Skipping it (disposition B) would have shipped broken passkey exports.

## Post-PR triage: the red shard-3 arc (2026-07-21)

`backup-restore-sw-restart` red 5/5 on this branch's network runs (three different waits), green on
a sibling branch running the identical shard set, green locally (incl. the true mid-restore leg;
constrained-CPU local repro proved non-discriminating — baseline reds too, at earlier stages).
Derivation cost ruled out by measurement (146ms cold / 17ms warm). Codex trace (session A) found
the two mechanisms now recorded in the e2e-testing skill: the escaped rollback-delete racing the
recovery unlock (this branch's longer unlock lock-hold shifts the race odds) and the
partial-network seeding suppression (pre-existing product gap — follow-up, not this plan). Test
now self-instruments on failure. Sixth run (post dev-merge + instrumentation): green; all three
required gates pass on head. Separately: two pushes fired NO workflows — the PR had gone DIRTY
after three dev merges (only conflict: plan index). Lesson routed to the e2e skill.
