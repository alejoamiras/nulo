# P8 · #718 in, and the fit a layer down

## The merge

The driver reported #718 merged into `dev` as `f32b1e0a` (a squash whose tree equals the PR head
`48a97f4a`). `git merge-tree --write-tree HEAD origin/dev` had no conflict; `git merge --no-ff
origin/dev` then auto-merged `send.test.ts`, `index.md`, `lessons.md` and `follow-ups.md`
(`8f4dc36c`, signed). Read after the merge, not trusted to it: the index keeps both plans' lines,
`lessons.md` is 7,341 bytes (under the 8 KiB budget), and `follow-ups.md` gains #718's own sections
with nothing that contradicts § Send amounts. `bun install --frozen-lockfile` changed nothing; the
send, hero and amount tests (22 files, 521 tests) passed on the merged tree.

## The move

`git mv` of `hero-fit.ts`, `hero-fit.test.ts` and `hero-ruler.ts` from
`popup/components/modules/general/` to `src/utils/`, byte for byte. BalanceView imports them from
`@/utils/`, its test mocks `@/utils/hero-ruler`, and `utils/amount.callers.test.ts` keys the moved
file as `utils/hero-fit.ts`. `bun run build` in `apps/extension` regenerated the auto-import
declarations: `auto-imports.d.ts` and `.eslintrc-auto-import.json` gain the two modules' exports,
as every top-level util's are. Nothing else referenced the old paths (`git grep` over the repo;
the closed ux-owner-picks plan names them in prose only).

Gate: `bun run lint` exit 0; `bun run typecheck:all` exit 0; `bun run test:all` exit 0 (extension
606 files passed, 3 skipped by design; 8,060 tests passed); the plans gate 0 enforced; the moved
`hero-fit.test.ts`, BalanceView's tests and the callers test 58 of 58. ✓

## F-3, `comma`

The driver's note let F-3 in while it stays inside the plan (§ Phase 0). Before deleting,
`git grep -w comma` over `apps` and `packages` found only the declarations and prose; no test
calls it. After deleting it and building, `.eslintrc-auto-import.json` dropped the name but
`auto-imports.d.ts` kept `const comma: typeof import('../utils/amount').comma` in its globals and
dropped only the component-property line (observed with unplugin-auto-import 21.1.0: a removed
export's global survives the regeneration). The file carries `// @ts-nocheck`, so the stale
global would type-check as a global that no longer exists and fail only at run time. It was
removed by hand, and a second build left the file without it.

Gate: `bun run lint` exit 0; `bun run typecheck:all` exit 0; `bun run test:all` exit 0 (extension
606 files, 8,060 tests passed); the plans gate 0 enforced. ✓
