---
plan: third-party-notices
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
budget: recon 1 agent · foreign reviewer /codex high · no same-family leg (light)
supersedes: legal-terms Arc C (draft PR #630)
---

# third-party-notices — ship the notices file, in arcs a review can finish

The extension bundles about 136 third-party components and ships no attribution. Arc C of
[`legal-terms`](../legal-terms/plan.md) built a generator that works (both targets, byte-identical
output) and then ran its Codex loop to seven engagements against a cap of three. The owner merged
arcs A and B, parked #630, and asked for the arc to be split. Read [`recon.md`](recon.md) first:
the code is reused, the seam already exists, and the overrun has a specific cause this plan removes.
**This is revision 2**: Codex rejected revision 1 ([`audit-codex.md`](audit-codex.md)); every
blocking point was accepted and is folded in below.

## Why the last attempt overran, and what changes

1. **No review standard was stated.** Twelve of 21 blocking findings were crafted-input bypasses
   that never changed the real build's output. Fixed by the standard below, given verbatim to every
   review leg.
2. **One loop covered four concerns** (a dependency bump, a policy library, bundler wiring, UI + CI).
   Fixed by one arc per concern, each with its own loop.
3. **Two fixes were proven against fakes** (`getWatchFiles`, a scripted test edit that did not
   apply). Fixed by a rule: any change to how a live build is read is proven on a real build in the
   same commit, by making the build refuse and naming what refused it.

## The review standard (owner decision, 2026-09-19: "Honest dependencies")

The generator is a **compliance tool, not a security boundary**.

- **In scope, blocking:** an ordinary dependency, added or bumped by an ordinary edit, whose licence
  is missed, mislabelled, or whose required text, copyright notice or NOTICE does not ship; any
  input the generator cannot read that does not stop the build; any file in the final package that
  no rule accounts for; output that is not byte-stable; a stale policy record that does not fail.
  **Ordinary includes what honest packages really do:** prebundling their own dependencies,
  keeping licences in a subdirectory or in file headers without a nested manifest, copying an asset
  from a worker build, inlining a worker. None of these is concealment, and each stays blocking.
- **Out of scope, non-blocking:** a package that deliberately lies about or hides its own licence
  (crafted manifests, forged paths, replaced build output). Such a package has worse options than
  hiding a licence, and the controls for it are the min-age gate, the frozen lockfile and
  provenance. The hardening already written against these stays; it is not the bar, and a reviewer
  who finds more of it reports it as non-blocking.
- **Fail direction:** unknown means refuse the build, naming the package or asset. Never emit a
  partial file.
- **A licence on the allowlist is not the same as its obligations met.** Text and copyright notice
  for MIT/BSD/ISC; NOTICE content for Apache-2.0 where the distribution has one (none is invented
  where it has none); for **MPL-2.0**, the entry must also say where the Source Code Form is
  available (§ 3.2), taken from the package's `repository` or a reviewed override, and the
  generator refuses an MPL entry without it.
- **Nobody's sign-off discharges a licence obligation.** Where evidence is incomplete the plan
  records a conservative superset or leaves the release blocker open. It never records an
  "accepted gap".

## Success criterion

1. A Chrome and a Firefox production build each contain `THIRD-PARTY-NOTICES.txt`, byte-identical
   across the two, listing every third-party component that renders into the bundle, its workers,
   its inlined stylesheets and its copied code assets, each with a licence on the allowlist and the
   text or notice that licence requires.
2. The five bundled fonts are listed with their licence texts.
3. For both barretenberg variants and both noir binaries the notices list what they compile in,
   backed by the evidence file C4 defines (artifact hash, source commit, build command, features and
   target, resolved dependency records, vendored and generated code, linked runtime). Where exact
   linked contents cannot be shown without rebuilding, a **documented conservative superset** is
   listed instead. Until C4 lands, `legal/README.md` blocker 4 stays open and nothing claims the
   notices are complete.
4. No test module ships in the production extension.
5. CI inspects the **final zips** of both targets: the notices file is present, names every entry on
   the expected-minimum list, and every other file in the zip is accounted for by the
   reconciliation rule (Architecture). Font binaries match their recorded hashes.
6. Settings → About opens the file (U8, already signed off).
7. Every arc converges `/codex high` within 3 rounds under the standard above. A fourth round is a
   stop, not a request.

## Out of scope

- Notices for `apps/landing` and `apps/tools`. They ship the same fonts and their own dependency
  sets; the library is written so they can adopt it, and they are separate follow-ups (tools is the
  other product; wallet work does not touch it). **The font licence texts are vendored inside
  `@nulo/design`, next to the fonts, so they are in place for all three apps.**
- Any change to `ALLOWED` for code. Fonts get their own category (below), not a wider code list.
- Rewriting the generator. Files move between PRs, not between modules.

## UI impact

| # | Surface | Before | After | Sign-off |
|---|---|---|---|---|
| U8 | Settings → About, "Open-source licences" row | absent | one `SettingItem`, `data-testid="legal-about-licences"`, opens the notices file in a tab | **signed off** in `legal-terms/plan.md` (Owner decisions, 2026-09-18); screenshot `u8-about-licences.png` carried over |

No other user-visible surface changes. Removing test routes changes no screen: those routes are
unreachable by navigation.

## Architecture

Unchanged from the branch; stated here so a reviewer needs nothing else.

```
live build ──plugin.ts──► BundleContents ──generate.ts──► THIRD-PARTY-NOTICES.txt
             (workers,     { modules, assets,   (policy.ts: ALLOWED, OVERRIDES,
              stylesheets,   workers, styles }   VENDORED; packages.ts: ownership,
              assets)                            licence files; spdx.ts)
```

- **Library** (`spdx`, `policy`, `packages`, `collect`, `generate`, `texts/`): no bundler object
  reaches it. Input is a plain `BundleContents` and two paths.
- **Wiring** (`plugin`, `stylesheets`, `check-minimum`, `bin/`, `expected-minimum.txt`): turns a
  live Rolldown build, including the four worker builds that only see `worker.plugins`, into
  `BundleContents`. Registered in `vite.chrome.config.mts` and `vite.firefox.config.mts` only, never
  the shared `vite.config.ts` (Storybook and vitest load that).
- **Coverage matrix (new, normative).** How third-party bytes can reach the package, and what sees
  each. C3 proves every row on a real build by making it refuse.

  | Path into the package | Seen by | If unseen |
  |---|---|---|
  | static and dynamic `import` of JS/TS/JSON | `chunk.modules` (rendered length > 0) | n/a |
  | CSS imported from JS | `chunk.modules` (zero-length CSS kept) | n/a |
  | CSS `@import` / `@use` / `@forward` | `stylesheets.ts` follows to disk; unfollowable refuses | refuse |
  | CSS `url()` and `new URL(x, import.meta.url)` assets | **reconciliation**, via the asset's `originalFileNames` | refuse |
  | worker builds (four) | `worker.plugins` instance, keyed by entry module | refuse |
  | inline workers | refused outright (none in tree) | refuse |
  | `emitFile` from other plugins (`extract-bb-wasm`, crx loader) | asset claims; notices plugin ordered last | refuse |
  | `public/` copies and manifest-declared resources | **reconciliation** against the final `dist/` | refuse |
  | runtime `fetch` of a remote resource | out of scope: not distributed by us | n/a |

- **Reconciliation (new).** After the bundle is written, every file in the target's `dist/` is
  classified exactly once: a chunk (covered through its modules); an asset whose every
  `originalFileNames` entry is a first-party workspace path outside `node_modules`; a file copied
  from the app's own `public/`; the manifest and the notices file; or a file matched by a
  `VENDORED` claim. Anything else refuses the build by name. A first-party directory holding
  third-party bytes (the fonts) is exactly the case the hash-bound claims exist for, so the fonts
  are claimed, not waved through as first-party.
- **Licence discovery beyond the root.** `packages.ts` also reads `LICENSE*` / `NOTICE*` /
  `COPYING*` in the directories between a rendered module and its package root, and a prebundled
  dependency without a nested manifest is handled by a reviewed `embedded` record on the host
  package (name, version, licence, text), version-bound like every other record.
- **Font category (new).** `policy.ts` gains `FONT_ALLOWED = { "OFL-1.1", "Apache-2.0" }`, consulted
  only for a `VENDORED` claim whose trigger is a font asset (`/\.woff2?$/`) and which declares
  `kind: "font"`. A font asset with no claim refuses the build, the same as an unclaimed `.wasm`. A
  code package declaring OFL-1.1 still fails `ALLOWED`. **A font claim binds the binary's SHA-256**
  to its provenance record: upstream repository and ref, how the file was produced (upstream
  release file, or a subset and by whom), licence, the **copyright line(s)** and any Reserved Font
  Name statement. A replaced or re-subset file changes the hash and refuses the build. The entry
  ships copyright plus licence text. Texts and the provenance table live in
  `packages/design/src/fonts/licences/`, one copy for all three apps, read through
  `@nulo/resolve-asset` (so `@nulo/third-party-notices` declares `@nulo/resolve-asset` and
  `@nulo/design` as workspace dependencies; no external dependency is added).
  **Subsetting is modification under the OFL.** If a `-latin` file is a subset of a family that
  declares a Reserved Font Name, and the subset was not made by the copyright holder, shipping it
  under that name is not permitted: C2 stops and surfaces it (options: ship the unmodified upstream
  file, or rename). That a hosting service served the subset does not settle it.
- **Version binding for asset claims.** Today's asset-trigger records carry no version. Each gains
  one binding: a font by hash (above); a wasm by the `reviewedVersion` of the package in
  `coveredBy`, so an `@aztec/*` bump invalidates the claim and its inventory together.
- **Wasm inventories (new).** `components: [{ name, version, licence, source, texts }]` on the
  asset's claim. Identical complete licence texts are deduplicated; texts that differ only in their
  copyright line are **not** merged, because the MIT notice that must be preserved is the whole
  text including that line.

## Arcs

Each arc: tests written with the behaviour, local gates, one Codex loop (max 3), then its PR.
`G-base` = `bun run lint` + `bun run typecheck:all` + the touched workspace's tests.

### C1 · deps — Presto MIT bump · **done, PR #639**
Codex round 1: approve. The min-age exclude was removed in the same PR (a frozen install never
re-gates a locked version; verified with `--frozen-lockfile --force`), which also clears the stale
exclude `dev` carried. No follow-up PR is owed.

### C0 · fix — keep test modules out of the production routes
Independent of everything else, off `dev`. `apps/extension/vite.config.ts`: add
`exclude: ["**/*.test.ts", "**/*.spec.ts", "**/*.pins.test.ts"]` merged with the plugin's defaults.
The plugin **replaces** its defaults when `exclude` is set (`vite-plugin-pages@0.33.3`,
`dist/index.cjs:778`), so the defaults are restated beside the new globs. Test
(`apps/extension/scripts/`, beside `layout-identity.test.ts`): enumerate every `*.test.*` /
`*.spec.*` under the five scanned dirs across the resolver's extensions (`vue`, `ts`, `js`) and
assert the config's `exclude` matches each; the primary build-side proof is on **module ids**, a
check that no rendered module id in the production bundle matches a test pattern or resolves into
`vitest` / `@vue/test-utils` / `@pinia/testing` / `chai`. A minified-name grep in
`_build-extension.yml` is supplementary only. Gates: `G-base`, `bun run build:chrome`, `bun run test:e2e` (routes changed),
`bun run test:ci-gating`, `bun run lint:actions`.
*Lands before C3 so the notices file never lists test libraries.*

### C2 · library — `@nulo/third-party-notices`, no build wiring
`spdx`, `policy`, `packages`, `collect`, `generate`, `texts/`, README, their tests, plus the font
category, the font provenance table and texts in `@nulo/design`, the MPL source rule, subdirectory
licence discovery and `embedded` records. `index.ts` exports **only what this arc contains**
(`plugin` exports arrive with C3). Nothing imports the package yet, so this PR cannot change a
build; it is complete on its own because `generateNotices` is driven by fixture `BundleContents`.
The package is registered now where discovery is automatic or pinned: workspace globs, the
`log-payload-ban` runtime enumeration, `typecheck:all`, `test:all`, and the `pr-quick.yml` /
`behavior-gating.test.ts` path filters for `packages/third-party-notices/**` and
`packages/design/src/fonts/**`, so a policy-only or font-only change runs the suites. Tests carried over (SPDX tables, ownership, legacy metadata, stale records,
byte stability, inventory block) plus: a font claim accepted under `FONT_ALLOWED`; OFL-1.1 on a code
package refused; an unclaimed `.woff2` refused; a font whose bytes do not match the recorded hash
refused; a font claim with no copyright line or missing text refused; **the five real binaries
hashed against the provenance table**; an MPL-2.0 entry without a source location refused; a
licence file in a subdirectory found; an `embedded` record at the wrong host version refused.
Gates: `G-base`, `bun run test:all`, `bun run audit:dup` read (not gated).

### C3 · wiring — the build writes the file, CI checks the zip
`plugin` (registered last, after `extract-bb-wasm` and crx), `stylesheets`, reconciliation,
`check-minimum`, `bin/`, `expected-minimum.txt` (+ the five font names), both target configs, the
`_build-extension.yml` assertion run against the **final zip** of each target, remaining path
filters (smoke and network e2e), the `behavior-gating.test.ts` pin. **Real-build proof rule:** every
row of the coverage matrix, and every change in `plugin.ts`, `stylesheets.ts` or reconciliation, is
proven by a temporary edit that makes the real build refuse by name; the probe and its output are
logged in `lessons/c3.md`. Gates: `G-base`, `bun run test:all`, `bun run build:chrome`,
`bun run build:firefox` (same SHA-256), `check-minimum.ts both` on the zips, `bun run test:ci-gating`,
`bun run lint:actions`, `bun run audit:vue`.

### C3b · surface — the About row
`legal-links.ts`, the About row (U8), e2e S10, docs (`CLAUDE.md` dependency rule, `aztec-update`
skill pin surface). `legal/README.md` blocker 4 is **not** closed here; C4 closes it. Gates:
`G-base`, `bun run test:e2e` with the legal spec twice at `--retry=0`, `bun run audit:vue`.

### C4a · inventory — the two noir binaries
### C4b · inventory — the two barretenberg variants
Two arcs, same method, research before code. Each writes `lessons/c4-<x>-evidence.md` **first** and
stops for a scope check if the evidence cannot be completed:

1. **Artifact:** SHA-256 of each shipped wasm, matched to the npm tarball.
2. **Source:** the exact commit (aztec-packages v5.2.0 tag; for noir, the submodule commit it pins).
3. **Build:** the release command, target (`wasm32-unknown-unknown` / the wasi toolchain bb uses),
   profile and **feature set**, read from upstream's build scripts and CI, not guessed.
4. **Resolved dependencies:** for noir, a target- and feature-matched resolution
   (`cargo tree --target … --no-default-features --features … -e normal,build` semantics against the
   pinned `Cargo.lock`), plus every `build.rs` inspected for vendored or generated code; for bb, the
   CMake targets linked into the wasm and every `FetchContent` / vendored directory they reach.
5. **Linked runtime:** the Rust standard library and `compiler_builtins`; wasi-libc / libc++ /
   compiler-rt for bb; each with its own licence record.
6. **Result:** where steps 3 to 5 pin the linked set, list it. Where they do not, list the
   **conservative superset** and say so in the entry's note. Never claim exact contents without
   evidence.

Then policy records + texts + tests (a `reviewedVersion` bump without re-review fails; a component
without a text fails). If a component's licence is off the allowlist, **stop and surface it**; the
list is not widened in this plan. If the record count makes hand-written policy entries
unreviewable, the records are generated from a checked-in, reviewed data file, announced before it
is written. C4b closes `legal/README.md` blocker 4. Gates: C3's build gates.

### Not code
- **`@aztec/bb.js` declares MIT, its tree carries Apache-2.0.** Which one applies is a question of
  evidence, not of which is stricter: C4b records what the barretenberg directory's licence file
  and file headers say at the tag, and the entry ships the text that evidence supports (both, if
  the evidence is split). An upstream issue asking them to reconcile the field is drafted in
  `lessons/bbjs-upstream-issue.md` for the owner to file; it is useful and establishes nothing.
- **Close #630** with a pointer to the replacement PRs once C3 is open.

## Security & adversarial considerations

- **Threat model:** the review standard above. The asset at risk is legal compliance of a shipped
  binary; the actor is our own next dependency edit, not an attacker.
- **Supply chain:** no new runtime dependency in any arc. C2 adds no dependency at all. Font texts
  and wasm inventories are fetched by hand from upstream at recorded refs with recorded hashes;
  nothing is fetched at build time, so the build stays offline and deterministic.
- **Fail closed, by name.** Every refusal names the package or asset, so a red build is actionable
  and cannot be "fixed" by loosening a pattern without reading what it matched.
- **Policy rot:** an override, claim or inventory that no longer matches anything fails the build;
  every record is version-bound.
- **Output as input:** the notices file opens in an extension tab as `text/plain`. Licence texts are
  third-party strings and are never rendered as HTML. CI reads only the fixed-position inventory
  block.
- **C0:** removing test routes removes about 35 unauthenticated-looking routes and four test
  libraries from the shipped bundle; it adds no surface.
- **What the supply-chain controls do not do:** min-age, the frozen lockfile and provenance say
  where a package came from. None of them validates attribution; only the generator does.
- **Named failure modes:** accidental omission (coverage matrix + reconciliation), stale binary
  provenance (hash and version binding), hook ordering (the notices plugin runs last and
  reconciles against what was actually written, so a late `emitFile` cannot slip past).
- **Logging:** nothing in this plan logs at runtime.

## Assumptions and open items

- **Checked by the audit against upstream licence files:** Inter, Space Grotesk, JetBrains Mono are
  OFL-1.1; Material Symbols is Apache-2.0. Still open: the provenance of **these binaries**.
- **Open, may stop C2:** how the three `-latin` / `-latin-ext` subsets were produced and whether
  their families declare a Reserved Font Name. See the font category.
- **Open:** whether any bundled component is MPL-2.0 today (the rule is written either way).
- **Ask (blocks C4 only):** if an inventoried component is LGPL/GPL or similar, the answer is not in
  this plan.

## Deviation from the blueprint skill

Plan-folder hygiene (gitignoring audits and `eli5.html`) is not applied; this repo commits them by
convention (`implementations-plan/README.md`). The worktree branch carries the plan; each arc uses a
conventional `fix/`, `feat/` branch inside the same worktree, as `legal-terms` did.

## Delivery

`C1` #639 and `C0` `fix(build): keep test modules out of the production routes` are independent PRs
into `dev`. One `gh stack` carries the rest: `C2` `feat(notices): add the third-party notices policy
library` → `C3` `feat(build): write third-party notices into both extension builds` → `C3b`
`feat(settings): open the open-source licences from about` → `C4a` `feat(notices): inventory what
the noir wasm compile in` → `C4b` `feat(notices): inventory what the barretenberg wasm compiles in`. The plan and
recon ride in C2. PR titles ≤ 93 chars. C3b's body carries the U8 sign-off quote and screenshot.
Merging is always the owner's call.

## Post-implementation

Per arc, before opening its PR: local gates green → `/codex high` review of the arc's diff, the
prompt quoting **The review standard** section verbatim and asking for BLOCKING (in scope) and
NON-BLOCKING (out of scope) separately → fix blocking → repeat until approve or
conditional-approve, **hard stop at 3 rounds: stop, write what is left to
`lessons/<arc>.md`, and ask the owner.** A targeted re-check of one fix counts as a round.
`/code-review` is off. `/harden` is not run. Never soften a gate or add a complexity suppression.
Lessons per arc in `lessons/`; after three failures on one step, stop and reassess. Keep
`implementations-plan/index.md` current in the same PRs.
