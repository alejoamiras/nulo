# Wallets Architecture Research — Nulo

> Comparative architecture study of four browser-extension wallets, with two independent analyses per wallet (Claude agents + Codex CLI).
>
> Generated 2026-05-08 against:
> - **Rabby** `(Rabby source tree)` (v0.93.87)
> - **MetaMask** `(MetaMask source tree)` (v13.31.0)
> - **Grego's `extension-wallet`** `(Grego source tree)/extension-wallet/` (the self-contained Aztec MV3 extension; the Electron wallet in the same repo is out of scope for this study)
> - **Nulo** `(project root)` @ `65ea47a`

---

## Executive summary

After reading the codebases and folding in two independent perspectives per wallet, four findings dominate.

**Nulo's package boundaries and crypto are already at production quality.** Biome-enforced `noRestrictedImports` per-package layer rules + the M6 component layer model (L0–L6 + C0/C1) are real, not aspirational; `PasswordSecretBox` with M2.6 cross-version vectors and the `ENCRYPTION_GUARD` plaintext probe is more disciplined than Grego's vault (which is honest about deferring at-rest encryption); the `NuloAccount` adapter that delegates to upstream `@aztec/accounts/schnorr` and adds recursive payload chunking + first-tx multicall wrapping + kernelless authwit discovery for `NO_FROM` is genuinely Aztec-aware code. Don't undo any of this.

**The one architectural area where Nulo is materially behind every other wallet is long-running operations.** Both the Claude self-analysis and the Codex critical review converge on the same diagnosis: the popup-to-SW execution path defaults to a 60-second `ServiceClient` timeout, healthy proofs can routinely outrun that, "timeout" is not "cancellation" so the SW keeps proving while the popup shows failure, fee-estimation cancellation only bumps a stale counter (no `AbortController` in the prove path — `grep` returns 0 hits), PXE concurrency is globally serialized behind one `ReadWriteGuard` instead of per-(profileId, chainId), in-flight prove state is not persisted, and there is no `chrome.alarms` wake-up to keep the wallet ready for incoming dApp messages between popup sessions. Rabby and MetaMask both ship better long-running-job patterns (Rabby's resumable history sync, MetaMask's `unlockPromise` semantics, `LazyListener` boot-time event buffering, deferred-promise port gating). For an Aztec wallet whose tx latency is *measured in seconds-to-minutes*, this is the section to fix first.

**One specific Aztec pattern from Grego is non-negotiable to adopt: stub-account simulation overrides.** At `shared/src/wallet/core/demo-wallet.ts:139-226`, `DemoWallet.buildAccountOverrides()` builds a `ContractOverrides` map that swaps each in-scope account's contract for `StubSchnorrAccountContractArtifact` / `StubEcdsaAccountContractArtifact` (upstream `@aztec/accounts/stub/*`), passes it as `SimulationOverrides`, and runs `pxe.simulateTx(req, { overrides, scopes, ... })`. Real signing keys never enter the simulator — they only show up at prove-time. Combined with **`forEstimation: true` flag on `completeFeeOptions`** for distinct sim-vs-real gas-limit policy through one code path, and the **public-static fast path** (`extractOptimizablePublicStaticCalls` + `simulateViaNode` + `buildMergedSimulationResult` from `@aztec/wallet-sdk/base-wallet`, parallelized via `Promise.all`), this is the simulation pipeline a serious Aztec wallet runs. Grego's wallet-sdk pipeline is also worth quoting verbatim: `simulate → collectOffchainEffects → CallAuthorizationRequest.fromFields → createAuthWit → merge-then-prove`. Nulo has the `NO_FROM` mechanism via `DefaultEntrypoint` but is missing the stub-account swap and the public-static parallelization.

**Stop trying to keep the SW alive. Design around it dying instead.** This is the single biggest cultural shift the comparison surfaces. MetaMask writes a 2-second `chrome.storage.session` timestamp and explicitly calls it a hack (`background.js:847-855`). Rabby pings the offscreen every 5 seconds — and acknowledges it's a bet on Chrome behavior (`offscreen/scripts/offscreen.ts:13-19`). Both Codex reviews of Rabby and MetaMask call this out unprompted as the wrong primary strategy. The right pattern, visible in Rabby's `historyDbService` and `perps.unlockPromise` and MetaMask's `LazyListener` + deferred-init promise, is: **persist enough state to resume, register listeners synchronously at top-level so events are not lost during cold start, and treat any in-flight job that survives the worker as a feature**. Nulo's heartbeat (10 s, `runtime.ts:148-154`) keeps the worker alive while the popup is open, but the moment the popup closes, an incoming dApp message has to cold-boot the entire BB-WASM init path — that is exactly the "design around it dying" failure mode.

The full prioritized recommendation list is below the comparison table.

---

## What's in this folder

