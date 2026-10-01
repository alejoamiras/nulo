# Release Tooling Research for `@nulo/extension`

## Bottom line

Your premise is slightly off: this is not primarily a "best changelog generator" decision. Nulo needs a **release orchestrator** with explicit-version control, good failure recovery, and strong release-note quality. The best fit for your shape is **`release-it` as the coordinator**, optionally delegating release-note generation to **`git-cliff`**. The browser-store story stays separate either way.

That conclusion also matches what serious wallet/browser-extension teams actually do. Public evidence from **MetaMask Extension** and **MetaMask Mobile** shows custom release PR + publish workflows, not a generic one-command framework; **Rabby** has custom build/release automation; **Rainbow** uses `release-it` only in a subpackage, not as a repo-wide release system. **Phantom is not public enough on the release-infra side to treat as a useful signal.** The practical go-to in 2026 is still: **GitHub Actions + explicit release workflow + a small number of focused tools**.

## What you missed

The list is not complete.

- **`WXT submit`** is the most relevant omission for the browser-extension ecosystem. It can submit Chrome/Firefox/Edge builds from CI, but it is really part of adopting WXT's extension framework, not a drop-in release tool for your current build.
- **`Beachball`** is the most relevant omission in the "wallet-grade human-authored notes" camp. If you wanted deliberate change files but did not like Changesets, this is the other serious option.
- **Store CLIs are first-class citizens here**: `web-ext` for Firefox and a Chrome Web Store upload CLI are still the real delivery primitives, no matter which release framework you pick.

## Tool-by-tool verdicts

**`release-it`**. Maturity is strong: about **8.9k stars**, latest **`20.0.1` on April 24, 2026**, latest major **20**, and effectively **one primary maintainer (`webpro`) plus a broad contributor/plugin ecosystem**. This is the best fit for your exact workflow because it is happy in a **manual `workflow_dispatch`** world, supports **prereleases**, **GitHub Releases**, hooks, and reruns via `--no-increment` when a partial failure leaves version/tag state behind. Bun compatibility is fine in practice as a JS CLI, but it is not Bun-native; run it under Node in CI or invoke it from Bun without pretending upstream tests Bun. Marketplace story is weak out of the box: no first-party Chrome/AMO pipeline I would trust long-term, so plan on separate `web-ext` / Chrome-store steps anyway. Release-note control is excellent if you override its changelog source, and that is exactly why `release-it + git-cliff` is the winning combo.

**`release-please`**. Mature and heavily used: about **6.9k stars**, latest **`17.6.0` on April 13, 2026**, latest major **17**, and clearly **multi-maintainer / Google-backed**. The problem is not quality; it is workflow shape. `release-please` wants to create and maintain **release PRs**, and explicit version overrides still revolve around **`Release-As:` commits** or release-PR mechanics, which is awkward for your "`workflow_dispatch` with `version` input" requirement. Recoverability is excellent because the version/changelog changes land in a release PR before publication, but that same PR-first model is extra ceremony for a single shippable artifact. No native store publishing story. Great if you decide you want a reviewable release PR every time; not great if you want a clean one-button manual release from `main` or `dev`.

**`semantic-release`**. Still the popularity king at about **23.7k stars** with latest **`25.0.3` on January 30, 2026**, latest major **25**, and a visible **3-person core team**. It is also a bad fit. The README is explicit that no human should be directly involved in the release. That clashes with your intentional, explicit-version, branch-gated manual release model. Yes, it can do channels and prereleases, and yes, it has a huge plugin ecosystem, but forcing an exact version number into `semantic-release` is working against the tool rather than with it. Bun compatibility is fine as a Node CLI, but its assumptions are CI-first and commit-driven. I would not use it for a wallet extension where release state must remain boring and recoverable.

