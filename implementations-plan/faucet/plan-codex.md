## 1. Summary

Build `packages/faucet/` as a standalone Vue 3 + Vite app with no router, no Pinia, and no backend. The app has one job: discover an Aztec wallet through `@aztec/wallet-sdk`, request the minimum capabilities needed to select an account and submit two fixed `Dripper` calls, then let the user drip fixed USDC or ETH into either public or private balance on alpha-testnet.

Keep the implementation narrow. Contract addresses live in `packages/faucet/src/contracts/deployments.json`, design tokens are vendored from `packages/extension/src/assets/styles/_base.scss` and `packages/extension/src/design/tokens.ts`, and all repo rules come from `CLAUDE.md`: Bun, Biome, Vue SFC ordering, colocated tests, `data-testid` selectors, no emoji except the wallet-sdk verification grid, and no WHAT-comments. The faucet should wait for the default `wallet.sendTx(...)` receipt path rather than fire-and-forget, so the UI can show a real accepted transaction state instead of a blind optimistic success.

## 2. Architecture

```text
deployments.json + TOKEN_CATALOG
        |
        v
contracts/deployments.ts ----> registerable contract instances
        |                              |
        |                              v
        |                    wallet.registerContract(...)
        |
        v
useWalletConnection.ts
  WalletManager.configure(...)
  -> discovery
  -> establishSecureChannel()
  -> hashToEmoji(verificationHash)
  -> pending.confirm()
  -> requestCapabilities(manifest)
  -> granted.accounts
        |
        v
useFaucetDrip.ts
  DripperContract.at(..., wallet)
  -> methods.drip_to_public/private(tokenAddress, amount).request()
  -> attach feePayer = SponsoredFPC
  -> wallet.sendTx(exec, { from })
        |
        v
App.vue + fresh faucet components
```

State lives in three places only.

1. `useWalletConnection.ts` owns wallet/provider/session/account state.
2. `useFaucetDrip.ts` owns in-flight drip state plus the last receipt/error per token card.
3. `useToast.ts` owns a single transient toast.

Everything else is props/emits. No global store. No router. No service layer abstraction. This package is too small to justify either.

## 3. File-by-file layout

