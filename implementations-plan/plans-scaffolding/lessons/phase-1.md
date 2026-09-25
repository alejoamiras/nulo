# Phase 1: the gate library, report-only (Arc A0)

**2026-09-25, green.**

## What landed

`scripts/ci-cd/plans/`:

- `lib.ts`: the leaf module, holding the rule ids, the canonical shapes, index-only git access (`GIT_NO_LAZY_FETCH=1`), `mode()`, the index parser and the step summary.
- `links.ts`: link extraction via `Bun.markdown.html` → `HTMLRewriter`, `resolveHref`, `link-untracked`, `link-missing` and `path-token`.
- `permalinks.ts`: `permalink-shape`, `permalink-base` and `permalink-ancestry`.
- `structure.ts`: `tracked-artifact`, `hygiene-files`, `nested-ignore`, `index-structure`, `archive-structure`, `curated-budget` and `local-path`.
- `check.ts` and `permalink-bases.json` (9f11de70 and 6611f861).
- `fixture-repo.ts` and five test files. `biome.json` includes the new dir.

Fixtures per rule. "pass" and "fail" are the fixture repos with no finding and with a finding:

| Rule | Tests | Pass | Fail |
|---|---|---|---|
| tracked-artifact | 3 | clean tree; nested `lessons/audit-x.md` | tracked transcript; tracked-ignored (`ls-files -ci`); `!audit-*.md` appended |
| hygiene-files | 3 | canonical pair | both files missing; `!audit-*.md` appended |
| nested-ignore | 2 | the allowlisted `vitest-on-bun` baseline ignore | a nested `.gitignore` |
| link-untracked | 2 | lessons file with a transcript name; a transcript's own links | a kept file linking `audit-codex.md` |
| link-missing | 3 | live doc whose targets exist; plan prose citing code | on disk but not indexed; `docs/a.md:3` cite; dead plan-tree link |
| path-token | 3 | resolving token; code naming an archived plan | dead token in a live doc; one brace alternative |
| permalink-shape | 2 | file, `#L`, pathless `tree/<sha>`; other repos | short SHA; fork owner; pathless blob |
| permalink-base | 1 | allowlisted SHA | SHA outside the allowlist |
| permalink-ancestry | 5 | dev ancestor (local and shallow PR clone); push run reports | side-branch entry; parent-arc SHA in a shallow PR clone; no `origin/dev`; unreachable origin |
| index-structure | 4 | pre-split tree; one line per active dir | unlisted, duplicate, dead, archive target, malformed; Outcome and status mismatch |
| archive-structure | 2 | archived plan with line and Outcome | fenced Outcome; `Outcome & Quality Bar`; no Seeds line; no index line |
| curated-budget | 3 | 8,192 B; follow-ups linking a repo issue | 8,193 B; two-line entry; no evidence; foreign URL |
| local-path | 2 | `~/` paths; closed plan prose before the split | home path in a curated file, the index and the active plan dir |

Helpers (`lib.test.ts` 9, extraction and resolution 5) and `tree.test.ts` make 50 tests over 5 files.

## Deviations from the plan text

Nine. The round-1 review brief called them seven; codex counted nine and judged the eight besides the citation exemption reasonable. Round 1 narrowed that exemption; see § Codex round 1.

- **`checkTree` lives in `check.ts`, not `lib.ts`.** Otherwise `lib.ts` imports the rule modules while they import it. Under ESM that cycle is a TDZ crash at load: "Cannot access 'PLANS' before initialization". `lib.ts` must stay a leaf.
- **`link-missing` skips transcript-shaped source docs.** They are already `tracked-artifact` findings and leave the tree with their links. Counting them gave 1,310 findings, nearly all of them reviewers' `path:line` cites.
- **Plan prose in the `plans` scope skips repo-rooted cites.** These are a `:line` suffix, or a first segment that is a top-level repo entry. They were broken before any move and stay history. Links into the plan tree are still checked. With both calibrations `link-missing` = 1 and `link-untracked` = 112, matching recon.
- **The scheme regex takes no dot.** `plan.md:40` is a broken file cite, not a URL. A mutation that allowed dots survived until this fixture was added.
- **A pathless `tree/<sha>` permalink is allowed.** CLAUDE.md links the freeze commit's root that way.
- **`path-token` excludes `scripts/ci-cd/plans`.** Its own fixtures named 81 fake plan paths.
- **`local-path` covers `PRE_SPLIT_ACTIVE = ["plans-scaffolding"]`** until `archive/index.md` exists. Before the split there is no active set to read.
- **The `local-path` fixtures assemble their home paths at runtime.** `scripts/check-no-local-paths.sh` greps the whole tree outside `implementations-plan/` with no test carve-out, and the first commit attempt tripped it. Assembling the paths keeps that guard's allowlist unchanged.
- **A report-only Actions run skips the ancestry fetch.** A push, nightly or release run never touches the network. A PR run fetches `dev` by name with `--filter=tree:0` and fails closed. A local run uses the existing `origin/dev` and asks for a fetch when it is missing.

