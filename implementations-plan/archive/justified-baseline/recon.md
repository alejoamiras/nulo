# justified-baseline — recon (round 3, plan 4)

## Reuse map

| capability | found | verdict |
|---|---|---|
| suppression scanning + form classification | `scripts/complexity-baseline/scan.ts` (`classifySuppressionLine`, `scanTree` over `git grep -nF`, `compareToManifest`) | **extend**: capture the reason, classify the accepted form, record the declaration anchor (`git grep -A1`) |
| local + CI enforcement | `scripts/complexity-baseline/check.ts` (lint + pre-commit, `--staged`), `scripts/ci-cd/complexity-baseline.test.ts` (CI mirror; classifier + manifest tests) | **extend** with entry-level drift |
| directive insertion + manifest write | `scripts/complexity-baseline/generate.ts` (Biome JSON reporter, bottom-up insertion, `--adopt` growth gate) | **change**: fail-closed marker, `--adopt` only on version mismatch, entries in the manifest |
| rescore | none | **build** `scripts/complexity-baseline/rescore.ts` + `scripts/ci-cd/complexity-rescore.test.ts` |
| Biome message parsing | `generate.ts` uses `/(\d+)/` on the message | **replace** with rule-anchored parsers |

## Constraints found

- `biome.json` `files.includes` is restrictive (`apps/**`, `packages/**`, `scripts/ci-cd/test-soak/**`, …): sibling copies of the 35 all sit under included roots; the negative fixture must too.
- `git grep` (and `--cached`) never sees untracked sibling copies, so counts and the staged scan are unaffected by the audit's temp files.
- Two files carry a length AND a cognitive directive on the same function (`discover-mainnet-fuel.ts`, `relay-claim-testnet.ts`): any per-directive line arithmetic is wrong; pair by sorted position per rule.
- Biome's stdin mode prints the processed code, not diagnostics — sibling files are the only path.
- The 35 span `.ts` and `.js`; none in `.vue` today, but the scanner covers `*.vue` and the override keeps the cognitive rule on there.