```text
packages/faucet/
├── README.md                                      package purpose, local dev, deploy command, invariants
├── package.json                                   Bun scripts and exact dependency pins matching the repo’s Aztec line
├── tsconfig.json                                  strict TS config with Vue SFC, JSON imports, and @ alias
├── vite.config.ts                                 Vue plugin, Aztec polyfills, COOP/COEP dev headers, alias, optimizeDeps
├── vitest.config.ts                               Vue-aware Vitest config for colocated component/composable tests
├── index.html                                     app shell, dark theme default, minimal process/global browser shim
├── public/
│   ├── _headers                                   Cloudflare Pages headers: COOP, COEP, CSP, cache policy
│   ├── favicon.svg                                vendored Nulo favicon
│   └── fonts/
│       ├── InterVariable.woff2                    vendored body font
│       ├── JetBrainsMono-latin.woff2              vendored mono font
│       ├── SpaceGrotesk-latin.woff2               vendored headline font
│       └── SpaceGrotesk-latin-ext.woff2           vendored headline extension font
├── scripts/
│   ├── deploy-config.ts                           faucet-only token list and network config for deploy script
│   └── deploy.ts                                  self-owned wrapper around Aztec deploy flow; writes src/contracts/deployments.json
└── src/
    ├── main.ts                                    creates Vue app, imports vendored design CSS, mounts App.vue
    ├── App.vue                                    single page shell: hero, wallet panel, token cards, toast region, footer
    ├── env.d.ts                                   Vite env typings for VITE_CHAIN_ID, VITE_CHAIN_VERSION, VITE_NULO_INSTALL_URL
    ├── test/
    │   └── setup.ts                               jsdom helpers for process/global/Buffer shims and common test stubs
    ├── design/
    │   ├── base.css                               vendored CSS vars, font-face rules, reset, app-level brutalist base styles
    │   └── tokens.ts                              vendored typed reflection of CSS variable names
    ├── constants/
    │   └── tokens.ts                              canonical faucet token catalog with fixed display amount and bigint on-chain amount
    ├── contracts/
    │   ├── deployments.json                       committed alpha-testnet dripper + USDC + ETH deployment output
    │   ├── deployments.ts                         parses JSON, validates symbols/decimals, reconstructs contract instances
    │   ├── deployments.test.ts                    proves JSON parsing/validation/invariants
    │   └── sponsored-fpc.ts                       computes deterministic SponsoredFPC address from protocol salt
    ├── lib/
    │   ├── capabilities.ts                        builds the exact wallet-sdk manifest for this faucet
    │   ├── capabilities.test.ts                   proves manifest metadata and exact scopes
    │   ├── chain-info.ts                          reads query/env chain overrides and returns wallet-sdk ChainInfo
    │   ├── errors.ts                              normalizes wallet/discovery/tx errors into UI-safe categories
    │   ├── errors.test.ts                         proves error mapping for reject, network, fee, init, revert cases
    │   ├── format.ts                              trimAddress, receipt formatting, brutalist status labels
    │   ├── testids.ts                             central source for interactive data-testid strings
    │   └── wallet.ts                              pure wallet-sdk helpers: granted account extraction, contract registration sequence
    ├── composables/
    │   ├── useToast.ts                            one-toast composable, no external dependency
    │   ├── useWalletConnection.ts                 connect/disconnect/verify/requestCapabilities/register contracts/select account
    │   ├── useWalletConnection.test.ts            ≥10 cases across discovery, verify, authorize, register, disconnect, error paths
    │   ├── useFaucetDrip.ts                       builds dripper exec payloads and submits them with sponsored fee payer
    │   └── useFaucetDrip.test.ts                  ≥10 cases across public/private, USDC/ETH, receipt, reject, fee, lock states
    └── components/
        ├── AppButton.vue                          fresh brutalist button primitive used everywhere interactive
        ├── AppButton.test.ts                      ≥5 cases for variants, disabled, loading, click behavior
        ├── AppToastRegion.vue                     fixed-position toast renderer driven by useToast
        ├── EmojiGrid.vue                          3x3 verification grid fed by hashToEmoji output
        ├── EmojiGrid.test.ts                      ≥5 cases for 9-char layout and rendering stability
        ├── VerificationModal.vue                  wallet verification overlay with grid, warning copy, cancel action
        ├── VerificationModal.test.ts              ≥5 cases for state, copy, cancel, visibility
        ├── WalletPanel.vue                        connect area, install-Nulo empty state, account select, disconnect
        ├── WalletPanel.test.ts                    ≥5 cases for idle, no-wallet, connected, multi-account, error rendering
        ├── TokenCard.vue                          USDC/ETH card with public/private drip buttons and last receipt/error row
        └── TokenCard.test.ts                      covers idle, busy, success, error, disabled, emitted action payload
```

## 4. Phase plan

1. Package scaffold and vendored design layer.

Files: `packages/faucet/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.ts`, `src/App.vue`, `src/design/base.css`, `src/design/tokens.ts`, `public/fonts/*`, `public/favicon.svg`.

Validate: `bun run --cwd packages/faucet typecheck`.

Risk: Aztec browser bundles fail before Vue mounts if `process`/`global` shims are missing. Mitigation: mirror the already-working `packages/playground/index.html` bootstrap and `vite-plugin-node-polyfills` pattern instead of inventing a lighter variant.

2. Contract and deploy plumbing.

Files: `packages/faucet/scripts/deploy-config.ts`, `scripts/deploy.ts`, `src/contracts/deployments.json`, `src/contracts/deployments.ts`, `src/contracts/deployments.test.ts`, `src/contracts/sponsored-fpc.ts`, `src/constants/tokens.ts`.