**`auto`**. Mature enough, but less relevant: about **2.4k stars**, latest **`11.3.6` on November 14, 2025**, latest major **11**, and **corporate/multi-maintainer ownership through Intuit**. Its strongest argument is the official **Chrome Web Store plugin**, which is better than most competitors. Its weakest argument is the release model: `auto` is built around **PR labels** and usually commit/PR-driven automation, not "operator picks exact version X on this branch now." You can bend it, but you will spend time fighting defaults. No equivalent first-party Firefox AMO story, so you'd still need separate tooling there. Good tool, wrong shape.

**`changesets`**. Very mature: about **11.8k stars**, current stable CLI still on major **2** with a **3.0.0-next** line visible, latest repo release activity in **May 2026**, and a healthy community-maintained project. This is the most serious alternative if you care more about **human-written release notes** than about a minimal operator flow. A changeset file per meaningful PR is excellent for wallet-grade trust. But you only ship **one artifact**, and you want the operator to pass an explicit version in `workflow_dispatch`; Changesets is best when the version is derived from accumulated change files, not typed in by hand at release time. Recoverability is strong because versioning is prepared before publish, but the workflow model is heavier than you need today.

**`git-cliff`**. Extremely solid: about **11.8k stars**, latest **`2.13.1` on April 26, 2026**, latest major **2**, and effectively **one strong maintainer (Orhun) with steady contributors**. Release-note quality is top-tier because the templating is deep, structured, and deterministic. It is also not a full release framework. For Nulo, `git-cliff` is excellent as the **release-notes engine**, not as the whole system. Bun compatibility is a non-issue because it is a standalone binary. Marketplace story is none. Recoverability is strong only when you compose it with separate bump/tag/release steps, which is why it pairs well with either `release-it` or a thin custom workflow.

**`changelogen`**. Respectable but less active: about **1.2k stars**, latest **`0.6.2` on July 6, 2025**, still on major **0**, and maintained by a **small UNJS core**. This is the cleanest simple JS tool in the Bun-adjacent ecosystem: it can bump, tag, and even sync GitHub releases, and it feels natural in a Bun/UnJS-flavored repo. But it is still more of a **smart changelog-and-bump utility** than a release-control framework. Template control is good but not as deep as `git-cliff`, and recoverability is lighter-weight but more DIY. Good tool; not best-of-class for a wallet release pipeline where failure semantics matter.

**`commit-and-tag-version`**. Small but stable: about **623 stars**, latest tag **`v12.7.3`** with release activity still current in **2026**, latest major **12**, and a **small maintainer base**. It is basically the maintained successor line for `standard-version`: bump files, generate changelog, commit, tag. For a manual explicit-version workflow it is actually decent, and its lifecycle hooks are useful. But it stops short of being a real release framework: GitHub Release creation, assets, and store publishing are all separate. It is the best "classic standard-version style" option, but `release-it` has surpassed it for your use case.

**`knope`**. Worth serious consideration, but not the winner. It is newer and smaller at about **169 stars**, latest **`0.22.4` in March 2026**, still on major **0**, and appears to have a **small core team**. The good news: it understands versioned files, changelogs, GitHub releases, and release assets in a way that produces clean, explicit workflow steps. The bad news: you are swimming upstream against the broader JS/Bun/browser-extension ecosystem, and the integration story for future Chrome/AMO publishing is weaker than with JS-first tools. If you wanted a single binary and were willing to accept ecosystem risk, I would rank it above `changelogen` but below `release-it`.

**`bumpp`**. Healthy and practical: about **928 stars**, latest **`11.1.0` on May 7, 2026**, latest major **11**, and effectively **two visible core maintainers (`antfu`, `sxzz`) plus contributors**. It is Bun-friendly in spirit and in packaging, and it is excellent at one thing: **version bump orchestration**. It also supports commit/tag/push and config hooks, so it is more capable than people assume. But release notes, GitHub releases, assets, and store publishing remain external. I would not use `bumpp` alone for Nulo, but I would absolutely use it in a composed stack if you wanted the thinnest possible release logic.

**`gh release create --generate-notes`**. Zero-install is its only real superpower. It is maintained by GitHub, trivially scriptable, and great as the final publish primitive in Actions. But GitHub-generated notes are not wallet-grade enough on their own. They are fine for v0 internal cadence; they are not what I would want users reading when trust is part of the product. Use `gh release create` as the transport, not as the note author.