## Mutation pass

16 of 16 mutants were killed:

- dev not fetched;
- ancestry anchored to HEAD;
- report runs fetching;
- lessons not exempt from the canonical shapes;
- `mode()` always enforcing;
- resolution from the filesystem;
- the `:line` cite rule removed;
- code spans counted as links;
- any Outcome counted as complete;
- an Outcome prefix match;
- negations allowed;
- the budget off by one;
- foreign URLs allowed;
- the index checked before the split;
- archive tokens rejected in code;
- braces not expanded.

## Gate

Run on the committed tree:

| Command | Exit | Result |
|---|---|---|
| `bun test scripts/ci-cd/plans/` | 0 | 50 pass, 0 fail, ≈6 s |
| `bun run test:ci-gating` | 0 | 200 pass, 2 skip, 0 fail |
| `bun run lint` | 0 | Biome clean on the new files; complexity-baseline check OK, with no new acceptance |
| `time bun scripts/ci-cd/plans/check.ts --report` | 0 | ≈2.9 s |

Report baseline, 787 findings:

| Rule | Findings |
|---|---|
| tracked-artifact | 667 |
| hygiene-files | 6 |
| nested-ignore | 1 (`tools-extraction/.gitignore`) |
| link-untracked | 112 |
| link-missing | 1: `token-identity/lessons/phase-1.md:13`, the doubled-dir link |
| every other rule | 0 |

Read-only against `feat/extraction-recipe`, the gate raises nothing on `implementations-plan/tools-extraction/tools/`. That branch adds 15 `permalink-base` findings only because it does not track the bases file.

## Stack rehearsal (I5)

A16 = local, so there is no GitHub sandbox. `gh stack` v0.1.1 is installed and was run against a bare `file://` remote with the stack dev ← b1 ← b2 ← b3, where b1 has two commits:

1. `gh stack init --base dev b1 b2 b3` adopts all three branches, and `view` works with no GitHub remote.
2. b1 squash-merged on the remote, plus one unrelated dev commit. **`gh stack rebase`** fast-forwarded the local trunk and rebased b1 onto it. b1's commits emptied and dropped because the squash carried the same content, which left b2 with only its own commit. Without GitHub it cannot see the PR merged, so this only works while dev has not touched b1's lines since.
3. **The manual `--onto` fallback:**
   - `git rebase --onto origin/dev <old b1> b2`, then `--onto b2 <old b2> b3`, never replays b1.
   - The squash commit is an ancestor of b2.
   - `push --force-with-lease=b2:<old tip>` succeeds, and a lease naming the wrong tip is refused (`stale info`).
4. **Re-adopting:** `gh stack init --base dev b2 b3` refuses while the old stack still tracks b2 ("already part of a stack", exit 5). `gh stack unstack --local` has to come first, so Delivery step 5 now says so.
5. **Conflict path.** dev and b2 edit the same line. `gh stack rebase` exits 3 with `UU shared.txt`; after resolving, `git add` and `--continue` finish b3 on b2 on dev. The same conflict under `--abort` restores both tips exactly, with no rebase left in progress.
6. **`gh stack push`** pushes both branches with per-branch leases, and the remote tips match the local ones.
7. **Trunk checked out in another worktree:** the case of the canonical clone's `dev`. git refuses to move it. `gh stack rebase` warns "Could not update local dev", rebases onto `origin/dev` instead and exits 0, and the other worktree stays clean.

**Incident: `gh stack` has no `-C` and acts on the cwd's repository.** On the first run, one `gh stack init` executed from the session's worktree instead of the rehearsal clone:

- It created `b1`, `b2` and `b3` at the local `dev` tip in the real clone.
- It wrote the worktree's `gh-stack` metadata file there.
- Its checkout of `b3` failed on local changes, so that worktree was not touched.

Cleanup, verified before deleting:

- The reflogs showed only "Created from refs/heads/dev" at that second, and no worktree had the branches checked out. `git branch -d` removed them.
- The metadata file held only that stack and was removed.

The rerun guards every `gh stack` call by asserting that `git rev-parse --show-toplevel` is the rehearsal clone. **Run `gh stack` only after `cd` into the intended checkout, and confirm the toplevel first.**

## Harness note

The session's worktree guard pins Bash to another worktree. This phase was built and committed in a scratch clone of `worktree-plans-scaffolding` outside the repo, and fast-forwarded into the worktree from there.

## Codex round 1

**2026-09-25. Verdict: changes required, 11 findings, all adopted.**

Codex also confirmed as sound:

- the `dev`-by-name ancestry fetch;
- index membership;
- UTF-8 budget counting;
- 787 findings reproduced without fetching.

Every fixture was written first and run against the unfixed code: 26 tests failed, and `tree.test.ts` failed to load (`verdict` missing). The one exception is the 40-group brace bomb, added only after the fix because the old code would hang on it. The fix landed in `8ae43352`.

| # | Finding | Fix | Fixtures (`scripts/ci-cd/plans/`) |
|---|---|---|---|
| 1 | `blob/GOOD/../../blob/BAD` passed as GOOD, and extra `../` segments reached another repo | A permalink must be canonical as written: no `.`/`..` segment, and `new URL(href).href === href`. The shape regex also rejects empty segments. | `permalinks.test.ts`: "dot segments, raw or percent-encoded, and empty segments fail even behind an allowlisted SHA" |
| 2 | Protocol-relative `//github.com/…` escaped the check, and bare URLs were not links | Candidates are found by parsed host (`github.com`, `www.`, any case, trailing dot; http or https; `//` and `/\`). The path is read both as written and as resolved. Markdown renders with `{ autolinks: true }`, so bare `https://`, `www.` and angle-bracket autolinks are links, as on GitHub. | `permalinks.test.ts`: "protocol-relative, backslash, http, www and case variants…" and "bare-URL autolinks are checked like any other link"; `links.test.ts`: "GFM autolinks: bare https, www. and angle-bracket URLs are links…" |
| 3 | `ctx.read()` used `readFileSync`: it followed symlinks and read an empty string on failure | Contents come from `git ls-files -s` plus one `git cat-file --batch` (`ctx.load`). Only modes 100644/100755 are read. A missing blob throws. A new `document-type` rule flags a symlink or gitlink that is a document or sits in the plan tree. The module comment now states the one working-tree input. | `lib.test.ts`: "a staged violation is judged from its blob although the working copy is clean" and "a tracked Markdown symlink or a plan-tree gitlink is a document-type finding…" |
| 4 | Brace expansion was exponential | A queue expansion checks `done + queued + alternatives > 256` before it builds anything. Past the cap it returns null, and the token becomes a `path-token` finding. | `links.test.ts`: "expansion stops past BRACE_CAP results, before building them, and the token becomes a finding" (9 groups, then 40) |
| 5 | `&#x110000;` threw `RangeError` | NUL, surrogates and code points past U+10FFFF decode to U+FFFD, and decoding never throws. | `lib.test.ts`: "an invalid numeric reference becomes U+FFFD…"; `links.test.ts`: "a numeric reference past U+10FFFF in an href never crashes the run" |
| 6 | `*` and numbered entries went unchecked, and `- [e][ref]` failed | `-`, `*`, `+`, `1.` and `1)` all open an entry, and any later non-blank, non-heading line is a second line. Each entry renders with the file's reference definitions. A definition glued under an entry is a lazy continuation in CommonMark, so it counts as a second line. | `structure.test.ts`: "`*`, `+` and numbered items are entries too…" and "a reference-style entry resolves against the whole document…" |
| 7 | Root's home, digit and underscore usernames and Windows profiles passed; a NUL byte exempted the whole file | The regex covers those forms, including a doubled-backslash profile. A lookbehind keeps URL and relative paths out. A NUL in an in-scope document is a finding, and the file is still scanned. Fixture paths are assembled at runtime. | `structure.test.ts`: "root's home, digit and underscore usernames and Windows profiles are home paths; a URL path is not" and "a NUL byte in an in-scope Markdown file is a finding…" |
| 8 | The citation exemption hid `../gone/plan.md:1` and `implementations-plan/gone/plan.md` | In `plans` scope a `:line` suffix is dropped, then every reading that lands in the plan tree is checked. Only repo-rooted cites of code outside `implementations-plan/` stay grandfathered. | `links.test.ts`: "a `:line` suffix or a repo-rooted spelling never hides a dead plan-tree target" |
| 9 | `.ignore` could negate `/archive/`, and nested `.ignore` files went unchecked | The plans `.ignore` may hold only `/archive/` and blank lines. A nested `.gitignore`, `.ignore` or `.rgignore` is a `nested-ignore` finding. | `structure.test.ts`: "the .ignore holds `/archive/` alone…" and "a nested .gitignore, .ignore or .rgignore fails" |
| 10 | Only `a[href]` and `img[src]` were extracted | `a`, `link`, `img` and `source` (`src`, `srcset`), `script` and `iframe`, plus `area`, `embed`, `video[src,poster]`, `audio`, `track` and `object[data]`; `srcset` is split into its candidates. | `links.test.ts`: "every URL-bearing attribute is a link, and srcset splits into its candidates" and "an srcset in Markdown's raw HTML is checked like any link" |
| 11 | `mode()` keyed on `GITHUB_BASE_REF` | Enforce locally and on `pull_request`/`pull_request_target`, whatever the base ref holds; every other Actions event reports. Ancestry skips on report mode. `verdict()` is the enforcement wiring. `tree.test.ts` stays report-only (`REPORT_ONLY = true`) but asserts that a PR run with findings fails. | `lib.test.ts`: the 9-case `mode` matrix; `permalinks.test.ts`: "a pull request with an empty base ref still fetches dev, and fails closed" and "a push, nightly or release run never fetches…, even with a base ref set"; `tree.test.ts`: both tests |

Also changed:

- **Two narrating comments trimmed:** `structure.ts:1` and `lineOf`'s.
- **`path-token` greps with `-a`.** `-I` skipped a NUL-containing file whole. Fixture: "a NUL byte does not hide a file's plan paths".
- **The hit regex runs in dotAll mode.** A CRLF line's `\r` stopped it from matching, which silently dropped the hit. This was an old bug, found while editing.

**Calibration catch.** The first cut of fix 8 raised 24 new `link-missing` findings on the real tree, all `.claude/skills/…:N` cites. The rooted test had excluded every `.`-prefixed path, not just `./` and `../`. After the fix, the baseline is unchanged.

**Mutation pass: 13 of 13 killed.** The mutants:

- `grep -I` restored;
- candidates found by the resolved path only;
- autolinks off;
- `img[srcset]` dropped;
- definitions ignored;
- `read` of a non-regular entry;
- `mode()` keyed on the base ref;
- rooted plan cites grandfathered;
- the `:line` suffix kept;
- `.ignore` checking only negations;
- the NUL exemption for documents;
- `&#0;` decoded;
- `document-type` limited to the plan tree.

The first run of the non-regular-read mutant survived, because its gitlink sat outside local-path scope. The fixture moved the gitlink into `plans-scaffolding/`, and the mutant died.

**Deviations and pushback:**

- **`document-type` is a 14th rule.** The plan names 13. Its closest neighbour, `tracked-artifact`, only covers the plan tree.
- **`mode()` no longer matches the plan text.** `plan.md` § Key interfaces and Phase 1's Mode line still say `GITHUB_BASE_REF`. Reconcile `plan.md` there.
- **An Actions run with no event name reports.** It is not failed closed; the driver's round-1 brief asked for exactly that.
- **The dot-segment check and the normalization check are redundant** behind the strict regex. Both are kept, as codex asked, which means no mutant of either one alone can die.
- **HTML's C1 remap (0x80–0x9F → Windows-1252) is left out.** No path or URL the gate judges depends on it.
- **Residual: `ls-files -ci --exclude-standard` still reads ignore rules from the working tree.** No git option reads them from the index. CI's checkout equals the commit, so only a local run with unstaged ignore edits can differ.
- **A `:line` cite is read relatively when its first segment is not a tracked top-level entry**, such as a removed directory. That fails closed. It affects zero cites on today's tree.
- **`base[href]` and `form[action]` stay unextracted.** No plan document uses either.

**Gate on `8ae43352`:**

| Command | Exit | Result |
|---|---|---|
| `bun test scripts/ci-cd/plans/` | 0 | 77 pass, 0 fail, ≈9 s |
| `bun run test:ci-gating` | 0 | 227 pass, 2 skip, 0 fail |
| `bun run lint` | 0 | Biome clean on the gate dir (the 29 warnings are elsewhere); complexity-baseline OK, with no new acceptance |
| `time bun scripts/ci-cd/plans/check.ts --report` | 0 | 787 findings in 3.3 s (3.4 s wall) |

The report baseline is unchanged:

| Rule | Findings |
|---|---|
| tracked-artifact | 667 |
| hygiene-files | 6 |
| nested-ignore | 1 |
| link-untracked | 112 |
| link-missing | 1 |
| document-type | 0 |
| every other rule | 0 |

Autolinks surface no bare permalinks on today's tree.

## Codex round 2

**2026-09-25. Verdict: changes required, 8 of 11 closed, 3 not closed (6, 8, 10), 3 new (12–14), all adopted.**

Every fixture was written first and run against the unfixed code: 10 tests failed. The fix landed in `a773733f`.

| # | Finding | Fix | Fixtures (`scripts/ci-cd/plans/`) |
|---|---|---|---|
| 6 | Indented items escaped the entry rules. `[unused]: bad target [fake](…)` passed as a definition and lent its link to every entry. A valid multiline definition failed. | New `entries.ts`, driven by Bun's CommonMark parser. `Bun.markdown.render` gives the top-level blocks, each item's single-line status (one paragraph of inline text, no break), and each block's first line, via a growing-prefix parse. Links come from the rendered `<li>` the item owns, decoded as a browser reads them; `render` itself reports raw destinations, so `https\://…` and bare `www.` would read as plan paths. A raw HTML list beside the entries fails closed. Past the first entry, a top-level block that is neither an entry nor a heading is "text outside any entry". | `structure.test.ts`: "an item indented one to three spaces is an entry…", "a would-be definition that renders a link lends no entry its evidence…", "a valid multiline reference definition passes…", "a raw HTML list beside the entries fails closed…"; mutation pin: "an entry is one paragraph on one line…" |
| 8 | `apps/../../gone/plan.md` passed as a repo-rooted cite | A spelling reads as a code cite only if `posix.normalize` leaves it unchanged; otherwise it resolves from the plan like any link. `linkLine` now tries the exact needle over the whole file before a decoded form. | `links.test.ts`: "a dot segment never lets a plan-relative link pass as a repo-rooted cite" (`apps/../..`, `apps/./..:4`, `%61pps/../..`) |
| 10 | `input[src]`, `cite`, `action`, `formaction` and `base[href]` were missing | New `html.ts` with an explicit policy covering every HTML and SVG URL attribute. Judged as links: `href` on any element (SVG, MathML) but `base`, `xlink:href`, `src`, `poster`, `cite`, `action`, `formaction`, `longdesc`, `background`, `manifest`, `lowsrc`, `dynsrc`, `usemap`, `srcset`, `imagesrcset`, `ping`, `object[data]`, and CSS `url()` / `@import` in a style attribute or `<style>`. Opaque: `srcdoc`, `codebase`, `classid`, `archive`, `profile`, `<applet>`, `<param>`, a meta refresh, and CSS the gate cannot read exactly (an escape, `image-set()`, `src()`). | `links.test.ts`: "every URL attribute the policy judges is a link…", "a CSS url() or @import… is a link; url(#id) is an anchor", "URL-bearing constructs outside the policy are findings, never skipped…" |
| 12 | `&sol;` and `&#98lob` hid a permalink | A numeric reference decodes as HTML reads it: no semicolon needed, C1 remapped through Windows-1252. HTML's full named table is not a dependency, so a named reference decodes only in its six common forms (with semicolon). Any other one a browser would decode is a `link-opaque` finding. Without a semicolon, HTML's frozen list of 106 legacy names applies: in an attribute such a reference decodes only when no letter, digit or `=` follows. `?a=1&family=2` and `&notify` stay text, as a browser keeps them. | `links.test.ts`: "a named reference the gate cannot decode is a finding; a semicolonless numeric one is decoded" (both of codex's regressions); `lib.test.ts`: "a numeric reference decodes as HTML reads it…" |
| 13 | `<base href>` re-based every relative link | A `link-opaque` finding, never resolved. | `links.test.ts`: `a <base href>, in HTML or in Markdown's raw HTML, is a finding…` |
| 14 | A colon in a file name dropped its path-token hits | `git grep -z`: NUL-terminated, unquoted names, parsed as sticky `name\0line\0text\n` records. Unparsable output throws. | `links.test.ts`: "a colon in a file name never hides its plan paths" |

**`link-opaque` is a 15th rule.** Its constructs sit in any tracked document, and the link rules they defeat run everywhere, so no existing rule id fits. `plan.md`'s rule union and A's enforce list now name it.

**Calibration catch.** The first cut raised 4 new findings on the real tree:
- `&family` in two Google Fonts URLs (`isolated-linker-store/eli5-v2.html`, `on-camera-landing/prototype.html`). The rule flagged every semicolonless name, while a browser keeps this one as text. That is now HTML's exact legacy rule.
- `url("{{font}}")` in the two store templates (`apps/extension/store/templates/{frame,tile}.html`). CSS URLs are now judged as links rather than flagged. Those templates sit outside every scoped rule, so they raise nothing.

After both fixes the baseline is unchanged.

**Mutation pass: 18 of 18 killed.** The mutants:
- the rooted cite not normalized;
- `linkLine` taking the loosest needle;
- grep without `-z`;
- `base[href]` judged as a link;
- named references never opaque;
- every semicolonless name opaque;
- semicolonless numerics not decoded;
- the C1 remap dropped;
- element-level opaque off;
- meta refresh ignored;
- CSS never read;
- the CSS count guard off;
- `cite`/`action`/`formaction` dropped;
- an item keeping ownership past its `</li>`;
- nested blocks not counted as multiline;
- the raw-HTML guard off;
- stray text allowed;
- every block on line 1.

**Codex's corrections to the round-1 residue, both accepted:**
- **`--exclude-standard` reads more than unstaged edits.** It also reads `.git/info/exclude` and the global excludes file, so a local run can differ from CI with no edit at all. The difference only adds findings. A pattern there can put an otherwise permitted tracked file into `ls-files -ci`, so `tracked-artifact` reports it. It cannot un-ignore anything, because the repo's `.gitignore` files take precedence over both. So a local run may report more than CI, never less. (Codex round 3 corrected an earlier draft of this entry that had the direction reversed.) The residue stands.
- **The C1 remap was omitted.** Now implemented.

**Deviations and pushback:**
- **A named reference with its semicolon passes only in the six common forms** (`amp`, `lt`, `gt`, `quot`, `apos`, `nbsp`, plus the uppercase legacy spellings). Any other, even a real one such as `&notin;`, is `link-opaque`. That is conservative and matches nothing on today's tree.
- **Evidence is what the rendered `<li>` holds,** raw inline HTML anchors included, not only Markdown links. A reader follows those links too.
- **`render`'s structure and the HTML's `<li>` order must agree,** or the file fails closed. A raw HTML list or a stray raw `</li>` splits them.
- **`scripts/ci-cd/plans/` is still not type-checked.** No workspace `typecheck` covers `scripts/`, and `bun-types` is not installed at the root. Bun runs the TypeScript untyped, as in round 1.

**Gate on `a773733f`:**

| Command | Exit | Result |
|---|---|---|
| `bun test scripts/ci-cd/plans/` | 0 | 90 pass, 0 fail, ≈9 s |
| `bun run test:ci-gating` | 0 | 240 pass, 2 skip, 0 fail |
| `bun run lint` | 0 | Biome clean on the gate dir (the 29 warnings are elsewhere); complexity-baseline OK, with no new acceptance |
| `time bun scripts/ci-cd/plans/check.ts --report` | 0 | 787 findings in 4.1 s (3.7–5.9 s over four runs) on a host at load average ≈130; round 1 recorded 3.3 s on a quieter host |

Per-rule counts are unchanged: tracked-artifact 667, hygiene-files 6, nested-ignore 1, link-untracked 112, link-missing 1, and 0 for every other rule, `link-opaque` included.

## Codex round 3: A0 ready to open report-only; one finding carried to A

Closed: 6, 8, 12, 13, 14.

Still open: 10, with a medium finding. The gate classifies raw spellings, not decoded values. None of these three constructs produces a link or a `link-opaque` finding:
- `<meta http-equiv="ref&#114;esh" content="0;url=…">`;
- a `style` attribute with an entity inside `url(`;
- a `<style>` block using a CSS escape (`u\72l(`).

The refresh case can navigate to an unapproved SHA. Codex's call: fix before enforcement, not a blocker for a report-only A0. It is now step 0 of Phase 2 in `plan.md`, so A cannot switch enforcement on without it.

Low: this log's `--exclude-standard` residue entry had the direction reversed. It is corrected above.

Probes reproduced 787 findings with unchanged counts. No defect surfaced in permalink validation or the `dev` ancestry anchor.