Validate: `bun run --cwd packages/faucet deploy --dry-run --network testnet` and `bun run --cwd packages/faucet test src/contracts/deployments.test.ts`.

Risk: raw deployment JSON is not a `ContractInstanceWithAddress`. Mitigation: reconstruct each instance with `getContractInstanceFromInstantiationParams(...)` from the artifact plus the stored constructor params, then register that computed instance.

3. Wallet session and capability handshake.

Files: `src/lib/chain-info.ts`, `src/lib/capabilities.ts`, `src/lib/wallet.ts`, `src/composables/useWalletConnection.ts`, `src/composables/useWalletConnection.test.ts`, `src/components/EmojiGrid.vue`, `src/components/VerificationModal.vue`, `src/components/WalletPanel.vue`.

Validate: `bun run --cwd packages/faucet test src/lib/capabilities.test.ts src/composables/useWalletConnection.test.ts src/components/VerificationModal.test.ts src/components/WalletPanel.test.ts`.

Risk: if multiple wallets ever start appearing, “first provider wins” becomes unstable. Mitigation: in v1, follow the verified playground pattern and take the first provider; keep provider collection isolated in `useWalletConnection.ts` so a wallet chooser can be added later without rewiring the app.

4. Drip execution path and brutalist UI states.

Files: `src/lib/errors.ts`, `src/lib/format.ts`, `src/lib/testids.ts`, `src/composables/useToast.ts`, `src/composables/useFaucetDrip.ts`, `src/components/AppButton.vue`, `src/components/AppToastRegion.vue`, `src/components/TokenCard.vue`, `src/App.vue`.

Validate: `bun run --cwd packages/faucet test`.

Risk: wallet popups serialize interaction anyway, so parallel drips just create a confusing queue. Mitigation: one global in-flight action; disable all four drip buttons while a request is pending.

5. README, hosting headers, and repo gate integration.

Files: `packages/faucet/README.md`, `public/_headers`, root `package.json`.

Validate: `bun run audit:vue`.

Risk: the faucet can pass its own package tests and still be missing from the root gate. Mitigation: explicitly update the root scripts so `audit:vue` runs faucet tests and build, not just extension ones.

## 5. Wallet-SDK integration details

Use the exact discovery flow already proven in `packages/playground/src/lib/wallet.ts`.

```ts
const manager = WalletManager.configure({ extensions: { enabled: true } })
const discovery = manager.getAvailableWallets({
  chainInfo: readChainInfo(),
  appId: "nulo-faucet",
  timeout: 60_000,
})
for await (const provider of discovery.wallets) {
  firstProvider = provider
  break
}
const pending = await firstProvider.establishSecureChannel("nulo-faucet")
const emojis = hashToEmoji(pending.verificationHash)
const wallet = await pending.confirm()
const granted = await wallet.requestCapabilities(buildManifest(...))
```

`readChainInfo()` should copy the playground’s query-param override pattern exactly, with precedence:

1. `?chainId=...&version=...`
2. `VITE_CHAIN_ID` / `VITE_CHAIN_VERSION`
3. `Fr.ZERO` / `Fr.ZERO`

That lets test drivers pin alpha-testnet precisely without adding a visible network switcher.

The manifest should be minimal and fixed. No wildcard transaction scope.

```ts
{
  version: "1.0",
  metadata: {
    name: "nulo-faucet",
    version: "0.1.0",
    url: window.location.origin,
  },
  capabilities: [
    { type: "accounts", canGet: true, canCreateAuthWit: false },
    {
      type: "contracts",
      contracts: [dripperAddress, usdcAddress, ethAddress],
      canRegister: true,
      canGetMetadata: false,
    },
    {
      type: "transaction",
      scope: [
        { contract: dripperAddress, function: "drip_to_public" },
        { contract: dripperAddress, function: "drip_to_private" },
      ],
    },
  ],
}
```

Use `granted.accounts` as the only source of truth for connected accounts. Do not call `wallet.getAccounts()` in the normal path. The faucet is a dapp, not an account manager.

