---
plan: third-party-notices
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
budget: recon 1 agent · foreign reviewer /codex high · no same-family leg (light)
supersedes: legal-terms Arc C (draft PR #630)
---

# third-party-notices — ship the notices file, and stop there

The extension bundles about 136 third-party components and ships no attribution. Arc C of
[`legal-terms`](../legal-terms/plan.md) built a generator that works (both targets, byte-identical
output, 55 tests) and then ran its Codex loop to seven engagements against a cap of three. The owner
merged arcs A and B, parked #630 and asked for a split. Read [`recon.md`](recon.md) first.

**This is revision 3, the slim one.** Revision 1 was rejected by Codex
([`audit-codex.md`](https://github.com/alejoamiras/nulo/blob/9f11de70b13933be2d54c3eb79622b1ff2719aba/implementations-plan/third-party-notices/audit-codex.md)); revision 2 accepted every point in full and grew a final-zip
reconciliation pass, nested-licence discovery, an MPL rule and evidence dossiers for the contents
of upstream's prebuilt wasm. The owner's read of that, 2026-09-20: *"im a bit scared we might be
mega-overdoing it and adding too much complexity just for third party license, but ill trust you"*.
He is right. A solo-developer wallet needs a notices file that lists what ships with its licence
texts, the font licences, and a guard against copyleft. Revision 3 keeps that and cuts the rest;
what was cut, and why that is defensible, is under **Deliberately not done**.

## Why the last attempt overran, and what changes

1. **No review standard was stated.** Most mid-round findings were crafted-input bypasses that never
   changed the real build's output. Fixed by the standard below, quoted to every review leg.
2. **One loop covered four concerns.** Fixed by one arc per concern.
3. **Two fixes were proven against fakes.** Fixed by a rule: a change to how a live build is read is
   proven on a real build, by making it refuse and naming what refused.
4. **(New, from revision 2.)** Accepting every audit point is how a compliance file becomes a
   research programme. A finding is weighed against what a wallet this size owes, not only against
   whether it is true.

## The review standard (owner decision, 2026-09-19: "Honest dependencies")

The generator is a **compliance tool, not a security boundary**.

- **Blocking:** an ordinary dependency, added or bumped by an ordinary edit, whose licence is missed
  or mislabelled, or whose licence text does not ship; an input the generator cannot read that does
  not stop the build; output that is not byte-stable; a stale policy record that does not fail.
- **Non-blocking:** a package that deliberately lies about or hides its own licence. The controls
  for that are the min-age gate, the frozen lockfile and provenance. Existing hardening stays; it is
  not the bar. Also non-blocking: anything listed under **Deliberately not done**; a reviewer may
  argue one of those lines is wrong, once, and the owner decides.
- **Fail direction:** unknown means refuse the build by name. Never a partial file.

## Success criterion

1. Chrome and Firefox production builds each contain `THIRD-PARTY-NOTICES.txt`, byte-identical,
   listing every third-party package that renders into the bundle, its workers and its inlined
   stylesheets, each under an allowlisted licence with its text.
2. The five bundled fonts are listed with copyright line and licence text, each file bound by hash.
3. The wasm binaries are attributed to the project that publishes them, under its licence, and the
   file says in plain words that their internal components are not itemised.
4. No test module ships in the production extension. **(done, #640)**
5. CI refuses a build whose notices file is missing or lacks a name on the expected-minimum list.
6. Settings → About opens the file (U8, signed off).
7. Every arc converges `/codex high` within 3 rounds. A fourth round is a stop, not a request.

## UI impact

| # | Surface | Before | After | Sign-off |
|---|---|---|---|---|
| U8 | Settings → About, "Open-source licences" row | absent | one `SettingItem`, `data-testid="legal-about-licences"`, opens the notices file in a tab | **signed off** in `legal-terms/plan.md` (Owner decisions, 2026-09-18); screenshot `u8-about-licences.png` carried over |

## Architecture

Unchanged from the branch. **No module is added in this plan.**

```
live build ──plugin.ts──► BundleContents ──generate.ts──► THIRD-PARTY-NOTICES.txt
             (workers,                        (policy.ts, packages.ts, spdx.ts, texts/)
              stylesheets, assets)
```

- **Library:** `spdx`, `policy`, `packages`, `collect`, `generate`, `texts/`. No bundler object
  reaches it; input is a plain `BundleContents` and two paths.
- **Wiring:** `plugin`, `stylesheets`, `check-minimum`, `bin/`, `expected-minimum.txt`. Registered in
  `vite.chrome.config.mts` and `vite.firefox.config.mts` only (Storybook loads the shared config).
- **Fonts, the one addition.** The existing rule "a copied code asset needs a `VENDORED` claim or
  the build refuses" is widened from `.wasm` / `.js` to `.woff2`. A font claim carries
  `kind: "font"`, the file's SHA-256, upstream URL, copyright line and licence, and is checked
  against `FONT_ALLOWED = { "OFL-1.1", "Apache-2.0" }` instead of the code allowlist. A changed
  file changes the hash and refuses. Texts live in the package's `texts/` with every other reviewed
  text (see `lessons/c2.md` for why not beside the fonts). About 40 lines of code and four records.
- **MPL-2.0 leaves `ALLOWED`.** Nothing bundled uses it (tally of the built file: 108 MIT,
  21 Apache-2.0, 2 ISC, 2 BSD-3-Clause, three dual expressions). MPL carries a source-availability
  duty the generator does not discharge, so the honest move is that an MPL package refuses the
  build and gets a decision the day one appears. This is a tightening and it is less code.

## Arcs

`G-base` = `bun run lint` + `bun run typecheck:all` + the touched workspace's tests.

### C1 · deps — Presto MIT bump · **PR #639, Codex approve round 1**
Min-age exclude removed in the same PR; no follow-up owed.

### C0 · fix — test modules out of the production routes · **PR #640, Codex approve round 1**
37 test modules were routes; the Chrome build is 690 kB smaller. Proven through the plugin's own
`PageContext` and on a real build.

### C2 · library — `@nulo/third-party-notices`, wired to nothing
The five library modules, `texts/`, README and tests as they stand on `feat/third-party-notices`,
plus the font claims and texts, minus MPL-2.0. `index.ts` exports only what this arc contains.
Driven by fixture `BundleContents`, so it cannot change a build. Path filters for the package and
`packages/design/src/fonts/**` land here. New tests: a font claim accepted; OFL-1.1 on a code
package refused; an unclaimed `.woff2` refused; a font whose bytes differ from the recorded hash
refused; **the five real files hashed against their records**; an MPL-2.0 package refused.
**Before any text is vendored:** confirm each font's licence and copyright line upstream, and how
the three `-latin` subsets were made. Subsetting is modification under the OFL; if a family
declares a Reserved Font Name and the copyright holder did not make the subset, stop and ask
(the options are the unmodified upstream file or a rename).
Gates: `G-base`, `bun run test:all`.

### C3 · wiring — the build writes the file, CI checks it, About opens it
`plugin`, `stylesheets`, `check-minimum`, `bin/`, `expected-minimum.txt` (+ the font names), both
target configs, the `_build-extension.yml` assertion, the e2e path filters, the
`behavior-gating.test.ts` pin, `legal-links.ts`, the About row, e2e S10, the wasm wording of
criterion 3, docs (`CLAUDE.md` dependency rule, `aztec-update` pin surface, `legal/README.md`
blocker 4 closed with its stated limits). Real-build proof rule applies to any change in
`plugin.ts` or `stylesheets.ts`; none is planned. Gates: `G-base`, `bun run test:all`,
`bun run build:chrome`, `bun run build:firefox` (same SHA-256), `check-minimum.ts both`, the legal
smoke spec twice at `--retry=0`, `bun run test:ci-gating`, `bun run lint:actions`,
`bun run audit:vue`. *If this arc's review is heading past two rounds on the wiring, the About row
splits out into its own PR rather than riding a third round.*

### Not code
- Draft an upstream issue for Aztec in `lessons/upstream-issue.md`: `@aztec/bb.js` declares MIT
  while its tree carries Apache-2.0, no `@aztec/*` package ships a licence file, and none publishes
  what its wasm compiles in. The owner files it. That is where the wasm inventory belongs.
- Close #630 with a pointer to the replacement PRs once C3 is open.

## Deliberately not done

Each line is a true finding from the plan audit that this plan declines, with the reason. They are
recorded in [`follow-ups.md`](follow-ups.md) with the trigger that reopens each, so they are decisions, not omissions.

| Cut | Why it is defensible |
|---|---|
| Itemising what `barretenberg.wasm` and the noir wasm compile in (revision 2's C4a/C4b) | They are upstream's prebuilt binaries, shipped under upstream's licence, and upstream publishes no inventory. Reconstructing feature-matched Cargo and CMake closures for someone else's build is weeks of work that almost no distributor does; the notices file says plainly that it is not done, and the upstream issue asks the party who can do it in an afternoon. `sqlite3.wasm` stays itemised because that work is already done and reviewed. |
| Reconciling every file of the final zip against a claim | The cases it would catch are third-party images or data pulled in through CSS `url()` or `public/`. The extension has none today, and its `public/` and asset directories are first-party. Code and fonts, the two classes that do occur, are covered by claims. Revisit if a third-party asset pack is ever added. |
| Licence files in package subdirectories; prebundled dependencies without a nested manifest | The generator already refuses a package with no readable licence, so the failure mode here is an *extra* unlisted component inside an already-attributed package, not a missing licence. The 136 current entries were reviewed by hand in rounds 1 to 4. |
| An MPL-2.0 source-location rule | Replaced by removing MPL-2.0 from the allowlist. |
| Notices for `apps/landing` and `apps/tools` | Other products. The font records and texts are reusable as they stand when those apps adopt the library. |

## Security & adversarial considerations

- **Threat model:** the review standard. The asset is legal compliance of a shipped binary; the
  actor is our own next dependency edit, not an attacker.
- **Supply chain:** no new external dependency in any arc; nothing is fetched at build time. Font
  texts are fetched by hand from upstream at recorded URLs and bound by hash.
- **Fail closed, by name,** so a red build is actionable and cannot be fixed by loosening a pattern
  without reading what it matched. Stale records fail too, and every record is version- or
  hash-bound.
- **What the supply-chain controls do not do:** min-age, the lockfile and provenance say where a
  package came from; none validates attribution.
- **Output as input:** the file opens in an extension tab as `text/plain`; licence texts are never
  rendered as HTML; CI reads only the fixed-position inventory block.
- **C0** removed 37 routes and four test libraries from the shipped bundle.
- **Logging:** nothing in this plan logs at runtime.

## Assumptions and open items

- Checked by the audit against upstream licence files: Inter, Space Grotesk, JetBrains Mono are
  OFL-1.1; Material Symbols is Apache-2.0. Open: the provenance of these binaries (C2, first step).
- **May stop C2:** a Reserved Font Name on a subsetted family.

## Deviation from the blueprint skill

Plan-folder hygiene (gitignoring audits and `eli5.html`) is not applied; this repo commits them by
convention. Revision 3 was not re-audited: it removes scope the audit added and adds nothing, and
the arcs' own loops review the code.

## Delivery

`C1` #639 and `C0` #640 are independent PRs into `dev`. `C2` `feat(notices): add the third-party
notices policy library` → `C3` `feat(build): ship third-party notices in the extension` are one
`gh stack`; the plan, recon and audit ride in C2. PR titles ≤ 93 chars. C3's body carries the U8
sign-off quote and screenshot. Merging is always the owner's call.

## Post-implementation

Per arc, before opening its PR: local gates green → `/codex high` review of the arc's diff, the
prompt quoting **The review standard** and **Deliberately not done** verbatim and asking for
BLOCKING and NON-BLOCKING separately → fix blocking → repeat until approve or conditional-approve,
**hard stop at 3 rounds: stop, write what is left to `lessons/<arc>.md`, ask the owner.** A targeted
re-check of one fix counts as a round. `/code-review` is off. `/harden` is not run. Never soften a
gate, widen `ALLOWED` or `FONT_ALLOWED`, or add a complexity suppression. Keep
`implementations-plan/index.md` current in the same PRs.
