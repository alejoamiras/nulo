# @nulo/extension

The Chrome/Firefox Manifest V3 wallet extension. Service worker, popup UI, content script, and offscreen PXE host wired together. Imports anything below it in the layer hierarchy; nothing imports it.

## Position in the stack

```
wallet-core  →  wallet-crypto  →  extension-messaging  →  aztec-runtime  →  wallet-bridge  →  extension
```

The sink. The four browser contexts (service worker, popup, content script, offscreen) all live here. See [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) for the process-boundary picture and message flow.

## Entry points

| Entry | File |
|---|---|
| Service Worker | `src/wallet/index.ts` |
| Popup UI | `src/popup/index.ts` |
| Content Script | `src/content-script/content.ts` |
| Offscreen | `src/offscreen/index.ts` |

## File map (top level)

| Path | Purpose |
|---|---|
| `src/wallet/` | Service-worker background services (account, profile, network, transaction, dapp-interaction, dapp-session, execution, fpc, passkey, token, token-balance, price, contact, …). Storage abstraction. Logger. Config. |
| `src/popup/` | Vue 3 popup app: `pages/` (L6), `components/modules/` (L4), `components/popups/` + `windows/` (L5), `constants/`, `utils/`. |
| `src/components/` | L1 `core/`, L2 `ui/`, L3 `composite/` primitives, plus flat service-bound visuals. |
| `src/composables/` | C0 pure utilities + C1 service hooks. |
| `src/stores/` | Pinia state (`app.store.ts`, `popup.store.ts`, `cache.store.ts`, `balances.store.ts` — the one popup-side owner of fee-juice-balance/FPC fetching; the fee cards are capability-declaring subscribers). |
| `src/design/` | Design tokens + Storybook story files for the token catalog. |
| `src/content-script/` | Content script + in-page injection bridge. |
| `src/offscreen/` | Offscreen entry shim; pulls the PXE entry from `@nulo/aztec-runtime`. |
| `src/setup/` | Boot wiring shared between the SW and popup setups. |
| `src/core/`, `src/utils/` | Cross-cutting extension-only helpers. Pure utilities live in `@nulo/wallet-core/utils`. |
| `src/shims/` | Bundle-time shims (e.g. `function-bind-stub` for the function-bind ESM gap). |
| `tests/e2e/` | Smoke + network e2e suites. See [`tests/e2e/README.md`](./tests/e2e/README.md). |
| `manifest/` | Per-target manifest configs (Chrome + Firefox). |
| `.storybook/` | Storybook 10 config. |
| `vite.chrome.config.mts`, `vite.firefox.config.mts` | Per-target Vite builds. |

For the L0–L6 component model and the C0/C1 composable rules, read [`../../CLAUDE.md`](../../CLAUDE.md). They are operating rules that span all packages — not extension-internal.

## Scripts

| Command | Effect |
|---|---|
| `bun run dev` | Chrome dev server (port 8088). |
| `bun run build` | Production Chrome build → `dist/chrome/`. Greps the bundle to verify `VITE_LOCAL_NETWORK_RPC_URL` substituted. |
| `bun run build:firefox` | Firefox build → `dist/firefox/`. |
| `bun run test` | Unit + component tests (vitest). |
| `bun run test:components` | Components only (filtered to `src/components/`). |
| `bun run test:e2e` | Smoke e2e (no Aztec sandbox). |
| `bun run test:e2e:all` | Smoke + network e2e (full sandbox). |
| `bun run lint` | `biome check src/`. |
| `bun run typecheck` | `vue-tsc --noEmit`. |
| `bun run storybook` | Storybook dev server (port 6006). |
| `bun run build-storybook` | Production Storybook build. |
| `bun run check:rp-id` | Build-step gate: verifies the WebAuthn RP_ID constant is in sync with the manifest. |

## Testing

Three test surfaces:

1. **Unit + component** (`vitest.config.ts`): colocated `*.test.ts` next to source. `chrome.*` is stubbed by `tests/vitest.setup.ts:88-113`. Component tests mount via `@vue/test-utils`. Coverage minimums per layer live in [`../../CLAUDE.md`](../../CLAUDE.md).
2. **Smoke e2e** (`vitest.e2e.config.ts`): `tests/e2e/*.test.ts` drives popup UI flows with no Aztec sandbox.
3. **Network e2e** (`vitest.e2e.network.config.ts`): `tests/e2e/network/**` drives the playground dApp against a per-worktree anvil + aztec sandbox. The agent runner (`bun run e2e:agent`) handles port allocation, builds, and isolation — see [`tests/e2e/README.md`](./tests/e2e/README.md).

`audit:vue` (run from repo root) sweeps typecheck + unit + lint + build, but **excludes** e2e tests. Run e2e separately when changes touch those surfaces.

## Loading in a browser

Chrome: `chrome://extensions` → Developer mode → Load unpacked → select `dist/chrome/`.

Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → select `dist/firefox/manifest.json`.

## Key invariants

- **Service ↔ ServiceClient** is the only RPC pattern for popup ↔ background. Adding a new background service: declare its `ServiceSpec`, extend `Service`, implement `init(services)`, register it in `setup/`. The popup uses `new <Name>ServiceClient()` and calls methods over the typed surface.
- **Service-startup order is phase-based** (`@nulo/wallet-core/base/topology.ts`). Declare `dependencies` for any service that touches another at `init` time. Cycles throw at startup, not at first call.
- **`onBeforeUnmount` cleanup order is load-bearing.** See [`../../CLAUDE.md`](../../CLAUDE.md). Composables expose `dispose()`; the parent calls it.
- **Storage migrations are data-preserving.** A release that changes a persisted `chrome.storage` shape transforms existing data via a numbered migration (never a wipe). See [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) §5, the engine at `@nulo/wallet-core/migration`, and the registry at `src/wallet/storage/migrations/`. Crypto/KDF changes are the one exception — they can't be migrated pre-unlock (see [`../../packages/wallet-crypto/README.md`](../../packages/wallet-crypto/README.md)).
- **`data-testid` stability is a contract** with the e2e suite. New testids are added; existing ones are not renamed without coordinating with `tests/e2e/`.
- **Pinned `@aztec/*` versions** — every Aztec dep is at the same version. Mismatches break proof generation inside `bb.js`.