## Ranked recommendation

1. **`release-it` + `git-cliff` + `gh release create`**
2. **`release-it` alone**
3. **`git-cliff` + `bumpp` + thin custom shell/Actions glue**

`release-it + git-cliff + gh` wins because it matches your exact workflow: explicit version input, stable/prerelease channels, GitHub release assets, and good rerun semantics. `release-it` alone is second if you want less moving parts and can live with simpler note generation. The thin composed stack is third if you want maximum determinism and minimum framework behavior, but you will own more glue.

## The actual go-to in 2026

For **Bun + browser extension + manual release workflow**, the honest winner is **`release-it`**, not `git-cliff`, not `changelogen`, and definitely not `semantic-release`.

The important nuance is that the **real go-to is not "one package does everything."** The real go-to is:

1. **`release-it`** to own version/tag/release orchestration.
2. **`git-cliff`** to own release-note quality.
3. **Store-specific tooling later** for Chrome Web Store and AMO.

That is the pattern closest to how serious shipping teams behave: one coordinator, one note generator, one store-delivery layer. Do not push Chrome-specific manifest normalization into the release framework. Fix that in [`packages/extension/manifest/manifest.config.ts`]((project root)/packages/extension/manifest/manifest.config.ts:6) or a tiny prebuild normalization helper, because invalid manifest versions are a product build concern, not a release-note concern.

## Recommendation for Nulo

Use a composed setup, not a monolith.

- Add a `.release-it.json` at the repo root and treat `packages/extension/package.json` as the single source of semver truth.
- Generate notes with `git-cliff` from the previous tag to `HEAD`, then hand that output to `release-it` / `gh release`.
- Keep Chrome/Firefox submission as separate future jobs using dedicated store CLIs.
- Fix prerelease manifest normalization in code before you automate anything else.

If I were implementing this now, I would aim for a release workflow that feels like:

```sh
bun run build:chrome
bun run build:firefox
git-cliff --tag "$VERSION" --output CHANGELOG.md
release-it "$VERSION" --ci
```

with the asset upload and branch/channel flags wired in `.github/workflows/release.yml`, not embedded in a giant bespoke script.

## Sources

- `release-it`: https://github.com/release-it/release-it and https://github.com/release-it/release-it/blob/main/docs/github-releases.md
- `release-please`: https://github.com/googleapis/release-please and https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md
- `semantic-release`: https://github.com/semantic-release/semantic-release
- `auto`: https://github.com/intuit/auto and https://intuit.github.io/auto/docs
- `changesets`: https://github.com/changesets/changesets
- `git-cliff`: https://github.com/orhun/git-cliff
- `changelogen`: https://github.com/unjs/changelogen
- `commit-and-tag-version`: https://github.com/absolute-version/commit-and-tag-version
- `knope`: https://github.com/knope-dev/knope and https://knope.tech/reference/config-file/steps/release/
- `bumpp`: https://github.com/antfu-collective/bumpp
- GitHub CLI release docs: https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository?tool=cli
- WXT submit docs: https://wxt.dev/guide/essentials/publishing.html and https://wxt.dev/api/cli/wxt-submit
- MetaMask extension publishing workflow: https://github.com/MetaMask/metamask-extension/blob/main/docs/publishing.md
- MetaMask extension release workflows: https://github.com/MetaMask/metamask-extension/blob/main/.github/workflows/create-release-pr.yml and https://github.com/MetaMask/metamask-extension/blob/main/.github/workflows/publish-release-from-release-head.yml
- MetaMask mobile release workflow: https://github.com/MetaMask/metamask-mobile/blob/main/.github/workflows/create-release-pr.yml
- Rabby build workflow: https://github.com/RabbyHub/Rabby/blob/develop/.github/workflows/autobuild.yml
- Rainbow subpackage `release-it` usage: https://github.com/rainbow-me/rainbow/blob/develop/src/react-native-animated-charts/.release-it.json
