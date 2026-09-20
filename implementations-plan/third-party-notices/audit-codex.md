# Codex audit of plan revision 1

GPT-6 Astra, `high`, read-only, one round (light tier). Verdict: **reject**. Every blocking point
was accepted; revision 2 of [`plan.md`](plan.md) is the result. Adjudication first, the response
verbatim after it.

| # | Finding | Call | Where it landed |
|---|---|---|---|
| 1 | Coverage stops at `chunk.modules`: `url()`, `new URL()`, `public/`, manifest resources | accept | Architecture: coverage matrix + reconciliation of the final `dist/`; C3 proves each row on a real build |
| 2 | "Honest" boundary too blunt; subdirectory licences, prebundled deps; MPL-2.0 § 3.2 | accept | Review standard (ordinary-package list, obligations bullet); `packages.ts` discovery + `embedded` records in C2; recon corrected |
| 3 | C2 not independently complete (`index.ts` exports, undeclared workspace deps, asset claims unversioned, path filters) | accept | C2 text; Architecture: version binding |
| 4 | Fonts: bind identity by hash; copyright plus licence; subsetting is modification, RFN | accept | Font category; open item that may stop C2 |
| 5 | C4 bounded by "depth" and crate count rather than evidence; owner acceptance cannot discharge an obligation | accept | Criterion 3; C4a / C4b evidence list; standard's last bullet |
| 6 | Gates: final zips, font hash drift, module-id test detection, path filters | accept | Criterion 5; C0; C2; C3 |
| n1 | C3 still mixes integration with UI | accept | split into C3 and C3b |
| n2 | "Apache is stricter" is not evidence | accept | Not code, bb.js bullet |
| n3 | Security section: omissions, stale provenance, hook ordering | accept | Security section |

Not re-audited: the tier allows one plan audit, and the arcs' own loops review the code.

---

**Reject — high confidence:** the split is viable, but ordinary attribution gaps and an underspecified WASM inventory remain blocking.

**BLOCKING**

- **Define coverage beyond `chunk.modules`.** Ordinary dynamic imports and imported JSON are covered when bundled. Runtime-resolved imports/fetches, `public/` copies, and copied manifest resources are not reliably covered. `new URL()` and CSS `url()` can emit or inline assets without attributable module IDs; the stylesheet walker follows imports, not asset URLs. Images/copied JSON escape the code-asset filter. Require a coverage matrix, explicit ownership for copied/inlined assets, final-package reconciliation, and real-build refusal probes. [Vite documents these distinct paths](https://vite.dev/guide/assets.html).

- **The “honest dependencies” standard needs a sharper boundary.** Ordinary packages prebundle dependencies, carry subdirectory licences, or use file-level notices without nested manifests; `packages.ts` only collects root licence/NOTICE files. These are not deliberate concealment. Recon also misclassifies missing musl text, worker-copied assets, and inline workers as necessarily crafted-input cases. Preserve these as blocking. Moreover, allowed MPL-2.0 requires source availability and recipient instructions when distributing executable form; copying its licence alone is insufficient. Specify that obligation or a separate mandatory release check. [MPL §3.2](https://www.mozilla.org/en-US/MPL/2.0/).

- **Make C2 independently complete.** The seam is real and fixture-testable without consumers, but the existing `index.ts` exports `plugin.ts`, which C2 excludes. Stage those exports. “C2 adds no dependency” contradicts reading design assets through `@nulo/resolve-asset`: declare both workspace dependencies where resolved. Define the new text-resolution contract and version binding now; existing asset-trigger records have no `reviewedVersion`. Include package-discovery/path-filter checks in C2, not only C3.

- **Font identity and obligations need explicit acceptance criteria.** `FONT_ALLOWED` scoped to font claims is sound, but filename/category alone cannot detect an ordinary replacement. Bind each binary’s hash to its provenance, licence, copyright and RFN evidence. Bundling permits a readable notices file containing **copyright plus licence**, without relicensing the application. Subsetting is modification; a hosting service is not necessarily the copyright holder, so “upstream-served” does not establish RFN permission. [OFL conditions](https://openfontlicense.org/open-font-license-official-text/), [subsetting FAQ](https://openfontlicense.org/ofl-faq/). For Material Symbols, inspect the matching distribution for applicable NOTICE content; Apache does not require inventing one when absent. [Apache §4](https://www.apache.org/licenses/LICENSE-2.0).

- **Bound C4 by evidence, not sqlite “depth” or crate count.** Require, for both bb variants and both Noir binaries: artifact hashes, source commits, release build commands/features/targets, resolved dependency records, vendored/generated code, and linked runtime/toolchain components. Cargo manifests plus lockfile alone omit feature resolution and toolchain/runtime inputs; use target/feature-matched Cargo resolution plus build-script inspection. A conservative documented superset can avoid rebuilding; do not claim exact linked contents without evidence. [Cargo semantics](https://doc.rust-lang.org/cargo/commands/cargo-tree.html). Preserve each distinct MIT copyright-and-permission notice; deduplicate identical complete texts, not copyright lines alone. [MIT](https://opensource.org/license/mit). Split Noir and bb research, resolve scope before coding, and prevent compliant-release claims until unresolved items are closed; owner acceptance cannot discharge licence obligations.

- **Strengthen gates around actual delivery.** Check final ZIP contents, both targets, late-emitted assets, font-hash drift, and missing required notices. `expected-minimum` and byte identity cannot prove completeness. Detect test module IDs across supported route extensions; minified-name greps are supplementary. Explicitly include font binaries/texts and inventory inputs in build-trigger filters.

**NON-BLOCKING**

- **Moderate confidence:** C3 still mixes the hardest integration work with UI/docs. Separate collector/build acceptance from About-row delivery if three rounds is a firm operational limit.
- Replace “Apache is stricter” for bb.js with evidence identifying the applicable licence. An upstream issue is useful but does not establish permission.
- Security should name accidental omissions, stale binary provenance and hook ordering; min-age/frozen installs do not validate attribution.

**What looks fine**

C0-before-C3 is correct; Pages 0.33.3 replaces defaults, so explicitly combining exclusions is necessary. C2 needs no production consumer. Current upstream licences support [Inter](https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt), [Space Grotesk](https://raw.githubusercontent.com/floriankarsten/space-grotesk/master/OFL.txt), [JetBrains Mono](https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/OFL.txt) as OFL and [Material Symbols](https://raw.githubusercontent.com/google/material-design-icons/master/LICENSE) as Apache, pending binary provenance. Existing bb extraction uses `emitFile` before notices. Reuse, product independence, U8 sign-off, complexity limits and the three-round stop are sound.