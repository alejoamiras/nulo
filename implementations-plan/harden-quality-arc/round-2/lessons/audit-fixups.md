# Round-2 audit follow-up — 6 before-merge fixes

Post-arc quality pass. After R0–R7 landed, a dual adversarial audit (codex xhigh +
Fable 5 high) over the round-2 code span (`dc2a03e..2f3d9d4`) surfaced 6 real
before-merge quality gaps. All 6 fixed on `qa/r2-audit-fixups` (PR #247 → dev-quality),
each behavioral change failing-test-first, each type/oracle change mutation-verified.

## The findings + fixes

1. **`requestCapabilities` arg guard wrong in BOTH directions** (codex#2 + Fable#1).
   The Q-02 guard `isPlainRecord(args[0])` rejected the no-manifest call (over-tight vs
   the handler's `manifest?.capabilities ?? []`) AND admitted `{capabilities:{}}`
   (under-tight → handler TypeErrors on `.filter`); `isPlainRecord` also admitted arrays.
   Fix: optionality-exact guard (`args[0] === undefined || (isPlainRecord && caps
   undefined-or-array)`), `isPlainRecord` excludes arrays, comments corrected.
   My own R6 oracle test had pinned the WRONG behavior (`requestCapabilities([]) === false`)
   — corrected it failing-test-first. Frozen authz oracle untouched.

2. **Tautological authwit ownership test** (codex#3). The foreign-account seed lacked
   `content`, so `AuthwitSchema` (requires content) hid the row → the test passed on
   row-absence, never exercising `authwit.account === account`. Fix: seed a codec-valid
   row (present) + a same-account control that crosses the gate into the send.
   **Mutation-verified:** neutering the account check now fails the foreign test (it
   would NOT have, before — that was the tautology).

3. **Dead Q-15 boolean** (codex#1 + Fable#3). `bootstrapActiveProfile` returns
   still-active but `loadProfile` ignored it, pushing to auth-required `/popup/general`
   even after a mid-bootstrap lock. Benign in prod (router nav guard `popup/index.ts:68-74`
   redirects the bad push to `/popup/auth`), so this is a clarity/defense-in-depth fix, not
   a hole. Fix: gate the push on the flag. No new unit test — boolean already pinned in
   `useProfileBootstrap.test.ts`; app.vue is L6 (unit-test-exempt); nav guard is enforcement.

4. **Milestone vocab in shipped source** (Fable#4). CLAUDE.md bans milestone/plan/phase
   tags. Reworded the round-2-introduced ones (`gap#N`, `leak#N`, `opus-MED-2`, `R1.x`,
   `Q-01/02/13/15`) in service comments + test titles to live-invariant WHY phrasing.
   **Scope-guarded by blame:** pre-round-2 tags (dispatcher `Phase 0.5`/`F-006`, `Q9`,
   token `Phase 2.5`, `Codex v2`) left untouched — out of round-2 scope. Load-bearing plan
   cross-refs (`R3-characterization.md`, UPDATE.md's R4 tracking) kept per CLAUDE.md.

5. **Lost PXEProxy per-method compile bridge** (Fable#2). The generated proxy replaced
   `subset.ts`'s `PXEProxy implements IPXE`, whose per-method SIGNATURE check was lost —
   `interface PXEProxy extends IPXE {}` + descriptors' `_IPXEMatchesTable` pin only the
   method-NAME set. Fix: two type asserts — (a) `proxy.ts`: the network-curried client must
   be ASSIGNABLE to IPXE (mirrors `implements`, incl. extra-optional-arg tolerance);
   (b) `descriptors.ts`: every `requiresNetwork:true` method has a `NetworkInfo` first param
   (closes the curry assert's `never`-vacuity gap). **Both mutation-verified** (a seeded
   return-type drift + a flipped flag each fail to compile).

6. **Discover missing its shell-lifecycle oracle** (Fable#6). capabilities & execute each
   have the A1–B9 frozen oracle; discover only had its `isReady` phishing-gate suite, so the
   shell test's claim that all three windows pin shell composition was inaccurate and spec
   pin B10 was undelivered. Fix: `discover/index.lifecycle.test.ts` (13 pins) mirroring
   capabilities, adapted for discover's divergences — B9 inverts (discover's reject bails on
   `!requestId` → complete no-op) and B10 (cancelled-reject inert) now pinned.
   **Mutation-verified** (dropping discover's bail fails B9). Shell-test file ref corrected.

## Discipline notes

- **Blame-gate every "reword all the tags" pass.** Half the milestone-vocab hits in the
  round-2 diff were PRE-round-2 (the diff shows them because the file was touched, not
  because round-2 authored the line). `git blame` vs the round-2 base separated in-scope
  from out-of-scope — rewording the pre-existing ones would have breached the scope limit.
- **A `*/` inside a block comment closes it.** Writing `windows/*/index.test.ts` in a JSDoc
  header silently terminated the comment → parse error. Globs with `*/` don't belong in
  block comments.
- **Prove de-tautologization / lost-check restoration by MUTATION, not just green.** A test
  that passes proves nothing about what it *catches*. Fixes 2, 5, 6 each seeded the exact
  regression and confirmed the pin fails — that's the real proof the fix has teeth.
- **`biome format --write`, never `check --write`** — the latter rewrites the intentional
  `vi.fn(function(){})` Vitest-4 mocks (needed for `new`-instantiation) into arrows that
  break at runtime. Those `useArrowFunction` warnings are pre-accepted across the suite.

## Validation
Local: lint ✅ · typecheck:all ✅ · `bun run test` **2862 passed / 0 failed**.
CI (workflow_dispatch on `qa/r2-audit-fixups` @ `730e3f9`, all green): Quality
`28602367850` · Smoke e2e `28602369652` · Network e2e `28602371758`.
Merged into `dev-quality` via plain squash (no `--admin`) — PR #247 → `c844e5c`.