Contract registration order should be strict and deterministic.

1. Parse `src/contracts/deployments.json`.
2. Rebuild the `Dripper` instance from the dripper deploy record.
3. Rebuild the USDC token instance from the token record whose `constructorArgs.symbol === "USDC"`.
4. Rebuild the ETH token instance from the token record whose `constructorArgs.symbol === "ETH"`.
5. Call `wallet.registerContract(instance)` in that order.

Do not rely on array order in `deployments.json`; map by symbol. The deploy script currently writes an array, not a keyed object.

For the tx itself, use the generated contract class and the wallet directly. The faucet does not need a backend or a local Aztec node.

```ts
const dripper = await DripperContract.at(AztecAddress.fromString(dripperAddress), wallet as any)
const interaction =
  visibility === "public"
    ? dripper.methods.drip_to_public(AztecAddress.fromString(tokenAddress), amount)
    : dripper.methods.drip_to_private(AztecAddress.fromString(tokenAddress), amount)

const exec = await interaction.request()
const tx = await wallet.sendTx(
  { ...exec, feePayer: sponsoredFpcAddress } as any,
  { from: AztecAddress.fromString(selectedAccount) } as any,
)
```

Do not pass `wait: "NO_WAIT"`. Nulo’s `aztec_sendTx` default path returns a receipt after `node.getTxReceipt(txHash)`. That is the right success boundary for this faucet. The UI should show success only after that promise resolves.

Fee payment should be explicit. Compute the deterministic SponsoredFPC address in `src/contracts/sponsored-fpc.ts` using `SPONSORED_FPC_SALT` and `SponsoredFPCContractArtifact`, then attach it as `exec.feePayer`. That avoids depending on the user already holding FeeJuice and keeps the demo path aligned with alpha-testnet expectations. If a wallet ignores or cannot use that embedded fee payer, fail bluntly.

Disconnect should be best-effort and total. Call `provider.disconnect()` if present, clear pending discovery, clear wallet/provider refs, clear selected account, clear verification grid, and clear all last-receipt state. Reconnect should always rerun capability request and contract registration; do not cache grants across page reloads.

One constraint conflict needs to be handled explicitly: the repo says no emojis in code or UI, but wallet verification depends on `hashToEmoji(...)`. Treat that grid as protocol security material, not branding. It is the only emoji surface in the entire package.

## 6. UX & copy

Hero headline: `DRIP TEST ASSETS`

Hero sub: `Alpha-testnet only. Connect an Aztec wallet and mint fixed USDC or ETH into a public or private balance. Internal faucet. No real value.`

Empty no-wallet state: `No Aztec wallet detected on this browser.`

Empty no-wallet CTA label: `Install Nulo`

Connect button states:
- Idle: `Connect wallet`
- Discovering: `Searching for wallet...`
- Verifying: `Verify in wallet`
- Connected: `Wallet connected`
- Error: `Retry connection`

Verification modal copy:
- Title: `VERIFY THE GRID`
- Body: `Match this grid with the wallet window. If it differs, stop.`
- Secondary line: `This check is for the secure channel. It is not decorative.`
- Cancel button: `Cancel request`

Wallet-connected panel copy:
- Label: `Selected account`
- Disconnect button: `Disconnect`
- Multi-account helper: `Use one granted account for all drips.`

TokenCard chrome:
- USDC subtitle: `Fixed drip: 1000 USDC`
- ETH subtitle: `Fixed drip: 1 ETH`
- Badge on both cards: `Test token · no real value`

TokenCard button labels:
- `Drip 1000 USDC to public`
- `Drip 1000 USDC to private`
- `Drip 1 ETH to public`
- `Drip 1 ETH to private`

TokenCard states:
- Idle helper: `Drips mint directly from the permissionless dripper.`
- Dripping helper: `Submitting in wallet...`
- Success helper: `Last receipt received on alpha-testnet.`
- Error helper: `Last request failed.`

