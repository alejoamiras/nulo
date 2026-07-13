# Repo map — Nulo wallet, security audit scope

**Authored from** the repo's own `ARCHITECTURE.md`, per-package `README.md`s, `CLAUDE.md`, and a directory/LOC inventory (documented Phase-1 deviation: the repo ships a high-fidelity architecture doc, so the top-level map is authored from primary sources rather than spawned mappers; each Phase-2 cluster agent still maps its own cluster before auditing).

## In scope
`apps/extension/src/**` + the 7 dependency packages. **Out of scope:** `apps/faucet`, `apps/landing`, `apps/playground`, all `*.test.ts` / `tests/e2e/**` (unless production-wired), generated files (`src/types/auto-imports.d.ts`, `src/types/components.d.ts`).

## Process boundaries (4 browser contexts, MV3)
| Context | Entry | Owns | Trust posture |
|---|---|---|---|
| Service Worker (background) | `apps/extension/src/wallet/index.ts` | every background service, storage, wallet-sdk dispatcher | authoritative; holds session |
| Popup UI (Vue 3) | `apps/extension/src/popup/index.ts` | Vue app, Pinia stores, service-clients | renders user-facing + dApp-approval UI |
| Content Script | `apps/extension/src/content-script/content.ts` | in-page bridge: `window.postMessage` ↔ `chrome.runtime` | **untrusted boundary** — talks to arbitrary dApp pages |
| Offscreen | `apps/extension/src/offscreen/index.ts` | Aztec PXE host; WebCrypto key derivation | hosts heavy crypto/proving |

## Package layer hierarchy (each imports only layers below)
```
wallet-core (foundation; pure; NO chrome.*)
  ↑ wallet-crypto (KDF + encryption)
  ↑ extension-messaging (RPC plumbing)
  ↑ aztec-runtime (PXE + account)     wallet-bridge (dispatcher; NOT aztec-runtime)
  ↑ extension (sink)
```
`bridge-core` and `design` are additional shared packages (bridge transport/channel; UI primitives).

## Security-critical trust boundaries & sink families
1. **dApp → wallet RPC** (highest): content-script postMessage → SW `BackgroundConnectionHandler` → `wallet-bridge` dispatcher (Zod narrow) → capability-map (approve vs auto-approve) → scope-enforcement → typed service call. Authz + input-validation surface.
2. **Cross-context messaging**: extension-messaging Service/Client, dynamic dispatch by method name, `Error` reconstruction across wire, offscreen sendMessage.
3. **Secret material lifecycle**: wallet-crypto (PBKDF2/HKDF, AES-GCM, PasswordSecretBox/passhash, Passkey PRF→HKDF, zeroize) → SessionManager (in-memory Fr, strict-mode passhash non-persistence) → offscreen derivation.
4. **Persisted-data deserialization**: `EntityStorage` per-row `JSON.parse`, `chrome.storage.local/session`, storage `migrate.ts` destructive wipe, operation journal `safeParse`.
5. **Signing / authwit / tx construction**: aztec-runtime `NuloAccount` (Schnorr signing-key derivation, DefaultAccountEntrypoint authwit signing, multi-call chunking, salt pinning), fee-payer selection.
6. **In-page injection / origin trust**: content-script provider injection, origin checks, encrypted channel key-exchange (bridge-core).
7. **DOM XSS surface**: Vue templates (`v-html`, dynamic `:href`/`:src`, `innerHTML`), JsonViewer/LogsViewer rendering untrusted data, external-link handling, clipboard.

## Cluster plan (12) — Phase 2 units
| # | Cluster | Paths |
|---|---|---|
| 1 | `crypto-core` | `packages/wallet-crypto/src/**` |
| 2 | `wallet-core-storage` | `packages/wallet-core/src/**` |
| 3 | `messaging-boundary` | `packages/extension-messaging/src/**` |
| 4 | `bridge-dispatcher` | `packages/wallet-bridge/src/**` |
| 5 | `bridge-core-channel` | `packages/bridge-core/src/**` |
| 6 | `aztec-runtime-signing` | `packages/aztec-runtime/src/**` |
| 7 | `ext-content-script` | `apps/extension/src/content-script/**` |
| 8 | `ext-offscreen` | `apps/extension/src/offscreen/**` |
| 9 | `ext-sw-dapp-connection` | `apps/extension/src/wallet/services/wallet-sdk/**` (+ SW dApp entry in `src/wallet/index.ts`) |
| 10 | `ext-sw-services-storage` | `apps/extension/src/wallet/**` EXCEPT `services/wallet-sdk/**` (services: profile/session-manager, operation-journal, config, token, execution, interaction; `storage/migrate.ts`; `utils/offscreen.ts`, `utils/lock.ts`; crypto glue) |
| 11 | `ext-popup-sensitive` | `apps/extension/src/popup/**`, `src/onboarding/**`, `src/composables/**` |
| 12 | `ext-components-design` | `apps/extension/src/components/**`, `packages/design/src/**`, `src/content-script` UI if any |

Dependency direction between clusters follows the layer hierarchy; handoff edges to watch: content-script→SW connection handler (7→9), dispatcher→typed services (4→10), SW→offscreen (10→8), messaging base→every service (3→9,10).
