# justified-baseline — round 3, plan 4 (BL light, 1 PR)

Scope row: [complexity-residue-round-3/scope.md](../complexity-residue-round-3/scope.md) §4.
After plans 1–3 the manifest holds exactly the 35 ACCEPT rows (29 cognitive + 6 length). This
plan changes no function: it retires the "refactor when touched" contract by (1) rewriting every
directive into a justified accepted form, (2) making the scanner reject anything else, (3) making
the generator fail closed for Biome-bump newcomers, and (4) adding a CI rescore audit so an
accepted function cannot quietly grow under a still-valid sentence. Manifest stays 35.

## The accepted form

```
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: accepted at score 45 — the ordered recursive shape walker IS the redaction policy; splitting it scatters security precedence
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: accepted at 154 lines — one declarative CodeMirror theme value; splitting selector groups only fragments it
```

Grammar (scanner-enforced): `accepted at score <N> — <sentence>` for the cognitive rule,
`accepted at <N> lines — <sentence>` for the length rule; the number must match the rule's unit;
the sentence is at least 12 characters (no empty or placeholder reasons). Everything else on a
budget rule — the legacy `baseline (…)` text, the generator marker below, a bare or vague reason
— is `forbidden` and reds `check.ts` (lint + pre-commit) and the CI mirror test alike.

## Tooling

- **`scan.ts`**: `SUPPRESSION_RE` also captures the reason; `classifySuppressionLine` returns
  `{ kind: "baselined", rule, accepted: N }` only for the accepted form, else `forbidden` with a
  specific `why` (legacy text → "replace with `accepted at … — <why>` or refactor"; marker → "a
  human must justify or refactor"; unit mismatch; missing sentence). `scanTree` carries `accepted`
  and the line number per directive for the audit. `compareToManifest` unchanged (counts).
- **`generate.ts`**: `REASONS` become fail-closed markers —
  `JUSTIFICATION REQUIRED (observed score N): refactor, or replace with "accepted at score N — <why>"`
  (and the lines form). Because the scanner refuses the marker, a regeneration that inserts one
  EXITS 1 listing the marked functions and writes no manifest; the human justifies or refactors,
  then re-runs. Under `--adopt` only, an existing accepted directive whose observed number differs
  from its stamp is RE-STAMPED (the number only, never the sentence) before the scan — the
  Biome-bump path. Without `--adopt` the generator never rewrites an existing directive.
- **`rescore.ts`** (`bun run baseline:rescore`, ~80 lines): for every baselined directive, write a
  sibling copy of its file WITHOUT that one directive line (name keeps every suffix so the Biome
  overrides still apply: `Foo.test.ts` → `Foo.rescore-140.test.ts`), lint all copies in ONE
  `biome lint --reporter=json` run, take the rule's diagnostic at the directive's line, parse the
  observed number, and fail when `observed > accepted` (or when no diagnostic remains — the
  directive is stale and must be removed + regenerated). Slack (`observed < accepted`) is printed,
  not failed. Copies are removed in `finally`; `git grep`-based counts never see them (untracked).
- **CI**: `scripts/ci-cd/complexity-rescore.test.ts` runs the audit over the real tree (exit 0) and
  a negative fixture (a temp sibling file with a deliberately over-budget function stamped too
  low → one violation) — in `test:ci-gating`. `check.ts` stays git-grep-fast; the rescore is
  CI-only plus on demand.
- **Tests**: classifier cases for the accepted form, both legacy texts, the marker, unit
  mismatch, empty sentence; generator marker + re-stamp helpers as pure functions.

## Codex blueprint conditions (folded — they replace the corresponding draft text above)

- **No automatic re-stamp, ever.** The generator never rewrites an existing directive. `--adopt`
  is accepted ONLY when the manifest's `biomeVersion` differs from the installed one (a Biome
  bump); otherwise it is refused as a gate bypass. After a bump the audit prints
  `accepted N → observed M` per drifted directive and the human edits each stamp (or refactors),
  then regenerates.
