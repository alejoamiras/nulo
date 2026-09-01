# Phase 4 — Drip vocabulary (arc 2, `refactor/tools-drip-tab`)

Commit `a413c886` (`feat(tools): rename the faucet tab to drip`). Six `git mv`s (view, drip composable, add-token composable + their tests), the symbol set from plan §Scope arc 2, the tab id/label, the manifest builder + description, the bridge-core promotion vocabulary (`assertDripCandidateShape`, `bridge+drip`, `drip` summary key), the three copy lines, and the drip-feature prose that arc 1 deliberately left (`App.vue`, `capabilities.ts`, `useWalletConnection.ts`, `useBridgeWallet.ts`, `BridgeAddToken.vue`, `constants/tokens.ts`, `bridge-deployments.ts`, `network.ts`, `testids.ts`, deploy scripts, the README tab list, three extension-test comments, the aztec contracts README).

Applied as a scripted pass (six `git mv` + ordered symbol `sed`s over the 21 files that carried the symbols, then per-file prose `sed`s), followed by a hand pass over the residue: `App.vue` comment lines, `useDrip.ts:120`, `useWalletConnection.test.ts:202`, six `capabilities.test.ts` strings, and four `capabilities.ts` phrasings the mechanical `\bfaucet\b → drip` had left as "the drip's" / "for the drip." (→ "the Drip tab's" / "for the Drip tab."). Two pre-existing review-history parentheticals on touched `live-intent.ts` lines were dropped.

**Final allow-list (master grep, 22 files)** — the keep list + the legacy literal only: `icons.json` ×2, `useLogFilters.ts`, `TransactionCard.vue`, `tx-enrichment.test.ts`, `price-map.ts` / `default-tokens.ts` / `token-balance/service.ts` ("faucet-minted"/"faucet mints"), `apps/tools/README.md` ×2 (archive links), `useL1Usdc.ts` ×2 (concept prose), `useWalletConnection.ts` ×1 (`LEGACY_APP_ID`), `build-integrity.test.ts` ×1 + `preview-hosts.test.ts` ×4 (branch-name fixtures), `tools-smoke.test.ts` ×1 (case 2c), `contracts/bridge/evm/README.md:68` ("Faucet-by-design"), five `.sol` files, `packages/bridge-core/README.md:40` (archive link), `packages/wallet-bridge/README.md:134` ("Nethermind faucet").

## Gate

```
bun run audit:tools → typecheck:all every workspace exit 0 ∥ test:tools 67 files / 738 passed ∥ lint 0 errors + baseline OK → verify:deployments match → build ✓
bun run --cwd apps/tools test:e2e → 3 files / 16 passed (jsdom; incl. 2b current key + 2c legacy key)
bun run --cwd packages/bridge-core test → 320 passed, 5 skipped (incl. promotion.test.ts against the new error strings)
git grep -n '"fa-' -- apps/tools → 0
master grep → exactly the 22-file allow-list above
manual real-wallet check → PASSED (2026-09-01 23:27–23:31 UTC), see below
```

## Real-wallet check (headless Chrome + the built extension, throwaway Puppeteer spec, not committed)

Setup: extension `dist/chrome` built armed at 22:27 UTC from the arc-1 tree (manifest `Nulo (V5)` `0.27.0.0`; the extension source is untouched by arc 2), the tools app served by `TOOLS_DEV_PORT=5199 bun run --cwd apps/tools dev` at `a413c886`, a fresh profile created through onboarding, the wallet on its default network. The spec reused the smoke fixtures (`launchExtension`, `registerProfile`, `waitForPopup`, `approveDiscover`, `approveVerify`, `approveCapabilities`) and lived at `apps/extension/tests/e2e/zz-tools-reconnect.tmp.test.ts` for the run only.

```
FRESH  DISCOVER_NAME=nulo-tools                       ← the wallet's discover popup names the app nulo-tools
AFTER_FRESH  current={"id":"nulo","name":"Nulo"} legacy=null
IDLE_BUTTON=Connect Nulo                              ← with ONLY nulo-faucet:preferred-wallet seeded, the idle label is restored from the legacy key
PICKER_SEEN=false                                     ← the remembered path never opened the picker
AFTER_LEGACY current={"id":"nulo","name":"Nulo"} legacy={"id":"nulo","name":"Nulo"}   ← promoted on full success; legacy left in place by design
vitest: 1 passed, EXIT=0
```

Two harness facts worth keeping: the wallet announces itself to the page only AFTER its discover popup is approved, so a dApp-side picker row cannot be awaited before that approval (the first attempt deadlocked on exactly this); and a dev-served app has no `nulo-build` meta (only production builds inject it), so the build id above comes from the built extension's manifest, not the page.

"Forget leaves neither key" has no UI entry point in the tools app (`forgetPreferredWallet` is a session API; the panels only expose `switchWallet`, which deliberately KEEPS the preference), so it is proven by the unit cases `forgetting the wallet removes BOTH keys` and `a failed remembered connect clears the legacy key too` rather than in the browser.
