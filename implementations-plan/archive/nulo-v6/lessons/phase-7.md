# Phase 7 · Release 0.29.0

## Step 1 · Live checks (2026-10-01, read-only, origin only)

- First pass, about 11:00Z, before the promote:
  - `node_getNodeInfo` through the wallet's silent client: `nodeVersion 6.0.0-rc.1`,
    `l1ChainId 11155111`, `rollupVersion 2914217885`, matching the pins.
  - `seed-preflight.ts 0x06a9…924b 0x2f85ee9e…f433` from `apps/extension`: exit 0. The instance's
    `currentContractClassId` equals the class `deriveSponsoredFpc` gives (salt zero, no
    arguments).
  - The SponsoredFPC's public Fee Juice, read at FeeJuice storage slot `map(1, sponsor)` the way
    rc.1's `getFeeJuiceBalance` reads it: 1,931.89 FJ, above the 100 FJ floor.
  - rc.1's `AztecAddress` has no `fromString`; the scratch reader uses `fromStringUnsafe`.
- Second pass, 13:50Z, just before #737 merged: the same three results (`nodeVersion 6.0.0-rc.1`,
  `rollupVersion 2914217885`; preflight exit 0 with `currentContractClassId` matching; 1,931.89
  FJ). Both logs carry no URL with a path.

## Step 2 · The owner's hands-on run

- **Waived by the owner**, 2026-10-01: "regarding (1) I trust the vast amount of tests we have."
  What stands in for it: both execution canaries prover-ON on Chrome and Firefox (locally in P5 and
  in #737's CI), the full network suite on both browsers against the local network, and step 1's
  read-only checks against the live V6 node. No transaction has run on the live V6 testnet from a
  release build.

## Step 3 · BEFORE-LAUNCH.md § 4 (2026-10-01)

- `git diff v0.28.0 -- legal/ packages/legal/` touches `legal/terms.md` (the A2 edit in place) and
  `legal/README.md` only; `legal/privacy.md` and the manifest are unchanged.
- § 4 asks for a new version when a document changed since the last release. Terms 1.0 still has
  `effective: null` in `packages/legal/src/manifest.ts`, so it is a draft no one is bound by yet,
  and the owner chose to edit it in place (A2). Nothing to fill; the 1.0 effective date stays § 3's
  job at v1.0.0.

## Step 4 · The promote and the release PR

- `release: promote dev → main (aztec v6: nulo v6 on the v6 testnet)` opened as #737 at 13:27Z
  from `dev` at `80663b61`: 59 commits since `v0.28.0`, none breaking. Every check passed at the
  first attempt: quality, workflow lint, smoke and network e2e on Chrome and on Firefox, both
  lanes' prover-ON canary jobs included (merge state `CLEAN`).
- Merged by the driver on the owner's word, 2026-10-01: "(2) can't you do it yourself leveraging
  my gh cli?" `gh pr merge 737 --merge` at 13:54:58Z: `e9405ab5`, signature valid, parents
  `95eb2902` (`v0.28.0`'s release commit) and `80663b61`.
- release-please opened #738, `chore(main): release 0.29.0`, at 13:56Z: the manifest and both
  `package.json` files move 0.28.0 → 0.29.0, and the changelog lists every PR since 0.28.0, #736
  under Features. One cosmetic flaw, left as generated: #695's subject renders "@aztec" as a link
  to github.com/aztec.
- The owner, asked whether the driver merges #738 once green and merge-commits the sync PR,
  answered "Yes, merge it when green" and "Yes, merge-commit it" (2026-10-01).
- #738's CI: every newest run green, Firefox smoke included (14:16Z). The PR read `UNSTABLE`
  until then. Its first runs were cancelled within a minute of opening, and their aggregators'
  failures (13:56Z) stay on the commit. The `nulo-landing` preview build on the release branch
  also failed; it is not a required check, and the same build passed on `80663b61` and
  `e9405ab5`. Each required check's newest result was green.
- Merged by the driver at 14:18:20Z, `gh pr merge 738 --merge`: `2bfce1d3`, signature valid,
  parents `e9405ab5` and `eabab4e4`.
- `release.yml` run `36875297262` on that push, green: release-please aborted as expected, and
  `auto-unstick` tagged `v0.29.0` (annotated, on `2bfce1d3`), created the release at 14:21:17Z
  and relabelled #738 `autorelease: tagged`. Then lint and typecheck, unit tests, both builds,
  smoke against the Chrome zip and, advisory, against the Firefox zip, all green, and
  `attach-assets`. `network-e2e` skipped, opt-in as the runbook says; both store
  jobs skipped, no store flags. Smoke against the zips ran 14:27Z to 14:44:48Z, `attach-assets`
  ended at 14:45:39Z and the sync job at 14:46:22Z.

## Step 5 · After the release

- `gh release view v0.29.0 --json assets -q '[.assets[].name]'`:
  `["nulo-chrome-0.29.0.zip","nulo-firefox-0.29.0.zip","SHASUMS256.txt"]`. Downloaded:
  `sha256sum -c SHASUMS256.txt` OK for both zips; both manifests read "Nulo V6", `version`
  `0.29.0.0`, `version_name` `0.29.0`, and the Firefox one keeps `wallet@nulo.sh`.
- The landing's production build on `2bfce1d3` passed at 14:19:21Z, two minutes before the
  release existed, so nulo.sh kept linking `v0.28.0`, as the runbook's step 7 expects.
- The sync job opened #739, `chore: sync main → dev` (14:46Z): the promote and release commits
  plus the bot's prerelease-manifest re-baseline to 0.29.0. Every check green, both Firefox
  lanes included; merged by the driver at 15:06:46Z, `gh pr merge 739 --merge`: `d7da8e62`,
  signature valid, parents `80663b61` and `42205ab0`, so `main`'s release commit is in `dev`'s
  ancestry.
- The `nulo-landing` production build was re-run from the Cloudflare dashboard after
  `attach-assets` (`main` stayed at `2bfce1d3`, so no push built it), and nulo.sh linked
  `releases/tag/v0.29.0` from 15:17:20Z. `curl -sI` returned every header in
  `apps/landing/public/_headers` with its exact value: the six `/*` headers on `/`, the `/*.html`
  `Cache-Control` on `/index.html` and the `/assets/*` one on a hashed asset. That closes the
  tools extraction's P1 follow-up, whose entry is deleted.

## Step 6 · The V5 dRPC key

- Not confirmed by close-out, so it moved to `follow-ups.md` § Aztec V6. Before the close-out
  merged, the owner dropped it from the follow-ups: "Remove the retiring v5 drpc key as follow-up
  please" (2026-10-01). The plan does not record whether the key is retired.

## Validation gate (2026-10-01)

- Step 1's checks: node, sponsor preflight and floor as stated, at 13:50Z.
- `gh release view v0.29.0 --json assets -q '[.assets[].name]'`:
  `["nulo-chrome-0.29.0.zip","nulo-firefox-0.29.0.zip","SHASUMS256.txt"]`.
- `gh run view 36875297262`: every job green; `network-e2e` and both store jobs skipped by
  design.
- The landing checks: nulo.sh links `v0.29.0` and serves every `_headers` header.
- The hands-on run: waived by the owner (step 2).

Pass, as written, with the owner's waiver for the hands-on run.