- **Identity, not counts.** The manifest pins every acceptance as
  `{ file, rule, anchor, accepted }` — `anchor` is the trimmed declaration line directly under
  the directive (`git grep -nF -A1`). Drift = any entry added, removed or changed (stamp or
  anchor); a same-file swap is an add + a remove and fails like any growth. Per-file counts stay
  in the manifest as a derived, readable summary.
- **Exact audit.** `observed !== accepted` fails — inflation (`score 999`) and stale slack alike;
  a directive with no remaining diagnostic fails ("remove it and regenerate").
- **Audit mechanics.** One sibling copy per file with ALL of its accepted budget directives
  removed (exclusive-create, unique `.rescore-<pid>` infix before the first suffix, removed only
  if created); originals + copies linted in ONE `biome lint --reporter=json --max-diagnostics=none`
  run; `diagnosticsNotPrinted === 0` and zero parse diagnostics required; pairing by file → rule →
  sorted source position with exact per-rule counts; originals must produce zero budget
  diagnostics (a new unsuppressed offender fails closed). Rule-anchored message parsers:
  `/^Excessive complexity of (\d+) detected/` and `/^This function has too many lines \((\d+)\)/`
  — wording drift fails, never silently mis-parses. The audit function takes injected directive
  descriptors so the negative fixture (an untracked file under an included root,
  `scripts/ci-cd/test-soak/`) is testable; the Bun test carries an explicit timeout.
- **Accepted-form regex** anchored to a whole `//` comment line; the sentence check is
  syntactic (length + no placeholder words) and documented as such — specificity stays
  review-enforced.
- **`.vue` classifier regression test** (the scanner covers `*.vue`; the override keeps the
  cognitive rule on there).
- **Docs corrections**: scope table `apps/faucet` → `apps/tools`; the split is
  **13 production / 7 bridge-core scripts / 15 harness** (test-soak counts as harness).

## The 35 rewrites

Each directive's sentence comes from scope.md's ACCEPT table, tightened at the line (the table's
paths are updated: `apps/faucet/...` moved to `apps/tools/...` in #517). No function body changes;
`bun run baseline:complexity` must report zero insertions and zero removals (counts unchanged, the
scanner now classifies the new text as `baselined`).

## Docs

CLAUDE.md § Complexity budgets: the accepted form replaces "refactor when touched"; the marker and
the re-stamp path replace the `--adopt` paragraph's "grandfathers"; the rescore audit joins the
enforcement list; the steady-state count is 35 with the 13 / 11 / 25 split re-derived from the
final table (the 35 = 13 production, 7 bridge-core scripts, 15 harness).
scope.md's ACCEPT table becomes the canonical 35 with the final sentences; the residue ledger
artifact is republished.

## Assumptions

Facts: 35 directives at the listed lines (29 cognitive / 6 length), none in `.vue`; Biome 2.5.9's
messages are `Excessive complexity of N detected (max: 15).` and `This function has N lines …`
(verified on the generator's own parsing `d.message.match(/(\d+)/)`); `test:ci-gating` is
`bun test scripts/ci-cd/`; `check.ts` runs in `bun run lint` and the pre-commit hook.
Inference: a sibling temp copy keeps the same Biome overrides (globs are path-based) — verified by
the negative fixture. Asks: none — the owner asked for exactly this in the round-3 framing.

## Security & adversarial

Quality-gate tooling. Rot vectors and the guard for each: a vague sentence (min length + no
placeholder words like "TODO"); a stale number after a Biome bump (`--adopt` re-stamp + the
audit); a function growing under its sentence (the audit's ceiling); a directive outliving its
function (the audit's "no diagnostic" failure + Biome's own unused-suppression warning); a new
suppression smuggled in the accepted form (the manifest's shrink-only count is unchanged — an
accepted line on a new function still grows a per-file count); same-file swap (out of scope,
recorded).
