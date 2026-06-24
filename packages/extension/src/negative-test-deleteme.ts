// TEMPORARY — Phase-3 negative acceptance test for the required-check fix.
// A deliberate noExplicitAny violation so `bun run lint` (Biome) fails, the
// lint-and-typecheck job goes red, and the quality-status aggregator reddens.
// This branch is NEVER merged — it proves a failing required check still BLOCKS.
export const forcedLintFailure: any = 1
