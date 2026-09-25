# Phase 2: hygiene, untrack, permalinks, policy (Arc A)

**2026-09-25, green locally. Not pushed: A opens after its codex loop, and merges only after the A14 soak.**

Branch `chore/plans-scaffolding-a`, cut fresh from `origin/dev` at `b15f5218` (A0 is #696, squashed as `137f1939`).

## Commits

| Commit | Step | What |
|---|---|---|
| `ccd2495a` | 0 | `fix(plans)`: judge decoded values and flag CSS escapes the gate cannot read |
| `fc46fa72` | 1-5 | `chore(plans)`: the untrack, promote and link-rewrite tools, with fixture tests |
| `0b9205ab` | 1 | `chore(plans)`: the untrack manifest, recorded before any path moves |
| `d2759350` | 2 | `chore(plans)`: 22 promotions and 3 renames |
| `f737c457` | 3, 7 | `docs(plans)`: hygiene files, stubs, the nested ignore file removed, and the policy text |
| `0c95ac1b` | 4 | `docs(plans)`: every link to a transcript pinned at its manifest commit |
| `169f19ba` | 5 | `chore(plans)`: 642 transcripts untracked |
| `ae9306e8` | 8 | `ci(plans)`: the gate enforces |

## Step 0: decoded values, not raw spellings

Codex round 3's three constructs, plus the variants they imply, in one fixture (`links.test.ts`, "a construct is judged by its decoded value"). Before the fix the fixture found nothing at all: 0 `link-opaque`, 0 `link-missing`.

- `<meta http-equiv="ref&#114;esh">`: `judgeElement` decodes `http-equiv` before comparing, so the encoded refresh is `link-opaque` like a plain one. An `http-equiv` holding a reference the gate cannot decode is opaque too.
- A `style` attribute with `u&#114;l(`: CSS detection runs on the decoded value, so the URL is judged as a link (`link-missing` in the fixture).
- `<style>` with `u\72l(`: the gate decodes no CSS escape, so `cssUrls` returns null for any backslash left after stripping comments and strings, and the block is `link-opaque`. An escape inside a string (`content: "\2014"`) stays fine.
- Also covered: `u\72l(` in a `style` attribute; `url&lpar;#g)` in an SVG `fill` (an undecodable reference in a CSS attribute is opaque); `u&#114;l(` inside `<svg><style>`, where a browser decodes references, so a `<style>` block is read both as written and decoded.

CSS is read whole only in `style` and the SVG presentation attributes that take a URL (`fill`, `stroke`, `filter`, `mask`, `clip-path`, `marker-*`, `cursor`, `color-profile`). Any other attribute still counts as CSS once its decoded value loads a URL, as before.

**Interpretation.** The plan says the encoded refresh "must yield its `url=` target". A0 classes every meta refresh as `link-opaque` (the `RuleId` list names it), so the decoded refresh is opaque rather than having its target judged. That is the stricter reading: a refresh cannot pass by pointing at an allowed target.

The tree's report was unchanged by step 0: 787 findings, `link-opaque` 0.

## A13: the offline bundle

`~/.cache/nulo-handoff/nulo-dev-2026-09-25.bundle`, 37,486,170 B, sha256 `87776b7e4249f81c91c91ce26078ecac88b23bc5d21a616b626e54ef2de04b6a`. Made with the plan's command before anything moved; its one ref is `refs/remotes/origin/dev` at `b15f5218`.

Verified by `~/.cache/plans-scaffolding-a0/bundle.sh`:
- `git bundle verify`: okay, complete history.
- Restored into an empty repo; its tip equals `origin/dev`; `9f11de70`, `6611f861` and the tip are ancestors; `git fsck --connectivity-only` is clean.
- After step 1, every one of the 679 manifest rows reads byte-identical from the restored repo (`bundle-rows.ts`).

**Gotcha.** A bundle of `origin/dev` carries `refs/remotes/origin/dev`, which `git clone <bundle>` does not check out: it warns "cloned an empty repository". Restore with `git init` and `git fetch <bundle> refs/remotes/origin/dev:refs/heads/dev`.

## Step 1: the manifest

679 rows, every one pinned at `9f11de70`: the 667 tracked transcripts, the 11 `plan.md` files a promotion replaces, and `tools-extraction/.gitignore`. No path needed the merge-base, so `permalink-bases.json` is unchanged. The three A2 files have rows too: they matched `audit-*` when recorded, and a row costs nothing.

## Step 2: promotions (A1) and renames (A2)

The promoter works from an explicit table (`tools/common.ts`), not a heuristic, and lists every earlier revision (the replaced `plan.md` first, then `plan-v*`, `plan-consolidated`) by permalink under the H1. Leg drafts (`plan-codex.md`, …) are not revisions.

- **11 with no `plan.md`**: M3/0 (`plan-0.6-phase2`), M4/10-network-rework (v4), aztec-4.2.0-bump (v2), bb-wasm-hardening (v1), bundle-fpc-nft (v2), contacts-export-uxr (v2), contacts-rename-export-senders (v2), e2e-determinism (`plan-final`), phase-2-plus (v4), pre-a11-ux-cleanup (v4), registry-stealth-notes (v3).
- **11 replacing a superseded `plan.md`**: M4/2 (v2; `plan.md` was the decision memo v1 superseded), capabilities-popup-quality (v2), deprecate-simulate-views (v2), docs-improvement (v2), e2e-network-recovery (v2), embedded-fpc-firsttx-cosmetic (v2), fast-path-internal-views (v2), faucet-add-token (v2), network-test-triage (`plan-reconciled`), profile-name-parity (v2), wallet-sdk-implicit-account-grant (v3).
- **Kept**: M6, whose `plan.md` is draft v3, newer than v1 and v2; and **e2e-stabilization**, whose `plan.md` (2026-05-26) is a later plan that names `plan-final.md` and `plan-consolidated.md` as a "prior plan (pre-open-source import, not landed) — reference only". A1 asked whether to promote `plan-final.md` there; the file answers no, so the approval's "A1 default" is read as the 22 above.
- **Renames**: `M3/7/audit-findings.md` → `findings.md`; `incoming-trust-state-machine-refactor/audit-response-round{1,2}.md` → `decision-ledger-round{1,2}.md`. No kept file linked any of them.

## Step 3: hygiene

- `implementations-plan/.gitignore` and `.ignore` are byte-identical to `fee6b4a2` (`cmp` in `hygiene.sh`).
- `.gitattributes` gains the three linguist lines.
- Stubs: `lessons.md` and `follow-ups.md`.
- `tools-extraction/.gitignore` is deleted. The tools-extraction session is the one building this arc, so the A11 notice to it is this entry. Nothing changes for that plan: the parent `.gitignore` covers the same shapes, and its `lessons/` files are now re-included instead of swallowed.

**Deviation: no `archive/index.md` stub.** The change map lists one in A, but the gate reads that file's presence as the archive split: `activePlanDirs()` stops returning null, so every indexed dir becomes active, `link-missing` goes to full scope and `local-path` covers every plan. That would red ~210 already-broken archived links and the 148 home paths A4 was to scrub. Mechanics § Link-check scope keeps A-C in the pre-split mode, and D's change map adds and generates `archive/index.md`, so D creates it.

## Step 4: the link rewrite

`rewrite-links.ts` rewrote **132 links in 48 files**, after the promotions:

| Kind | Links |
|---|---|
| permalink to a transcript's manifest row | 119 |
| a promoted plan's link to `plan.md`, which meant the plan it replaced | 11 |
| de-linked: `dapp-interaction-lock-fix-v1/plan.md:11`, `audit-codex-round-4.md` (never committed) | 1 |
| doubled directory: `token-identity/lessons/phase-1.md:13`, `../token-identity/deployments.md` → `../deployments.md` | 1 |

- The plan's 112 became 119 permalinks because promoted plans are kept files now, and they link their sibling audits and revisions.
- The doubled-dir link the plan cites, `e2e-network-recovery/plan.md:179`, sits in a fenced block of the v1 `plan.md` that promotion replaced: not a link, and gone from HEAD. The real doubled-dir link was the `token-identity` one, the tree's only `link-missing`.
- `index.md:41` was among the 119.
- **Render-equivalence proof**: each file's `Bun.markdown.html` output equals the old output with the same attribute substitutions, and its extracted links are exactly the old ones mapped. `rewrite-links.ts --verify 0c95ac1b` re-derives the commit from its parent: 48 files, 0 problems. No file needed a manual edit.

## Step 5: untrack

`untrack.ts` ran `git rm --cached` on 642 paths (667 − 22 promoted − 3 renamed). `git ls-files -ci --exclude-standard -- implementations-plan` is 0. The branch diff against `origin/dev` is 747 entries: 653 D (the 642 plus the 11 revisions promoted over an existing `plan.md`), 15 R (11 promotions, 3 renames, and the nested ignore file paired with the new parent one), 66 M, 13 A.

## Step 6: skipped

A4 (the scrub and the guard's new pattern) is deferred until counsel answers (§ Approval). `scrub-paths.ts` is not written and `check-no-local-paths.sh` is unchanged.

## Step 7: policy text

In the `.gitignore` commit: CLAUDE.md's pointer (L14), routing (L43: cross-task gotcha → `lessons.md`, open follow-up → `follow-ups.md`), the milestone-tag line (L457), § Implementation plans rewritten (verdicts inline, transcripts gitignored, uncommitted means disposable, closing a plan, the curated budget, the gate) and "What this file is NOT"; `README.md` L13, L27 and L60 (to `index.md` and the standard); `implementations-plan/README.md` rewritten with § Portable rules and the asset rule; `CI.md:3` and `.github/README.md:3`.

- The code-cites rule is unchanged: A7's rewrite of CLAUDE.md L459-462 is C's, so the README keeps "code MAY reference a plan by path" with its two cross-references.
- `CI.md:230` still says "original design + audits"; D's live-doc pass edits `CI.md` links anyway.

## Step 8: enforcement

`lib.ts` gains `ENFORCED`: the twelve rules the plan lists. `verdict()` fails only on an enforced finding, `check.ts` exits 1 only on one and prints `(report)` before the others, and `tree.test.ts` asserts a pass with no report-only switch. It pins the unenforced set to `path-token`, `index-structure`, `archive-structure`.

**Deviation: `check.ts` ends at 5 findings, 0 enforced, not 0.** The 5 are `path-token`, all code mentions of untracked files: `ChangeAuthwitsRegistryPopup.test.ts:7` and `RevokeAuthwitsPopup.test.ts:9` (→ `network-followups/audit-codex-fix-review.md`), `embedded-fpc-cap.ts:64` (→ `embedded-fpc-firsttx-cosmetic/plan-v2.md`), `vitest.e2e.network.config.ts:40` (→ `network-followups/audit-codex-rootcause.md`), `prune-stale-branches.sh:6` (→ `ci-cd/audit-smoke-gating.md`). They are C's repairs (Phase 5 step 4); fixing them here would touch `apps/extension/**` and fire both e2e suites on a PR the plan keeps to `quality-status`. The sixth mention, `wallets-architecture-research/nulo-phase-2-plus.html:98`, is outside `path-token`'s scope.

## Tools

`implementations-plan/plans-scaffolding/tools/`: `untrack.ts` (`--record`, apply, `--verify`, `--dry-run`), `promote.ts`, `rewrite-links.ts` (`--verify <commit>`), `common.ts` (the manifest, the promotion and rename tables), `gate.ts` (finds the gate library from its own location, so the tools still run once this dir is archived one level deeper) and `fixture.ts`. 7 tests across 3 files. The tools sit outside `biome.json`'s includes, so `~/.cache/plans-scaffolding-a0/biome-tools.sh` checks each through stdin under a stand-in path in the gate dir: clean, no complexity finding.

`untrack.ts --verify` coverage is every `D` under `implementations-plan/` in `git diff -M origin/dev...HEAD`, every rename away from a transcript name, and, per promotion table entry done on the branch, the promoted revision and the replaced `plan.md`.

## Gate on `ae9306e8`

| Command | Exit | Result |
|---|---|---|
| `git ls-files -ci --exclude-standard -- implementations-plan \| wc -l` | 0 | 0 |
| `bun scripts/ci-cd/plans/check.ts` (enforcing) | 0 | 5 findings, 0 enforced (the 5 `path-token` above), 1.8 s |
| `bun implementations-plan/plans-scaffolding/tools/untrack.ts --verify` | 0 | 679 rows, 0 problems |
| `bun implementations-plan/plans-scaffolding/tools/rewrite-links.ts --verify 0c95ac1b` | 0 | 48 files, 0 problems (render-equivalence) |
| `bun test scripts/ci-cd/plans/` | 0 | 92 pass |
| `bun test implementations-plan/plans-scaffolding/tools/` | 0 | 7 pass |
| `bun run test:ci-gating` | 0 | 242 pass, 2 skip |
| `bun run lint` | 0 | clean (the 29 warnings are elsewhere); complexity-baseline OK |
| `bun run lint:actions` | 0 | clean |
| `./scripts/check-no-local-paths.sh` | 0 | ok |
| `bun run test` | 0 | 559 files, 7068 tests pass |
| `git diff --name-status -M origin/dev...HEAD \| wc -l` | 0 | 747 (< 3000) |
| every tool rerun (`--record`, promote, hygiene, rewrite, untrack), then `git status --short` | 0 | 0 rows, 0 promotions, 0 links, 0 paths; status empty |
| `git clone --no-local .`, then `check.ts` in the clone | 0 | 5 findings, 0 enforced |
