# Phase 0 · Program setup

## Gate (plan.md § Program setup, step 4) — passed 2026-09-24

- `python3 implementations-plan/ux-feedback/design/mocks/build.py` → exit 0 (1556 KiB page).
- `node implementations-plan/ux-feedback/design/shots.mjs` → exit 0, 36/36 shots (round-5 targets
  included).
- Artifact republished at its URL as Version 5 (round 5: U1–U12); `picks` store read back, 22 docs.
- `geckodriver --version` → `geckodriver 0.37.1 (300705c65d1b 2026-07-17 09:25 +0000)`.
- Baseline smoke on the untouched base (`ad9f9ffb`, docs only on top of `origin/dev`):
  - Chrome: 139 passed, 8 skipped (147), exit 0, 902 s.
  - Firefox: 36 files passed, 2 skipped; 135 passed, 12 skipped (147), exit 0, 1063 s.
  - `bun run e2e:reap` afterwards: nothing to reap.

## Notes

- Geckodriver installed from the pins in `.github/actions/setup-geckodriver/action.yml`
  (tarball and extracted-binary SHA-256 both verified, single-member archive), to
  `~/.local/bin`; Puppeteer's Firefox `stable_153.0.4`. `~/.local/bin` must be on `PATH` for the
  Firefox runs.
- Round 5 draws only what the code already has and no round drew; each state carries the
  recommended option and a picker (`i5b`, `i6e`–`i6k`, `i8b`, `tipsb`, `tipsc`). U10 has no
  picker (overlays unchanged).
- Building the mocks against the real components surfaced two facts the drawings now follow:
  `Banner.vue` always draws the `info` icon (the done variant only turns it green), and the
  browser hands the identity block a punycode host, so U8's sample is `xn--tls-seda.nulo.sh`.
- The "Test USDC" follow-up was restated from the tree: the extension's testnet seed
  (`default-tokens.ts`, `0x1c81…e9ae`) is absent from `apps/tools/public/testnet-bridge.json`.
