---
plan: plans-scaffolding
tier: mid
driver: claude-code
code_review: off
eli5_mode: artifact
budget: ultracode
status: draft rev 3 — final pass applied, awaiting owner approval
base: dev @ 9f11de70 (2026-09-24, #692)
harden: not scheduled (Ask A12)
---

# plans-scaffolding — migrate `implementations-plan/` to the blueprint scaffolding standard

This plan moves the repo's 253-dir planning tree off the old convention, where transcripts are committed next to plans and one flat index is only ever appended to (`implementations-plan/README.md`). It moves the tree to the owner's current standard:

- an active-only `index.md`;
- closed plans under `archive/`, each with a generated `## Outcome` block;
- a curated `lessons.md` (≤ 8 KiB) and a `follow-ups.md`;
- transcripts gitignored;
- a CI gate that keeps it that way.

Five stacked PRs do the work:

- **A0**: the gate, report-only.
- **A**: untrack, and the gate enforces.
- **J**: owner judgement (closures, lessons, follow-ups).
- **C**: the assets that code reads.
- **D**: the archive move.

Two small PRs then close this plan itself. Each PR reverts on its own. The large ones are mechanical, and the one that needs a line-by-line read is small. Nothing is purged from history.

Companion files: `recon.md` (the Phase 0.4 reuse map), `lessons/phase-N.md`, `untrack-manifest.json` (A), `closures.json` and `mining.jsonl` (J).

## Owner decisions (Phase 0, 2026-09-24): binding

| # | Decision |
|---|---|
| O1 | **Transcripts**: untrack, with `git rm --cached`, every committed file the new `.gitignore` covers (`audit-*.md`, `plan-*.md`, `_*.md`, `eli5.html`; 667 at 9f11de70). Every link to one from a kept file becomes a commit-pinned permalink, `https://github.com/alejoamiras/nulo/blob/<sha>/<path>`. Nothing is purged from history. |
| O2 | **Old plans**: every closed plan moves to `archive/` with a short generated `## Outcome` (date, final status, PRs, and a line retiring its `/goal` and `/loop` seeds). A plan with an ambiguous status goes to the owner; none is guessed. |
| O3 | **Lessons seed**: mine all plans and their `lessons/` to seed `lessons.md` (≤ 8 KiB) and `follow-ups.md`. |
| O4 | `code_review: off`. The codex fix loop is the only post-implementation review. |
| O5 | Budget: "ultracode" (thoroughness over token cost). |

Related decision: tools-extraction D24 (6534e8f1, not on dev) makes this migration a separate plan, run in parallel. Unleashed's B4 bootstrap mirrors § "Portable rules" of the new README.

---

## Outcome & Quality Bar

**Who uses the result:**
- every future agent session here, which reads `index.md` and `lessons.md` at the start of a task and searches the tree;
- the owner, who reviews plans in GitHub and keeps the transcripts as evidence in the Azguard provenance matter;
- the parallel plans (ux-feedback, tools-extraction, vitest-5-bump), which rebase onto this migration;
- unleashed's B4, which copies the rules.

**What excellent looks like:**
1. **Agents start from signal.**
   - `index.md` holds exactly one line per active dir. It has 190 lines and 110 KiB today.
   - `lessons.md` is ≤ 8,192 B, one line per entry. Each line links to archived evidence and traces to a quote checked against its source.
   - A default ripgrep search returns no transcripts and no archived plans.
   - Gates: `index-structure`, `curated-budget`, and Phase 4's mining gate.
2. **No reference dies silently.**
   - Every rendered link in a kept file resolves in the git index, or is an allowlisted permalink. This covers inline, reference-style and raw-HTML links in markdown, and `href`/`src` in `.html`.
   - Every `implementations-plan/<path>` token resolves: at HEAD in live docs, and at HEAD or under `archive/` in code.
   - Every untracked file stays reachable at a pinned `dev`-ancestor SHA, whose blob is byte-identical to the one removed.
   - Gates: the tree check and `untrack.ts --verify`.
3. **The standard holds on its own.**
   - On a PR or a local run, `quality-status` turns red, with a what-to-run message, for any of these: a re-landed transcript, a negating `.gitignore` line, a nested `.gitignore` that swallows `lessons/`, a broken plan link, or an oversize `lessons.md`.
   - On push, nightly and release, the same check reports and passes, so a docs slip never blocks a publish.
   - It uses no network except on PR runs, which fetch `dev`'s commit graph to check permalink ancestry, as the complexity ratchet already fetches its base on every PR run (`complexity-baseline.test.ts:311-322`).
4. **History stays legible.**
   - Every file under a closed dir is detected as a rename of its original in D's squash commit.
   - Every pair that is not identical differs only by the generated edit. This is proved by re-derivation, not by one `--follow` sample.
   - Every archived plan states its final status. No active or parked plan gets an Outcome.

**Good enough:**
- Archived prose is not repaired: codex `path:line` cites, old `packages/extension` paths, and absolute paths inside frozen transcripts.
- Fragment anchors are not checked.
- The 40 near-misses stay tracked (A3).
- The 66 plan mentions in source comments stay. They resolve under `archive/`; only the 6 that name an untracked file are repaired (A6).
- Published ELI5 Artifacts keep their stale seeds.

---

## Architecture & Implementation

### Proposed architecture

**Permanent gate: `scripts/ci-cd/plans/`** (lib, CLI and colocated tests; precedent `scripts/ci-cd/test-soak/`).
- It lives inside `test:ci-gating` discovery (`bun test scripts/ci-cd/`, package.json:31). It therefore runs in `pr-quick.yml:211`, `release.yml:216` and `nightly.yml:161` with no workflow change.
- **It enforces on `pull_request` and locally, and only reports elsewhere.** This is `ratchetBase()`'s rule (`complexity-baseline.test.ts:276-282`): under Actions without `GITHUB_BASE_REF`, it writes its findings to `$GITHUB_STEP_SUMMARY` and passes. Every other test in the job stays fatal.
- A0 ships it report-only in every mode. A switches enforcement on.

**One-shot tools: `implementations-plan/plans-scaffolding/tools/`.**
- The set: untracker and manifest, promoter, rewriter, scrubber, classifier, miner, Outcome generator, archive mover, index splitter, link repairer.
- They import the lib and are idempotent. They are archived with this plan, and CI never runs them (precedent: `isolated-linker-store/tools`).

**Reuse** (`recon.md`):
- Markdown goes through `Bun.markdown.html`, then the built-in `HTMLRewriter` (`a[href]`, `img[src]`, `h2`). `.html` goes straight to `HTMLRewriter`. The `Bun.markdown.render` callbacks the draft used miss raw `<a href>` (F16). Precedent: `apps/landing/scripts/legal-pages.ts:119`.
- Git calls: `spawnSync('git', …)` with a large `maxBuffer`, and exit 1 treated as no match (`scripts/complexity-baseline/scan.ts`).
- PR base and fail-closed fetch: `complexity-baseline.test.ts:272-348`.
- Outcome template: `send-publish-ledger/plan.md:15`.
- **No new dependencies.**

### Key interfaces (`scripts/ci-cd/plans/lib.ts`)

```ts
type Finding = { rule: RuleId; file: string; line: number; detail: string; fix: string }
type RuleId =
  | "tracked-artifact"   // tracked under implementations-plan/ and (ls-files -ci OR a canonical pattern outside lessons/)
  | "hygiene-files"      // a canonical line missing, or a `!` line other than `!**/lessons/**`
  | "nested-ignore"      // a .gitignore below implementations-plan/ outside the shrink-only allowlist
  | "link-untracked"     // any link form → a path a canonical pattern covers
  | "link-missing"       // any link form → a path absent from the git index (scope: A8)
  | "permalink-shape"    // not https://github.com/alejoamiras/nulo/(blob|tree)/<40-hex>/<[A-Za-z0-9._/-]+>(#L\d+)?
  | "permalink-base"     // SHA not in permalink-bases.json
  | "permalink-ancestry" // PR runs and local: an entry that is not an ancestor of `dev`, fetched by name (never the PR base)
  | "path-token"         // live docs: resolves at HEAD; code/config: at HEAD or under archive/
  | "index-structure"    // index line ↔ active dir mismatch, duplicate, dead target, target in archive/, or Outcome ↔ "closed, awaiting archive" mismatch
  | "archive-structure"  // no archive/index.md line, or host lacks a real `## Outcome` h2 with Date, Status, Shipped|Delivered, Seeds retired
  | "curated-budget"     // lessons.md > 8192 B; a multi-line entry; no link into implementations-plan/ or an allowlisted permalink; any other URL host
  | "local-path"         // absolute home path in lessons.md, follow-ups.md, the index files or an active plan dir
export const CANONICAL_PATTERNS: readonly string[]  // audit-*.md, plan-*.md, _*.md, eli5.html (lessons/** exempt)
export function trackedFiles(): Set<string>          // git ls-files -z, never the filesystem
export function extract(file: string, src: string): { links: Link[]; h2: string[] }
export function mode(): "enforce" | "report"         // enforce locally and when GITHUB_BASE_REF is set
export function checkTree(): Finding[]
```

**`permalink-bases.json`** lists the full SHAs a permalink may pin: `9f11de70…`, `6611f861…` (#692's freeze links), and any merge-base the rewriter used. Both named SHAs are `dev` ancestors (checked 2026-09-24).
- **Ancestry is anchored to `dev`, never to the PR base.** On a stacked PR the base is a parent arc, so "ancestor of `base.sha`" would accept a commit that exists only on an unmerged branch (and, after a squash merge, never reaches `dev`).
- **Every entry, every PR run.** The list is a handful of SHAs, so the gate checks all of them rather than diffing against an old allowlist. That removes the depth-1 problem of obtaining the old file, and it validates the initial entries on A's PR, the first enforcing run.
- **How a depth-1 checkout gets the graph:** `git fetch --no-tags --filter=tree:0 origin +refs/heads/dev:refs/remotes/origin/dev` (commits only), then `git merge-base --is-ancestor <entry> refs/remotes/origin/dev` per entry. Locally it uses the existing `origin/dev` without fetching; a stale ref fails with a "fetch dev" message.
- A fork-network SHA fails. A failed fetch fails closed on a PR run (ratchet L344-348). Push, nightly and release runs do not fetch and only report.

**`check.ts`** exits 1 with one line per finding; `--report` exits 0. **`tree.test.ts`** asserts `[]` in enforce mode.

**`plans-scaffolding/untrack-manifest.json`** is the evidence index. It holds `{path, sha, blob}` per path removed or promoted away, recorded before any mutation, and is append-only.

### Data & control flow (critical path)

1. **A0**: lib, report-only test, and the plan dir plus its index line.
2. **A**: manifest → promoter (A1) and curated renames (A2) → hygiene files (byte-identical to fee6b4a2) → rewriter (each link pinned to its manifest row) → untracker → `--verify` → scrub and guard (A4) → policy text → enforce.
3. **J**: classifier → owner answers → `closures.json` → miner (inventory, quoted candidates) → cluster subagents → driver-written lines → fresh verifier → `lessons.md`, `follow-ups.md`, `mining.jsonl` → spec lift.
4. **C**: asset `git mv`; repoint the executable consumers; repair the 6 broken mentions; `path-token` on.
5. **D**: Outcome generator (in place, own commit) → archive mover (own commit) → index splitter → map-driven link repairer → `archive-move.ts --verify`.
6. **After D merges**: E (this plan's closing steps 1-3), then F (its move).

### File-level change map

| PR | Adds | Modifies | Deletes / moves |
|---|---|---|---|
| A0 | `scripts/ci-cd/plans/{lib,links,structure,permalinks,check}.ts` + tests, `tree.test.ts`, `permalink-bases.json`; `plans-scaffolding/{plan.md,recon.md,lessons/}` | `index.md` (+1) | — |
| A | `implementations-plan/{.gitignore,.ignore}` (= fee6b4a2), `{lessons,follow-ups}.md` + `archive/index.md` (stubs); `untrack-manifest.json`; `tools/{untrack,promote,rewrite-links,scrub-paths}.ts` + tests | `.gitattributes` (+3); ~45 kept files (links); 23 kept files (scrub, A4); `check-no-local-paths.sh`; `tree.test.ts`; `CLAUDE.md` L14, L42, L456, L468-475, L692; `README.md` L13, L27, L60; `implementations-plan/README.md`; `CI.md:3`; `.github/README.md:3` | `git rm --cached` ~640; promotions in 22 dirs; 3 renames; `tools-extraction/.gitignore` |
| J | `closures.json`, `mining.jsonl`, `gh-{prs,issues}.json`; `tools/{classify,mine}.ts` + tests; `transport-ready-handshake/spec-rows.md` | `lessons.md`; `follow-ups.md`; `index.md` (2 lines); this `plan.md` (answers) | — |
| C | — | 4-5 KAT imports; `test-soak/cli.ts:39`; the 6 broken mentions; stale texts and asset cites (Phase 5 steps 4-5); `package.json` | `git mv`: 3 `reference/` projects (15 files), `phantom-sweep.ts`, `PRF-NON-PORTABLE.md`, 25 baselines (unless #669 did) |
| D | `archive/index.md`; ~23 stub `plan.md`; `tools/{outcome,archive-move,split-index,repair-links}.ts` + tests | ~330 moved files (Outcomes, seed lines, links); `index.md`; curated-file links; live docs (Phase 7 step 3); `audit/bugs/2026-08-22-production-ready/adjudication-2026-08-24.md:64-65` | `git mv` ~250 closed dirs (~1,400 files) → `archive/` |
| E | — | `plans-scaffolding/plan.md` (its Outcome); `lessons.md`; `follow-ups.md` | — |
| F | — | `index.md` → `archive/index.md` (1 line) | `git mv plans-scaffolding archive/` |

### Non-obvious mechanics

**Extraction and source-preserving rewrite.**
- Links and h2s come from the rendered HTML (F16). A finding's line is the first source line holding the href.
- The rewriter edits only URL tokens in destination positions: `](…)`, `]: …`, `href="…"`, `src="…"`.
- It proves each file by render-equivalence: `html(new)` must equal `html(old)` with the same URL substitutions. A changed code span, fence or link text fails.
- A's permalink rewrite and D's repair both use it.

**Link-check scope (A8).**
- `link-missing` covers root `*.md` (except `CHANGELOG.md` and `AUDIT.md`), `legal/**`, `apps/**/README.md`, `packages/*/README.md`, `.claude/skills/**`, `.github/README.md`, the index files, the curated files and active plan dirs.
- In `archive/**` it checks only targets under `implementations-plan/`; the 210 already-broken archived links are frozen history. Until D splits the index there is no active set, so every plan dir gets this archive rule in A-C. The full check for active dirs switches on with `index-structure` in Phase 7. The same pre-D limit applies to `local-path`, which until then covers only the curated files, the indexes and this plan's dir. If A4 is declined, the guard's exemption narrows only in D.
- `audit/`, `architecture/` and `wallets-architecture-research/` are out of scope, but their 3 links and 1 mention into moving plans are repaired once.
- `link-untracked` applies everywhere.
- Resolution is index-only. `git rm --cached` leaves files on disk, so a filesystem check would pass locally and fail on CI. Phase 2 proves this in a fresh clone.

**Evidence manifest and permalink base (codex C1, fable F4).**
- Before any mutation, `untrack.ts --record` writes one row per path to be removed or promoted away.
  - `blob` = `git rev-parse HEAD:<path>`.
  - `sha` = the first of [9f11de70, the merge-base with `origin/dev`] where `rev-parse <sha>:<path>` equals that blob. No match stops the tool.
- The rewriter pins each permalink to its row. `file.md:24` becomes `…#L24`.
- Append-only: a rerun adds rows for transcripts that landed meanwhile (e.g. #669). It fails if an old row no longer verifies.
- `--verify` checks every blob at its sha, that every sha is a `dev` ancestor, and coverage: every `D` under `implementations-plan/` in `git diff --name-status -M origin/dev...HEAD`, and every promoted-away source, has a row.
- The never-committed `dapp-interaction-lock-fix-v1/audit-codex-round-4.md` is de-linked. The doubled-dir link at `e2e-network-recovery/plan.md:179` is resolved by basename.

**Revision promotion (A1).**
- In 11 dirs the latest `plan-vN`/`plan-final`/`plan-reconciled` is the only plan of record. In 11 more, `plan.md` is v1 or superseded.
- The promoter runs `git mv -f <latest> plan.md` and adds `Earlier revisions: <permalinks>` under the H1. That line includes the replaced `plan.md` (fable F5).
- Without promotion, 8 plans and 4 subdirs vanish from HEAD.

**Outcome detection, placement and hosts (codex C5, fable F3).**
- **What counts as an Outcome:** only a real h2 whose text is exactly `Outcome`, from `extract().h2`. Fenced examples, `## Outcome & Quality Bar` and `## Outcome (B-06…)` don't count.
- **Complete blocks** (Date, Status, Shipped|Delivered, Seeds retired) are left alone; that covers `send-publish-ledger`. An incomplete block gets its missing fields appended inside it, never a duplicate block.
- **Not hosts:** the 36 other exact-heading files (4 `STATUS.md`, 32 lessons logs; F10). The 4 `STATUS.md` blocks feed the classifier as evidence.
- **Placement (A15):** with byte-0 YAML front matter the block goes directly after the closing `---`, before the H1 (the owner's rule); without front matter, at byte 0, before the H1 (the one extension that reads the same for every file).
- **The exemplar.** `send-publish-ledger/plan.md` reads front matter → H1 (L13) → Outcome (L15), so it does not meet that rule. A15 settles it explicitly; the default grandfathers it by path in `outcome.ts --verify`, the only placement exception, since its block is complete and generated blocks never touch a complete one.
- **Hosts, in order:**
  1. `plan.md`;
  2. the index line's non-plan target (`runbook.md`, `adoption-map.md`, `scope.md` ×2, `README.md`, `seed.md`);
  3. the dir's `README.md` (M2, M3, M4);
  4. a synthesized stub `plan.md`.
- **Live plans are never touched.** The generator reads only closed rows and refuses any dir with an active `index.md` line. A fixture proves ACTIVE and PARKED rows are untouched.

**Outcome block** (≤ 1 KiB, from `closures.json`, never from front-matter `status:`, which is stale in 23 plans). The block starts with the h2 heading whose text is exactly `Outcome` and a blank line. The template's heading is described here rather than printed, so this plan never carries a line a grep-based STOP check could misread. The body is:
```md
- **Date**: <last substantive commit date, excluding 5ee8ec13 and 9f11de70>. **Status**: <completed | superseded by <plan> | abandoned — <reason> | historical — pre-open-source import (2026-05-19)>.
- **Shipped**: <merged PRs, e.g. #417, #418 | no PR recorded>.
- **Open items**: <none | follow-ups.md "<entry>">.
- **Seeds retired**: the `/goal` and `/loop` seeds in this directory are spent and must never be pasted. Generated by plans-scaffolding on <date>.
```
- Nested `plan.md` files carry the same fields with Status `closed with parent <plan> (<parent status>)`. That covers the M2/M3/M4 children, the harden-quality-arc findings, onboarding-fees audit-fixes and harden-2026-09 b1-b4.
- The ~28 non-plan seed files get `> Seeds retired (<date>): …` above their first seed block.

**PR extraction.** Only gh `MERGED`, or a `(#N)` squash subject on dev, proves a merge. Stack ids, issue numbers and the closed-by-design PRs listed in `recon.md` (Reuse map row 2) are kept apart.

**`archive/index.md` is generated, never copied** (a copy would carry stale "PR #122 open" text).
- Format: `- [name](name/<outcome-file>) — <status> <date> (#PRs) — <hook ≤ 200 chars>`.
- The hook is the old index hook, or the host's H1 for the 76 unindexed dirs.
- Duplicate lines (private-fuel-fee-fix, aztec-5.2.0-js-line) collapse to the later one.
- L86 and L88 become one line per child.

**Archive-move fidelity (codex C7, fable Fa).** D's squash commit carries renames and generated edits together. Why detection still pairs them:
- Git pairs exact renames first, and runs inexact matching only while sources × destinations ≤ `diff.renameLimit`² (1000²).
- After A merges, D's inexact candidates are only its ~330 edited files: ~110k pairs. The draft's "887 inexact sources" counted A's 640 deletions.
- The smallest Outcome host is 1,705 B (F17), so a ≤ 1 KiB block keeps every host ≥ 63% similar, above the 50% default.

`archive-move.ts --verify` checks the real diff:
- every path under a closed dir is `R<score>` to its mapped path;
- R100 unless the path is in the planned-edit set;
- every edited pair satisfies `generate(oldBlob) == newBlob`;
- the only additions are `archive/index.md` and the stubs;
- fewer than 3,000 files, measured against D's actual parent (the lower arc's branch, or `dev` once the lower arcs merged), never `origin/dev...HEAD`, which counts unmerged lower arcs.

GitHub documents a 300-file limit on rendered PR diffs and a 3,000-file cap on the PR-files API ("List pull requests files"). D (~1,460) is reviewed locally, and once PR D is open its pre-merge gate enumerates the API's file list completely (`gh api --paginate`) and reconciles it with the move map: the same count as the local diff, every `renamed` row mapped, every `modified` row in the planned-edit set, the only `added` rows `archive/index.md` and the stubs. **Split fallback:** if `--verify` finds an unpaired D or A, or the API pairs a file differently or nears the cap, the Outcome commit becomes its own PR before a pure-move D (R100 pairs are exact renames).

**Link repair via an explicit old→new map** built from `closures.json`.
- Each kept file, moved or not, resolves every relative link from its old location, maps the target, and re-relativizes from its new location.
- One rule covers the 41 sibling links, the 10 `../../` links, nested files, the 3 `approval.html` hrefs, and any active/archive crossing that an owner answer creates.
- `lessons.md`, `follow-ups.md` and live-doc path tokens use the same map. `CLAUDE.md:517`'s brace form is done by hand.

**Concurrency re-check (codex C8, fable F7, final pass 5).** At D's start and again in D's pre-merge gate, against the refreshed base, per directory:
- A dir with no row (first seen after `closuresBase`) is ACTIVE and stays.
- A closed dir whose content changed since `closuresBase` (`git diff --quiet <closuresBase> <refreshed base> -- <dir>` fails) goes back to the owner; nothing merges until the answer is in `closures.json`.
- Index lines added by other branches are kept verbatim when their dir is active.
- **D is regenerated, never rebased across upstream edits.** After any base refresh the session resets D to its refreshed parent and re-runs `outcome.ts`, `archive-move.ts`, `split-index.ts` and `repair-links.ts` (all idempotent). `git diff --stat <old D head> <new D head>` must be explained by the drift report, line for line. So a resumed plan's new content can never ride into `archive/` under a closed Outcome, and generated edits never mix with upstream ones.

**"Closed, awaiting archive" (final pass 2).** The owner's closing standard writes the Outcome in the delivery PR and moves the dir only after it merges, because a running `/loop` still reads the live path. The gate models that state:
- An `index.md` line whose status field is exactly `closed, awaiting archive` must target a host with a complete Outcome; every other active line must target a host without one.
- Only this plan passes through that state (PR E → PR F). D's ~250 dirs get their Outcome and their move in one PR, so none of them ever sits in it.

**Mentions are not links (A6).**
- Code comments naming a plan path stay: they resolve at HEAD or under `archive/`, which `path-token` accepts for code.
- C repairs only the 6 that name an untracked or promoted file:
  - `ChangeAuthwitsRegistryPopup.test.ts:7`
  - `RevokeAuthwitsPopup.test.ts:9`
  - `embedded-fpc-cap.ts:64`
  - `vitest.e2e.network.config.ts:40`
  - `scripts/ci-cd/prune-stale-branches.sh:6`
  - `wallets-architecture-research/nulo-phase-2-plus.html:98`
- Rewriting all 66 would be digest-safe (F15), but it would touch ~52 files for no reader gain.

**Parked spec lift (J).** `transport-ready-handshake`'s spec rows live in `e2e-deflake/flake-ledger.md` and `deflake-round-4/fix-plan.md`, both closing. J copies the open rows verbatim, with source permalinks, into `transport-ready-handshake/spec-rows.md`, and repoints its index line.

### Trade-offs & alternatives not taken

- **The competing outline (freeze in place, 2 PRs).** Rejected: it violates O2 and O3, and both audits agree. Grafted from it: early independent A, report-only outside PRs, byte-identical hygiene files, and a shrink-only in-place list (built only if the owner keeps a dir in place).
- **Outcomes in their own PR before the move (the draft's B).** Dropped. The rename analysis holds, and B mixed judgement with mechanics in 350 files, where `lessons.md` could not even render.
- **One big PR.** Rejected: ~2,000 files, a mixed commit, and both e2e suites for a docs change.
- **Archive first, or `.gitignore` before `git rm --cached`.** Rejected: 667 transcripts would move into `archive/`, or ripgrep would hide ~640 committed files.
- **Permalinks in all 66 comments (the draft's A6 default).** Not taken: 52 files, and the mentions resolve under `archive/` anyway.
- **`packages/wallet-crypto/vectors/`.** Rejected: it puts three standalone projects inside a published package's tree and Biome scope. N2 stages only `dist` and `NOTICE` (F15), so the digest is not the reason.
- **A network link checker, or a per-PR `permalink-object` fetch.** Rejected: a new dependency and new flake; and a fetch proves existence, not ancestry (fable F4).
- **A phrase denylist on `lessons.md`.** Dropped: trivially bypassed (both audits), and it would suggest a control that does not exist.
- **Merge-committing D.** Not taken: merge commits are reserved for the sync PR, and `--verify` proves pairing under squash.

---

## Security & Adversarial Considerations

**Threat model.** The repo is PUBLIC:
- external PR authors can add links, permalinks and allowlist entries;
- a compromised or prompt-injected session can write into `lessons.md`, which every run reads;
- GitHub serves fork-network commits under the parent URL;
- parallel branches that went green on stale bases can re-land transcripts.

**Permalink tampering.** Only the exact shape passes, at an allowlisted SHA. Every entry must be a `dev` ancestor on every PR run, checked against `dev` fetched by name, so a fork SHA or a commit that exists only on a stacked parent branch fails even with its own allowlist entry. Migration permalinks pin byte-identical blobs, and render-equivalence keeps link text intact. A reviewer samples one link per class.

**Legal evidence.**
- No purge, `filter-repo`, force-push to `dev` or history rewrite, and none is proposed. Untracking is `git rm --cached` only.
- `untrack.ts --verify` proves every removed path at a byte-identical blob on a `dev` ancestor. It runs at Phases 2 and 7, and before every merge.
- **Before A merges, the owner stores an offline bundle (A13):** `git fetch origin && git bundle create <offline>/nulo-dev-<date>.bundle origin/dev && git bundle verify <file>`. It is read-only for the repo. A bare SHA is refused (F19); `origin/dev`'s history contains 9f11de70.
- The A4 scrub edits kept copies only, and waits for counsel.

**Path leaks.**
- **Untrack set:** 64 files hold home paths (945 macOS-prefix and 199 homelab occurrences). Untracking removes them from HEAD only: they stay public at 9f11de70, and the permalinks point there by design (O1). Removing them would take a history rewrite, which is a hard limit and blocked on `dev`.
- **Kept files:** 23 hold 148 more, which A4 scrubs.
- **The guard:** `check-no-local-paths.sh` misses `/mnt/<volume>/<user>`, runs only as a hook, and exempts all of `implementations-plan`. A extends it after proving 0 hits and narrows the exemption to `archive/**`.
- **In CI:** `local-path` covers the curated files, the indexes and active plan dirs, `mining.jsonl` included.

**Destructive pulls.** Pulling A deletes the ~640 files from every other checkout, the owner's main clone included. The A11 notice, the permalinks and the bundle cover this.

**CI availability (codex C3, fable F1).**
- `dev` does not require up-to-date branches (CLAUDE.md:73), so two green PRs can combine into a failing tree.
- Outside PRs the gate reports and passes; the next PR's run surfaces the finding.
- No new check name and no workflow edit. The check takes < 10 s, measured during A0's soak.

**Prompt injection via `lessons.md` and `follow-ups.md`.**
- Mined text is untrusted data. Phase 4's gate is the control: `grep -F`-checked quotes, own-words lines, a fresh verifier, a currency check, and provenance in `mining.jsonl`.
- Links may point only into `implementations-plan/` or at allowlisted permalinks.
- J is ~14 files and both curated files are exempt from `linguist-generated`, so the owner reads every line in GitHub.
- A line that tells an agent to weaken a gate (`--admin`, `--no-verify`, `continue-on-error`, force-push) is a review blocker.

**Least privilege and supply chain.** No workflow permission, secret, required-check or dependency change. The only network use is the PR-run fetch of `dev`'s commit graph under the checkout's read token. `gh` runs locally and read-only. With Bun built-ins only, the age gate and frozen lockfile are untouched. The `reference/` projects keep their own `bun.lock` (`@aztec/*` only, which Renovate disables).

**Crypto and the account freeze.**
- No crypto code changes. `vectors.json` moves by a byte-identical `git mv`.
- `derivation-vectors.test.ts` and every freeze test must pass with zero vector or pin edits. C is reviewed as a freeze-surface change.
- Nothing in `packages/wallet-crypto/src` changes except `*.test.ts` imports, which N2 does not stage (F15).

**Rollback.**
- **A:** a gate false positive gets a fix-forward PR, `quality-status` only. A full rollback is `git revert` of A's squash via PR. It restores the 640 files and drops the gate and `.gitignore` together; rebased branches conflict only on `.gitignore` and README.
- **`test.skip` on the gate:** weakens a gate (CLAUDE.md), so it needs owner sign-off.
- **C and D:** `git revert` via PR.

---

## Assumptions

### Facts (verified at 9f11de70 unless noted)
- **F1.** `test:ci-gating` = `bun test scripts/ci-cd/` (package.json:31, recursive). `_unit-tests.yml:44-45` runs it from `pr-quick.yml:211`, `release.yml:216` and `nightly.yml:161`: a 15-minute job (`:16`) on a depth-1 checkout.
- **F2.** `pr-quick.yml:73-129` fires packages on `packages/*/src/**` + `package.json`, extension on `apps/extension/**`, landing on `legal/**`, workflows on `.github/{workflows,actions}/**`, and root-config on `package.json`, `bun.lock`, `bunfig.toml`, `biome.json`, `tsconfig.json`, `.commitlintrc.json`, `.githooks/**` and `patches/**`. Smoke (`pr-extension-smoke-e2e.yml:42-72`) and network (`:48+`) fire on `apps/extension/**` (network also on `apps/playground/**`), `packages/*/src/**` and manifests. No filter lists `implementations-plan/**`, root `*.md`, `.claude/**`, `.gitattributes`, `scripts/**` or `packages/*/README.md`.
- **F3.** `check-no-local-paths.sh:5` matches `/Users/[A-Za-z]|/home/[A-Za-z]`, exempts `implementations-plan` (L13-14), and runs only from `.githooks/pre-commit:4`.
- **F4.** `.gitattributes` has 5 eol lines and no linguist attributes. No `implementations-plan/{.gitignore,.ignore,lessons.md,follow-ups.md,archive/}` exists.
- **F5.** The four patterns match 667 tracked files. `!**/lessons/**` re-includes `harden-quality-arc/round-2/lessons/audit-fixups.md`.
- **F6.** `tools-extraction/.gitignore` overrides the parent's `!**/lessons/**` (tested). `vitest-on-bun/lessons/baselines/full/.gitignore` stays allowlisted until C or #669 moves it.
- **F7.** Four tests import `key-model-v2/reference/vectors.json` (e.g. `derivation-vectors.test.ts:6`). A fifth, `scripts/publish/stage.test.ts`, is on `feat/publishable-packages`; whichever of C and tools-extraction lands second repoints it. `test-soak/cli.ts:39` pins `BASELINES_DIR`.
- **F8.** `CLAUDE.md:470` says transcripts are committed. `:460-461` sanction two plan cross-refs. `:47` runs `isolated-linker-store/tools/phantom-sweep.ts`.
- **F9.** `index.md` has 190 lines. L3 is the format line, L108 the parked `transport-ready-handshake`, L179 the unlinked `incoming-tip-first-scan`, and L190 `tools-extraction`.
- **F10.** 37 files carry an exact `^## Outcome\s*$` line (fable counted 38). Among `plan.md` files only `send-publish-ledger/plan.md:15` does, with its H1 at L13. The rest are 4 `STATUS.md` and 32 lessons logs.
- **F11.** fee6b4a2 (`feat/ux-1-first-run-wording`, not on dev) adds the 5-line `.gitignore`, the `/archive/` `.ignore`, and a conflicting README.
- **F12.** Bun's heading ids differ from GitHub's (`#troubleshooting--when-x-fails`). No slugger is installed.
- **F13.** The network suite has 0 unconditional skips, so `CI.md:219` ("18 quarantined tests") is false.
- **F14.** The repo is PUBLIC. `dev` blocks force-push and deletion, so pinned SHAs stay reachable.
- **F15.** (Driver, 2026-09-24.) N2's `stage.ts` bundles with Bun and emits declarations with `removeComments: true`.
  - A probe that added comments to `wallet-crypto/src/account-derivation.ts` left every staged file byte-identical.
  - Staged bytes change only for code, the first line of an Azguard-headed file (it becomes the banner), or a file move.
  - The staged README comes from `scripts/publish/readme/`, and `files` is `["dist","NOTICE"]` (stage.ts:227, 259).
  - The digest control is for the 0.1.0 bootstrap only.
- **F16.** Bun 1.4.2 probe (recon scratchpad): the `Bun.markdown.render` callbacks miss raw `<a href>`, both inline and in HTML blocks. `Bun.markdown.html` + `HTMLRewriter` returns all five link forms, skips code spans and fences, and yields no h2 for a fenced `## Outcome`.
- **F17.** The smallest Outcome hosts at base are 1,705 B (top-level `plan.md`), 2,662 B (nested) and 3,531 B (non-plan). Git's inexact rename matching runs only while sources × destinations ≤ `diff.renameLimit`² (default 1000).
- **F18.** `ratchetBase()` returns `null` under Actions without `GITHUB_BASE_REF`, and `origin/dev` locally. Its PR fetch fails closed (L344-348).
- **F19.** `git bundle create <file> <bare-sha>` fails: "Refusing to create empty bundle". It needs a named ref.
- **F20.** `gh stack` is v0.1.1 here. `init <branches...> [--base]` adopts existing branches; there is no `--adopt` flag. `sync` fetches, cascade-rebases and **pushes** (`--force-with-lease --atomic`) in one step, restores every branch and exits 3 on a conflict, and when non-interactive exits 0 with `Sync aborted` on a local/remote divergence. `rebase` rebases without pushing, stops on a conflict, and takes `--continue` / `--abort` (all branches). `push` is per-branch `--force-with-lease`, not atomic. Its v0.1.1 troubleshooting reference says `sync` handles a squash-merged parent with `--onto`.
- **F21.** `gh pr list` and `gh issue list` fetch 30 items unless `--limit` says otherwise.
- **F22.** `send-publish-ledger/plan.md` has front matter (L1-11), its H1 at L13 and a complete Outcome at L15.

### Inferences (attack these)
- **I1.** The classifier is fitted to today's index text. Phase 3 re-runs it and compares per dir; the owner sees every dir whose class moved.
- **I2.** The 22 promotions pick the plan of record everywhere except `e2e-stabilization` (A1).
- **I3.** GitHub pairs D's renames as local `git diff -M` does. D's pre-merge gate checks it against the complete API inventory; the split fallback covers a mismatch.
- **I4.** A and D exceed the 300-file rendered-diff limit, so they are reviewed locally (`git diff -M --stat` against the arc's parent, filtered diffs), and codex gets filtered diffs.
- **I5.** `gh stack` recovers when A0 and A squash-merge under J-D. Its docs say so (F20), but it is rehearsed before A0 opens (Phase 1), and the manual `--onto` procedure in Delivery is rehearsed too.
- **I6.** Byte-identical hygiene files let ux-feedback's add/add merge cleanly (the alt's probe). The README is the one conflict.
- **I7.** A `/mnt/<volume>/<user>` pattern has no false positives on dev. This is proved before it lands.
- **I8.** A soak of ≥ 1 nightly plus ≥ 3 PRs (A14) surfaces A0's runtime and depth-1 surprises.

### Asks: one batch for the owner (answer at the approval gate; Phase 3 hard-stops before `closures.json` if any is unanswered)

**Plan status (O2: surface, never guess).** Evidence comes from git and gh (`recon.md`) plus the 4 `STATUS.md` Outcomes.

| Ask | Plans (class) | Recommendation |
|---|---|---|
| S1 | 59 CLOSED-EVIDENCE: merged PRs, stale index text | **Closed, in bulk**. Follow-ups: harden-quality-arc Q-13, v3-followups P2, any-erc20-bridge P10 (unleashed pointer) |
| S2 | 39 legacy imports (sole commit is the 2026-05-19 import) | **"historical — pre-open-source import"**. `passkey-e2e` relocates (A7). `network-test-triage`'s stale texts are rewritten (F13). `playwright-migration` is "abandoned — Puppeteer retained" |
| S3 | authwit-lifecycle-and-execution-followups, aztec-5.0-upgrade, execution-decomposition, q3-transport-unification, required-check-mismatch, stable-release-0.26.0 | **Closed** (merged; the last two are keyword false positives) |
| S4 | chrome-store-launch, dapp-popup-cancel-focus, firefox-first-class-spike | **Closed, plus one follow-up each**: launch items; the macOS Space-switch check; a pointer to CLAUDE.md's Firefox checklist |
| S5 | aztec-5.0.1-line, key-model-v2, monorepo-restructure, quality-arc-deferred, storage-migration-framework, vitest-vite8-dedupe | **Closed** |
| S6 | proverless-network-stabilization ("Phases 0-2 ✓") | **Owner**: closed, or closed plus a remaining-phases follow-up |
| S7 | bun-1.4-adoption, composition-test-rollout, dapp-preexisting-fee, execution-pxe-injection-spike, incoming-public-transfers, key-model-v2-hardening, network-e2e-required, nightly-release, profile-fenced-execution, profile-flow-dedup-q2, release-dev-to-main | **Closed** |
| S8 | aztec-5.0.0-stable ("Phase 6 in flight") | **Superseded by aztec-5.2.0-js-line**; its `reference/` relocates |
| S9 | harden-findings-remediation (F-11 scope open) | **Closed, plus an F-11 follow-up** |
| S10 | light-theme-fix, token-identity (manual checks pending) | **Closed; the residual is dropped** |
| S11 | bridge-permit2-recipient-commitment, private-fuel, swap-fuel | **Closed; the residual is owned by unleashed** |
| S12 | account-switch-isolation (Phase 0+1 only) | **Owner**: remaining phases abandoned, or a follow-up |
| S13 | backup-restore-residuals (security-fence epic) | **Closed, plus an epic follow-up** |
| S14 | complexity-budgets (continued in rounds 2-3) | **Closed** |
| S15 | audit-448-remediation, journal-stage-restructure | **Closed** |
| S16 | transport-ready-handshake (PARKED) | **Stays in `index.md` as PARKED**; its spec rows are lifted |
| S17 | incoming-tip-first-scan (index-only proposal) | **Moves to `follow-ups.md`** |

**Design Asks** (defaults apply on "as recommended"):
- **A1. Promote the latest revision to `plan.md` in 22 dirs.** Default yes. The Earlier-revisions line lists the replaced `plan.md`. For `e2e-stabilization`, promote `plan-final.md`?
- **A2. Rename the 3 curated files the `audit-*` glob catches.** `M3/7/audit-findings.md` → `findings.md`, and `audit-response-round{1,2}.md` → `decision-ledger-round{1,2}.md`. Default yes.
- **A3. The 40 near-misses and 4 outside-tree files.** Default: out of scope, recorded in `follow-ups.md`.
- **A4. Scrub the 23 kept files and extend the guard.** Default yes, once counsel has no objection.
- **A5. Vectors.** Default: top-level `reference/`.
- **A6. The 66 comment mentions.** Default: leave them, repair the 6 broken ones, and add a "clean up on touch" line to `follow-ups.md`. Alternative: permalink all 66 (digest-safe, F15), which adds ~52 files to C.
- **A7. `PRF-NON-PORTABLE.md` → `apps/extension/tests/e2e/`.** Default yes. The CLAUDE.md rule becomes: new code cites a live doc or a permalink, never a plan path. Existing mentions stay until touched (A6).
- **A8. Link-check scope as in Mechanics.** Default yes.
- **A9. Delivery.** Default: 5 stacked squash PRs, then E and F after D merges. A0 and A each open when their own loop converges; J, C and D open after the final pass.
  - Opening A0 and A early is a recorded exception to the blueprint's "no PR before every loop" rule.
  - Both audits asked for it, so that A lands before the blueprint race and #669 widen. The final pass agrees, on two conditions the plan adopts: each opens only after its own loop, soak (A14) and bundle (A13); and a later finding that affects a merged arc blocks every further delivery until a fix-forward PR lands.
- **A10. Baselines.** Default: relocate to #669's destination if #669 has not landed.
- **A11. Informational messages to the ux-feedback, tools-extraction and vitest-5-bump sessions after A merges.** Default yes.
- **A12. `/harden`.** Default: not scheduled (docs plus a gate, no trust-boundary change).
- **A13. The owner stores the offline bundle before A merges.** Default yes.
- **A14. A merges only after A0 has run report-only in ≥ 1 nightly and ≥ 3 other PRs, with no error and < 10 s.** Default yes.
- **A15. Outcome placement and the exemplar.** Default: directly after front matter (the owner's rule) or at byte 0 without it, before the H1 in both cases; `send-publish-ledger` is grandfathered by path, the only exception. Alternatives: (b) reposition the exemplar's block (one generated edit in D, and Phase 6's "exemplar unchanged" check becomes "changed only by the move of its block"); (c) the Outcome is the first h2, with only the H1 allowed between it and the front matter, which the exemplar already meets.
- **A16. Rehearsing `gh stack` squash recovery.** Default: rehearse the manual `--onto` procedure locally against a bare `file://` remote (no GitHub), and trust `gh stack`'s documented squash handling (F20), watching the first real merge closely. Alternative: the owner allows a throwaway private sandbox repo, where the session rehearses real squash merges of a 3-branch stack before A0 opens, then deletes it.

---

## Implementation phases

**Validation layers** (real scripts): `bun run lint` (Biome + complexity baseline), `bun run typecheck:all`, `bun run test:all` (every workspace, KAT pair included), `bun run test:ci-gating`, `bun run audit:vue`, `bun run test:e2e` (smoke), `bun run e2e:agent` (network; CI covers it in C), `bun run lint:actions`, `./scripts/check-no-local-paths.sh`, and for the tools `bun test implementations-plan/plans-scaffolding/tools/`.

**Every phase:**
- logs to `lessons/phase-N.md`;
- runs `bun test scripts/ci-cd/plans/ && bun run lint` after each meaningful step.

**Every gate:**
- runs on a committed tree (codex C11): rerun checks re-run the tools after the first run is committed, and fresh-clone checks clone that commit;
- measures the arc against its actual parent, written `$PARENT` below: the lower arc's branch while it is open, `origin/dev` once it merged (`gh stack view --json` names it). So `git diff --name-status -M $PARENT...HEAD | wc -l` < 3000. Only `untrack.ts --verify` stays cumulative from `origin/dev`, because every removal across the stack needs a manifest row.

### Phase 0: rebase, refresh, coordinate (no PR)

1. `git fetch origin && git rebase origin/dev`, then record the base in front matter.
2. List in-flight work: `git branch -a --list '*ux*' '*vitest-5*' 'feat/publishable-packages'` and `gh pr list --state open`.
3. `agent-worktree status plans-scaffolding "phase 0 green: gate library"`.

**Validation gate.**
- Commands: `git status --short`; `git merge-base --is-ancestor 9f11de70 HEAD`.
- Pass: exit 0, clean tree.
- Layers: bookkeeping.

### Phase 1: the gate library, report-only (Arc A0)

Write `scripts/ci-cd/plans/{lib,links,structure,permalinks,check}.ts` and `permalink-bases.json`, with temp-repo fixtures for each case:

- **Links:** a code-span link (not a link); inline, reference-style, raw-inline and block-HTML links (all links); brace tokens.
- **Tracking:**
  - a nested `lessons/audit-x.md` (stays tracked);
  - a tracked-ignored file (`ls-files -ci`, never `check-ignore`);
  - a `!audit-*.md` appended to `.gitignore` (reds `tracked-artifact` and `hygiene-files`).
- **Permalinks:** a short SHA, a foreign owner, a non-allowlisted SHA, an entry that is not a `dev` ancestor, and an entry that is an ancestor of an unmerged parent branch but not of `dev` (it must fail).
- **A real shallow checkout:** a fixture origin (`uploadpack.allowFilter` on), cloned with `git clone --depth 1 file://…` at a PR-like merge commit. The gate's own fetch runs there and accepts a `dev` ancestor, rejects the parent-branch SHA, and fails closed when the origin is unreachable.
- **Outcomes:** a fenced `## Outcome` and `## Outcome & Quality Bar` (neither counts), and a real Outcome without "Seeds retired".
- **Budget:** `lessons.md` at 8,192 and at 8,193 B; a two-line entry; a foreign URL.
- **Mode:** `mode()` enforces locally and with `GITHUB_BASE_REF`. Under Actions without it, it reports: the summary is written and the test passes.

`tree.test.ts` is report-only in every mode. `check.ts --report` prints the baseline. Commit the plan dir and its index line.

**Stack rehearsal (I5, before A0 opens).** Against a bare `file://` remote with a 3-branch stack, simulate a squash merge of the bottom branch into trunk, then run Delivery's manual `--onto` procedure and the conflict path (`gh stack rebase`, resolve, `--continue`; and `--abort`). With A16's sandbox, also run real squash merges and `gh stack rebase` / `gh stack push` there. Log both in `lessons/phase-1.md`.

**Validation gate.**
- Commands: `bun test scripts/ci-cd/plans/`, `bun run test:ci-gating`, `bun run lint`, `time bun scripts/ci-cd/plans/check.ts --report`.
- Pass: all exit 0; every rule id has at least one passing and one failing fixture; the report finishes in < 10 s; the stack rehearsal is logged.
- Layers: unit, lint.

**Arc A0 boundary:** codex loop → wave 1a (PR A0) → `gh stack add plans-scaffolding-untrack`.

### Phase 2: hygiene, untrack, permalinks, policy (Arc A; one atomic change)

1. `tools/untrack.ts --record` writes the manifest.
2. `tools/promote.ts` (A1) runs, then the 3 renames (A2).
3. Hygiene:
   - `.gitignore` and `.ignore`, byte-identical to `git show fee6b4a2:implementations-plan/<file>`;
   - `.gitattributes` (+3 lines);
   - the stubs;
   - delete `tools-extraction/.gitignore`, and tell that session.
4. `tools/rewrite-links.ts`: 112 links in ~43 files, plus `index.md:41`, become permalinks at their manifest SHAs, with the render-equivalence proof. De-link the never-committed target and fix the doubled-dir link.
5. `tools/untrack.ts`: `git rm --cached` until `git ls-files -ci --exclude-standard -- implementations-plan` is empty.
6. `tools/scrub-paths.ts` (A4) and the guard (`/mnt/<volume>/<user>`; exemption narrowed to `implementations-plan/archive/**`).
7. Policy text, in the `.gitignore` commit:
   - CLAUDE.md §Implementation plans rewritten: verdicts inline, transcripts gitignored, uncommitted means disposable, Outcome, archive, curated files.
   - CLAUDE.md L14 and L42 (routing: cross-task gotcha → `lessons.md`, open follow-up → `follow-ups.md`), plus L456 and L692.
   - `README.md` L13, L27 and L60.
   - `implementations-plan/README.md` rewritten: the standard, the milestone key, and § "Portable rules", including the asset rule "a plan-dir file live code or CI reads is relocated before its plan is archived".
   - `CI.md:3` and `.github/README.md:3`.
8. `tree.test.ts` enforces `tracked-artifact`, `hygiene-files`, `nested-ignore`, `link-untracked`, `link-missing`, `permalink-*`, `curated-budget` and `local-path`.

**Validation gate.** Commit, then run:
- `git ls-files -ci --exclude-standard -- implementations-plan | wc -l` → `0`;
- `bun scripts/ci-cd/plans/check.ts`;
- `bun implementations-plan/plans-scaffolding/tools/untrack.ts --verify`;
- `bun test implementations-plan/plans-scaffolding/tools/`, `bun run test:ci-gating`, `bun run lint`, `./scripts/check-no-local-paths.sh`;
- rerun every Phase 2 tool, then `git status --short` (empty);
- `git clone --quiet --no-local . "$SCRATCH/ps-clone"`, then `bun scripts/ci-cd/plans/check.ts` in the clone.

Pass: all exit 0, the count is 0, and every manifest row verifies. Layers: unit, lint, repo-integrity. This proves criteria 2 and 3.

**Arc A boundary:** codex loop → wave 1b (PR A) → `gh stack add plans-scaffolding-closures`.

### Phase 3: the closure table (Arc J)

- `tools/classify.ts` ports the recon classifier. It reads a frozen snapshot committed beside it: `gh pr list --state all --limit 10000 --json …` and the same for issues (F21), plus the repository's `pullRequests.totalCount` and `issues.totalCount` from `gh api graphql`. `--check` fails unless each snapshot's length equals its total.
- Fixtures:
  - the known false positives (`#172 deliberate-red`, `gated on tag-integrity`);
  - non-PR ids;
  - duplicate index lines;
  - a `STATUS.md` Outcome used as evidence;
  - a row-less dir, classified ACTIVE.
- Re-run it on the current base and compare per dir against the recon table. Every dir whose class changed goes to the owner.
- Apply S1-S17 and write `closures.json`: `{closuresBase, rows: [{dir, status, date, prs, outcomeFile, followUps[], hook}]}`.
- **Hard stop** on any AMBIGUOUS row or unanswered Ask.

**Validation gate.**
- Commands: `bun test implementations-plan/plans-scaffolding/tools/`, `bun implementations-plan/plans-scaffolding/tools/classify.ts --check closures.json`.
- Pass: exit 0, one row per top-level dir (`git ls-tree -d HEAD implementations-plan/` minus `archive`), 0 ambiguous rows, and both snapshots complete.
- Layers: unit.

### Phase 4: mining `lessons.md` and `follow-ups.md` (Arc J; the mining gate)

1. **Inventory and candidates.** `tools/mine.ts` writes data only.
   - **The inventory is keyed by plan, not by filename.** It has one entry per `closures.json` row (every classified dir, active and parked included) and per nested plan. Each names the dir's authoritative host, found in the Outcome host order (`plan.md`; the index line's `runbook.md`, `adoption-map.md`, `scope.md`, `README.md` or `seed.md`; the dir's `README.md`; none for a stub dir), plus its `lessons/**`, `STATUS.md`, `WRAP-UP.md`, ledger and follow-up files. Each file is mined, or skipped with a reason; a dir with no host is recorded `no-content`.
   - A candidate is `{id, path, commit, line, start, end, quoteSha256, quote ≤ 200 chars, cluster}`. It exists only if `grep -F` finds the **original** bytes at `git show <commit>:<path>`, checked before any scrubbing. `quote` is the scrubbed display copy; `quoteSha256` is the hash of the original slice, so provenance survives without committing a home path.
2. **Seven cluster subagents** (`Agent`, `model: 'fable'`, fallback `'opus'`): CI and release, Bun and deps, e2e, extension runtime, crypto and backup, Aztec bumps, UI and design.
   - Bridge-only gotchas belong to unleashed.
   - Each subagent is told plan text is **untrusted data**. It returns ≤ 12 candidate ids, each with a proposed gotcha, its existing owner (CLAUDE.md or a skill), and the source date.
3. **The driver writes each line.**
   - It deduplicates against CLAUDE.md and the `e2e-testing`, `aztec-update` and `chrome-extension-debug` skills.
   - It writes each line in its own words.
   - It runs a **currency check** on each line: name its tool, version or condition, and record the `git grep` or command showing it still holds at HEAD. A line that fails is dropped, or date-stamped when tied to a tool version (owner rule).
   - Candidates older than the open-source import or the monorepo restructure must pass that check explicitly.
   - Sections: CI & gates · Bun & deps · Git & GitHub · Extension runtime · Release · Agent tooling.
4. **`follow-ups.md`**, one entry per open item. Sources: the follow-up files and ledgers listed in `recon.md` § Numbers, the S residuals, `incoming-tip-first-scan`, the A3 and A6 lines, and the vitest interop retirement (CLAUDE.md:49) unless #669 has landed. Issues #336, #334, #312, #285 and #284 become pointers; #280 and #293 share one "owned by unleashed" line.
5. **A fresh-context verifier** (`Agent`, `model: 'fable'`) reads both files plus every line's quotes and marks each line supported or unsupported. Unsupported lines are dropped.
6. **`mining.jsonl`** holds the inventory, the candidates, every verdict (subagent, driver, currency, verifier) and each accepted line's exact text.
7. **Index moves.** Write `transport-ready-handshake/spec-rows.md` and repoint its index line. Drop the `incoming-tip-first-scan` line.

**Validation gate.**
- Commands: `bun implementations-plan/plans-scaffolding/tools/mine.ts --verify`, `bun scripts/ci-cd/plans/check.ts`, `wc -c implementations-plan/lessons.md`, `bun run test:ci-gating`, `bun run lint`.
- `mine.ts --verify` requires all of:
  - every `closures.json` row and nested plan has an inventory entry whose host matches the Outcome host order (the O3 reconciliation: plan coverage, not filename coverage);
  - every candidate's original slice at `commit:path` hashes to `quoteSha256`, and scrubbing it yields `quote`;
  - every entry in both files equals an accepted candidate's text and carries a verifier "supported" verdict;
  - every `followUps` id has an entry.
- Pass: all exit 0, and `lessons.md` ≤ 8192 B.
- Layers: unit, repo-integrity. This proves criterion 1.

**Arc J boundary:** codex loop (plus: injected or gate-weakening lines, wrong closures, unsupported follow-ups) → `gh stack add plans-scaffolding-repoints`.

### Phase 5: relocate assets, repair broken mentions (Arc C; fires both e2e suites)

1. Re-count the importers: `git grep -n 'key-model-v2/reference' -- ':!implementations-plan'` should show 4, or 5 if tools-extraction has landed.
2. `git mv` the assets:
   - the 3 `reference/` projects → `reference/<plan>/`;
   - `phantom-sweep.ts` → `scripts/`;
   - `PRF-NON-PORTABLE.md` → `apps/extension/tests/e2e/`;
   - the baselines → `scripts/ci-cd/test-soak/baselines/`, updating `cli.ts:39`. If #669 already did the move, verify its files and the `cli.ts` consumer instead.
3. Edit the KAT import paths.
4. Repair the 6 mentions: the transcripts get manifest permalinks, and `embedded-fpc-cap.ts:64` points at the promoted `plan.md`.
5. Stale texts:
   - network-test-triage in `CI.md:219`, CLAUDE.md:461 and `vitest.e2e.network.config.ts:37`;
   - CLAUDE.md L47 and L459-461 (A7);
   - `legal/README.md:68` and `third-party-notices/README.md:113` → `follow-ups.md`;
   - the wallet-crypto README and `PROVENANCE.md:29` → `reference/`.
6. Add `"check:plans": "bun scripts/ci-cd/plans/check.ts"`. Turn on `path-token` for code and config only (the lenient mode; docs follow in Phase 7). Shrink the `nested-ignore` allowlist.

**Validation gate.** Commit, then run:
- `git diff -M100% --diff-filter=R --stat $PARENT...HEAD -- reference scripts apps/extension/tests/e2e`: every moved asset is R100;
- `git diff --name-only $PARENT...HEAD -- packages/wallet-crypto/src ':!*.test.ts'`: empty, so N2's staged bytes are unchanged (F15);
- `bun run test:all`: zero vector or pin edits;
- `bun run typecheck:all`, `bun run audit:vue`, `bun run test:ci-gating`, `bun run lint`, `bun run lint:actions`;
- `bun scripts/phantom-sweep.ts`, `bun test scripts/ci-cd/test-soak/`, `bun run check:plans`, `bun run test:e2e`.

The network e2e runs as the PR's required check. Pass: all exit 0, and `git diff $PARENT...HEAD -- '*.json' ':!package.json'` shows only renames (against `origin/dev` it would also show J's `closures.json` and A's manifest while those arcs are open). Layers: typecheck, lint, unit, smoke locally, network in CI.

**Arc C boundary:** codex loop (freeze-surface review) → `gh stack add plans-scaffolding-archive`.

### Phase 6: Outcome blocks and seed retirement, in place (Arc D, first commit)

1. Refresh the base: `gh stack rebase`, then the lower arcs' gates, then `gh stack push` (Delivery § Stack operations).
2. Re-run `untrack.ts --dry-run` (and `--record` if anything new landed), then `classify.ts --check` with the concurrency re-check.
3. `tools/outcome.ts` writes the top-level and nested Outcomes, the seed lines and the stubs, and repairs incomplete blocks.

**Validation gate.** Commit, then run:
- `bun implementations-plan/plans-scaffolding/tools/outcome.ts --verify`: every closed host has one complete, real `## Outcome` placed per A15 (the exemplar per A15's answer), and no ACTIVE or PARKED dir changed;
- `outcome.ts` again, then `git status --short` (empty);
- `git diff $PARENT -- implementations-plan/send-publish-ledger/plan.md`: empty under A15's default or (c); under (b), only the block's move;
- `bun scripts/ci-cd/plans/check.ts`, `bun run test:ci-gating`, `bun run lint`.

Pass: all exit 0. Layers: unit, repo-integrity.

### Phase 7: archive move, index split, repairs (Arc D)

1. `tools/archive-move.ts`: `git mv` every closed dir, in its own commit with no content edits.
2. `tools/split-index.ts`: `index.md` keeps its header, format line and active lines verbatim (tools-extraction, transport-ready-handshake PARKED, plans-scaffolding, anything newer). `archive/index.md` is generated.
3. `tools/repair-links.ts`: apply the map to the moved files, `lessons.md`, `follow-ups.md`, the audit and research links, and the live docs:
   - CLAUDE.md L49, 71, 75, 86, 104, 109, 114, 137, 215, 517, 540 and 577;
   - `CI.md`, `ARCHITECTURE.md`, `SECURITY.md`, `UPDATE.md`;
   - e2e-testing SKILL.md L379, 410, 528, 541, 562, 638-644 and 699-704, and the aztec-update SKILL.md;
   - `.github/README.md:7`.
4. Turn on strict `path-token` for docs, `index-structure` (with its "closed, awaiting archive" rule), `archive-structure`, and the full `link-missing` check for active plan dirs.

**Validation gate.** Commit, then run:
- `bun implementations-plan/plans-scaffolding/tools/archive-move.ts --verify` (fidelity proof);
- `bun run check:plans`, `bun run test:ci-gating`, `bun run lint`, `./scripts/check-no-local-paths.sh`;
- `bun implementations-plan/plans-scaffolding/tools/untrack.ts --verify` (evidence re-proof);
- `split-index.ts` and `repair-links.ts` again, then `git status --short` (empty).

Pass: all exit 0. Layers: unit, lint, repo-integrity. This proves criteria 1, 2 and 4.

**Arc D boundary:** codex loop → final cross-arc pass → wave 2.

---

## Delivery

**Topology: 5 stacked squash PRs via `gh stack`, in two waves, plus 2 close-out PRs.**
- Setup: `gh stack init --base dev worktree-plans-scaffolding` (it adopts the existing branch; F20), then `gh stack add <branch>` at each arc boundary.
- `code_review` is **off** on every arc.

| PR | Phases | Branch | Opens | Title (≤ 93 chars) | Files (≈) | Paths-filters fired |
|---|---|---|---|---|---|---|
| A0 gate | 1 | `worktree-plans-scaffolding` | wave 1a, after its loop | `ci(plans): add the plan-tree gate in report-only mode` | 16 | none: `quality-status` only |
| A untrack | 2 | `plans-scaffolding-untrack` | wave 1b, after its loop; merges after the soak (A14) and bundle (A13) | `chore(plans): untrack plan transcripts behind hygiene rules and enforce the tree gate` | 780 (≈640 D) | none: `quality-status` only |
| J judgement | 3-4 | `plans-scaffolding-closures` | wave 2 | `docs(plans): record plan closures and seed lessons.md and follow-ups.md` | 14 (owner reads 5) | none: `quality-status` only |
| C repoints | 5 | `plans-scaffolding-repoints` | wave 2 | `chore(plans): relocate plan-dir assets that code and ci read` | 65 (≈40 if #669 moved the baselines) | core-foundation, aztec-runtime, extension, landing (`legal/**`), root-config → builds + **smoke and network e2e** (≈25 min) + advisory Firefox |
| D archive | 6-7 | `plans-scaffolding-archive` | wave 2 | `chore(plans): archive closed plans with outcome blocks and split the index` | 1,460 (≈1,400 R, ≈330 edited) | none: `quality-status` only |
| E close | — | `plans-scaffolding-close` | after D merges | `docs(plans): close plans-scaffolding` | 4 | none |
| F self-archive | — | `plans-scaffolding-archive-self` | after E merges | `chore(plans): archive plans-scaffolding` | 25 | none |

**Why two waves (A9).**
- A0 needs to soak before A enforces.
- A stops three things: the blueprint race (every concurrent `/blueprint` half-migrating its own branch), #669's transcript re-land, and ux-feedback's add/add.
- Implementation never waits for a merge: J-D build on the unmerged stack, and Stack operations rebase them once A0 and A land (I5).
- A final-pass finding against a merged A0 or A blocks every further delivery until its fix-forward PR (on the lowest open arc) merges.

**Stack operations (final pass 1).** Never `gh stack sync` here: it pushes before anything is validated (F20).
1. Record every arc's tip and its parent's tip (`git rev-parse`) in `lessons/phase-N.md`.
2. `gh stack rebase`. On a conflict (exit 3): resolve, `git add`, `gh stack rebase --continue`; or `gh stack rebase --abort`, which restores every branch.
3. Run each rebased arc's pre-merge gate (below), bottom-up.
4. `gh stack push` (per-branch `--force-with-lease`, this plan's own branches only). A rejected branch is fixed and pushed again; the others are unchanged.
5. **Manual fallback**, when `gh stack` cannot recover: bottom-up, `git rebase --onto <new parent tip> <old parent tip> <branch>`, where a squash-merged parent's new tip is `origin/dev` and its old tip is the one recorded in step 1 (so its commits are never replayed). Then step 3, then `git push --force-with-lease=<branch>:<old tip> origin <branch>` per branch, then `gh stack init --base dev <remaining branches>` to re-adopt them.

**Before every merge (codex C8, final pass 5).** `dev` is not strict, so a PR that went green on an old base can merge into a broken tree. Before the owner merges any PR here, the session refreshes the base (Stack operations 1-4), then runs **that arc's** gate in a clean clone checked out at the PR's head (`gh pr view <n> --json headRefOid`), never whichever branch happens to be checked out, and posts the output in the PR:

| Arc | Pre-merge gate |
|---|---|
| A0 | `bun test scripts/ci-cd/plans/`, `bun run test:ci-gating`, `bun run lint`, `bun scripts/ci-cd/plans/check.ts --report` (no `untrack.ts` exists yet) |
| A | Phase 2's gate, fresh clone included; the soak (A14) and the bundle (A13) confirmed |
| J | `check.ts`, `untrack.ts --verify`, `classify.ts --check` with the drift check against the refreshed base (owner adjudication for any drifted dir), `mine.ts --verify` |
| C | Phase 5's gate against `$PARENT`, then `check.ts` and `untrack.ts --verify` |
| D | D regenerated on the refreshed parent (Mechanics § Concurrency); the drift check and any owner adjudication; `mine.ts --verify`; `outcome.ts --verify`; `archive-move.ts --verify` against `$PARENT`; the complete API enumeration reconciled with the move map; `check.ts`; `untrack.ts --verify` |
| E | `check.ts` (the "closed, awaiting archive" line included), `bun run lint` |
| F | `repair-links.ts` for the moved dir, then `check.ts`, `untrack.ts --verify` from its archived path, `bun run test:ci-gating` |

The owner merges only on a green re-run. Merging is always the owner's call.

**Merge order vs other branches.** The plan holds in either order.

- **ux-feedback** (fee6b4a2). Ideally A lands first. The byte-identical hygiene files merge cleanly, and the README conflict resolves to dev's version. That session re-adds its index line after D. If it lands first instead, A's hygiene step is a no-op and A's README replaces the "older plans keep their transcripts" line.
- **#669** (owner-parked). No arc depends on it. If it lands before A, its transcripts become new manifest rows, and C verifies its baseline move (files and consumer). If it lands after A, `tracked-artifact` reds it until it runs `git rm --cached`; PR A's body says so.
- **tools-extraction.** A deletes its nested `.gitignore`, and `nested-ignore` catches a re-add. D keeps its L190 line verbatim. Whichever of C and tools-extraction lands second repoints `stage.test.ts` (F7). C edits no staged source (F15), so the digest needs no re-approval.
- **Unleashed B4** mirrors § Portable rules. `live-intent.ts` (6611f861, L171-174) reads `intent.json` under four plans' `lessons/`, so in unleashed those plans stay active or the reader is repointed first (the asset rule).
- **Parallel `/blueprint` sessions** get the rebase note after A merges (A11).

---

## Post-implementation

In order. No `/code-review`: `code_review` is `off`.

1. **Codex audit (`/codex high`) at each arc boundary (A0, A, J, C, D)**, before delivery or `gh stack add`. Send:
   - the arc's diff against `$PARENT` (A and D: `git diff -M --stat`, the non-rename/non-delete diff, the tools' source and the gate output);
   - plan.md and the decision ledger;
   - the arc map ("arc N of 5; later arcs build <X> on it");
   - the adversarial ask: *"What could go wrong? What would an attacker target? What are we trusting that we shouldn't? Where are the supply-chain / crypto / least-privilege weaknesses?"*;
   - the arc-specific asks: A0 bypasses and the mode switch; A permalink tampering and the manifest; J injection, wrong closures and unsupported follow-ups; C the freeze surface, filters and N2; D rename fidelity and links;
   - the two rules below, verbatim.
2. **Iterative fix loop.**
   1. Verify codex's factual claims against the repo, and apply the accepted fixes.
   2. Commit, and log the round (consult and verdict) in `lessons/phase-N.md`.
   3. **Resume the same codex session** with the fix diff.
   4. Repeat until a round yields no new material findings; rejected nitpicks don't count. Still material after 3 rounds: stop and surface to the owner.
3. **Wave 1 delivery.** When A0's loop converges, `gh stack submit --auto` opens PR A0 alone; then `gh pr edit <n> --body-file …` and `gh pr checks <n> --watch`. Repeat when A's loop converges (PR A).
4. **Final cross-arc pass**, after D's loop. Open a FRESH codex session with the net diff from the plan baseline, A0 through D, merged arcs included (a stat plus filtered diffs).
   - Ask about seams between arcs, duplication across arcs, and drift from the plan.
   - Run the same loop until clean. Fixes land on the lowest open arc.
5. **Wave 2 delivery**: the first time J, C and D open.
   - Stack operations 1-3 (rebase, gates), then `gh stack submit --auto` (it pushes), then a `gh pr edit` body for each: the stat summary, the gate output, and the evidence note (manifest and base SHA), ending with the attribution line.
   - Then `gh pr checks --watch`.
   - Owner review points: J (`closures.json`, `lessons.md`, `follow-ups.md`) and C (the imports).
   - The pre-merge re-run precedes every merge.
6. **Close-out after D merges** (outside the `/goal` and `/loop` scope).
   - **PR E** (closing steps 1-3):
     - this plan's `## Outcome`, directly after its front matter, listing the merged PRs;
     - its `index.md` line's status becomes exactly `closed, awaiting archive`, which `index-structure` requires once the Outcome exists;
     - its generalizable gotchas → `lessons.md` (deduplicated, within budget);
     - its open items → `follow-ups.md`.
   - **PR F**, after E merges:
     - `git mv implementations-plan/plans-scaffolding implementations-plan/archive/plans-scaffolding`, and its index line → `archive/index.md` in the generated format;
     - `repair-links.ts` with a one-row map: the dir's own relative links gain a level, and the links into it (curated files, indexes, live docs) are re-pointed;
     - F's pre-merge gate (the table above).
   - Then suggest `agent-worktree done plans-scaffolding`.
   - The Outcome comes only after every authorized step, so the `/loop`'s Outcome check can never stop unfinished work.

**No-over-engineering rule** (verbatim in every post-impl codex prompt): *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*

**Comment-quality rule** (verbatim in every post-impl codex prompt): *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*

**Hard limits:**
- No purge, no history rewrite of `dev` or `main`, and no force-push to a branch another human touches. `gh stack push`'s per-branch `--force-with-lease` (or the manual fallback's) on this plan's own arcs is fine. No `gh stack sync`.
- No merging.
- No change to required checks or workflow permissions.
- No new dependency.
- No scope beyond this plan (the A3 near-misses stay out).
- This plan's own Outcome is written only in PR E.
- Failure policy: 3 failures on a step when a human drives, 5 under `/loop`; then stop and reassess with codex.

**Post-implementation hardening:** not scheduled (A12). **UI impact: none.** The plan changes docs, plans, a CI gate, test import paths and six code comments. No user-visible surface changes, so owner UI sign-off does not apply.

---

## Audit verdicts

- **Codex (`/codex high`, 2026-09-24): changes needed** (high confidence, 12 findings). Rev 2 adopts 11. C9 is partly adopted: the driver's N2 probe settled the digest question. The changes are the blob-identity manifest, enforced ancestry, report-only mode outside PRs, the bypasses closed, heading-based Outcomes, wave delivery with close-out PR E, a map-driven archive proof, the pre-merge re-run, the mining inventory and commit-first gates.
- **Fable (Plan agent, Fable 5.1, 2026-09-24): conditional approve** (8 findings plus proportionality, mining and rollback). Rev 2 adopts the A0 → A → J restructure with Outcomes folded into D (checked, F17), mining (i)-(v) as Phase 4's gate, the bundle (A13), new dirs defaulting to ACTIVE, and mentions staying as mentions. The `test.skip` rollback is adopted only with owner sign-off.
- **Final fresh-context codex pass (`/codex high`, 2026-09-24): changes needed** (high confidence, 7 findings; it judged the report-only isolation, rendered-link extraction, atomic untracking, blob preservation, offline backup and asset relocation sound, and seven PRs defensible). Rev 3 adopts all seven after checking their facts (F20-F22, `gh-stack` v0.1.1's command and troubleshooting references, both permalink bases being `dev` ancestors):
  1. **Stack commands** (adopted): `init --base` instead of the nonexistent `--adopt`; rebase → validate → push, never `sync`; a recorded-SHA `--onto` fallback; a rehearsal before A0 opens (A16 for a GitHub sandbox).
  2. **Outcome state** (adopted): "closed, awaiting archive" in `index-structure` for E → F; the exemplar resolved explicitly (A15, default grandfathered); F repairs links and reruns the gates.
  3. **Permalink ancestry** (adopted, simplified): every entry checked against `dev` fetched by name on every PR run, so there is no old allowlist to fetch and the initial entries are validated when enforcement starts; a real shallow-checkout fixture with an unmerged parent SHA.
  4. **Mining coverage** (adopted): inventory keyed by `closures.json` row and authoritative host; `--limit` plus `totalCount` completeness; quotes hashed on their original bytes before scrubbing.
  5. **Pre-merge concurrency** (adopted): per-arc pre-merge gates in a clean clone at the PR head, A0's included; D regenerated rather than rebased, with a drift report.
  6. **Acceptance commands** (adopted): every arc measured against `$PARENT`; complete paginated API enumeration reconciled with the move map before D merges; split fallback.
  7. **Assumptions** (adopted): I3, I5 and O3 reconciliation each get a concrete check before the step they guard.

---

## Decision ledger

**Decisions**

| # | Decision | Source | Rejected alternative (why) | Status |
|---|---|---|---|---|
| L1 | Main outline, restructured to A0 → A → J → C → D, then E/F | main, fable Fa/Fc, codex | The alt (freeze in place, 2 PRs): violates O2 and O3; both audits agree | adopted |
| L2 | Offline gate: enforces on PRs and locally, reports elsewhere | codex C3, fable F1, alt | Fatal everywhere: dev isn't strict, so a docs slip could red nightly or release | adopted |
| L3 | Source mentions stay; the 6 broken ones are repaired | fable F2(c), alt | Permalink all 66: digest-safe (F15) but 52 files | pending owner (A6) |
| L4 | Promote revisions before untracking | recon | Untrack all `plan-*.md`: 8 plans vanish | pending owner (A1) |
| L5 | Top-level `reference/` | recon | `packages/wallet-crypto/vectors/`: package tree and Biome scope | pending owner (A5) |
| L6 | Outcomes ride with the move in D | fable Fa, checked (F17) | The draft's B: a 350-file PR mixing judgement and mechanics | adopted; fallback if `--verify` finds unpaired files |
| L7 | Wave-1 early delivery of A0 and A, each after its own loop, soak and bundle; a later finding on a merged arc blocks further delivery | codex C6, fable Fc, alt, final pass | The blueprint's "no PR before all loops" | pending owner (A9) |
| L8 | Outcome after front matter (or at byte 0), before the H1; the exemplar grandfathered by path | codex C5, final pass 2 | Reposition the exemplar; "first h2, only an H1 between" | pending owner (A15) |
| L9 | "Closed, awaiting archive" as a gate-checked index state between E and F | final pass 2 | Outcome and move in one PR: breaks the owner's two-step closure while a `/loop` reads the live path | adopted |
| L10 | Every allowlist entry checked against `dev`, fetched by name, on every PR run | final pass 3 | Additions only, against `base.sha`: accepts parent-arc SHAs and needs the old allowlist in a depth-1 checkout | adopted |
| L11 | `gh stack rebase` → gates → `gh stack push`; recorded-SHA `--onto` fallback | final pass 1, F20 | `gh stack sync` (pushes before validation); `init --adopt` (does not exist) | adopted |
| L12 | Per-arc pre-merge gates in a clean clone at the PR head; D regenerated on a refreshed base | final pass 5 | One shared re-run of `check.ts` and `untrack.ts --verify` | adopted |
| L13 | Arc sizes and diffs against `$PARENT`; complete API enumeration for D | final pass 6 | `origin/dev...HEAD`, which counts unmerged lower arcs | adopted |
| L14 | gh-stack squash rehearsal: local `--onto` rehearsal, GitHub sandbox only with owner consent | final pass 7 | Trusting the docs alone | pending owner (A16) |

**Findings**

| Id | Finding | Verdict | Where / why |
|---|---|---|---|
| C1 | Existence isn't preservation | adopted | `{path, sha, blob}` manifest: byte identity, coverage, append-only |
| C2 | A PR can add a fork SHA plus its allowlist entry | adopted | `permalink-ancestry` on PRs that add entries; offline elsewhere |
| C3 | A docs typo can red release or nightly | adopted | `mode()` reports outside PRs (F18) |
| C4 | `!audit-*.md` bypass; raw `<a href>` missed; rewrite unspecified | adopted | Canonical patterns + negation ban; HTML pipeline (F16); render-equivalence |
| C5 | Outcome detection, fields, placement, nested status, live plans | adopted | Real-h2 detection, required fields, in-block repair, A15, active/parked refusal |
| C6 | Delivery contradicts "A first"; own Outcome stops `/loop` early | adopted | Two waves; this plan's Outcome only in PR E, after D merges |
| C7 | D isn't R100; squash erases commit boundaries; one `--follow` sample | adopted | Explicit map; per-pair proof (R100 or re-derived) |
| C8 | Stale green branches; bucket counts; index text; #669 | adopted | Pre-merge re-run; per-dir re-check; verbatim active lines; #669's files and consumer verified |
| C9 | Fifth consumer; digest risk in production comments | partially adopted | Fifth importer added (F7). The digest risk is void: comments never reach staged bytes (F15), and C edits no staged source |
| C10 | Mining coverage; injection controls; dates, 300 B limit and denylist exceed the standard | adopted | Inventory, provenance, verifier, same scrutiny on follow-ups; the three extras dropped |
| C11 | Clone before commit; rerun check; fixed index ceiling | adopted | Commit-first gates; `index-structure` replaces `≤ 10` |
| C12 | F2 misses `.commitlintrc.json`; the alt is 2 PRs; I5 stale | adopted | F2 fixed; trade-offs reworded; F15 replaces I5 |
| F1 | "Passed its PR" ≠ passes on release | adopted | As C3 |
| F2 | N2 risk misattributed; option (c); fifth import | partially adopted | Option (c) is A6's default and the import is added. No src file list for tools-extraction: C edits no staged source (F15) |
| F3 | F10 wrong: 38 exact Outcomes | adopted | Restated (37 on recount); STATUS.md used as evidence, plus a fixture |
| F4 | Base pin can freeze a stale copy; fetch proves no ancestry | adopted | Subsumed by C1's blob identity; `permalink-object` dropped |
| F5 | Promotion orphans the old `plan.md` | adopted | Earlier-revisions line includes it |
| F6 | Evidence depends on GitHub | adopted | A13 bundle of `origin/dev` (F19) |
| F7 | New dirs hard-stop D | adopted | Default ACTIVE |
| F8 | Denylist is only a tripwire | adopted | Dropped outright (C10) |
| Fa | Fold Outcomes into the move; small judgement PR | adopted | D and J; checked via F17 |
| Fb | Mining 500:1 needs (i)-(v) | adopted | Phase 4's gate |
| Fc | A is the riskiest step: A0, bundle, revert | partially adopted | A0 and the bundle adopted; `test.skip` needs owner sign-off (CLAUDE.md quality gates) |
| X1 | `--adopt` does not exist; `sync` pushes before validation; recovery unspecified | adopted | L11, F20, Delivery § Stack operations, Phase 1 rehearsal |
| X2 | Placement vs the exemplar; E's Outcome under an active index line; F's links | adopted | L8, L9, A15, PR F steps |
| X3 | Ancestry against `base.sha` on stacked PRs; old allowlist at depth 1; initial entries | adopted | L10, Phase 1 shallow-checkout fixture |
| X4 | Filename coverage ≠ plan coverage; 30-item `gh` lists; scrubbed quotes | adopted | Phase 3 snapshots, Phase 4 inventory and quote hashes |
| X5 | Pre-merge drift, generated vs upstream edits, the arc actually merged; A0's gate | adopted | L12, Mechanics § Concurrency, Delivery table |
| X6 | 300-file render and 3,000-file API limits; `origin/dev...HEAD` includes lower arcs | adopted | L13, `$PARENT`, D's API reconciliation |
| X7 | I5, O3 and F17/I3 need checks before damage | adopted | Phase 1 rehearsal, Phase 4 `--verify`, D's pre-merge gate |

**Still disputed** (the final pass's sides recorded; the owner decides)
- **Outcome placement.** Final pass: follow the after-front-matter rule, byte 0 before the H1 without front matter, and resolve the exemplar explicitly. Rev 3's default grandfathers it (A15).
- **Denylist.** Fable would keep it as a tripwire; codex (both passes) calls it unjustified: provenance and human review carry the control. It stays dropped; the owner may restore it.
- **Early wave-1 delivery** (A9). Final pass: approve as an explicit exception after each arc's own reviews, soak and bundle gate, with later findings on merged arcs blocking further delivery. Rev 3 adopts those conditions.
- **The 66 mentions** (A6). Final pass: leave the valid ones, repair the six broken references, record cleanup-on-touch. That is A6's default.

---

## Seeds (DRAFT — finalized after approval)

ELI5 Artifact: https://claude.ai/artifact/APE6BrLDXTog5iaUSJ42bm (`eli5_mode: artifact`; its source stays off-repo, in the session scratchpad).

**Recommended: `/goal`.** Completion shows in the transcript: gate outputs, `gh stack view`.

```
/goal All phases 0–7 marked ✓ in implementations-plan/plans-scaffolding/plan.md (the phase headers in the file, not the chat or task list), each ✓ backed by that phase's validation gate as written in plan.md reported passing in the transcript; for each phase the agent printed `LESSONS_FILE=implementations-plan/plans-scaffolding/lessons/phase-N.md`; `/code-review` was NOT run (code_review: off); the codex fix loop converged at each of the 5 arc boundaries (A0 gate, A untrack, J judgement, C repoints, D archive) and in the final fresh-context cross-arc pass, each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; the owner's S1–S17 and A1–A16 answers are recorded in plan.md before Phase 3 ran; PRs A0 and A were each opened only after their own arc loop converged and PRs J, C, D only after the final cross-arc pass (`gh stack view` output in the transcript); `git ls-files -ci --exclude-standard -- implementations-plan` printed nothing, and `bun scripts/ci-cd/plans/check.ts`, `untrack.ts --verify`, `archive-move.ts --verify`, `bun run test:ci-gating`, `bun run test:all` and `bun run lint` all reported exit 0 in the transcript. Never purge, rewrite dev's history, merge, or write this plan's own Outcome block (that is close-out PR E, after D merges).
```

**Alternative: `/loop`.** Use exactly one per session; they do not compose.

```
/loop 15m Drive implementations-plan/plans-scaffolding forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/plans-scaffolding/plan.md and lessons/ (authoritative, not the chat), including Outcome & Quality Bar. If that path is gone, look for implementations-plan/archive/plans-scaffolding/plan.md: the plan closed, STOP and say so. If plan.md has a real `## Outcome` heading (exactly that text, not "Outcome & Quality Bar"), it is closed: STOP. Task list empty? Rebuild it from the phase headers. Run `git status`, `git log --oneline -5`, `gh stack view`; with PRs open, `gh pr view --json statusCheckRollup` per PR.
2. Waiting on CI is fine (Arc C's network e2e takes ~25 min). Confirm progress with `gh run watch <id>` up to 10 min; stuck → inspect logs, log as blocked. Never wait for a merge: J–D build on the unmerged stack. Use waits to review the diff or prep the next phase.
3. No task in hand? Take the next pending step. After each meaningful edit run `bun test scripts/ci-cd/plans/ && bun run lint` (plus `bun test implementations-plan/plans-scaffolding/tools/` when tools changed). Commit (conventional, lower-case, signed) → `gh stack push`. If dev or a lower arc moved: plan.md § Stack operations (record tips, `gh stack rebase`, each arc's pre-merge gate, then `gh stack push`). Never `gh stack sync`.
4. Stuck, or facing a decision you'd bring to me? `/codex high` with full context until you reach a defensible decision; log consult + verdict in lessons/phase-N.md. Never crossed: an unanswered S/A Ask (Phase 3 hard stop: surface and hold), `gh stack sync`, purge or history rewrite of dev, merging, required-check or workflow-permission changes, new dependencies, scope beyond plan.md, writing this plan's own Outcome (PR E only).
5. Same step failed 5 times? Stop, reassess with codex, continue on the agreed path.
6. Phase green = its validation gate in plan.md passes (commit first; commands + pass criteria). Paste the result, mark ✓, write the lessons entry, print `LESSONS_FILE=…/phase-N.md`, `agent-worktree status plans-scaffolding "phase N green: <next>"`. Arc boundary (after phases 1, 2, 4, 5, 7)? Run the codex loop on the arc diff (`/codex high`, arc map, adversarial + arc-specific asks, the plan's no-over-engineering and comment-quality rules, resume until no material findings; no /code-review: code_review is off). After A0 and A: wave-1 delivery (`gh stack submit --auto`, `gh pr edit` body, `gh pr checks --watch`). Then `gh stack add <next-arc-branch>`.
7. All phases ✓? Final cross-arc pass: FRESH `/codex high` session over the net diff A0–D (stat + filtered diffs), cross-arc ask + both rules, loop until clean. Then wave-2 delivery per plan.md: Stack operations 1-3, `gh stack submit --auto`, `gh pr edit` bodies, `gh pr checks --watch`. Wrap-up: what shipped, every contested decision codex and I debated (ELI5: question, options, why ours), open items, the pre-merge re-run and the post-merge close-out (PRs E, F). Surface and stop.
Keep the native task list current (TaskUpdate); plan.md stays the source of truth.
```
