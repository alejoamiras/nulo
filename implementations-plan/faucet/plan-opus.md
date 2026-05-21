# Nulo × Aztec Faucet — Opus Plan

## 1. Summary

`packages/faucet/` is a single-page Vue 3 + Vite app that drips fixed amounts of two pre-deployed test tokens (USDC, ETH) on alpha-testnet via the permissionless Wonderland `Dripper`. Wallet support is wallet-agnostic via `@aztec/wallet-sdk` discovery; in practice the only wallet on the network is Nulo.

Three pillars:

1. **Stateless frontend.** No backend, no rate limit, no remote config. Token addresses baked into a JSON committed at PR time. Only runtime input is the user's wallet.
2. **Inline minimal deployer.** ~100-line script in `packages/faucet/scripts/` mirroring `aztec-standards/scripts/deploy.ts` (sponsored FPC, schnorr deployer, salt-deterministic, idempotent) emitting the canonical `DeploymentData` shape. We do NOT vendor the upstream script — wrapper integration is more friction than the inline version.
3. **Vendored brand, fresh components.** Copy the relevant CSS-variable block from `_base.scss` plus the `tokens.ts` reflection into `packages/faucet/src/design/`. Fresh L1/L2/L3 components — no `@nulo/ui` extraction (settled decision #4).

Shipped surface: Connect button, emoji-verify dialog, two TokenCards each with `[Public]` `[Private]` CTAs, toast host, footer. Internal audience. Brutalist register: black/cream, mono accents, no marketing fluff.

## 2. Architecture

Single-page Vue 3 app. State lives in **composables**, not Pinia — one user, one connection, per-token transient status.

```
Browser tab
├── @aztec/wallet-sdk WalletManager → PendingConnection → Wallet
├── App.vue
│   ├── ConnectButton.vue       (L4)  drives useWallet()
│   ├── EmojiVerifyDialog.vue   (L4)  consumes pending.verificationHash
│   └── TokenCardList.vue       (L4)
│       └── TokenCard.vue × 2   (L4)  drives useDrip(tokenAddress)
└── ToastHost.vue               (L4)  passive sink for useToast()
```

State ownership:

| State | Lives in | Why |
|---|---|---|
| `wallet`, `provider`, `status`, `selectedAccount` | `useWallet()` module-singleton | One connection per tab, survives re-mounts. |
| `pendingConnection` ref | `useWallet()` (gated by `status === "verifying"`) | Drives the emoji dialog; disposed on confirm/cancel. |
| `dripStatus[tokenAddress]` | `useDrip()` reactive Map | Per-token UI isolated so two cards drip concurrently. |
| `toasts[]` | `useToast()` | Append-only ring. |
| Deployment addresses | `src/contracts/deployments.json` imported at module scope | Build-time constant. |

`deployments.json` matches the exact `DeploymentData` shape from `aztec-standards/scripts/deploy.ts`. No transformation layer.

## 3. File-by-file layout

```
packages/faucet/
├── README.md                              purpose, dev/deploy commands, addresses
├── package.json                           name="@nulo/faucet"; pinned aztec/wallet-sdk@4.2.0
├── tsconfig.json                          extends root; "@/*" → src/*
├── vite.config.ts                         port 5176, vue plugin, nodePolyfills, optimizeDeps excludes
├── index.html                             head + process/Buffer stub (verbatim from playground)
├── _headers                               Cloudflare Pages COOP/COEP/CSP
├── public/favicon.svg                     Nulo glyph
├── scripts/
│   └── deploy-faucet-tokens.ts            inline deployer (~100 lines)
├── src/
│   ├── main.ts                            createApp, mount, global error handler
│   ├── App.vue                            root layout
│   ├── env.d.ts                           vite/client + window stubs
│   ├── contracts/
│   │   ├── deployments.json               committed deploy output
│   │   ├── deployments.ts                 typed wrapper; exports DRIPPER, TOKENS
│   │   └── deployments.test.ts            addresses parse; minter==dripper; decimals match
│   ├── design/
│   │   ├── tokens.css                     vendored CSS vars (faucet subset of _base.scss :root)
│   │   ├── tokens.ts                      typed reflection (subset)
│   │   ├── fonts.css                      @font-face for Space Grotesk + Inter + JetBrains Mono
│   │   └── reset.css                      box-sizing + button/input resets
│   ├── assets/fonts/                      SpaceGrotesk, InterVariable, JetBrainsMono .woff2
│   ├── lib/
│   │   ├── wallet-sdk.ts                  discovery + secure channel (adapted from playground)
│   │   ├── manifest.ts                    capability manifest builder
│   │   ├── emoji-table.ts                 64-glyph table + hashToEmoji (see §5, §11)
│   │   ├── format.ts                      formatAmount, abbreviateAddress
│   │   └── log.ts                         devtools-aware logger; no-op in production
│   ├── composables/
│   │   ├── useWallet.ts                   discovery, connect, disconnect, requestCapabilities
│   │   ├── useWallet.test.ts              ≥10 cases
│   │   ├── useDrip.ts                     sendTx wrapper; drip(token, balance)
│   │   ├── useDrip.test.ts                ≥10 cases
│   │   ├── useToast.ts                    queue
│   │   └── useToast.test.ts               ≥10 cases
│   ├── components/
│   │   ├── ui/
│   │   │   ├── Button.vue + .test.ts      variants: primary | outline | ghost; size: md|lg
│   │   │   ├── Spinner.vue + .test.ts     1em pseudo-element; currentColor
│   │   │   ├── Tag.vue + .test.ts         "Test token · no real value"
│   │   │   ├── Card.vue + .test.ts        outlined surface, 1px border
│   │   │   ├── Toast.vue + .test.ts       single toast item
│   │   │   └── Dialog.vue + .test.ts      native <dialog> shell
│   │   ├── composite/
│   │   │   ├── EmojiGrid.vue + .test.ts   5 glyphs from hash; deterministic
│   │   │   ├── AddressDisplay.vue + .test.ts   copyable short address
│   │   │   └── BalancePill.vue + .test.ts      PUBLIC/PRIVATE badge
│   │   ├── ConnectButton.vue + .test.ts   orchestrates useWallet()
│   │   ├── EmojiVerifyDialog.vue          renders during pending.confirm()
│   │   ├── TokenCard.vue + .test.ts       name, decimals, two CTAs, drip state
│   │   ├── TokenCardList.vue              maps deployments.tokens → TokenCard
│   │   ├── ToastHost.vue                  teleport target
│   │   └── Footer.vue                     links + disclaimer
│   ├── styles/
│   │   ├── app.css                        global layout (max-width 720px)
│   │   └── animations.css                 named transitions
│   └── types/deployments.d.ts             mirrors deployments.json shape
├── tests/e2e/smoke.test.ts                page-renders smoke (jsdom, no network)
└── .gitignore
```

Testid catalog (faucet-prefixed, mirroring playground convention):

- `fa-btn-connect`, `fa-btn-disconnect`, `fa-status[data-status]`, `fa-account`
- `fa-emoji-grid`, `fa-btn-emoji-confirm`, `fa-btn-emoji-cancel`
- `fa-token-card[data-symbol]`, `fa-btn-drip-public`, `fa-btn-drip-private`, `fa-token-status[data-drip-status]`
- `fa-toast[data-kind]`

## 4. Phase plan

### Phase 1 — Scaffolding

**Lands:** workspace package, vite/vue/biome wiring, empty `App.vue` rendering the hero, vendored design tokens, font files. No wallet code.

**Files:** root `package.json` (add `dev:faucet`, `build:faucet`); `packages/faucet/{package.json,tsconfig.json,vite.config.ts,index.html}`; `src/{main.ts,App.vue,env.d.ts}`; `src/design/*`; `src/assets/fonts/*`; `src/styles/app.css`; `src/components/ui/{Button,Spinner,Tag,Card}.vue` + tests.

**Validation:** `bun run --cwd packages/faucet dev` renders hero. `bun run --cwd packages/faucet typecheck` passes. Component tests ≥5 cases each. `bun run lint` passes.

**Risk:** vite + Aztec polyfills are fiddly. **Mitigation:** mirror `packages/playground/vite.config.ts` exactly and the same `index.html` `<script>` stub. Add `optimizeDeps.exclude` for the wasm packages before phase 2.

### Phase 2 — Wallet integration

**Lands:** `useWallet()`, `ConnectButton`, `EmojiVerifyDialog`, manifest builder. Connect flow end-to-end against a running Nulo build.

**Files:** `src/lib/{wallet-sdk.ts,manifest.ts,emoji-table.ts}`; `src/composables/useWallet.ts` + test; `src/components/{ConnectButton.vue,EmojiVerifyDialog.vue}`; `src/components/composite/EmojiGrid.vue` + test.

**Validation:** unit tests pass; manual: Nulo installed, click Connect, emoji dialog appears, confirm in Nulo, state moves to `connected`.

**Risk:** the verification-emoji algorithm must match Nulo's wallet exactly or the user can't verify. **Mitigation:** vendor a 64-glyph table inline; pin a CI test asserting `hashToEmoji("0xdeadbeef…")` returns a known sequence. The right long-term fix is shared code (see §13).

### Phase 3 — Deploy contracts

**Lands:** inline deployer script, committed `deployments.json`, typed wrapper.

**Files:** `scripts/deploy-faucet-tokens.ts`; `src/contracts/{deployments.json,deployments.ts,deployments.test.ts}`; `src/types/deployments.d.ts`; README update.

**Inline deployer logic** (mirrors `aztec-standards/scripts/deploy.ts` patterns):

1. Parse `--deployer-secret` or `DEPLOYER_SECRET`; derive via `poseidon2Hash`.
2. `EmbeddedWallet.create(nodeUrl, { pxeConfig: { proverEnabled: true, dataDirectory: "testnet-store/" } })`.
3. `wallet.createSchnorrAccount(deployerSecret, Fr.ZERO)`.
4. Setup `SponsoredFeePaymentMethod` (register `SponsoredFPCContract.artifact` with salt `SPONSORED_FPC_SALT`).
5. Deploy account if missing (handle "Existing nullifier" as success).
6. For each contract (dripper, then tokens), compute address via `getContractInstanceFromInstantiationParams`, check `node.getContract(address)`; if missing, `Contract.deploy(...).send({...feeOptions, contractAddressSalt, universalDeploy: true, wait: { waitForStatus: TxStatus.PROPOSED } })`.
7. Token list: `{ usdc: { decimals: 6 }, eth: { decimals: 18 } }`, salt `1337` each, `minter = dripper.address`.
8. Write `{ tokens: [...], dripper: {...} }` JSON to `src/contracts/deployments.json` in the upstream `DeploymentData` shape.

**Validation:** `bun run --cwd packages/faucet deploy:testnet` writes 3 addresses (dripper + 2 tokens). `deployments.test.ts` verifies each address parses, `minter === dripper.address`, decimals match.

**Risk:** deploying on alpha-testnet is itself flaky (sponsored FPC quotas, sandbox restarts). **Mitigation:** the script is idempotent (re-running picks up where it left off). Support `--dry-run` and `--salt <n>` flags for recovery.

### Phase 4 — Drip flow

**Lands:** `useDrip()`, `useToast()`, `TokenCard`, `TokenCardList`, `ToastHost`, `Footer`, `Dialog`, `Toast`, composite components. App wiring complete.

**Files:** `src/composables/{useDrip.ts,useToast.ts}` + tests; `src/components/{TokenCard,TokenCardList,ToastHost,Footer}.vue`; `src/components/ui/{Dialog,Toast}.vue`; `src/components/composite/{AddressDisplay,BalancePill}.vue`; `src/App.vue` (mount all).

**Validation:** tests pass; manual: connect, drip USDC public, see emoji-verify (one-time per session), then SendTx popup in Nulo, sign, wait for toast `Dripped 1,000 USDC to public`. Repeat for ETH. Repeat for private (~30s).

**Risk:** first drip on a fresh account is the cold-start scenario (no fee asset). Nulo's dispatcher offers sponsored FPC in the SendTx popup; faucet does NOT supply a `feePayer` — identical to playground `sendTx-default`. **Mitigation:** surface wallet errors verbatim; document "use sponsored FPC" in toast copy.

### Phase 5 — Hardening + hosting

**Lands:** production build sanity, headers, CI wiring, README finalization.

**Files:** final `vite.config.ts`; `README.md`; `.github/workflows/pr-quick.yml` (add `faucet` paths filter); `_headers`.

**Validation:** `bun run --cwd packages/faucet build` succeeds, preview works against alpha-testnet, smoke test runs in CI.

## 5. Wallet-SDK integration details

### Discovery

Mirror `packages/playground/src/lib/wallet.ts:62-93`. Two adaptations:

1. `APP_ID = "nulo-faucet"` — agreement between discovery, the manifest's `metadata.name`, and the connect popup.
2. `chainInfo` — pin alpha-testnet chain ID. The playground uses `Fr.ZERO/Fr.ZERO` (match-any); the faucet pins the testnet chain ID, with `?chainId=X&version=Y` override for test drivers (same pattern as playground).

### Emoji verify modal

`pending.verificationHash` is a byte buffer. Faucet derives 5 glyph indices via 6-bit windows (5 × 6 = 30 bits) and looks them up in a 64-entry table. Vendor the table in `lib/emoji-table.ts`. **Glyph choice:** ASCII-safe geometry/punctuation (squares, triangles, circles, dots) — renders identically across OS, matches brutalist register, avoids font-dependent emoji rendering.

Two columns side-by-side in the dialog: "dApp" (computed in faucet) and "Nulo" (read off wallet). User matches them, clicks Confirm. **Critical:** Nulo's `hashToEmoji` algorithm must produce the same encoding or the faucet is broken. See §11 and §13.

### Capability manifest

One bundle, scoped to dripper + 2 tokens + accounts read:

```ts
{
  version: "1.0",
  metadata: { name: "nulo-faucet", version: "0.1.0", url: window.location.origin },
  capabilities: [
    { type: "accounts", canGet: true, canCreateAuthWit: false },
    { type: "contracts", contracts: [DRIPPER, USDC, ETH], canRegister: true, canGetMetadata: true },
    { type: "transaction", scope: [
      { contract: DRIPPER, function: "drip_to_public" },
      { contract: DRIPPER, function: "drip_to_private" },
    ] },
    { type: "simulation", transactions: { scope: "*" }, utilities: { scope: "*" } },
  ],
}
```

`canCreateAuthWit: false` — dripper has no permission guards, no authwit needed.

### Contract registration order

After capabilities granted:

1. Resolve the granted accounts; select first.
2. **Lazy registration:** on first drip of each token, `useDrip` calls `wallet.getContractMetadata(tokenAddress)`; if it throws "unknown contract", registers dripper + token via `wallet.registerContract(instance)` and retries. Recompute the `ContractInstance` from `getContractInstanceFromInstantiationParams` using `deployments.json` constructor args.

Lazy keeps the connect flow fast — only registers tokens the user actually exercises.

### Fee payment

Faucet delegates entirely to the wallet. `useDrip` builds the `ExecutionPayload` without setting `feePayer`:

```ts
const exec = await dripperContract.methods.drip_to_public(tokenAddress, amountU64).request()
await wallet.sendTx(
  { calls: exec.calls, authWitnesses: [], capsules: [], extraHashedArgs: [] },
  { from: selectedAccount },
)
```

Nulo opens `/windows/execute`, offers the fee picker. On a fresh alpha-testnet account, sponsored FPC handles account-deploy + drip in one tx. Faucet doesn't know or care.

### Disconnect / reconnect

`useWallet().disconnect()` calls `provider.disconnect()` (best-effort), clears state to `idle`. Reconnect from `idle` runs the full handshake again. No state persisted across reloads.

## 6. UX & copy

Single column, max-width 720px, centered. Three vertical bands: header (title + connect chip), token grid (two cards side by side, stack on mobile), footer.

### Copy (final, ship as-is — no placeholders)

**Hero headline:** `NULO × AZTEC TESTNET FAUCET`

**Hero sub:** `Drip yourself test tokens. Public or private balance. Alpha-testnet only.`

**Connect button states:**
- idle: `Connect wallet`
- discovering: `Looking for a wallet…`
- verifying: `Verify the code` (dialog opens)
- connected: shows `0xa1b2…f93c` + small `Disconnect` link
- error: button reverts to `Connect wallet`; inline subtext `Connection failed. Try again.`

**No-wallet empty state** (discovery returns no provider in 60s):

> `No Aztec wallet detected.`
> `Install Nulo, refresh, and try again.`
> `[ Get Nulo ]` ← links to the extension store listing

**Emoji-verify dialog:**

- Title: `Confirm the code`
- Body: `Match the symbols below with what your wallet shows. If they don't match, cancel.`
- Two columns: `dApp` (5 glyphs) | `Nulo` (5 glyphs — read off your wallet)
- Buttons: `[ Cancel ]` `[ Confirm ]`

**TokenCard states:**
- idle: `Drip 1,000 USDC` (or `Drip 1 ETH`) headline, two CTAs `[ Public ]` `[ Private ]`.
- dripping: spinner + `Dripping to public…` / `Dripping to private…` (button disabled). Private subtext: `Private drips take 30-90 seconds. Stay on the page.`
- ok: brief flash `Done.` then back to idle. Toast carries the durable confirmation.
- error: red border 1px, inline subtext `Drip failed.` + small `Retry` link. State auto-clears on next click.

**Tag** bottom-left of each card: `Test token · no real value`, mono font, opacity 60%.

**Toast copy (one line each):**
- ok public: `Dripped 1,000 USDC to public · 0x4e2f…`  (last 4 of tx hash)
- ok private: `Dripped 1,000 USDC to private`
- error rejected: `Rejected in wallet.`
- error no wallet: `No wallet found.`
- error network: `Network unreachable.`
- error account uninitialized: `Account not deployed yet. Sign once to initialize.`
- error fee: `No fee asset. Use sponsored FPC.`
- error reverted: `Transaction reverted. Check the explorer.`

**Footer:** `alpha-testnet only · no rate limit · MIT · nulo.sh`

### Visual register

- Background `#0a0908`, surfaces `#141312`, text `#f5f0e6`, accent `#f8f1e7`.
- Headline: Space Grotesk 700, tracking -0.02em, 36/28/20 hero/section/body.
- Body: Inter 400/500.
- Mono: JetBrains Mono for addresses, tx hashes, the emoji code, the `1,000` / `1` amounts.
- Borders: solid 1px `#4a463f`. No drop shadows, no gradients.
- Buttons: 2px solid outline for ghost CTAs; solid `#f8f1e7` with dark text for primary; never both.
- One animation: CSS-only spinner; 150ms opacity on hover.

## 7. Tests

CLAUDE.md guidance: "enough tests to prove what we wanted to implement works, and that failures are caught." Surface is small. Honest ROI:

### Unit / composable (required)

- `useWallet.test.ts` (≥10): idle→discovering→verifying→connected; cancel from idle; cancel from verifying; error path on no provider; double-connect is no-op; disconnect from connected; reconnect after disconnect; granted accounts populate; capability request with no accounts is surfaced as error; chainInfo override via query param.
- `useDrip.test.ts` (≥10): builds correct payload for public; for private; amount `1_000_000_000n` for USDC and `1_000_000_000_000_000_000n` for ETH; sets `from` to selected account; calls `wallet.sendTx` exactly once; surfaces wallet error verbatim; state idle→dripping→ok; idle→dripping→error; concurrent drips on different cards isolated; not-connected throws.
- `useToast.test.ts` (≥10): append, auto-dismiss timer, manual dismiss, max queue size, kind variants, ordering, id uniqueness, no-op on empty dismiss, double-dismiss safe, host renders zero when empty.

### Library

- `deployments.test.ts` (5+): JSON parses; every address is valid `AztecAddress`; dripper.address ≠ `AztecAddress.ZERO`; every token's `minter` field equals dripper.address; decimals match (USDC=6, ETH=18); both tokens have distinct addresses.
- `emoji-table.test.ts` (5+): table has exactly 64 entries; no duplicate glyphs; known hash → known glyph sequence (locks the algorithm); empty buffer renders 5 placeholders; long buffers truncate cleanly.

### Component

L1/L2 primitives (≥5 each — `Button`, `Spinner`, `Tag`, `Card`, `Toast`, `Dialog`). L3 composites (≥10 each — `EmojiGrid`, `AddressDisplay`, `BalancePill`). L4 NOT required per CLAUDE.md.

### E2E

**Skip the network e2e in v1.** Alpha-testnet is not reproducible in CI, proving private notes takes 30s+, and the value over manual smoke is low.

**Ship one no-network smoke** at `tests/e2e/smoke.test.ts`: jsdom-mounts `App.vue`, asserts `fa-status`, `fa-btn-connect`, both `fa-token-card[data-symbol]` testids exist, footer renders. ~30 lines, runs in CI. The playground's network e2e already covers `wallet.sendTx` + `requestCapabilities` flows the faucet just wraps.

If the Foundation later wants nightly drip-against-testnet, add it as a follow-up — not a v1 blocker.

## 8. Deploy story

### One-time setup (maintainer)

```sh
cd packages/faucet
echo "DEPLOYER_SECRET=<32+ char string>" > .env.local
bun run deploy:testnet
```

Where:

```json
"scripts": {
  "deploy:testnet": "bun run scripts/deploy-faucet-tokens.ts --network testnet",
  "deploy:testnet:dry": "bun run scripts/deploy-faucet-tokens.ts --network testnet --dry-run"
}
```

**Idempotency:** every contract deploy checks `node.getContract(addr)` first. Existing → register with PXE, skip. Same salts → same addresses. Partial crash recovers cleanly on re-run.

**Output:** `packages/faucet/src/contracts/deployments.json`, committed to the PR.

**Recovery:** `--salt 1338` to start a fresh deployment if the old one is borked. If sponsored FPC quota is exhausted, wait and retry.

### Frontend pickup

`src/contracts/deployments.ts` imports the JSON at module scope:

```ts
import deploymentsJson from "./deployments.json"
import { AztecAddress } from "@aztec/aztec.js/addresses"

export const DRIPPER = AztecAddress.fromString(deploymentsJson.dripper.address)
export const TOKENS = deploymentsJson.tokens.map(t => ({
  address: AztecAddress.fromString(t.address),
  symbol: t.constructorArgs.symbol,
  decimals: t.constructorArgs.decimals,
  fixedAmount: t.constructorArgs.symbol === "USDC"
    ? 1_000_000_000n
    : 1_000_000_000_000_000_000n,
}))
```

Build-time constant. No env-var indirection. Testnet redeploys are a PR.

## 9. Build & hosting

**Build:** `bun run --cwd packages/faucet build` → `packages/faucet/dist/`. Bundle ~5-6 MB (bb.js dominates). Acceptable for internal-only.

**Host:** **Cloudflare Pages.** Free, first-class wasm support, easy `_headers` config. Build command `bun install && bun run --cwd packages/faucet build`, output `packages/faucet/dist`. Custom domain `faucet.nulo.sh` (TBD with team).

**Required headers** (bb.js + potential SharedArrayBuffer):

```
# packages/faucet/_headers
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' https://*.aztec.network wss://*.aztec.network; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

`connect-src` URL is provisional — pin to the actual testnet node URL once known. Verify COOP/COEP doesn't break the postMessage bridge to the extension during phase 2.

**Vercel** is the equivalent alternative (`vercel.json` instead of `_headers`). **GH Pages: do not use** — no headers control.

## 10. CI gates

The existing `pr-quick.yml` uses path filters. Add one:

```yaml
# changes.outputs:
faucet: ${{ steps.override.outputs.full || steps.filter.outputs.faucet }}

# filters:
faucet:
  - 'packages/faucet/**'
  - '!packages/faucet/**/*.md'
```

`lint-and-typecheck` and `unit-tests` already run via `--filter '@nulo/*'`, so the faucet picks them up automatically once `@nulo/faucet` exists and matches the workspace glob.

**Required for the faucet:**
- Biome lint + format (root config).
- `vue-tsc --noEmit`.
- Vitest unit + component tests.
- Build sanity (`bun run --cwd packages/faucet build`) — catches missing deps.

**Not required:**
- Network e2e (deferred per §7).
- Bundle size budget (informational).

Root `audit:vue` already chains `typecheck:all → test → lint → build`; workspace globbing covers the faucet. Add ergonomic root scripts `dev:faucet`, `build:faucet`.

## 11. Risks & open questions

### Real risks

1. **Cold-start fee on first drip.** Fresh Aztec account on alpha-testnet has no fee asset. Nulo's dispatcher handles this via sponsored FPC in SendTx popup — but if the quota is exhausted or misconfigured, the user sees a raw wallet error. **No mitigation in the faucet** — we surface the error verbatim. The fix is in Nulo. If this is recurring, next iteration adds a pre-flight ping and pre-warns.

2. **Private drip is slow.** `drip_to_private` requires proving + note delivery (~30-90s). UX shows `Dripping to private…` with a hint subtext; a 2-minute soft timeout flips to `Still working… check Nulo for status.` rather than hanging silently.

3. **Verification-emoji mismatch.** If Nulo's wallet renders different glyphs than the faucet, the user can't verify. **Mitigation:** vendor the 64-glyph table, pin a CI test on a known hash. The right fix is shared code (see §13).

4. **Sponsored FPC quotas.** Both deploy and drip rely on it. If the Foundation depletes the daily quota, drips revert. **No mitigation** — README documents the failure mode.

5. **`@defi-wonderland/aztec-standards@4.2.0-aztecnr-rc.2` artifact drift.** Faucet uses the same exact-pinned version as the extension. Verify Renovate excludes it (or that bumps are coordinated). **Mitigation:** exact-pin already; add to Renovate ignore list if not.

6. **Bundle includes full Aztec wasm.** The dApp ships a PXE-capable runtime; cold start is slow. Acceptable internally; lazy-load behind the Connect click if we ever go public.

7. **Same-origin handshake under COOP/COEP.** Wallet-SDK uses postMessage to the extension. Verify in phase 2 that headers don't break the bridge.

### Pushback on settled decisions

- **No backend:** strong agree, but corollary is the maintainer is on the hook for redeploys on testnet resets. Fine for internal.
- **Vendor design tokens, don't extract `@nulo/ui`:** I'd extract `@nulo/design-tokens` (CSS vars only, ~150 lines) as a workspace package even now. The brief forbids it; following the rule. If a second surface ships (swap UI), we'll regret this — noted for synthesis.

### Open questions

- Confirm alpha-testnet chain ID + version before phase 2.
- Confirm Nulo's `hashToEmoji` algorithm before phase 2 (palette + byte-window stride).
- Confirm sponsored FPC quota healthy at launch.
- Cloudflare Pages vs Vercel — team preference.
- Final subdomain naming (`faucet.nulo.sh` vs alternatives).

## 12. Non-goals

- No swap UI; no transfer-between-users; no balance history.
- No multi-network switcher; no custom drip amounts; no rate limit.
- No backend / API / DB; no custodial wallet fallback.
- No `@nulo/ui` extraction; no extension refactor; no new contract code.
- No CHANGELOG entries; no Sentry; no analytics; no i18n.
- No keyboard shortcuts beyond standard tab order.
- No dark/light theme toggle (brand is dark-on-dark).
- No "explore Nulo" empty-state pitch.

## 13. One question I'd ask the user if I could

**"What is the exact algorithm Nulo's extension uses to derive the 5-glyph code from `pending.verificationHash`?"**

That is: byte-window stride, glyph palette, and rendering rules. The brief says "show emoji grid via `hashToEmoji(pending.verificationHash)`" — but does not specify whether the dApp's algorithm must produce the same visual as Nulo's wallet, or whether the user verifies a checksum that's encoded differently on each side.

If they must match, we need Nulo's exact table — and if Nulo refactors it later, the faucet breaks silently. The right move is to extract `hashToEmoji` into a shared helper (in `packages/wallet-core` or a tiny new `packages/wallet-verify-emoji` package) and import it both sides. That's a stack-extraction the brief forbids ("no `@nulo/ui`") — but emoji-verify is wallet-protocol, not UI, so the prohibition shouldn't apply.

Without an answer, I default to "vendor a 64-glyph table inline in `lib/emoji-table.ts`, document the exact byte-window stride, and pin a test that asserts a known hash → known sequence so any divergence with Nulo breaks loudly in CI." But the right answer is shared code, not parallel vendoring.