Drip success toast copy:
- `USDC to public submitted.`
- `USDC to private submitted.`
- `ETH to public submitted.`
- `ETH to private submitted.`

Common error toast copy:
- No wallet: `No wallet found. Install Nulo and reload.`
- User rejected: `Request rejected in wallet.`
- Network down: `Alpha-testnet is not responding. Try again.`
- Tx reverted: `Drip transaction reverted. Check wallet activity.`
- No fee asset / unsupported sponsored path: `No sponsored fee route available for this wallet session.`
- Account uninitialized: `Selected account is not initialized on alpha-testnet.`

Footer microcopy: `Alpha-testnet only. Permissionless dripper. Fixed amounts. Test token · no real value.`

The visual register should stay blunt: dense cards, square edges, uppercase action labels, mono receipt rows, no mascot copy, no promotional language, no decorative icons.

## 7. Tests

The right ROI here is unit, composable, and component coverage. Not network e2e.

Add these pure/unit tests:

- `src/contracts/deployments.test.ts`
  Checks the parser rejects missing dripper, rejects duplicate symbols, rejects wrong decimals, rejects missing USDC/ETH, and exposes the expected address map.

- `src/lib/capabilities.test.ts`
  Checks manifest metadata, exact accounts capability, exact contracts scope, exact transaction scope, and that no extra capability types are requested.

- `src/lib/errors.test.ts`
  Checks user rejection (`code === 4001`), no wallet discovered, network fetch failure, revert-ish messages, sponsored-fee failure, and account-uninitialized messages.

Add these composable tests:

- `src/composables/useWalletConnection.test.ts`
  At least 10 cases: initial idle state, query override parsing, no-wallet discovery failure, verification state before confirm, granted accounts become selected account, contract registration order, reconnect after disconnect, best-effort provider disconnect, stale error cleared on retry, and multiple granted accounts.

- `src/composables/useFaucetDrip.test.ts`
  At least 10 cases: USDC public payload uses `1_000_000_000n`, USDC private uses same amount, ETH public/private use `1_000_000_000_000_000_000n`, selected account is passed as `from`, SponsoredFPC address is injected as `feePayer`, receipt success stores status, rejection maps to rejected toast, revert maps to error state, concurrent second drip is blocked, and state resets after completion.

Add these component tests:

- `AppButton.test.ts` for primitive behavior.
- `EmojiGrid.test.ts` for 3x3 layout from a 9-character string.
- `VerificationModal.test.ts` for copy and cancel handling.
- `WalletPanel.test.ts` for empty, connected, and multi-account states.
- `TokenCard.test.ts` for idle, busy, success, error, and disabled rendering.

Do not add automated alpha-testnet e2e in v1. It is expensive, brittle, and misleading here because the real risk is wallet/browser/network interplay, not DOM click mechanics. One manual smoke pass is enough before merge:

1. Connect Nulo on alpha-testnet.
2. Drip USDC to public.
3. Drip USDC to private.
4. Drip ETH to public.
5. Drip ETH to private.
6. Reject one drip in the wallet and verify the error path.
7. Disconnect and reconnect.

## 8. Deploy story

The maintainer command should be:

```bash
DEPLOYER_SECRET="..." bun run --cwd packages/faucet deploy --network testnet
```

Optional dry run:

```bash
bun run --cwd packages/faucet deploy --network testnet --dry-run
```

`packages/faucet/scripts/deploy.ts` should be self-owned, not a shell-out to the sibling checkout in `/Users/alejoamiras/Projects/Ecosystem/aztec-standards`. It should reuse the same APIs and artifact classes, but live inside this repo so another maintainer can run it from a clean checkout.

The script should:

1. Create or reuse the deterministic deployer account from `DEPLOYER_SECRET`.
2. Register the deterministic SponsoredFPC and use `SponsoredFeePaymentMethod` for deploy fees.
3. Deploy or reuse `Dripper`.
4. Deploy or reuse `USDC` and `ETH` with `constructor_with_minter(..., dripperAddress)`.
5. Write `packages/faucet/src/contracts/deployments.json`.

