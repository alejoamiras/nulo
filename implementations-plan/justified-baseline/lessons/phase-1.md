# justified-baseline — lessons (phase 1)

Round-3 plan 4. One codex session (fresh; blueprint audit → PR review).

## Consults

| Turn | Who | Ask | Verdict | Folded |
|---|---|---|---|---|
| 1 | codex | blueprint audit | conditional approve | three blocking holes in the draft: (a) **automatic ceiling raising** — `--adopt` re-stamping numbers was a gate bypass → the generator never rewrites a stamp; `--adopt` is allowed ONLY when the manifest's Biome version differs from the installed one, and every re-stamp is a human edit; (b) **count-only identity** — a same-file swap (drop one accepted directive, add another on a different function, stamp its real score) passed counts and a `>`-only audit → the manifest pins every acceptance as `{ file, rule, anchor, accepted }` where `anchor` is the declaration line under the directive, drift is any added/removed/changed entry, and the rescore audit is EXACT (`observed !== accepted` fails: inflation and stale slack alike); (c) **exact-line diagnostic matching** broke on the paired length+cognitive directives (`discover-mainnet-fuel.ts`, `relay-claim-testnet.ts`) → one sibling copy per file with ALL accepted directives removed, originals + copies in ONE Biome run (`--max-diagnostics=none`, `diagnosticsNotPrinted === 0`, parse failures rejected), pairing by file → rule → sorted source position with exact per-rule counts, originals must yield zero budget diagnostics (new unsuppressed offenders fail closed); plus: the accepted-form regex anchored to a whole `//` comment, sentence checks described honestly as syntactic, rule-specific anchored message parsers (`Excessive complexity of N detected` / `This function has too many lines (N). Maximum allowed is 80`), the negative fixture through injected descriptors (untracked files are invisible to `git grep`) placed under an included root, a `.vue` classifier regression test, exclusive-create unique sibling names cleaned only when created, an explicit Bun test timeout, `apps/faucet` → `apps/tools` in the scope table, and the corrected split 13 production / 7 bridge-core scripts / 15 harness |
| 2 | codex | PR review (read-only) | **reject** | three mechanism holes, all real, all folded: (a) **same-checkout trust** — tree-vs-manifest passes a hand-edited row → the CI mirror now ratchets head against the PR base's manifest (`GITHUB_BASE_REF`, shallow-fetched when absent; fail-closed on a PR, skipped on push/schedule; per-rule totals against a base that predates entries; relaxed only across a Biome version change); (b) **re-triggerable migration** — deleting `accepted` and regenerating re-pinned anything → the hatch is gone, an entry-less manifest is refused by generator, check and CI; (c) **anchor collisions** — a same-text declaration or a stacked duplicate collapsed silently in a `Map` → duplicate identities and non-unique anchor lines are `forbidden`, and the anchor reads through a paired directive, a doc block and blanks (8-line reach) instead of taking a comment as the declaration. Also folded: the sentence is pinned in the manifest so a rename or file move (same rule + stamp + sentence, new identity) regenerates as a *move* while a swap onto another function is an *add*; the false "nothing was written" message; CLAUDE.md (numbers *rise* only on a bump; the harness rationale no longer says "scenario matrices" for lexers/predicates); scope.md §4 rewritten to the implemented contract. Held as residual, stated in the docs: on a genuine Biome bump the ratchet relaxes, so unrelated added acceptances could ride along with the bump — the bump PR is the one diff reviewed line by line, and every addition needs a human-written sentence the generator cannot produce |
| 3 | codex | PR review round 2 (read-only) | **reject** | two mechanism points, both folded: (a) the legacy-base ratchet compared `base.rules` with the head's editable `rules` summary → head totals are now derived from `head.accepted`, and both `check.ts` and the CI mirror refuse a manifest whose `rules` differ from its entries; (b) sentence equality alone let delete-and-recreate (same score, copied sentence) launder as a move → a move now also requires visible identity continuity: the exact declaration line in another file, or the same declaration NAME (`declarationName`: function / const / property / method / test title; anonymous callbacks have none and therefore no move path). Also folded: the ratchet reads the pull_request event's exact `base.sha` from `GITHUB_EVENT_PATH` (branch tip only as fallback) so the comparison is reproducible if dev advances mid-run; `*gen() {` generator methods are declarations, not comment continuations; the stale migration lesson. Held as residual: the bootstrap PR itself (dev's manifest has no entries) can only be ratcheted on totals — owner review of a directive-text-only diff |
| 4 | codex | PR review round 3 (read-only, the protocol's last) | **reject** | one blocking point plus a doc mismatch, both folded as codex proposed rather than surfaced as a stalemate: name continuity is forgeable (remove accepted `main`, write an unrelated over-budget `main` with the same score, copy the sentence) → moves are ratchet violations by default; a genuine rename or file move needs the owner's `baseline:move-approved` PR label (read from the event payload; apply, then re-run), and `generate.ts` still regenerates moves locally so the manifest can follow. The exact-line cross-file route was dropped so "anonymous callbacks have no move path" is true. Accepted residuals, codex's words: the bootstrap PR's same-count swap (owner review of a directive-text-only diff) and the Biome-bump relaxation (line-by-line review). Named in the docs as the limit of any identity scheme: a same-named in-place replacement with the identical score is indistinguishable from an unchanged entry — the label review and rescore exactness are the answer, not a stronger key. No fourth round: the fold is codex's own remedy, verified by the unit tests; the owner reviews the PR |

## Decision ledger

- **Re-stamp**: human-only. Ergonomics after a Biome bump are one edit per drifted directive with
  the audit's `accepted N → observed M` line pasted; the alternative (automatic upward re-stamp)
  was a silent ceiling raise.
- **Identity**: declaration-line anchor rather than a synthetic ID — no new syntax in the source,
  and a moved directive changes its anchor.
- **Exact audit**: slack is a failure, not a note — the stamp is a claim about the function, and a
  stale claim is how the next inflation hides.

## Lessons

- **The first regeneration under the new manifest shape had nothing to diff against.** A manifest
  without `accepted` entries makes every current directive "added", and `--adopt` is refused on
  the same Biome by design. The bootstrap was a one-off generator branch that pinned the current
  directives; codex showed it was re-triggerable (delete `accepted`, regenerate), so it was removed
  in the same PR — an entry-less manifest is now refused everywhere, and this PR's own CI run
  ratchets against dev's entry-less manifest on per-rule totals derived from the head entries.
  What that bootstrap run cannot prove is a same-count swap inside this one PR; the diff is
  directive text only, and the owner's review of it is the gate for this single transition.
- **Run record (2026-09-02):** 35 rewrites in 25 files; regen 29 cognitive + 6 length = 35
  entries, zero markers inserted; rescore exact 35/35; `--adopt` on the pinned 2.5.9 refused;
  the staged scan against the pre-rewrite index reported all 35 legacy forms as forbidden — the
  negative path exercised on the real tree, not only in the classifier tests;
  `bun test scripts/ci-cd/complexity-*.test.ts` 11/11; `bun run lint` clean.
- **Run record, fold (2026-09-02):** regen → 35 entries with sentences (two `reworded:` lines, the
  field being new); `bun test scripts/ci-cd/` green; in CI mode (`GITHUB_ACTIONS=true
  GITHUB_BASE_REF=dev`) the ratchet ran against origin/dev's entry-less manifest on per-rule
  totals (29/6 vs 29/6) and passed; the negative drill — one hand-written manifest row with no
  directive in the tree — reds both the tree-equality test ("manifest is stale") and the base
  ratchet ("grew relative to origin/dev"), manifest restored byte-identical afterwards.
- **CI (#526):** the directive rewrites touched e2e fixtures, so the full network suite ran; five
  shards + smoke green, the canary lane red once on the known SW-restart auth-popup fingerprint
  (`ensureUnlocked: lock state never settled within 30s (hash: #/popup/auth …)` at
  `frozen-account-canary.test.ts:245`) on a diff of comment lines and scripts — rerun once per
  policy. `quality-status` green = the base ratchet ran on a real pull_request event against dev's
  entry-less manifest and passed on per-rule totals.
- **Harness split is 6 + 5 + 4.** Of the 15 harness acceptances, 6 sit in unit-test files, 5 in
  the e2e fixtures (`extension.ts`, `journal.ts`) and 4 in the CI test-soak scripts — "test/e2e
  harness" undercounted the soak scripts, so CLAUDE.md now says test/CI harness.
