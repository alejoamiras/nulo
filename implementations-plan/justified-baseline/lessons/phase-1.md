# justified-baseline — lessons (phase 1)

Round-3 plan 4. One codex session (fresh; blueprint audit → PR review).

## Consults

| Turn | Who | Ask | Verdict | Folded |
|---|---|---|---|---|
| 1 | codex | blueprint audit | conditional approve | three blocking holes in the draft: (a) **automatic ceiling raising** — `--adopt` re-stamping numbers was a gate bypass → the generator never rewrites a stamp; `--adopt` is allowed ONLY when the manifest's Biome version differs from the installed one, and every re-stamp is a human edit; (b) **count-only identity** — a same-file swap (drop one accepted directive, add another on a different function, stamp its real score) passed counts and a `>`-only audit → the manifest pins every acceptance as `{ file, rule, anchor, accepted }` where `anchor` is the declaration line under the directive, drift is any added/removed/changed entry, and the rescore audit is EXACT (`observed !== accepted` fails: inflation and stale slack alike); (c) **exact-line diagnostic matching** broke on the paired length+cognitive directives (`discover-mainnet-fuel.ts`, `relay-claim-testnet.ts`) → one sibling copy per file with ALL accepted directives removed, originals + copies in ONE Biome run (`--max-diagnostics=none`, `diagnosticsNotPrinted === 0`, parse failures rejected), pairing by file → rule → sorted source position with exact per-rule counts, originals must yield zero budget diagnostics (new unsuppressed offenders fail closed); plus: the accepted-form regex anchored to a whole `//` comment, sentence checks described honestly as syntactic, rule-specific anchored message parsers (`Excessive complexity of N detected` / `This function has too many lines (N). Maximum allowed is 80`), the negative fixture through injected descriptors (untracked files are invisible to `git grep`) placed under an included root, a `.vue` classifier regression test, exclusive-create unique sibling names cleaned only when created, an explicit Bun test timeout, `apps/faucet` → `apps/tools` in the scope table, and the corrected split 13 production / 7 bridge-core scripts / 15 harness |

| 2 | codex | PR review (read-only) | **reject** | three mechanism holes, all real, all folded: (a) **same-checkout trust** — tree-vs-manifest passes a hand-edited row → the CI mirror now ratchets head against the PR base's manifest (`GITHUB_BASE_REF`, shallow-fetched when absent; fail-closed on a PR, skipped on push/schedule; per-rule totals against a base that predates entries; relaxed only across a Biome version change); (b) **re-triggerable migration** — deleting `accepted` and regenerating re-pinned anything → the hatch is gone, an entry-less manifest is refused by generator, check and CI; (c) **anchor collisions** — a same-text declaration or a stacked duplicate collapsed silently in a `Map` → duplicate identities and non-unique anchor lines are `forbidden`, and the anchor reads through a paired directive, a doc block and blanks (8-line reach) instead of taking a comment as the declaration. Also folded: the sentence is pinned in the manifest so a rename or file move (same rule + stamp + sentence, new identity) regenerates as a *move* while a swap onto another function is an *add*; the false "nothing was written" message; CLAUDE.md (numbers *rise* only on a bump; the harness rationale no longer says "scenario matrices" for lexers/predicates); scope.md §4 rewritten to the implemented contract. Held as residual, stated in the docs: on a genuine Biome bump the ratchet relaxes, so unrelated added acceptances could ride along with the bump — the bump PR is the one diff reviewed line by line, and every addition needs a human-written sentence the generator cannot produce |

## Decision ledger

- **Re-stamp**: human-only. Ergonomics after a Biome bump are one edit per drifted directive with
  the audit's `accepted N → observed M` line pasted; the alternative (automatic upward re-stamp)
  was a silent ceiling raise.
- **Identity**: declaration-line anchor rather than a synthetic ID — no new syntax in the source,
  and a moved directive changes its anchor.
- **Exact audit**: slack is a failure, not a note — the stamp is a claim about the function, and a
  stale claim is how the next inflation hides.

## Lessons

- **The first regeneration under the new manifest shape has nothing to diff against.** A manifest
  without `accepted` entries would make every current directive "added", and `--adopt` is refused
  on the same Biome by design. The generator treats the entry-less manifest as a one-time shape
  migration (pins the current directives, says so) and is fail-closed from the next run on.
- **Run record (2026-09-02):** 35 rewrites in 25 files; regen 29 cognitive + 6 length = 35
  entries, zero markers inserted; rescore exact 35/35; `--adopt` on the pinned 2.5.9 refused;
  the staged scan against the pre-rewrite index reported all 35 legacy forms as forbidden — the
  negative path exercised on the real tree, not only in the classifier tests;
  `bun test scripts/ci-cd/complexity-*.test.ts` 11/11; `bun run lint` clean.
- **Harness split is 6 + 5 + 4.** Of the 15 harness acceptances, 6 sit in unit-test files, 5 in
  the e2e fixtures (`extension.ts`, `journal.ts`) and 4 in the CI test-soak scripts — "test/e2e
  harness" undercounted the soak scripts, so CLAUDE.md now says test/CI harness.
