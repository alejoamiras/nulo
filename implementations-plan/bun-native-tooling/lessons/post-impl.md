# Post-implementation review loop — Arc D

## `/code-review max --fix` (implementation diff `git diff 8710518d -- . ':!implementations-plan'`, 11 files, +379/−61)

Read in full: `run.ts`, `run.test.ts`, the six migrated scripts' diffs, `candidate-schema.ts` (one `export`), README, `.env.example`. Checked each of the 18 audit rows against the code: `check: false` exactly where a caller interprets failure (`runForge`, `buildForkInL1Root`, the two conductors); `status --porcelain` read untrimmed (leading-space status lines feed `l.slice(3)`); `git()` (trimmed) only where trimming is neutral; `forgeBin()`/`castBin()` memoized and lazy (import probe green); the `forge()` wrapper in `verify-l1.ts` keeps the file's `console.error` + `exit(1)` idiom; the legacy validator covers exactly the forge-bound fields and nothing else; the conductors' soft-fail reads `exitCode !== 0`, which also covers a spawn failure (`exitCode: null`), as `status !== 0` did.

Findings: **none requiring a change.** Two judgement calls left as they are: `run()`'s catch-all converts ANY synchronous throw into `invalid argument` (by design — a thrown spawn error must never be retained; the typed API leaves no other throw class in practice); `resolveBin` returns an env override verbatim without existence-checking it (the operator's explicit choice; the failing spawn names it).

No `fix(review)` commit.

## Codex post-impl audit (fresh session)

Pending.
