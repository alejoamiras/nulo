# @nulo/tools — the Nulo tools app

A standard Aztec dApp (it speaks `@aztec/wallet-sdk`; it touches no wallet code) with three
sections on a left rail:

- **Send** — move **any ERC-20** between Ethereum and Aztec through the generation the bundled
  manifest names (an L1 `PortalFactory` + `SwapBridgeRouter`, one L2 `TokenBridgeHub`), with an
  optional **gas leg**: a slice of the amount is swapped to Fee Juice on the way in so the arriving
  account can pay for its own claim. Exits burn on L2 first, then consume on L1.
- **Faucet** — self-mint the two test tokens (NULO, 6 dec; OLUN, 18 dec) on testnet through
  Wonderland's permissionless `Dripper`. Two token cards, four drip buttons. No backend, no rate
  limit.
- **Activity** — every bridge this browser started or restored, as full cards with their next
  step, backup and restore. Beside Send and Faucet the same records sit in a collapsible **dock**
  (two-line rows grouped Needs you / Running / Done; one badge on the 44px strip while something
  needs you), which opens itself once per record that starts needing you and never for a blocked
  one. The wallet chips live in each section's header; one Aztec panel serves both the faucet
  and the bridge.

Two build targets (`testnet.tools.nulo.sh`, `tools.nulo.sh`), selected at BUILD time by which vite
config runs — never at runtime and never from a dashboard variable. A manifest with no `bridge`
block renders the Send placeholder (both networks until a generation is promoted); the mainnet
target additionally ships the whole-app placeholder (target-keyed, no faucet).

Plans + audits: [`implementations-plan/faucet/`](../../implementations-plan/faucet/) (the faucet),
[`implementations-plan/any-erc20-bridge/`](../../implementations-plan/any-erc20-bridge/) (the Send
section) and [`implementations-plan/tools-console/`](../../implementations-plan/tools-console/) (the
shell: rail, header chips, dock).

## Quick start

```bash
# from repo root
bun install
bun run --cwd apps/tools dev            # testnet target
```

Connect with the Nulo extension (or any wallet that speaks `@aztec/wallet-sdk`). The app uses
**discovery** to find wallets: every wallet that answers is listed in a picker and you choose
explicitly (a wallet's name/icon/id are self-claimed, so the picker is a selection, not a trust
decision — the emoji verification that follows is what proves the channel). Your choice is
remembered per browser; "use a different wallet" (or the `switch` action on the connected chip)
forgets it. If multiple wallets claim the remembered identity during the scan window,
auto-reconnect turns itself off and the picker shows all claimants.

**Multiple accounts**: if your wallet shares more than one account, the app asks which one to use
and remembers the answer per wallet. The connected chip shows the active account and opens a menu
to switch anytime — switching drives every section and is blocked while an operation is running, so
nothing executes under an account other than the one it started with.

The Send section additionally needs an **Ethereum wallet** (EIP-1193, e.g. MetaMask) on the manifest's
L1 chain; a wallet on another chain is told so before anything is signed.

## The Send section

`Token → Amount → Review` down a vertical step rail inside one card, then **Sign & send**: the
Aztec wallet's grant prompt for the token, and
the Ethereum wallet's signature(s) — a Permit2 approval on the token's first use, the seal signature
for a private send, the deposit signature.

- **Token** — the catalog is the manifest's pre-created tokens plus the community token list
  (`packages/bridge-core/src/token-list.ts`: one pinned origin, validated, cached, never a logo
  fetched — every tile is a committed sprite or a monogram). Any address can be pasted; its
  metadata is read on chain and the portal is derived, never looked up. A token the factory has
  seen before shows "portal verified" in the review; a first send creates the portal inline and
  registers the token on its first claim — the only difference the user sees is a one-line note.
- **Amount** — three choice cards (token only / token + gas / gas only) and one privacy row.
  Gas is sized from the manifest's calibrated `fjPerTx`/`fjRegister` and re-quoted before signing
  (`useGasShare`, `useRouteQuote`); a routeless token cannot carry gas and says so.