Idempotency comes from the same ingredients as the upstream script: universal deploy, deterministic salt, and “already deployed” detection. A rerun should either deploy nothing or only fill missing contracts, then rewrite the same JSON.

The frontend should never read contract addresses from env. It should import `src/contracts/deployments.json` at build time through `src/contracts/deployments.ts`.

## 9. Build & hosting

Build command:

```bash
bun run --cwd packages/faucet build
```

Output dir: `packages/faucet/dist`

Host it on Cloudflare Pages. It is the cleanest fit because the faucet is static and Cloudflare respects a committed `public/_headers` file without extra runtime code.

Setup notes:
- Project root: `packages/faucet`
- Install command: `bun install --frozen-lockfile`
- Build command: `bun run build`
- Output directory: `dist`

Required headers:

```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
```

This package should self-host every font and asset. Do not pull Google Fonts, analytics, or third-party scripts. COEP is much easier to keep correct when everything is same-origin.

In dev, `vite.config.ts` should also set COOP/COEP headers and mirror the playground’s Node polyfill setup. Use port `5176` with `strictPort: true`.

GitHub Pages is the wrong choice here because custom response headers are the whole point.

## 10. CI gates

The faucet should hook into the existing repo gate with minimal root changes.

Package-level scripts:
- `dev`
- `build`
- `preview`
- `typecheck`
- `test`
- `deploy`
- `deploy:dry-run`

Root `package.json` changes:
- Add `dev:faucet`: `bun run --cwd packages/faucet dev`
- Add `build:faucet`: `bun run --cwd packages/faucet build`
- Add `test:faucet`: `bun run --cwd packages/faucet test`

Most root gates already pick it up automatically if the package is named `@nulo/faucet` and exposes `typecheck` and `test`:
- `typecheck:all` already uses `bun run --filter '@nulo/*' typecheck`
- `test:all` already uses `bun run --filter '@nulo/*' --if-present test`
- `lint` already covers `packages/**` through `biome.json`

The one-shot gate should become:

```bash
bun run typecheck:all && bun run test:all && bun run lint && bun run build && bun run build:faucet
```

That preserves the current extension build while adding faucet tests and faucet build.

## 11. Risks & open questions

- The contract artifact import path is a real sharp edge. The repo already proves `@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js` works. I would use that proven path for both `Token` and `Dripper` unless the package’s top-level export is verified in this workspace.

- `deployments.json` is not directly registerable with `wallet.registerContract(...)`. It is deploy metadata, not a full contract instance. I would refuse any shortcut that tries to pass the raw JSON through unchanged.

- Sponsored fee payment is the difference between a usable faucet and a support burden. I would refuse shipping a version that depends on users already holding FeeJuice.

- The exact alpha-testnet `chainId` and `version` defaults are not verified in the brief. The package should support query/env overrides from day one because this is a real integration variable, not a nice-to-have.

- COOP/COEP must be validated against the extension handshake in a real browser. It should work, but it is still a browser-policy boundary and should be treated as such.

- Wallet-agnostic connection is real at discovery time, but sponsored-fee execution may still be Nulo-specific in practice. The UI needs to fail bluntly instead of pretending all wallet-sdk providers are equivalent.

## 12. Non-goals

- No backend, database, analytics, or rate limiting.
- No network switcher, sandbox toggle, or multi-environment UI.
- No custom drip amounts, token forms, or arbitrary contract calls.
- No balance history, explorer integration, or transaction list page.
- No wallet creation, recovery, or onboarding inside the faucet.
- No extension refactor and no shared `@nulo/ui` extraction.
- No automated alpha-testnet e2e in this PR.

## 13. One question I'd ask the user if I could

What exact alpha-testnet `chainId` and `version` should ship as the default `VITE_CHAIN_ID` and `VITE_CHAIN_VERSION` values, so the faucet does not rely on `Fr.ZERO` wildcard matching in production?