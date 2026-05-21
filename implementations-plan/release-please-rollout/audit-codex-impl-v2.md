# Fix-up re-review — release-please implementation

## Verdict
REJECT

## Resolution
- `attach-assets` needs `network-e2e`: fixed for the original gap. `attach-assets.needs` now includes `network-e2e`, `lint-and-typecheck`, and `unit-tests` in [.github/workflows/release.yml](/Users/alejoamiras/Projects/nulo/nulo-3/.github/workflows/release.yml:172).
- `CI.md` release section: fixed. The “What runs when” table, `release.yml` workflow description, and `Releasing` section now describe the release-please model in [CI.md](/Users/alejoamiras/Projects/nulo/nulo-3/CI.md:12), [CI.md](/Users/alejoamiras/Projects/nulo/nulo-3/CI.md:53), and [CI.md](/Users/alejoamiras/Projects/nulo/nulo-3/CI.md:89).
- commit subject hygiene (deliberate omission): accept. The repo’s actual commitlint enforcement passed that commit range earlier; this is a docs-vs-enforcement mismatch, not a release blocker.

## New issues
1. New blocking regression: the documented `workflow_dispatch` escape hatch says `run_network_e2e` can be set `false`, but `attach-assets` now hard-`needs` `network-e2e` while `network-e2e` is still conditionally skipped when that input is false ([release.yml:136](/Users/alejoamiras/Projects/nulo/nulo-3/.github/workflows/release.yml:136), [release.yml:172](/Users/alejoamiras/Projects/nulo/nulo-3/.github/workflows/release.yml:172), [CI.md:113](/Users/alejoamiras/Projects/nulo/nulo-3/CI.md:113)). In Actions, a skipped needed job skips dependents too, so emergency re-publish without network e2e no longer works.

## Greenlight to merge
no-go

Items:
1. Preserve the publish gating on normal releases, but restructure the manual `run_network_e2e=false` path so `attach-assets` can still run.