- **Review** — a frozen five-line summary + collapsed details (addresses, route, effective rate,
  the portal's derivation status). The wallet grant for the token's L2 contract is requested right
  before the signature (`useTokenGrant`), and the journal record is written BEFORE the signature is
  asked for, so a lost tab never loses a claim secret.
- **Journal** — every in-flight send/exit, device-local, milestone facts only
  (`useBridgeJournal` over `@nulo/bridge-core`'s journal engine). At boot each record's token block
  is re-validated against the live factory registration; a record that disagrees is withheld
  (`blocked`), never claimed. Records can be exported as a sealed backup and restored. The record
  whose stepper is on screen is the stepper's alone: the dock lists it only once it is backgrounded
  (`visibleRecords`); the Activity page lists every record. The page card and the dock row read one
  pure policy (`lib/record-policy.ts`), so the dock never offers a button the card would refuse —
  and it offers no DISCARD at all.
- **Exit** (`useHubExit`) — preflights the chain, BOTH pause bits (L1 factory + L2 hub), the hub
  binding and the balance before authorising a burn, states the burn-before-finish order in the
  review, and never discards a record whose burn landed (a consume that fails re-reads the Outbox).

## Deploy the faucet contracts (one-time)

The `Dripper` + NULO + OLUN contracts are deployed once per network reset. The script writes
`src/contracts/deployments.candidate.json` (candidate-first; it refuses the live path without
`--allow-live-output`) and `live-intent.ts promote` moves it into the committed `deployments.json`.

```bash
cd apps/tools
export DEPLOYER_SECRET_KEY=0x…  DEPLOYER_SALT=0x…   # or DEPLOYER_SECRET=<passphrase> for a fresh account
bun run deploy:testnet          # idempotent: skips anything already at its computed address; writes the candidate
bun run deploy:testnet:dry      # addresses only, no tx
```

The bridge generation (factory + router + hub + pre-created tokens) is deployed by
`packages/bridge-core/scripts/deploy-generation.ts`, candidate-first, and promoted into
`public/testnet-bridge.json` by `live-intent.ts promote` — the full runbook is
`.claude/skills/aztec-update/SKILL.md` Branch B. `bun run verify:deployments` re-derives the faucet
addresses (and, with `BRIDGE_MANIFEST=<manifest>`, the whole generation) from the committed params;
it runs inside the build CI gate.

## Production build + hosting

```bash
bun run --cwd apps/tools build:testnet   # → dist/ for testnet.tools.nulo.sh
bun run --cwd apps/tools build:mainnet   # → dist/ for tools.nulo.sh (placeholder while bridge: null)
```

Static output. Hosting is **Cloudflare Pages**, one project per target:

- Project root: `apps/tools`; install `bun install --frozen-lockfile`; build `bun run build:<target>`; output `dist`.
- Env (Production AND Preview): `BUN_VERSION=1.4.0` (the image defaults to Bun 1.2.15, which cannot read
  the repo's v2 lockfile) and `NODE_VERSION=24` (vite loads its config under the ambient Node; the
  config imports raw `.ts` from `@nulo/resolve-asset`).

`bb.js` needs cross-origin isolation. The build GENERATES `dist/_headers` (`vite.config.ts`) with
COOP/COEP + a tight CSP whose `connect-src` is the target's (`src/lib/network-targets.ts`): the
Aztec node hosts plus exactly one token-list host. `dist/build.json` + a `<meta name="nulo-build">`
carry the build id and chain id the release pipeline's `verify-live` reads; `verify:build-target`
asserts a built `dist/` matches the target it claims.

## Environment

| Variable | Where it's read | Purpose |
|---|---|---|
| `DEPLOYER_SECRET_KEY` + `DEPLOYER_SALT` (or `DEPLOYER_SECRET`) | `scripts/deploy.ts` only | The faucet deployer account |
| `AZTEC_NODE_URL` | `scripts/deploy.ts` only | Override the deploy RPC |
| `VITE_AZTEC_NODE_URL` | Frontend (dev/e2e only) | Override the target's node URL |
| `VITE_EXPLORER_BASE_URL` | Frontend | Base for L2 explorer links |
| `VITE_NULO_INSTALL_URL` | Frontend (no-wallet CTA) | Chrome Web Store link |

The build never embeds a deploy secret. **Chain identity is NOT an env var**: the L1 chain id +
rollup version live in `src/lib/chain-constants.ts` and the per-target `FaucetTarget`; a stale
Cloudflare `VITE_CHAIN_VERSION` once shadowed the value and broke the wallet handshake in prod, so
the env path was removed. The bridge manifest is injected per target at build time
(`VITE_BRIDGE_MANIFEST_JSON` via vite `define`) and strict-validated at module init — a manifest
whose chain disagrees with the build target fails the app at boot (`src/lib/build-integrity.ts`).

## Tests

```bash
bun run --cwd apps/tools typecheck   # vue-tsc
bun run --cwd apps/tools test        # vitest unit + component (jsdom)
bun run --cwd apps/tools test:e2e    # smoke e2e: shell + faucet + send wizard, mock wallets, jsdom
```

The faucet and shell smokes mount the full app in jsdom against a **mock Aztec wallet** (intercepts
`aztec-wallet-discovery` and answers canned RPC; the mock bodies live once in
`tests/e2e/fixtures/sdk-boundary.ts`). The shell smoke walks the rail, the header chips, the
Activity page, the cross-section completion toast and the dock (auto-open once, badge equals the
page's buttons, the foreground record absent). The send smoke mounts the Send view over the
REAL wizard composables and the REAL journal engine, faking only the chain/wallet boundary (the
manifest, the two wallet sessions, the bridge-core calls that would reach a chain), and drives
list / paste / grant-at-sign / no-route / first-time / 2-tx private / gas-only /
exit-with-pause-preflight / placeholder scenarios. No browser, no real wallet, no network. Live
behaviour is proven by the `packages/bridge-core` sandbox smoke and the testnet canaries, not here.
See `tests/e2e/README.md`.

## File layout

```
apps/tools/
├── public/                    ← testnet-bridge.json + mainnet-bridge.json (the generation manifests), favicon
├── scripts/                   ← deploy.ts (faucet deployer), verify-deployments.ts, verify-build-target.ts
├── vite.{testnet,mainnet}.config.mts ← the two build targets (inject the manifest + target)
├── src/
│   ├── AppShell.vue           ← rail | main | dock grid; owns the ONE completion-toast watcher and the activity feed
│   ├── views/                 ← DripView, SendView, ActivityView, MainnetPlaceholderView
│   ├── components/
│   │   ├── send/              ← the wizard: WizardShell (the card), StepStrip (the vertical rail), TokenStep/TokenList/
│   │   │                        TokenTile/PasteAddress, AmountStep/ChoiceCards/GasBreakdown, ReviewStep/ReviewDetails, SendWizard
│   │   ├── RailNav, SectionHeader, ActivityDock/DockStrip/ActivityRow ← the shell
│   │   ├── AztecWalletPanel, L1WalletPanel, AccountSwitcher, ConnectionErrorStrip ← the header chips
│   │   ├── Bridge*.vue        ← stepper + phase rail, receipt, journal page list + cards
│   │   └── *.vue              ← faucet + connection components
│   ├── composables/           ← useSend, useHubExit, useTokenCatalog/Selection/Grant, useRouteQuote,
│   │                            useGasShare, useBridgeJournal, useL1Wallet, useWalletConnection,
│   │                            useShell, useDockState, useActivityFeed, useCompletionToasts, …
│   ├── contracts/             ← bridge-generation.ts (manifest reader), deployments.{json,ts}, the FPCs
│   ├── lib/                   ← capabilities (per-token wallet grants), send-model, network-targets,
│   │                            chain-constants, build-integrity, bridge-steps, token-display,
│   │                            record-policy (card + dock gates), activity (grouping + row words), …
│   └── constants/tokens.ts    ← the faucet's two tokens
└── tests/e2e/                 ← tools-smoke + shell-smoke + send-smoke (mock wallets, jsdom); fixtures/sdk-boundary.ts
```

## What this is NOT

- No backend, no analytics, no rate limit
- No network switcher — the target is fixed at build time
- No custom drip amounts (fixed 1,000 NULO / 1 OLUN)
- No wallet code: the app is a standard dApp over `@aztec/wallet-sdk` and never touches `apps/extension/**`
- No i18n
- No swap UI or transfer-between-users — that's the AMM playground
- **No multi-tab safety.** The bridge journal lives in `localStorage` and its per-record lock and
  generation fence are tab-local: two tabs can both pass a claim's simulate and both send it.
  Journal writes are per-record merges and the hash clears are expected-hash guarded (load,
  compare and write in one synchronous span — `localStorage` offers no atomic compare-and-set,
  so a write from another tab can still land inside that span), which makes a second tab erasing
  a first tab's live claim unlikely, not impossible. Use ONE tab for bridging. Owner decision
  2026-09-02; Web Locks were considered and declined.