```
wallets-architecture-research/
├── README.md                         ← this file (executive synthesis)
├── rabby/
│   ├── claude-analysis.md            ← deep-dive by a fresh Claude agent (~5,800 words)
│   └── codex-analysis.md             ← independent Codex CLI review (~6,500 words)
├── metamask/
│   ├── claude-analysis.md            ← Claude agent (~5,230 words)
│   └── codex-analysis.md             ← Codex (~5,800 words)
├── grego/
│   ├── claude-analysis.md            ← ORIGINAL agent (mistakenly analyzed the Electron flavor; kept because the Aztec patterns from `shared/src/wallet/*` apply to BOTH the Electron and extension-wallet flavors)
│   ├── extension-wallet-claude-analysis.md  ← CORRECTED agent (extension-wallet only, ~8,400 words)
│   └── codex-analysis.md             ← Codex (extension-wallet only, ~6,800 words)
└── nulo/
    ├── self-analysis.md              ← self-analysis by Claude fork (~5,500 words, deliberately critical)
    └── codex-analysis.md             ← Codex critical review (~6,200 words)
```

Roughly 70k words of analysis material, each with real `path/file.ts:LN` citations.

---

## Methodology

For each wallet, I spawned **two independent agents** in parallel:

1. A general-purpose **Claude agent** that was told to read the source tree directly and form its own view, with no access to sibling analyses.
2. The **Codex CLI** at `xhigh` reasoning effort, told the same thing, also denied access to sibling analyses before forming its view.

This gives two cross-checks per wallet. Where Claude and Codex agree on a finding, the confidence is high. Where they disagree, both takes are documented and I weighed them on merit.

I did the comparative synthesis (this file) myself — neither agent saw the others' work.

The original Grego agent went off-scope (analyzed the Electron + native-messaging flavor at `app/`/`web/`/`extension/` instead of `extension-wallet/`); when the user corrected me mid-flight I spawned a corrected agent and rewrote the Codex prompt. The original analysis is kept because the Aztec-specific patterns it surfaced live in `shared/src/wallet/*` which is consumed by both the Electron flavor and `extension-wallet/`.

---

## ASCII comparison table

Wide table, monospace, scroll horizontally if needed. The leftmost column groups dimensions; subsequent columns are the four wallets. **Bolded cells are noteworthy** (genius, anti-pattern, or unique).

```
╔════════════════════════════════════════╦═══════════════════════════════╦══════════════════════════════════╦══════════════════════════════════╦═════════════════════════════════╗
║ DIMENSION                              ║ Rabby                         ║ MetaMask                         ║ Grego (extension-wallet)         ║ Nulo                            ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ === MANIFEST & BUILD ===                                                                                                                                                          ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ Manifest version                       ║ MV3 + MV2 (3 manifests)       ║ MV3 + MV2 dual                   ║ MV3 only                         ║ MV3 only                        ║
║ Browsers                               ║ Chrome, Firefox               ║ Chrome, Firefox (forces V2)      ║ Chrome, Firefox (offscreen FB)   ║ Chrome (Firefox FB planned)     ║
║ UI framework                           ║ React + Rematch (Redux)       ║ React + Redux                    ║ React 18 + MUI 6                 ║ Vue 3 + Pinia                   ║
║ Bundler                                ║ Webpack (custom)              ║ Browserify + Webpack (parallel)  ║ Vite via WXT                     ║ Vite via WXT                    ║
║ Build complexity                       ║ Webpack + custom MV2/MV3      ║ **EXTREME** (LavaMoat policies,  ║ Lean (one config, env flags)     ║ Lean (one config, env flags)    ║
║                                        ║                               ║ 4 flavors × 2 manifests × 2      ║                                  ║                                 ║
║                                        ║                               ║ build systems = 16 policy files) ║                                  ║                                 ║
║ Total TS/TSX files                     ║ ~1,562                        ║ ~1,289 in app/                   ║ 28                               ║ ~32k LoC across 8 packages      ║
║ Layer enforcement                      ║ None (organic growth)         ║ Compile-time messenger delegation║ None visible                     ║ **Biome noRestrictedImports**   ║
║                                        ║                               ║ (best-in-class)                  ║                                  ║ (8 packages + L0-L6 + C0/C1)    ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ === SERVICE WORKER ===                                                                                                                                                            ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ SW entry style                         ║ **Hand-written 102-line       ║ 15-line shim → dynamic import    ║ Bundled by WXT (single chunk)    ║ Bundled (vite, single chunk)    ║
║                                        ║ _raw/sw.js → importScripts    ║ → 2625-line background.js        ║                                  ║                                 ║
║                                        ║ background.js**               ║                                  ║                                  ║                                 ║
║ Cold-boot listener registration        ║ At top-level of _raw/sw.js    ║ **`ExtensionLazyListener`        ║ At entrypoints/background.ts top ║ At runtime.start() — risk: not  ║
║                                        ║ before importScripts          ║ buffers events before bundle     ║ level (BackgroundConnHandler)    ║ all listeners registered before ║
║                                        ║                               ║ loads, replays after**           ║                                  ║ first async tick                ║
║ Init-race handling                     ║ UI polls `getBackgroundReady` ║ **`await isInitialized` Promise  ║ Offscreen `ready-gate` with      ║ 10s setInterval polls           ║
║                                        ║ every 100ms; SW emits         ║ blocks every onConnect until     ║ explicit `offscreen-ready` msg   ║ `nulo:liveness` heartbeat;      ║
║                                        ║ EXTENSION_READY to all tabs   ║ setupController() finishes**     ║                                  ║ `ensureInitialized` polls 500ms ║
║                                        ║                               ║                                  ║                                  ║ for up to 30s (ugly)            ║
║ Keep-alive strategy                    ║ Offscreen pings SW every 5 s  ║ `setInterval(chrome.storage.     ║ Ref-counted port keep-alive +    ║ `setInterval` writes liveness   ║
║                                        ║ + long-lived popup ports +    ║ session.set, 2_000)` + onConnect ║ activity hooks; suppress         ║ to chrome.storage.session every ║
║                                        ║ chrome.alarms for hourly jobs ║ ports + `chrome.alarms` for      ║ auto-lock during in-flight       ║ 10 s while popup open;          ║
║                                        ║                               ║ specific recurring tasks         ║ requests                         ║ **NO chrome.alarms wake-up for  ║
║                                        ║                               ║                                  ║                                  ║ dApp messages — gap**           ║
║ State persistence                      ║ chrome.storage.local +        ║ chrome.storage.local +           ║ chrome.storage.local +           ║ chrome.storage.local +          ║
║                                        ║ Dexie (IndexedDB) +           ║ **IndexedDB BACKUP for           ║ chrome.storage.session +         ║ chrome.storage.session +        ║
║                                        ║ chrome.storage.session        ║ KeyringController + 2 others**   ║ IndexedDB (kv-store)             ║ IndexedDB (PXE per profile/     ║
║                                        ║                               ║                                  ║                                  ║ chain)                          ║
║ State sync UI ←→ SW                    ║ Proxy(set) auto-broadcasts on ║ **PatchStore: Immer patches over ║ Broadcast events on per-event    ║ Per-method event subscriptions  ║
║                                        ║ every service-store mutation  ║ wire (scales w/ change rate, not ║ name (wallet-update, vault-      ║ (`onProfileUpdated`, etc.) —    ║
║                                        ║ + Rematch dispatch in UI      ║ state size)**                    ║ locked, etc.)                    ║ no patches; full state in event ║
║ Shutdown story                         ║ `pm.dispose()` rejects all    ║ `setOnSetFailed` triggers backup ║ No explicit teardown (good for   ║ `stop()` exists but never       ║
║                                        ║ in-flight requests on unload  ║ recovery on disk corruption      ║ this scope; will matter at scale)║ called; only clears heartbeat   ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ === UI ↔ BACKGROUND ===                                                                                                                                                           ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ Transport                              ║ chrome.runtime.connect ports  ║ **chrome.runtime.connect +       ║ chrome.runtime.connect with Zod  ║ chrome.runtime.connect with     ║
║                                        ║ + `PortMessage` (custom)      ║ ObjectMultiplex** (3 substreams: ║ discriminated-union envelope     ║ `Service<Methods, Events>` typed║
║                                        ║                               ║ controller / patch-store /       ║                                  ║ RPC                             ║
║                                        ║                               ║ provider)                        ║                                  ║                                 ║
║ UI-side wallet API surface             ║ **`Proxy({}, get → port.req)` ║ JSON-RPC dictionary of ~200      ║ Proxy-backed                     ║ Per-service typed Client        ║
║                                        ║ cast to WalletControllerType  ║ bound methods                    ║ `InternalWalletInterface`        ║ classes (auto-reconnect, 60s    ║
║                                        ║ — zero ceremony, no runtime   ║                                  ║ generated by enumerating         ║ default timeout, jsonSanitize)  ║
║                                        ║ safety**                      ║                                  ║ schema keys                      ║                                 ║
║ Schema validation on transport         ║ None (stringly-typed)         ║ JSON-RPC 2.0 envelope; Immer for ║ **Zod validation on every        ║ TypeScript types only; no       ║
║                                        ║                               ║ patches                          ║ envelope; jsonStringify          ║ runtime schema                  ║
║                                        ║                               ║                                  ║ fallback for DataCloneError**    ║                                 ║
║ Reconnect / re-init                    ║ `dispose()` rejects pending   ║ `await isInitialized`            ║ Auto-reconnect with backoff      ║ Auto-reconnect (1s backoff) +   ║
║                                        ║ requests; UI re-checks        ║                                  ║                                  ║ fail-fast on lifecycle errors   ║
║ Wire concurrency                       ║ `pQueue({concurrency: 1000})` ║ Implicit (JSON-RPC) + per-port   ║ Per-port FIFO                    ║ Per-port; per-method; no global ║
║                                        ║ for backpressure              ║ stream                           ║                                  ║ throttle                        ║
║ Decorators / metadata                  ║ **`@Reflect.metadata('APPROVAL║ Per-controller `StateMetadata`   ║ None                             ║ None                            ║
║                                        ║ ', [...])` for method policy**║ {persist, anonymous}             ║                                  ║                                 ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ === dApp ↔ BACKGROUND ===                                                                                                                                                         ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ Provider injection                     ║ `chrome.scripting.register-   ║ Manifest content_scripts (MAIN + ║ Wallet-sdk handles it (no inpage ║ Wallet-sdk handles it (no inpage║
║                                        ║ ContentScripts(world: MAIN)`  ║ ISOLATED) + ObjectMultiplex      ║ in extension package)            ║ in extension package)           ║
║                                        ║ programmatically (Chromium    ║                                  ║                                  ║                                 ║
║                                        ║ MAIN-world manifest bug)      ║                                  ║                                  ║                                 ║
║ inpage script size                     ║ Imports                       ║ ~130 lines (page-world           ║ N/A (delegated to wallet-sdk)    ║ N/A (delegated to wallet-sdk)   ║
║                                        ║ @rabby-wallet/page-provider   ║ initializer + post-message-      ║                                  ║                                 ║
║                                        ║ (out-of-tree)                 ║ stream wiring)                   ║                                  ║                                 ║
║ Content script size                    ║ ~80 lines + BroadcastChannel  ║ Hundreds of LoC (handles BFCache,║ ~12 lines pure relay             ║ **9 lines** (pure relay via     ║
║                                        ║                               ║ stream re-init, etc.)            ║                                  ║ wallet-sdk ContentScript-       ║
║                                        ║                               ║                                  ║                                  ║ ConnectionHandler)              ║
║ Encryption (dApp ↔ wallet)             ║ Plaintext (EVM)               ║ Plaintext (EVM)                  ║ ECDH P-256 + AES-256-GCM via     ║ Same (ECDH + AES-256-GCM via    ║
║                                        ║                               ║                                  ║ @aztec/wallet-sdk                ║ @aztec/wallet-sdk)              ║
║ Approval window                        ║ **`notification.html` 400×600 ║ Notification window via          ║ **Per-request `approval.html?    ║ `WindowManager` opens window;   ║
║                                        ║ chrome.windows popup; queue;  ║ `notificationManager`; queue     ║ requestId=<id>` window; serial   ║ no explicit queue (one approval ║
║                                        ║ deferred-Promise resolves on  ║ via `pendingApprovals` map +     ║ queue (one window at a time);    ║ at a time by design); wait-     ║
║                                        ║ accept/reject**               ║ addRequest/acceptRequest state   ║ `authorization.getPending`       ║ for-popup deferred promise      ║
║                                        ║                               ║ machine                          ║ one-shot read at mount**         ║                                 ║
║ Origin gating                          ║ `permissionService` per-origin║ `@metamask/permission-controller`║ Remembered apps keyed on         ║ `dappSessionService` per-origin ║
║                                        ║ + `@APPROVAL` decorators +    ║ + middleware-stack permission    ║ **`(appId, origin, chainId,      ║ + capability map +              ║
║                                        ║ rate-limit (3 rejects/60s →   ║ enforcement                      ║ version)`** (prevents cross-net  ║ scope-enforcement (53 tests)    ║
║                                        ║ block 60s)                    ║                                  ║ auto-approval)                   ║                                 ║
║ Sub-message serialization              ║ Per-origin lockedOrigins/     ║ Per-origin throttling middleware ║ **Per-session FIFO** via         ║ Per-session FIFO + **decryption ║
║                                        ║ connectOrigins Sets (block    ║                                  ║ sessionQueues Map                ║ monkey-patch on upstream        ║
║                                        ║ parallel unlock prompts)      ║                                  ║                                  ║ private method**                ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ === VAULT & KEY MGMT ===                                                                                                                                                          ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ KDF                                    ║ PBKDF2-SHA256 default 600k    ║ PBKDF2-SHA256 600k iter via      ║ Argon2id (m=64MiB, t=3, p=1)     ║ PBKDF2-SHA256 600k iter +       ║
║                                        ║ via @metamask/browser-        ║ encryptorFactory                 ║                                  ║ AES-GCM-256 + ENCRYPTION_GUARD  ║
║                                        ║ passworder                    ║                                  ║                                  ║ probe                           ║
║ Vault format                           ║ {data, iv, salt} JSON +       ║ Same (browser-passworder)        ║ {iv, ciphertext} probe + raw     ║ {1 version byte][12 byte IV]    ║
║                                        ║ separate `booted` marker      ║                                  ║ secrets PLAINTEXT IN INDEXEDDB   ║ [ciphertext]} base64 + cross-   ║
║                                        ║ (encrypted "true")            ║                                  ║ (deferred encryption per their   ║ version vectors (M2.6)          ║
║                                        ║                               ║                                  ║ own README)                      ║                                 ║
║ At-rest encryption                     ║ Vault encrypted; non-secret   ║ Encrypted via KeyringController; ║ **NONE (deferred)**              ║ **YES (PasswordSecretBox seals  ║
║                                        ║ keyring metadata cleartext    ║ Snap state separately encrypted  ║                                  ║ master Fr secret per profile)** ║
║ Cross-restart unlock (no re-prompt)    ║ **`chrome.storage.session`    ║ No (re-prompt every cold start;  ║ Lock UX only (vault contents are ║ **`passhash` in chrome.storage. ║
║                                        ║ stores PBKDF2-derived AES key ║ `chrome.storage.session` only    ║ already plaintext)               ║ session in lenient mode (off    ║
║                                        ║ + salt; `tryUnlock()` decrypts║ stores keep-alive timestamp +    ║                                  ║ by default in 0.13.9+)**        ║
║                                        ║ vault silently after SW       ║ first-setup flag)                ║                                  ║                                 ║
║                                        ║ respawn**                     ║                                  ║                                  ║                                 ║
║ Auto-lock                              ║ `autoLockAt` in storage.      ║ Memory-only; idle → manual lock  ║ `chrome.alarms` 15-min default   ║ **`chrome.alarms` proactive TTL ║
║                                        ║ session; setTimeout +         ║                                  ║ via `auto-lock.ts`               ║ lock with stale-alarm gate via  ║
║                                        ║ re-arm on respawn             ║                                  ║                                  ║ scheduledTime===lockedAt**      ║
║ Hardware wallets                       ║ 13 keyring types (Ledger,     ║ Trezor/Ledger/OneKey/Lattice/    ║ None                             ║ None                            ║
║                                        ║ Trezor, KeyStone, etc.)       ║ KeystoneHQ via offscreen bridge  ║                                  ║                                 ║
║ Memory hygiene (zeroize)               ║ None visible                  ║ None visible                     ║ Zeroize-on-lock (Uint8Array fill)║ **Explicit `zeroize.ts` with    ║
║                                        ║                               ║                                  ║                                  ║ caller-vs-callee buffer         ║
║                                        ║                               ║                                  ║                                  ║ ownership semantics (M4.6)**    ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ === LONG-RUNNING OPS ===                                                                                                                                                          ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ Typical op duration                    ║ Seconds (sign, gas estimate)  ║ Seconds                          ║ Seconds-to-minutes (Aztec proofs)║ **Seconds-to-minutes (Aztec     ║
║                                        ║                               ║                                  ║                                  ║ proofs)**                       ║
║ Pattern for slow ops                   ║ Deferred-Promise approval +   ║ Approval state machine (addReq/  ║ Per-request approval window;     ║ Synchronous popup→SW RPC with   ║
║                                        ║ separate notification window  ║ acceptReq); long ops via         ║ keep-alive ref-counts on port    ║ 60s timeout default;            ║
║                                        ║                               ║ JsonRpcEngine async chain        ║ during in-flight requests        ║ in-memory tasks                 ║
║ Resumability after worker death        ║ **`historyDbService` persists ║ **`unlockPromise` pattern in     ║ Not persistent (in-memory only)  ║ **NOT RESUMABLE — operation     ║
║                                        ║ progress markers; resumes on  ║ perps: stores in-memory rebuild  ║                                  ║ journal preserves state labels  ║
║                                        ║ next boot before doing        ║ promise so callers can await     ║                                  ║ but not enough to reconstruct   ║
║                                        ║ anything else**               ║ readiness**                      ║                                  ║ a proof; tasks are memory-only**║
║ Cancellation primitive                 ║ Promise rejection only        ║ Promise rejection only           ║ Cancellation token cancels       ║ `cancellationToken` cancels     ║
║                                        ║ (no AbortController)          ║                                  ║ approval interaction; no abort   ║ popup interaction only;         ║
║                                        ║                               ║                                  ║ in PXE                           ║ **0 hits for `AbortController`  ║
║                                        ║                               ║                                  ║                                  ║ in wallet/ — gap**              ║
║ Retry / speed up                       ║ `setCurrentRequestDeferFn` +  ║ Transaction-controller speed-up  ║ User retries from dApp           ║ User retries from dApp          ║
║                                        ║ `bgRetryTxMethods` bumps      ║ via gas bump in pendingTx UI     ║                                  ║                                 ║
║                                        ║ nonce/gas 1.3× and replays    ║                                  ║                                  ║                                 ║
║ Concurrent proofs / parallel sims      ║ N/A (no proofs)               ║ N/A (no proofs)                  ║ Single PXE per session keyed by  ║ **Global ReadWriteGuard around  ║
║                                        ║                               ║                                  ║ Promise (concurrent first-callers║ ALL PXE writes; reads can happen║
║                                        ║                               ║                                  ║ await same init); one PXE per    ║ in parallel with other reads but║
║                                        ║                               ║                                  ║ chainId-version                  ║ proves block other proves       ║
║                                        ║                               ║                                  ║                                  ║ globally**                      ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ === MIGRATIONS ===                                                                                                                                                                ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ Migration framework                    ║ 10 versioned, sorted, applied ║ **206 migrations, sorted, in-    ║ Not visible in this package      ║ **Destructive wipe per version  ║
║                                        ║ at SW boot (storage.local-    ║ place mutation post-v186, errors ║                                  ║ bump (3 versions to date); the  ║
║                                        ║ scoped) + Dexie version()     ║ caught (non-fatal, Sentry)**     ║                                  ║ migrate.ts comment is honest:   ║
║                                        ║                               ║                                  ║                                  ║ "no production users yet"**     ║
║ Per-key changed-controller reporting   ║ No                            ║ **Yes (post-v186) — feeds split- ║ N/A                              ║ N/A (wipe doesn't preserve)     ║
║                                        ║                               ║ controller storage so only       ║                                  ║                                 ║
║                                        ║                               ║ changed keys re-write**          ║                                  ║                                 ║
║ Failure handling                       ║ Throw → halt boot             ║ Catch + Sentry + halt loop +     ║ N/A                              ║ Wipe → re-seed defaults         ║
║                                        ║                               ║ boot with partial state          ║                                  ║                                 ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ === SECURITY HARDENING ===                                                                                                                                                        ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ SES / lockdown                         ║ `SecSDK` (LavaMoat-style)     ║ **LavaMoat at extreme scale      ║ None                             ║ None                            ║
║                                        ║ hardening present but gated   ║ (~40k LoC of policies; 4 build   ║                                  ║                                 ║
║                                        ║ behind `false &&`             ║ flavors; ~6 months of dev cost)**║                                  ║                                 ║
║ CSP                                    ║ wasm-unsafe-eval              ║ wasm-unsafe-eval + sandbox       ║ **wasm-unsafe-eval +             ║ wasm-unsafe-eval + COEP+COOP    ║
║                                        ║                               ║ unsafe-eval (Snap iframes)       ║ function-bind alias to CJS stub  ║ for SharedArrayBuffer (Aztec    ║
║                                        ║                               ║                                  ║ to avoid 'unsafe-eval'**         ║ proving) — atypical for EVM     ║
║ Snaps / extensibility                  ║ None                          ║ **Yes** (offscreen sandbox in    ║ None                             ║ None                            ║
║                                        ║                               ║ MV3, iframe in MV2; full         ║                                  ║                                 ║
║                                        ║                               ║ capability/endowment system)     ║                                  ║                                 ║
║ Dep-supply-chain hardening             ║ Manual patch-package          ║ LavaMoat compartments (every     ║ patch-package + `function-bind`  ║ Pinned versions only            ║
║                                        ║                               ║ npm package wrapped at runtime)  ║ alias                            ║                                 ║
║ Phishing / blocklist                   ║ Heuristic per-origin block    ║ PPOM tx simulation +             ║ None                             ║ None                            ║
║                                        ║ (3 rejects/60s)               ║ TrustSignals + phishing detection║                                  ║                                 ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ === AZTEC-SPECIFIC (Grego/Nulo only) ===                                                                                                                                          ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ PXE host                               ║ N/A                           ║ N/A                              ║ Offscreen document               ║ Offscreen document              ║
║ PXE init pattern                       ║ N/A                           ║ N/A                              ║ **One PXE per (chainId, version) ║ Per (profileId, chainId)        ║
║                                        ║                               ║                                  ║ keyed by Promise; concurrent     ║ ChainRuntimeRegistry; orphan    ║
║                                        ║                               ║                                  ║ first-callers await same init**  ║ IndexedDB cleanup at init       ║
║ PXE store keying                       ║ N/A                           ║ N/A                              ║ **Namespaced by L1 rollup        ║ `pxe/<profileId>/<chainId>` —   ║
║                                        ║                               ║                                  ║ address (rollup upgrades cleanly ║ no rollup-address namespacing   ║
║                                        ║                               ║                                  ║ reset state)**                   ║                                 ║
║ Lazy PXE                               ║ N/A                           ║ N/A                              ║ **`@aztec/pxe/client/lazy`**     ║ Plain `@aztec/pxe`              ║
║ Kernel-less / stub-account simulation  ║ N/A                           ║ N/A                              ║ **`buildAccountOverrides()`      ║ **Partial: NO_FROM via          ║
║                                        ║                               ║                                  ║ swaps for                        ║ DefaultEntrypoint, but no       ║
║                                        ║                               ║                                  ║ StubSchnorrAccountContract-      ║ stub-account swap during        ║
║                                        ║                               ║                                  ║ Artifact in SimulationOverrides; ║ simulation; signing-key path is ║
║                                        ║                               ║                                  ║ real signing only at prove time  ║ touched in sim**                ║
║                                        ║                               ║                                  ║ (`shared/src/wallet/core/        ║                                 ║
║                                        ║                               ║                                  ║ demo-wallet.ts:139-226`)**       ║                                 ║
║ Public-static fast path                ║ N/A                           ║ N/A                              ║ **`extractOptimizablePublic-     ║ Not present                     ║
║                                        ║                               ║                                  ║ StaticCalls` + `simulateViaNode` ║                                 ║
║                                        ║                               ║                                  ║ + `buildMergedSimulationResult`  ║                                 ║
║                                        ║                               ║                                  ║ from @aztec/wallet-sdk; private+ ║                                 ║
║                                        ║                               ║                                  ║ public sims via Promise.all**    ║                                 ║
║ Sim vs prove gas-limit policy          ║ N/A                           ║ N/A                              ║ **Single `forEstimation: true`   ║ Implicit; no flag-based         ║
║                                        ║                               ║                                  ║ flag on `completeFeeOptions`     ║ separation                      ║
║                                        ║                               ║                                  ║ through one code path**          ║                                 ║
║ Auth witness pipeline                  ║ N/A                           ║ N/A                              ║ **simulate → collectOffchain-    ║ Custom kernelless authwit       ║
║                                        ║                               ║                                  ║ Effects → CallAuthorization-     ║ discovery (NuloAccount build-   ║
║                                        ║                               ║                                  ║ Request.fromFields →             ║ TxExecutionRequest); structure  ║
║                                        ║                               ║                                  ║ createAuthWit → merge-then-prove ║ similar but not as cleanly      ║
║                                        ║                               ║                                  ║ (`internal-wallet.ts:181-198`)** ║ separated                       ║
║ Capability authorization               ║ N/A                           ║ N/A                              ║ **AuthorizationManager with      ║ Capability map +                ║
║                                        ║                               ║                                  ║ progressive wildcard matching:   ║ scope-enforcement (53 tests);   ║
║                                        ║                               ║                                  ║ `simulateTx:0x123:swap` →        ║ no progressive wildcard         ║
║                                        ║                               ║                                  ║ `:*:swap` → `:*` with strict /   ║ matching                        ║
║                                        ║                               ║                                  ║ permissive mode**                ║                                 ║
║ Paymaster / fee abstraction UX         ║ N/A                           ║ N/A                              ║ **`embeddedPaymentMethodFeePayer`║ Implementation present but no   ║
║                                        ║                               ║                                  ║ with distinct UI signal**        ║ distinct UI chip surfaced       ║
║ NO_FROM execution UX                   ║ N/A                           ║ N/A                              ║ **`DefaultEntrypoint` with       ║ **Mechanism present in          ║
║                                        ║                               ║                                  ║ distinct UI chip + alert**       ║ `NuloAccount` for sendTx; no    ║
║                                        ║                               ║                                  ║                                  ║ distinct UI chip in approval**  ║
║ Account contract                       ║ N/A                           ║ N/A                              ║ Schnorr (upstream)               ║ Schnorr (upstream via           ║
║                                        ║                               ║                                  ║                                  ║ NuloAccount adapter, salt=ZERO, ║
║                                        ║                               ║                                  ║                                  ║ recursive payload chunking,     ║
║                                        ║                               ║                                  ║                                  ║ first-tx multicall wrapping)    ║
║ Fr revival at port boundaries          ║ N/A                           ║ N/A                              ║ **`reviveChainInfo` + Zod arg    ║ Implicit via `jsonSanitize`     ║
║                                        ║                               ║                                  ║ parsers reconstruct Fr/AztecAddr ║ utility; no explicit revival    ║
║                                        ║                               ║                                  ║ after JSON hops**                ║ helpers                         ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ === KNOWN HACKS / LOAD-BEARING DEBT ===                                                                                                                                           ║
╠════════════════════════════════════════╬═══════════════════════════════╬══════════════════════════════════╬══════════════════════════════════╬═════════════════════════════════╣
║ Largest load-bearing hack              ║ Offscreen→SW 5s ping as       ║ 2s storage.session timestamp     ║ Plaintext secrets in IndexedDB   ║ **`(handler as any).            ║
║                                        ║ keep-alive (acknowledged in   ║ as keep-alive (background.js:    ║ (deferred encryption per their   ║ handleEncryptedMessage = …`     ║
║                                        ║ comments)                     ║ 849)                             ║ own README)                      ║ monkey-patches upstream private ║
║                                        ║                               ║                                  ║                                  ║ method in wallet-sdk**          ║
║ God class                              ║ **`WalletController` 7,055    ║ **`metamask-controller.js`       ║ None (deliberately small)        ║ `ExecutionService` 1,920 LoC    ║
║                                        ║ lines**                       ║ 10,113 lines (90% wiring,        ║                                  ║ (already on next-arc            ║
║                                        ║                               ║ being dismantled)**              ║                                  ║ decomposition list)             ║
║ Polling antipatterns                   ║ UI polls getBackgroundReady   ║ Persistent setInterval timestamp ║ None                             ║ `ensureInitialized` polls 500ms ║
║                                        ║ every 100ms                   ║ writes (2s)                      ║                                  ║ for 30s; tx receipt watcher     ║
║                                        ║                               ║                                  ║                                  ║ infinite while-true             ║
╚════════════════════════════════════════╩═══════════════════════════════╩══════════════════════════════════╩══════════════════════════════════╩═════════════════════════════════╝
```

---

## Critical fixes for Nulo (production blockers)

These should be done before there are real users with real money. Both Claude self-analysis and Codex critical review converge on these.

### 1. Replace synchronous popup→SW execution with durable job submission for prove flows

The `ExecutionServiceClient` defaults to a **60-second timeout** (`packages/extension-messaging/src/background/client.ts:11-18`); the offscreen client raised its own to 90s for PXE calls (`packages/extension-messaging/src/offscreen/client.ts:10-18`); meanwhile Aztec proofs can take seconds-to-minutes. A healthy proof can blow the popup-side timeout while the SW continues proving and eventually submits — **classic split-brain UX**: popup says "Simulation failed, transaction not sent" while the chain confirms the tx (`packages/extension/src/popup/pages/send.vue:258-280`).

Pattern to adopt: **MetaMask's approval state machine** (`addRequest` → `acceptRequest` → `rejectRequest`) combined with **Rabby's resumable history-sync pattern** (`packages/wallets/Rabby/src/db/services/historyDbService.ts:153-246` writes "I am syncing" + progress markers before looping, resumes on next boot before anything else). Submit job, return jobId, observe job state via subscription. Job state survives SW death.

**Effort:** large (re-architect ExecutionService), but unavoidable.

### 2. Wire `AbortController` through prove and simulation pipelines

`grep -r "AbortController" packages/extension/src/wallet/` returns **zero hits**. `useFeeEstimation` only bumps a stale counter (`packages/extension/src/composables/useFeeEstimation.ts:52-90`); the underlying `simulateTx` keeps running under PXE's write lock. Stale fee estimates head-of-line-block real proofs.

**Effort:** medium. Thread `AbortSignal` from popup → `ExecutionServiceClient` → service → PXE call. Aztec.js may not honor abort everywhere yet — at minimum, abort should bypass the queue + drop result on resolution.

### 3. Partition PXE concurrency per `(profileId, chainId)`

`PxeService` wraps `simulateTx`/`proveTx`/`executeUtility`/`profileTx`/notes/events through one **service-global** `ReadWriteGuard` (`packages/aztec-runtime/src/pxe/service.ts:58-68`). Tab A proving on chain A blocks tab B simulating on chain B.

Codex says it bluntly: "*globally serialized inside PXE*". For multi-tab dApps this is wrong.

**Effort:** small-to-medium (replace the single guard with a per-key map).

### 4. Stop persisting `passhash` by default — make strict mode the default

Currently lenient mode persists `passhash` to `chrome.storage.session` for silent re-unlock after SW termination (`packages/extension/src/wallet/services/profile/session-manager.ts:193-206`). The `passhash` is a bearer-equivalent input to `EncryptionKey.fromPasshash()`. AUDIT.md A1 is honest about this.

Strict mode is already implemented and is set as default in 0.13.9+ per the self-analysis — **verify and enforce in tests** that no code path falls back to lenient without explicit user opt-in.

**Effort:** small if already done; verify via test.

### 5. Add auth gate to `exportEncrypted()`

`packages/extension/src/wallet/services/profile/service.ts:507-517` returns the encrypted secret blob with **no auth check**. AUDIT.md A2. Local-only attack surface, but trivial to fix.

**Effort:** trivial (add `await ensureUnlocked()` or equivalent).

### 6. Fix the `port!.postMessage` non-null race (AUDIT A5)

`packages/extension-messaging/src/background/client.ts:176`. Between the `while (state !== Connected)` loop and the `postMessage`, an `onDisconnect` handler can set `port = undefined`. The non-null assertion lies. Hasn't bitten because reconnect is fast; will eventually.

**Effort:** small. Capture port reference before await; guard the postMessage; on null reject with a structured error and let the caller retry.

### 7. Persist enough execution intent to recover SW-death-during-prove

The `OperationJournal` preserves state labels (`planned`/`proving`/`submitting`/`submitted`/`failed`) at `packages/extension/src/wallet/services/operation-journal/service.ts:23-29` but does NOT persist the inputs needed to reconstruct a proof. Codex calls this out as the most important gap for an Aztec wallet.

Either persist the request, or explicitly tombstone stuck `proving` jobs on next SW boot with a "request died, please retry" UI signal.

**Effort:** medium.

### 8. Add `chrome.alarms` wake-up for incoming dApp messages

Today nothing wakes the SW between popup sessions. A dApp's first message after popup-close cold-boots the entire BB-WASM init. Fix by registering an alarm that periodically (every 1-5 min) keeps the wallet "warm enough" — or, better, by structuring the boot path so first-message handling is fast (lazy BB init, prebuilt service graph).

**Effort:** small for the alarm; medium for the structural fix.

---

## High-impact patterns to adopt

Each ranked **specific source ↔ specific target** with file:line refs.

### From Grego (extension-wallet + shared)

#### A1. **Stub-account simulation overrides** — `shared/src/wallet/core/demo-wallet.ts:139-226` → Nulo `aztec-runtime/src/account/`

The single most valuable Aztec-specific pattern in the entire study. Build a `ContractOverrides` map swapping each in-scope account contract for `StubSchnorrAccountContractArtifact` from `@aztec/accounts/stub/*`, pass as `SimulationOverrides`, run `pxe.simulateTx(req, { overrides, scopes, ... })`. Real signing keys never enter the simulator. Adopt verbatim.

#### A2. **Public-static fast path** — `@aztec/wallet-sdk/base-wallet` (`extractOptimizablePublicStaticCalls` + `simulateViaNode` + `buildMergedSimulationResult`)

For read-heavy dApps, run private + public sims in parallel via `Promise.all`. Big speedup. Confirm the helper is exported from the version of `@aztec/wallet-sdk` Nulo pins.

#### A3. **`forEstimation: true` flag on `completeFeeOptions`** — for distinct sim vs real gas-limit policy through one code path

Avoids two parallel implementations. Cleaner than Nulo's current implicit handling.

#### A4. **Single PXE per `(chainId, version)` keyed by Promise** — concurrent first-callers await the same init

Nulo has per-`(profileId, chainId)`; align the keying with Grego's `(chainId, version)` to play well with Aztec network upgrades. Add the **L1 rollup address namespacing** so rollup upgrades reset state cleanly.

#### A5. **`@aztec/pxe/client/lazy`** — defer PXE wiring until first use

Already used by Grego. Likely a small change in `aztec-runtime/src/pxe/`.

#### A6. **JSON-stringify fallback on `postMessage` `DataCloneError`** — `port-server.ts:46-88`

For Aztec primitives (Fr, AztecAddress, BigInts, Buffer/Uint8Array). Tries structured-clone first; falls back to `jsonStringify(result)` and annotates `resultIsJson: true`; client transparently `JSON.parse`s. Nulo currently has `jsonSanitize` but not the fallback path. **High value for production** — DataCloneError under pressure is a nightmare to debug.

#### A7. **Offscreen `ready-gate` with explicit `offscreen-ready` signal** — `offscreen-lifecycle.ts:18-33`

`chrome.offscreen.createDocument()` resolves before listeners are attached. Grego waits for an explicit ready message from inside the offscreen runtime. Nulo's `ensureOffscreenRunning` already does READY handshake — verify and tighten.

#### A8. **Firefox fallback: hidden minimized window** — `offscreen-lifecycle.ts:67-85`

`chrome.windows.create({state:"minimized"})` to host `offscreen.html` when `chrome.offscreen` doesn't exist. Free Firefox support.

#### A9. **`function-bind` CJS stub aliased in Vite** — `wxt.config.ts:33-37` + `src/shared/function-bind-stub.cjs`

The `function-bind` package (transitive dep of many Aztec libraries) constructs functions from strings, breaking MV3 CSP `'unsafe-eval'`. Grego aliases both `function-bind` and `function-bind/implementation` to a stub that uses native `Function.prototype.bind`. **Save weeks of debugging** — this exact issue is one Nulo will hit eventually.

#### A10. **`nodePolyfills` for Buffer/process at module-init** — Vite plugin

Aztec deps reach for Node globals at module-init time. A runtime shim in a single entry doesn't survive code-splitting. Use the rollup-inject-style `vite-plugin-node-polyfills` to inject globally.

#### A11. **Capability manifests with progressive wildcard matching** — `shared/src/wallet/managers/authorization-manager.ts:218-256`

Resolution order: `simulateTx:0x123:swap` → `simulateTx:0x123:*` → `simulateTx:*`. Pair with strict / permissive mode + per-app duration. Makes the capability surface much more usable.

#### A12. **Remembered apps keyed on `(appId, origin, chainId, version)`**

Prevents cross-network auto-approval (adversarial dApp asks for testnet permission, gets mainnet). Nulo's `dappSessionService` already uses `origin` — extend to the full tuple.

#### A13. **NO_FROM + paymaster UX chips**

Nulo has the *mechanism* for both, but the approval window doesn't surface them as distinct UI signals. Grego has explicit "kernel-less" / "embedded paymaster" chips + alerts. Cheap UX win.

#### A14. **Schema-key enumeration NOT Proxy spread**

Spreading a Proxy into a plain object loses the `get` trap. Grego enumerates `Object.keys(WalletSchema)` to build handler maps. Worth a code-review pass on Nulo's dispatcher.

#### A15. **`authorization.getPending` one-shot read at mount, NOT broadcast-replay**

Avoids spamming every open UI surface with re-broadcasts. Approval window reads pending state at mount via the port and queries by `requestId`. Cleaner than maintaining a subscription.

### From Rabby

#### R1. **`chrome.storage.session` for derived AES key** — `background/utils/password.ts:36-83`

Stash the PBKDF2-derived AES key (NOT the password) in `chrome.storage.session`. After SW respawn, `tryUnlock()` reads it back and decrypts the vault silently. Combined with the auto-lock deadline also in `storage.session`, gives you "unlocked across SW deaths until manual lock or browser restart" without re-prompting.

Nulo's current lenient-mode persistence of `passhash` is **less safe** than Rabby's pattern (passhash is bearer-equivalent; Rabby stores the derived key directly which is similar in attack model but more disciplined naming/scoping). Verify Nulo's strict-mode default and consider Rabby's approach as the lenient-mode upgrade.

#### R2. **`createPersistStore` — Proxy-based auto-persist + auto-broadcast** — `background/utils/persistStore.ts:32-48`

60-line Proxy that auto-persists on mutation and auto-broadcasts a typed diff to UI. Nulo's `EntityStorage` could grow a sibling for "small reactive object stores" with this trick. **Good for popup-side ephemeral cached state.**

#### R3. **`PromiseFlow` koa-style middleware** — `utils/promiseFlow.ts:9-26` + `controller/provider/rpcFlow.ts`

17 lines wrapping `koa-compose`. Right abstraction for `(ctx, next) => Promise<void>` pipelines that gate RPC requests through lock → permission → approval → handler. Nulo's `wallet-bridge` dispatcher can adopt this.

#### R4. **`@Reflect.metadata` for declarative method policy**

Method handlers self-declare `@APPROVAL`, `@SAFE`, `@PRIVATE` instead of central config. The dispatcher becomes a generic gate-runner. Light cognitive load; see `provider/controller.ts:447-1951` and `rpcFlow.ts:39-502`.

#### R5. **Rate-limit per origin (3 rejections / 60s → block 60s)** — `service/notification.ts:435-495`

Trivial spam protection. Nulo doesn't have it.

#### R6. **`unlockPromise` pattern in `perpsService`** — `background/service/perps.ts:173-212`

When a subsystem has expensive post-unlock rebuild, store an in-memory promise of the rebuild and make callers `await` readiness instead of racing a partially built memory graph. **Directly applicable** to Nulo's PXE/PXE-init handshake.

#### R7. **Resumable jobs with persisted progress** — `db/services/historyDbService.ts:153-246`

Persist progress markers before the loop, update after each chunk, on next boot resume before doing anything else. **The right pattern for proof generation.**

### From MetaMask

#### M1. **`@metamask/messenger` `delegate({ messenger, actions, events })` — compile-time-enforced cross-service deps**

The single best thing in MetaMask's architecture. Each controller declares allowed actions/events; TypeScript fails compilation if it tries to use anything not delegated. Nulo's `Service<Methods, Events>` is in the same family — codify the same restriction.

#### M2. **`PatchStore` — Immer patches over wire** — `app/scripts/lib/PatchStore.ts`

Send patches not full state. Scales linearly with change rate, not state size. As Nulo's state grows (tx history, balances, contacts), this becomes meaningful. ~150 lines self-contained.

#### M3. **`LazyListener` pattern for SW boot** — `app/scripts/lib/extension-lazy-listener/extension-lazy-listener.ts`

Buffer events that fire during cold-start before real listeners attach; replay when listeners ready. Without it, an `onInstalled` event during first install can be lost. **Directly portable.**

#### M4. **Deferred-promise gating on port traffic** — `await isInitialized` (`background.js:637`)

Every `onConnect` handler queues until full boot. The way to handle MV3 cold-start race conditions cleanly. Nulo's `ensureInitialized` polling loop is the worse equivalent.

#### M5. **`ObjectMultiplex` with three substreams over one port** — `metamask-controller.js:7086`

`controller` (RPC for UI actions) + `patch-store` (state diffs) + `provider` (EIP-1193). Same Chrome port, three logical channels with different lifecycles. As Nulo grows, this pattern is more efficient than N separate ports.

#### M6. **Migrations framework: numbered, sequential, in-place mutation, failure-tolerant** — `app/scripts/lib/migrator/index.js:37-123` + `app/scripts/migrations/{002.js..207.ts}`

Critical: **failed migration is non-fatal** (logs Sentry, breaks loop, boots with partial state). And the post-v186 changed-controller reporting feeds split-storage so only modified keys re-write. **Storage migrations are the one thing nobody can retrofit later** — Nulo's destructive wipes are pre-launch only.

#### M7. **IndexedDB backup for vault recovery** — `shared/lib/stores/persistence-manager.ts:21`

Three "always-backup-these" controllers (`KeyringController`, `AppMetadataController`, `MetaMetricsController`) get a parallel backup in IndexedDB. On `chrome.storage.local` corruption, recover from backup. **Storage corruption is a real production issue** (Firefox flaky on disk pressure). Mandatory for an Aztec wallet where corruption could mean unrecoverable funds.

#### M8. **Approval state machine: `addRequest` (returns Promise) / `acceptRequest` / `rejectRequest`** — `@metamask/permission-controller`

The right way to model "user needs to confirm" flows. Combine with M9 below.

#### M9. **State metadata `{persist, anonymous}`** — `StateMetadata<T>` from `@metamask/base-controller`

Marks each state slice as persisted-or-not and Sentry-anonymous-or-not. Use for both storage and crash reporting.

---

## Anti-patterns to avoid

Things Nulo should NOT copy from these wallets despite their popularity.

1. **Don't ship MV2 alongside MV3** (Rabby + MetaMask both still do, both regret it). Drop the `isManifestV3` branches; you have the luxury they don't.
2. **Don't go LavaMoat at this stage.** Genuinely useful at MetaMask scale; ~6 months of dev cost + ~40k LoC of policy + 16 policy.json files to maintain across build flavors. For an Aztec wallet pre-mainnet, the cost-benefit isn't there. Use `--frozen-lockfile`, automated dependabot, small dep set, pre-commit `bun audit`. Add SES/LavaMoat after traction.
3. **Don't go Snaps.** Massive surface area (SES sandbox + capability enforcement + endowment runtime checks + attestation + allow-list management) for the value of "third parties can extend the wallet". Aztec's privacy model is a sufficient extension point for years.
4. **Don't build a 7,055-line `WalletController` (Rabby) or 10,113-line god class (MetaMask).** Keep your service-bound granularity (`AccountServiceClient`, `ProfileService`, etc.) — Nulo is **already doing this right**.
5. **Don't normalize the keep-alive hack.** MetaMask writes a 2-second `chrome.storage.session` timestamp; Rabby pings the offscreen every 5 seconds; both Codex reviews call this the wrong primary strategy. Design around SW death (resumable jobs, lazy listeners, deferred init), not against it.
6. **Don't use an untyped event bus** like Rabby's `eventBus.ts`. Two distinct event namespaces (`EVENTS` vs `EVENTS_IN_BG`) with stringly-typed string + payload = bug factory at scale.
7. **Don't lean on Sentry as your error-boundary strategy.** Rabby captures exceptions to Sentry without recovery in many places (`service/keyring/index.ts:1089-1091`, `ui/app.tsx:240`); user sees a hung UI.
8. **Don't treat tasks as memory-only** (Nulo's current state). Nothing that survives the worker = nothing that survives a 30-second-plus proof.
9. **Don't write entire `chrome.storage.local` namespace on each `set`** like Rabby's `createPersistStore`. Fine at small scale; explodes at wallet-size state.
10. **Don't blanket-clear alarms on each SW boot** (Rabby's `_raw/sw.js:3-10`). Discards in-flight delays.
11. **Don't rely on `isManifestV3` runtime branches throughout.** Compile-time variants are cleaner than runtime branching where both paths are kept alive.
12. **Don't monkey-patch upstream private methods** (Nulo's `(handler as any).handleEncryptedMessage = …`). It works; every minor wallet-sdk bump is a roulette. Push for the `void this.handleEncryptedMessage(...)` upstream fix or replace with a wrapper that doesn't depend on private internals.

---

## Aztec-specific recommendations (highest-leverage section)

In priority order:

1. **Adopt stub-account simulation overrides verbatim** (Grego A1). Real signing keys should not enter the simulator. `shared/src/wallet/core/demo-wallet.ts:139-226`.
2. **Restructure long-running operations as durable jobs.** This is the single biggest architectural shift. Not optional for an Aztec wallet whose tx latency exceeds most wallet timeouts.
3. **Partition PXE concurrency per chain.** Global write lock is wrong for multi-tab Aztec dApps.
4. **Add public-static fast path with parallel sims** (Grego A2). Big speedup for read-heavy dApps that many dApps will be.
5. **Adopt the `forEstimation: true` flag pattern** (Grego A3) for sim/real gas-limit unification.
6. **Add `@aztec/pxe/client/lazy`** and L1 rollup address namespacing for clean rollup upgrades.
7. **Surface NO_FROM and paymaster as distinct UI chips** in the approval window. Mechanism is already in `NuloAccount`; just plumb to UX.
8. **JSON-stringify fallback on postMessage** for Aztec primitives (Grego A6). Save weeks of `DataCloneError` debugging.
9. **`function-bind` CSP stub** (Grego A9). Pre-empt the MV3 'unsafe-eval' issue everyone hits.
10. **Persist enough proof reconstruction inputs** so a stuck `proving` job after SW death can be either resumed or explicitly tombstoned.
11. **Capability manifests with progressive wildcard matching** (Grego A11). Better than a flat capability map.
12. **Remembered apps keyed on `(appId, origin, chainId, version)`** (Grego A12). Prevent cross-network auto-approval.
13. **Multi-tab + multi-proof + cold-SW-mid-proof e2e tests.** For this wallet, not exotic — first-class correctness tests.
14. **Document `humanizeOperationKind` first-underscore-only bug fix as part of approval-UX work** (M6 STATUS.md follow-up). Pinned via test, deferred since M6.

---

## Suggested implementation roadmap

Phasing the recommendations so each phase is shippable and the high-impact items go first.

### Phase 1: "Stop the bleeding" (1–2 weeks)
*Goal: close the production-blocking gaps without big architecture work.*

- Crit #5 (auth on `exportEncrypted`) — trivial
- Crit #6 (port!.postMessage A5 race) — small
- Crit #4 (verify strict-mode default) — small
- Aztec #7 (NO_FROM / paymaster UX chips) — small UX work
- A6 (jsonStringify fallback) — small, Big bang for buck
- A9 (function-bind CJS stub) — copy-paste
- A10 (nodePolyfills) — copy-paste

### Phase 2: "Long-running ops" (3–6 weeks)
*Goal: durable jobs + cancellation + persistence — the biggest architecture work in the entire study.*

- Crit #1 (durable job submission) — the hard one
- Crit #2 (AbortController throughout)
- Crit #3 (per-chain PXE concurrency)
- Crit #7 (persist proof reconstruction inputs)
- A4 + A5 (Promise-keyed PXE init + lazy PXE)
- M3 + M4 (LazyListener + deferred-init port gating)
- R6 (unlockPromise for PXE init handshake)
- R7 (resumable progress markers)

> **Refined 2026-05-12 (post-PR-76 / v0.14.9)** — the canonical view of this section is now the HTML site, which splits Phase 2 into three:
> - **`nulo-phase-2.html`** — the shippable 8-item lift (this section, refined).
> - **`nulo-phase-2-plus.html`** — durable jobs *done right*: the six job-system properties Phase 2 leaves on the table (fairness, idempotency, retry policy, tombstones, sweeper, attach/detach) + chaos discipline + narrow formal methods. Mostly additive on top of Phase 2 if Phase 2 makes 5 forward-looking "carries" (see the Phase 2 page).
> - **`nulo-maximalist.html`** — 5/5 across all 12 dimensions plus 5 new ones (network privacy, supply chain, observability, threat modeling, narrow formal methods). Year-long shape. Storage hardening (rollback drills, migration test harness, IDB invariant validator, corruption quarantine, storage-corruption chaos) moves here from Phase 2 — it's persistence-spine work, not durable-jobs work.
>
> Two ideas surfaced in design conversation and were explicitly ruled out as *product* decisions: a dedicated progress window (separate popout owning long-running prove UI) and a desktop proving companion (Tauri-style native daemon). Wallet stays browser-only.

### Phase 3: "Catch up to Grego on Aztec" (2–3 weeks)
*Goal: Aztec-specific patterns that are visibly missing.*

- A1 (stub-account simulation overrides) — verbatim
- A2 (public-static fast path)
- A3 (forEstimation flag)
- A11 (capability manifests + wildcard matching)
- A12 (remembered apps with chainId)
- Multi-tab / cold-SW e2e tests

### Phase 4: "Catch up to MetaMask on infra" (3–4 weeks)
*Goal: industrial-strength foundations.*

- M1 (messenger delegation discipline — codify the rule and enforce in tests)
- M2 (PatchStore over the wire, replacing per-event subscriptions)
- M5 (ObjectMultiplex with controller + patches + provider streams)
- M6 (real migrations framework, replacing destructive wipes)
- M7 (IndexedDB backup for the vault)
- M9 (StateMetadata `{persist, anonymous}` flags)

### Phase 5: "Polish" (rolling)
- R2 (Proxy-based auto-persist sibling for `EntityStorage`)
- R3 + R4 (PromiseFlow + @Reflect.metadata in wallet-bridge)
- R5 (rate-limit per origin)
- Crit #8 (chrome.alarms wake-up)
- Re-test old flakes; clear M6 STATUS.md follow-ups
- ConfirmDialog promise-API upgrade (~30 sites)
- Storybook story coverage for L1/L2/L3 primitives

---

## Appendix: Claude vs Codex consensus per wallet

Where two independent agents agreed = high confidence. Where they disagreed = both views recorded.

### Rabby

**Both agree:**
- The 7,055-line `WalletController` is the worst code-smell.
- `chrome.storage.session` for AES key + `tryUnlock()` is the real lock-survival trick worth stealing.
- Hand-written `_raw/sw.js` + `importScripts` is a defensible MV3 pattern.
- Untyped `eventBus.ts` + 2 namespaces is fragile at scale.
- The keep-alive ping (offscreen→SW every 5s) is a load-bearing hack.
- Resumable history sync via `historyDbService` is the right pattern for long-running jobs.
- Notification window for sensitive approvals is the right UX.

**Diverge:**
- Claude rated `createPersistStore` Proxy + auto-broadcast highly; Codex called out the "writes whole object on every set" cost (both views are right; pattern is cheap at small scale, expensive at wallet-size).
- Claude described the `Proxy(wallet)` cast as "elegant"; Codex described it as "dynamic string dispatch with little schema protection". Both true.

### MetaMask

**Both agree:**
- `metamask-controller.js` is wiring not god class — but its 10k-line size and backwards-compat property assignments are still organizational debt.
- The `@metamask/messenger` `delegate({ actions, events })` pattern is the single most portable thing.
- Migrations framework (numbered + in-place + failure-tolerant + changed-controller reporting) is gold.
- The 2-second `chrome.storage.session` keep-alive is a hack; design around SW death instead.
- LavaMoat is real defense-in-depth at MetaMask scale; cost-prohibitive at smaller scale.
- Snaps is overkill for non-MetaMask use cases.
- IndexedDB backup for vault is mandatory for crypto wallets.

**Diverge:**
- Claude called `LazyListener` "the" pattern for SW boot; Codex emphasized `await isInitialized` deferred-promise gating instead. Both are correct — they compose.
- Claude was more detailed on `PatchStore`; Codex emphasized the boot-ordering disciplines around it. Both perspectives apply.

### Grego (extension-wallet)

**Both agree (despite Claude's original-agent scope drift):**
- `extension-wallet/` is structurally a thin transport host modeled on MetaMask; real wallet logic lives in `@demo-wallet/shared`.
- The single-port multiplexed Zod-typed RPC is steal-worthy.
- `jsonStringify` fallback for `DataCloneError` is critical infra for Aztec values crossing ports.
- Offscreen `ready-gate` + Firefox fallback is mature MV3 engineering.
- `function-bind` CSP stub + nodePolyfills are pre-solved production gotchas.
- `(appId, origin, chainId, version)` tuple-keyed remembered apps prevents cross-network auto-approval.
- At-rest encryption is deliberately deferred — Nulo is ahead here.
- `authorization.getPending` one-shot read at mount is cleaner than broadcast-replay.

**Diverge:**
- Claude (corrected) emphasized the keep-alive ref-counted port pattern; Codex emphasized the cross-session `authorization.resolve` (dApp/UI session may differ) — different details, both valuable.
- The original Grego claude agent (off-scope) surfaced the deepest Aztec patterns from `shared/src/wallet/*` (stub-account simulation, public-static fast path, capability manifests). The corrected agent + Codex covered the extension-MV3 layer thoroughly. Together they cover both halves.

### Nulo (self-analysis vs Codex critical review)

**Both agree (in close paraphrase):**
- Long-running ops is the biggest architectural gap. Synchronous popup→SW RPC with 60s timeout is wrong for Aztec.
- The wallet-sdk `handleEncryptedMessage` monkey-patch is load-bearing and embarrassing.
- `port!.postMessage` non-null assertion (A5) is a real race that will eventually bite.
- Storage migrations as destructive wipes are a pre-launch tactic, post-launch wallet-eater.
- PXE concurrency is too coarsely serialized.
- `passhash` lenient mode persistence is too soft a default.
- `exportEncrypted` lacks an auth gate.
- The popup-side `managers` global + `app.vue:140` dual-trigger race for `initAccount` is symptom-fixed (per-tuple lock) not designed-out.
- Documentation has drifted (`NuloAccount` path moved; conventions still mention Histoire post-Storybook switch).
- Real strengths: biome layer enforcement, `PasswordSecretBox` + cross-version vectors, `NuloAccount` adapter, M6 layer model.

**Diverge:**
- Self-analysis emphasized the strengths of the testing posture (517 unit + 166 e2e + audit:vue gate). Codex was more skeptical: "tests prove decomposition discipline better than they prove production liveness". Both true — the unit tests are good, the e2e is decent, but multi-tab + cold-SW + mid-proof scenarios are not exercised.
- Self-analysis described `ensureInitialized` 500ms-poll-for-30s as "ugly but works"; Codex described it more harshly. Self-analysis is closer to honest — it works, it's an embarrassment, it's not a bug.
- Self-analysis was warmer on the M6 layer model than Codex; Codex pointed out specific composables (`useFullscreenPopupSetting`, `useDappInteractionPayload`) that violate the "service composables don't own their own onUnmounted" rule. Self-analysis missed that.

---

## Closing read

If the user only does one thing from this study: **adopt the stub-account simulation pattern from Grego (Aztec #1) AND restructure long-running ops as durable jobs (Critical #1)**. Together, they solve the two areas where Nulo is most behind, and they unblock the rest of the Aztec roadmap. Everything else compounds, but those two are the ones whose absence will eventually look like a production bug.

The structural foundation Nulo has built — package boundaries, biome layer enforcement, M6 model, `NuloAccount` adapter, `PasswordSecretBox`, strict-mode-default, audit:vue gate — is *better than every other wallet in this study at the same age*. Don't let the "first-time-implementer" framing obscure that. The work is to fix the long-running-ops architecture and the half-dozen security/race papercuts, not to rebuild what's already working.
