# third-party-notices — recon

Base: `origin/dev` at `c97edc64` (legal-terms arcs A and B merged). Prior art is the unmerged
branch `feat/third-party-notices` (draft PR #630): a working generator whose Codex fix loop ran
seven engagements against a cap of three. This rework reuses that code; it does not start over.
One read-only explorer ran; its absence claims carry their search trail.

## Reuse map

| Capability | Found | Verdict |
|---|---|---|
| SPDX parse + allowlist | `feat/third-party-notices:packages/third-party-notices/src/spdx.ts` (79 lines, 19 table cases) | reuse as is |
| Reviewed policy data (ALLOWED, 18 `@aztec/*` overrides, bb.js, noir, sqlite3mc, hash.js, vendored claims) | same branch, `src/policy.ts` (236 lines, zero imports) | adapt: add a font category and the wasm inventories |
| Bundle to abstract contents | `src/collect.ts` (68 lines, own `OutputBundleLike`, no fs) | reuse as is |
| Policy check + byte-stable render | `src/generate.ts` (292 lines, reads `texts/` and licence files) | reuse as is |
| `node_modules` ownership walk | `src/packages.ts` (150 lines, fs) | reuse as is; belongs with the library (generate calls it) |
| Rolldown plugin, worker tracking | `src/plugin.ts` (99 lines, structural hook types, no vite import) | reuse as is, in the wiring arc |
| Stylesheet import following | `src/stylesheets.ts` (80 lines, fs) | reuse as is, in the wiring arc |
| CI minimum check | `src/check-minimum.ts` + `bin/` + `expected-minimum.txt` (30 names) | reuse as is, in the wiring arc |
| Caller-anchored package resolution | `@nulo/resolve-asset` (`resolvePackageAsset`, `assertPackageIdentity`) | reuse as is |
| About row, `openThirdPartyNotices`, S10 e2e | same branch, `apps/extension/src/utils/legal-links.ts`, `settings/about.vue`, `tests/e2e/legal-acceptance.test.ts` | reuse as is; U8 already signed off |
| Font licence texts | none. Searched `find . -iname "OFL*" -o -iname "*FONT*LICENSE*"` outside `node_modules`; `grep -rn fontsource --include=package.json`; `grep -rln font-face apps/extension/src` | build new: vendor the upstream texts |
| Inventory of what bb / noir wasm compile in | none in the packages. Searched each of `@aztec/bb.js`, `@aztec/noir-acvm_js`, `@aztec/noir-noirc_abi` for `LICENSE*`, `NOTICE*`, `*THIRD*PARTY*`, `Cargo.lock`, `*licenses*.json`, `*licenses*.html` | build new: derive from upstream build inputs at the pinned refs, as was done for sqlite3mc |
| Pages test exclusion | none. `apps/extension/vite.config.ts:107-130` sets only `dirs`; plugin default `exclude` is `["node_modules", ".git", "**/__*__/**"]` (`vite-plugin-pages@0.33.3`, `dist/index.cjs:778`) | build new: one `exclude` line |

## Findings that shape the plan

**The seam is already in the code.** `spdx`, `policy`, `collect`, `generate`, `packages` never see
a bundler object: `generateNotices(contents, options)` takes a plain `BundleContents` and two
directory paths. `plugin`, `stylesheets`, `check-minimum` are what turn a live build into that
shape. The two halves can be reviewed separately without moving a line between files.

**Where the review rounds went.** Of 21 blocking findings across rounds 1 to 4, the ones with legal
weight were round 1's (attribution completeness of `sqlite3.wasm`, owner resolution, legacy licence
metadata, CSS-only packages) and round 4's one ordinary gap (CSS `@import`). Rounds 2 and 3 were
mostly crafted-input bypasses (malformed manifests, forged inventory rows, a hostile file name
matching a claim, nested manifests at wrong versions), and the real build's output did not change
across them. **Not all of it was crafted, though**, and the plan audit corrected this recon on the
point: the missing musl text, assets a worker build copies, and inline workers are things honest
packages do, and stay blocking. No review leg had been told which standard applied.

**Fonts.** `packages/design/src/fonts/` vendors five `.woff2` binaries: InterVariable (352 KB),
Space Grotesk latin + latin-ext, JetBrains Mono latin, Material Symbols Outlined (344 KB).
`@font-face` lives only in `packages/design/src/base.css:11-43`. No npm font package, no licence
text anywhere in the tree. The same five ship in the extension, the landing and the tools app
(each imports `@nulo/design/base.css`). Inter, Space Grotesk and JetBrains Mono are OFL-1.1;
Material Symbols is Apache-2.0 (upstream facts to re-verify against each project's repository
during implementation, not yet verified in this session). OFL-1.1 is not on the code allowlist and
should not be: it is a font licence.

**Test files ship as routes, and the earlier count was low.** The legal-terms plan recorded
thirteen `*.test.ts` under `src/popup/pages`. `src/popup/windows` is scanned by the same `dirs`
entry and holds 22 more, so about 35 test modules become routes and pull `vitest`, `chai`,
`@vue/test-utils` and `@pinia/testing` into the production bundle.

**bb and noir wasm.** Policy attributes each wasm wholesale to its package (`components: []`,
`coveredBy`). `@aztec/bb.js@5.2.0` declares MIT with no `repository` field and no licence file;
the barretenberg tree is Apache-2.0 (override with `declared: "MIT"` already models this). The
noir packages point at `noir-lang/noir` (`acvm_repo/acvm_js`, `tooling/noirc_abi_wasm`). None of
the three ships a dependency listing, so an inventory has to come from upstream: the noir
`Cargo.lock` at the commit aztec-packages v5.2.0 pins, filtered to what each wasm crate's
dependency graph reaches, and barretenberg's CMake dependency declarations at the v5.2.0 tag.
