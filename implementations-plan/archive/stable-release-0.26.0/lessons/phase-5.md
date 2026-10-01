# Phase 5 — sync-back main → dev (PR #322) + Phase 6 live verification

## Phase 5 — ✓ GREEN
- `sync-main-to-dev` opened **#322 `chore: sync main → dev`** (App-token → dev CI fired). No conflict (`labels=[]`, not `needs-manual-resolution`).
- Files: `.release-please-manifest.json`, `.release-please-prerelease-manifest.json`, `CHANGELOG.md`, `apps/extension/package.json`, `package.json` — the `apps/extension/package.json` bump matched `extension-network`, so full network-e2e ran (as codex predicted). First-batch note: unlike #321, #322 saw no superseded/cancelled batch — its runs went straight to success.
- All 3 required aggregators green (`quality`/`smoke`/`network-e2e`), `state=CLEAN`.
- Merged via `gh pr merge 322 --merge` (merge-commit, NOT squash). Merge commit `1da3377d45705b8e6f792e5a6a4be66ff26071e8`; **2-parent check = 3**. `origin/dev` advanced.
- Post-merge dev anchors: `package.json` version `0.26.0`; `.release-please-prerelease-manifest.json` `{".":"0.26.0"}` (rebaselined for the next rc series). No `--admin` needed (App-signed manifest commit satisfied required_signatures).

# Phase 6 — ✓ GREEN (verified)
- `verify live deploys (advisory)` job in the release run: **success**.
- Independent confirmation:
  - `https://nulo.sh` serves **v0.26.0** (landing references v0.26.0 + `nulo-chrome-0.26.0`).
  - `https://testnet.tools.nulo.sh/build.json` → `{"buildId":"0.1.0+bffaad26","version":"0.1.0","chainId":1816023401}` — `buildId` SHA-suffix `bffaad26` == **TAG_SHA** ✓ (faucet independently versioned 0.1.0, per the codex-corrected Fact #8). Sites fresh by release SHA.
