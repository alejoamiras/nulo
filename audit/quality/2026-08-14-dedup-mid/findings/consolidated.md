# Consolidated findings — 2026-08-14-dedup-mid

15 findings — architectural: 3 · structural: 10 · local: 2. One finding (clipboard-copy) is cross-cutting across two clusters.

## Findings (priority order)

### [ARCHITECTURAL] Q-01: `Lock` exposes only `enter()`/`leave()` — the acquire/release protocol is hand-rolled at 56-71+ call sites

**Smell:** Duplicate Code → Shotgun Surgery · **Found by:** both · **Confidence signal:** convergent
**Blast radius:** 14 production modules on top of the shared `Lock` primitive (`packages/wallet-core/src/utils/lock.ts`) · **Change frequency:** high — 27-32 commits touched these service files in the last 90-120 days
**Instances:** `services/network/service.ts` (14 sites), `services/dapp-session/service.ts` (12), `services/fpc/service.ts` (7), `services/auth-registry/service.ts` (6), `services/operation-journal/service.ts` (8), `services/contact/service.ts` (5), `services/token/service.ts` (5, two guarded with a `holdsLock` boolean instead of the bare pattern), `services/transaction/service.ts` (4), `services/dapp-interaction/service.ts` (1), `services/profile/service.ts` (1, already has a local ad hoc wrapper), `services/incoming-transfer/service.ts` (1, already has a local ad hoc wrapper), `services/activity-protocol/coordinator.ts` (2), `services/wallet-sdk/queued-journal.ts` (1). Exact file:line pairs are enumerated in `ext-services-claude.md` (56 sites, 9 files) and `ext-services-codex.md` (71 sites, 14 files, superset).
**Evidence:** every write path does `try { await this.lock.enter() } finally { this.lock.leave() }` by hand. Two services already extracted local ad hoc exclusive-run wrappers (`profile/service.ts`, `incoming-transfer/service.ts`), and `token/service.ts` diverged into a `holdsLock` boolean guard instead of the bare pattern — proof the idiom is already drifting apart from having been copied 50+ times instead of centralized.
**Why it harms future change:** the mutual-exclusion contract ("always release in `finally`") is enforced by convention, not the type system. A write method that forgets the `finally` silently reintroduces the deadlock/starvation bug `Lock`'s own force-release timer exists to paper over.
**Recommended refactoring:** Extract Method — add `Lock.withLock<T>(fn: () => Promise<T>): Promise<T>` to `packages/wallet-core/src/utils/lock.ts`; inline the try/finally at every call site into `this.lock.withLock(...)`. The two ad hoc local wrappers and the `holdsLock` divergence disappear.
**Effort estimate:** 1-2 days (mechanical, but touches 14 files — Codex flags a handful of sites with extra `catch`/journal-transition logic around the critical section that need care during migration).

---

### [ARCHITECTURAL] Q-02: L1+L2 client-bootstrap block copy-pasted across 10-12 `bridge-core/scripts` conductors

**Smell:** Duplicate Code → Shotgun Surgery · **Found by:** both · **Confidence signal:** convergent
**Blast radius:** 12 files, ~2,900 combined lines, all under `packages/bridge-core/scripts/` · **Change frequency:** HIGH — the most actively edited part of the cluster (up to 9 commits/file; the 5.0/5.0.1 dependency upgrade touched 9 of these scripts together)
**Instances:** `deposit-testnet.ts`, `fuel-testnet.ts`, `deploy-bridge-testnet.ts`, `smoke-swap-existing-testnet.ts`, `fpc-dust-canary-mainnet.ts`, `deploy-bridge-mainnet.ts`, `smoke-existing-testnet.ts`, `deploy-sandbox.ts`, `smoke-existing-mainnet.ts`, `fee-juice-canary-testnet.ts` (Claude's 10) plus `discover-mainnet-fuel.ts`, `restore-swap.ts` (Codex's 2 additional) — all in `packages/bridge-core/scripts/`. Full file:line ranges for `defineChain`/client-construction/`--config` manifest-load/`t0`-`mins()` timer blocks are in both raw reports.
**Evidence:** the same four-part sequence — viem `defineChain` + `createPublicClient`/`createWalletClient`, `createAztecNodeClient`, `EmbeddedWallet.create`, and (in most) a `--config`-driven manifest load — recurs near-verbatim, plus an identical `t0`/`mins()` elapsed-timer helper in every file with a `main()`. Already silently drifted: `deploy-sandbox.ts` passes `pxeConfig: { proverEnabled: false }` while every sibling passes `true` at the identical call site, with nothing marking this as an intentional delta vs. a stale copy.
**Why it harms future change:** a fleet-wide fix (retry/timeout policy after a flaky-RPC incident, rotating a default RPC URL) means hand-editing the same block in 12 files, with every miss reintroducing the bug in one script while looking fixed everywhere else. `deploy-manifest.ts`/`deployer-keys.ts` already establish the precedent for a shared `scripts/` helper — it was just never done for the bootstrap itself.
**Recommended refactoring:** Extract Function into a sibling helper (e.g. `scripts/script-bootstrap.ts`): `createBridgeScriptClients({chain, rpcUrl, nodeUrl, proverEnabled})`, `loadManifestFromConfigArg(argv)`, `stopwatch()`. Each conductor keeps only its network-specific identifiers.
**Effort estimate:** 1 day.

---

### [ARCHITECTURAL] Q-03: `useFeeEstimation` and `useFeeEstimationMap` maintain two copies of the same cancel/debounce/handoff state machine

**Smell:** Duplicate Code → Shotgun Surgery (observed in git history, not inferred) · **Found by:** both · **Confidence signal:** convergent
**Blast radius:** 2 composable files on the fee-estimation hot path consumed by `send.vue` and the dApp-approval execute windows · **Change frequency:** both files were edited in the *same two commits*, six days apart, each shipping one feature (`5f115286` cancellable estimates, `204f2bf4` estimate-to-confirm handoff)
**Instances:** `apps/extension/src/composables/useFeeEstimation.ts:70-148` (whole state machine: `clearTimer`, `cancelOwnedRemote`, `cancel`, `schedule`, `handoff`) duplicated against `apps/extension/src/composables/useFeeEstimationMap.ts:73-169` (Map-keyed equivalent: `clearTimerFor`, `cancelOwnedRemoteFor`, `cancel(key)`, `schedule(key, params)`, `handoffAll`)
**Evidence:** both implement the identical algorithm — debounce-then-fire, a monotonic counter to invalidate stale in-flight promises, an inflight/completed token pair, a fire-and-forget `cancelRemote` for tokens that actually started, a `handedOff` set to disarm cancellation on submit, and `dispose`/`onScopeDispose` — once scalar, once keyed by `Map<TKey,…>`. The keyed file's own comment cross-references the other ("See `useFeeEstimation`: a transport failure must not orphan the SW-side runner…") — the duplication is a known, hand-maintained invariant, not an accident.
**Why it harms future change:** this is concurrency-sensitive code. Every future change to the estimate lifecycle has already twice required identical logic to be hand-written in both files, confirmed by two real commits; the next such change carries the same risk of a scalar/Map split with no compiler or test forcing parity.
**Recommended refactoring:** the Map-keyed version already generalizes the scalar case (a single-slot estimator is a map with one key). Reimplement `useFeeEstimation` as a thin wrapper over `useFeeEstimationMap` with one fixed sentinel key, deleting the ~90-line duplicate state machine.
**Effort estimate:** 0.5-1 day.

---

### [STRUCTURAL] Q-04: Async memoize-with-retry idiom hand-rolled 5-6 times in `pxe/`

**Smell:** Duplicate Code · **Found by:** both (Claude found a 6th instance, `service.ts`'s `stubClassRegistrations`, that Codex's scope excluded) · **Confidence signal:** convergent
**Blast radius:** 4-5 files in `packages/aztec-runtime/src/pxe/` · **Change frequency:** recurring — the pattern was hand-copied at least 3 separate times over ~3 months (`578861be` touched 3 sites together; `64d85291` added 2 more independently)
**Instances:** `packages/aztec-runtime/src/pxe/artifact-catalog.ts:88,93-106`; `note-schemas.ts:61,63-89`; `public-events.ts:169-182`; `public-events.ts:184-194`; `artifact-registry.ts:52,99-112`; `service.ts:508-523` (`stubClassRegistrations`, Claude only)
**Evidence:** each independently implements "cache a promise, clear it on rejection so a retry is possible," and the implementations have already diverged in subtle ways: `artifact-catalog.ts` conditionally deletes the cache entry only if the rejected promise is still current (a race guard absent from every other site), and `note-schemas.ts`'s own comment says "matches ArtifactRegistry pattern" — proof the author knew this was a re-implementation and hand-copied it anyway rather than extracting it.
**Why it harms future change:** the retry/race semantics are subtle and now exist as 5-6 independently-typed micro-implementations with no single place to land a correctness fix; the missing race-guard divergence is already a silent behavioral gap between "identical-looking" instances.
**Recommended refactoring:** Extract Function — a `pxe/async-memo.ts` exporting `memoizeAsync<T>()` (singleton) and `memoizeAsyncBy<K,V>()` (keyed), both encoding the cache-and-clear-on-reject contract once, with the race guard applied uniformly.
**Effort estimate:** 0.5 day.

---

### [STRUCTURAL] Q-05: Client passthrough exhaustiveness-guard copy-pasted in 16 `client.ts` files

**Smell:** Duplicate Code · **Found by:** both · **Confidence signal:** convergent
**Blast radius:** 16 files, all `services/<x>/client.ts` siblings on top of the shared `ServiceClient` + `definePassthroughs` · **Change frequency:** moderate — 8-12 commits/90 days touch these files; every new RPC method exposed on any service re-triggers the edit
**Instances:** `services/{account,account-state,auth-registry,contact,dapp-interaction,dapp-session,execution,fpc,incoming-transfer,log-viewer,note,passkey,task,token,token-balance,transaction}/client.ts` (all under `apps/extension/src/wallet/services/`)
**Evidence:** an identical 4-part skeleton is reproduced per file instead of centralized: a `_METHODS` array, an `Exclude<>`-based exhaustiveness type, a dummy const + `void` statement, a verbatim `biome-ignore` comment, and the `definePassthroughs(...)` call. The factory itself documents that callers should pair it with this assertion (`service-client-factory.ts:19-21`) but cannot enforce it through its current signature.
**Why it harms future change:** a future editor who forgets the exhaustiveness-guard step loses the compile-time proof silently — TypeScript won't complain; only a manual diff against a sibling file would catch the omission.
**Recommended refactoring:** Extract Function/Class — one shared generic (e.g. `definePassthroughsExhaustive<Methods>()`, or a curried factory constrained so `Exclude<keyof Methods, Tuple[number]>` must be `never`) in `extension-messaging/src/core/`. Each client keeps only its method-name array and a one-line call.
**Effort estimate:** 0.5-1 day.

---

### [STRUCTURAL] Q-06: Clipboard-copy hand-rolled at ~19 sites across popups, pages, and shared components — including the security-sensitive secret-export scrub logic (cross-cutting: ext-ui-popups + ext-pages-composables)

**Smell:** Duplicate Code → Shotgun Surgery · **Found by:** both scanners, independently, in both clusters (4-way convergence) · **Confidence signal:** convergent + scanner+prior-survey (prior-survey item #2: "three divergent address-copy implementations… predates the header-copy-address.ts extraction")
**Blast radius:** ~19 unique call sites spanning `components/`, `popup/components/popups/`, `popup/components/modules/`, `popup/pages/`, `composables/` · **Change frequency:** high collectively — 18-28 commits across the combined file set
**Instances:** `components/header-copy-address.ts:11-21` (correct: awaited, try/catch, sanitizes); `components/ScopeAddress.vue:47-54`; `components/ScopeClassId.vue:21-25`; `components/JsonViewer/JsonViewer.vue:72-81`; `popup/components/popups/AccountsPopup.vue:44-52`; `popup/components/popups/EditFpcPopup.vue:146-149`; `popup/components/popups/TokenMetadataPopup.vue:39-42`; `popup/components/popups/ReceivePopup.vue:26-29`; `popup/components/popups/IncomingTrustPopup.vue:74-83` (correct, independently re-derived); `popup/components/modules/general/BalanceView.vue:135-138`; `popup/pages/settings/about.vue:19-22`; `popup/pages/settings/accounts/index.vue:60-63`; `popup/pages/settings/contacts/index.vue:121-124`; `popup/pages/settings/fpcs/index.vue:70-73`; `popup/pages/settings/connected-apps/[id].vue:131-134`; `popup/pages/tokens/[id].vue:101-104`; `popup/pages/tx/[id].vue:106-109`; `popup/pages/settings/advanced/account-state/senders/index.vue:46-55`; `popup/pages/received/[id].vue:139-146`; `composables/useProfileImportFlow.ts:85-93`; `popup/pages/settings/security/export/key.vue:76-96,109-120` (scrub timer); `popup/pages/settings/security/export/seed.vue:66-86,99-109` (byte-identical scrub timer)
**Evidence:** the common shape is `navigator.clipboard.writeText(...)` then `openToast(...)`. Most sites fire the success toast unconditionally, without `await`/`catch`, so a rejected clipboard write (documented Chromium behavior on extension-popup focus-loss) produces a false "copied" toast — a bug already found and fixed once (`header-copy-address.ts`) but reintroduced at 7+ near-identical sites since; `ScopeAddress.vue` even duplicates the fix's sanitization logic byte-for-byte without the `await`/`catch`. Separately, `key.vue` and `seed.vue` duplicate the entire 60-second clipboard-scrub timer plus the "intentionally do NOT clear on unmount" rationale, word-for-word, for the wallet's private-key/seed-phrase export flow.
**Why it harms future change:** an already-fixed correctness bug keeps getting silently reintroduced by copy-paste instead of propagating from its one fix; separately, the export pages' scrub-timer duplication sits on the private-key/seed-phrase security surface, where a scrub-window or unmount-rationale change drifting between the two copies has security consequences, not just cosmetic ones.
**Recommended refactoring:** Extract Function — generalize `header-copy-address.ts` into `copyToClipboard(text, openToast, {successLabel, failureLabel})`, inline at the ~17 ordinary sites; separately Extract Composable `useSecretClipboardCopy(getValue, toastLabel)` for the two export pages' scrub lifecycle.
**Effort estimate:** 1 day (ordinary sites) + 0.5 day (secret-scrub composable — needs care given the security sensitivity).

---

### [STRUCTURAL] Q-07: Background/offscreen messaging transports duplicate the same 5-method error-shaping quintet

**Smell:** Duplicate Code (residual to an already-completed `BaseServiceClient` extraction) · **Found by:** both · **Confidence signal:** convergent
**Blast radius:** 2 files — the sole implementations of every popup↔SW and SW↔offscreen RPC call · **Change frequency:** 4 commits each since the base-class split, every one touching both files in lockstep
**Instances:** `packages/extension-messaging/src/background/client.ts:86-98,134-136,138-143,145-151,153-155` ↔ `packages/extension-messaging/src/offscreen/client.ts:68-85,113-115,117-122,124-130,132-134`; abstract contract at `core/base-client.ts:259-269`
**Evidence:** `makeRemoteError` and `makeDisconnectError` are byte-identical between the two files; `makeTimeoutError`/`makeSendFailureError` differ only in an interpolated message string while constructing identical `{requestId, methodName, cause}` detail objects; `onMessage` shares the same validate-then-dispatch shape. `offscreen/client.ts`'s own comment names the intent ("parity with the background transport") — this duplication is known and hand-maintained, not accidental.
**Why it harms future change:** `BaseServiceClient` was explicitly built to absorb "mechanics duplicated and subtly drift-prone across the two forks" — this is the part that extraction left behind. A future change to the wire error contract must be made twice with no compiler link between the copies.
**Recommended refactoring:** Pull Up Method — move `makeRemoteError`/`makeDisconnectError` verbatim into `BaseServiceClient`; Template Method for `makeTimeoutError`/`makeSendFailureError` via a message-template hook.
**Effort estimate:** 0.5 day.

---

### [STRUCTURAL] Q-08: dApp identity-strip trust anchor reimplemented independently 3 times

**Smell:** Duplicate Code → Divergent Change · **Found by:** both (Codex found a 3rd instance — `verify/index.vue`'s inline copy — that Claude's pass didn't surface) · **Confidence signal:** convergent
**Blast radius:** 3 implementations across the discover, capabilities, execute, and verify windows — this is the anti-phishing identity anchor a user reads before signing · **Change frequency:** 4 commits across the involved files
**Instances:** `apps/extension/src/components/composite/DappStatusStrip.vue:1-96` (consumed by `popup/windows/discover/index.vue:6,143` and `popup/windows/capabilities/index.vue:6,262`); `apps/extension/src/popup/windows/execute/SignerIdentityStrip.vue:1-105` (consumed by `popup/windows/execute/index.vue:460`); `apps/extension/src/popup/windows/verify/index.vue:179-192,271-330` (inline 3rd copy)
**Evidence:** all three render an identical skeleton — status dot, account name, separator, network name, trailing "NULO" brand mark — with class-for-class identical CSS (`identity_strip`, `status_dot`, `identity_account`, `identity_sep`, `identity_network`, `identity_brand`). `SignerIdentityStrip`'s own header comment ("Different from `DappStatusStrip` because…") confirms it was deliberately forked rather than designed as a shared-base variant.
**Why it harms future change:** a spacing, palette, status-semantics, or accessibility fix applied to the shared component silently leaves execute and verify visually inconsistent — exactly the kind of drift that undermines a trust anchor users rely on to confirm what they're about to sign.
**Recommended refactoring:** Extract Component — a presentation-only `IdentityStrip` frame taking `{accountLabel, networkLabel, status, warn?}`; all three implementations become thin callers.
**Effort estimate:** 0.5-1 day.

---

### [STRUCTURAL] Q-09: `trimAddress()` exists and is well-adopted, yet is independently hand-rolled at 9 sites with 4 mutually-inconsistent separator styles

**Smell:** Duplicate Code → Shotgun Surgery · **Found by:** both · **Confidence signal:** convergent
**Blast radius:** 1 canonical file + 9 consumer files spread across `popup/windows`, `popup/pages`, and `components` · **Change frequency:** `string.ts` itself is low-touch, but the 9 sites sit in actively-touched trees
**Instances:** `apps/extension/src/utils/string.ts:6-9` (canonical, `trimAddress(address, start=8, end=4)`); `popup/windows/verify/index.vue:44`; `popup/components/popups/AccountsPopup.vue:76`; `popup/windows/capabilities/AccountSelectRow.vue:51`; `popup/pages/settings/connected-apps/[id].vue:231`; `popup/pages/settings/accounts/index.vue:79`; `components/Header.vue:250`; `popup/components/modules/general/TokenImportRow.vue:27`; `popup/pages/journal/[id].vue:125`; `popup/components/popups/ReceivePopup.vue:63-66`
**Evidence:** all 9 sites reimplement the same `start=6, end=4` slicing policy `trimAddress` already supports, but with 4 different separator styles — `..` (canonical) vs `...` (6 sites) vs the single Unicode ellipsis `…` (2 sites) vs a bulleted two-span `•••` layout (1 site) — live proof the hand-rolled copies have already drifted from each other and from the canonical helper.
**Why it harms future change:** a rebrand of the truncation affordance, or an a11y-driven separator change, requires grepping across the whole `popup/` and `components/` trees instead of editing one function; the codebase already visibly disagrees with itself on what a truncated address should look like.
**Recommended refactoring:** Replace Inline Code with Function Call — swap each of the 9 sites for `trimAddress(address, 6, 4[, separator])`; extend `trimAddress` with an optional separator parameter if the visual variety is intentional.
**Effort estimate:** 2-3 hours.

---

### [STRUCTURAL] Q-10: `deploy-private-fpc-mainnet.ts` / `-testnet.ts` duplicate the protocol-correctness-critical deploy conductor

**Smell:** Duplicate Code · **Found by:** both · **Confidence signal:** convergent
**Blast radius:** 2 files, ~150 combined lines, ~92-line overlap · **Change frequency:** low but asymmetric — testnet has 3 commits (most recently the 5.0.1 `@aztec/*` rename), mainnet has 1 (its introduction)
**Instances:** `packages/bridge-core/scripts/deploy-private-fpc-mainnet.ts:26-27` (timer), `:28-34` (node/pin/idempotency check), `:58-70` (deploy + address assertion); `deploy-private-fpc-testnet.ts:25-26`, `:27-33`, `:61-73` (same structure)
**Evidence:** both scripts independently start the same elapsed timer, create the node client + canonical pinned address, early-return if the contract already exists, deploy `PrivateFPCContract` with the same `PRIVATE_FPC_SALT`/`universalDeploy: true`, assert the resulting address equals `PRIVATE_FPC_ADDRESS`, and log completion — only the fee-payment/account-bootstrap middle section genuinely differs.
**Why it harms future change:** the pinned-address assertion + deploy-args block is what proves the deployed contract lands where the faucet's manifest and the wallet hardcode; the asymmetric commit history shows this already didn't stay in lockstep once.
**Recommended refactoring:** Extract Function — `deployCanonicalPrivateFpc({node, prepareDeployment})` owning the idempotency check + canonical deploy/assert sequence; each network file keeps only its account/fee-setup call.
**Effort estimate:** 0.5 day.

---

### [STRUCTURAL] Q-11: Dead `<style module>` CSS block copy-pasted across 5+ popup files (~280+ dead lines), plus scattered dead selectors in 8 more

**Smell:** Dead Code + Duplicate Code · **Found by:** both (Codex's superset spans 13 files total; Claude confirmed the core 5-file exact duplicate) · **Confidence signal:** convergent + scanner+prior-survey (prior-survey item #1: "nine dead `<style module>` CSS blocks across popup components")
**Blast radius:** 13 files with dead CSS; the core duplicated block spans 5 popup files · **Change frequency:** not dormant — a prior quality pass (`#220`, "harden-quality arc — 21/22 audit findings") touched these exact files and still didn't remove the block
**Instances:** `NewAccountPopup.vue:137-194`; `EditAccountPopup.vue:96-153`; `NewNetworkPopup.vue:194-231/249`; `EditNetworkPopup.vue:133-170/188`; `NewSenderPopup.vue:180-217/235` (partial — only `.network`/`.icons`/`.item`; `.shake` stays live); plus Codex's additional dead-selector sites: `EditContactPopup.vue:300-318` (`.shake` + keyframes); `EditProfilePopup.vue:185-198` (`.icon_btn`); `AccountsPopup.vue:142-191`; `RevokeAuthwitsPopup.vue:313-316`; `SelectProfilePopup.vue:148-165`; `SelectTokenPopup.vue:111-128`; `BalanceView.vue:388-398`; `SelectNetworksPopup.vue:135-137,145-149`
**Evidence:** the `.network`/`.icons`/`.item` rules (identical row-border, hover/active state, icon-opacity, `.item.selected`/`.disabled` declarations) are md5-identical across the 5 core files; grep across every owning template confirms zero live `$style[...]` or `class="...network..."` references anywhere.
**Why it harms future change:** a future editor sees the block defined 5 times and must independently re-derive that none of it is live before touching styling; a new popup copied from one of these 5 propagates yet another dead stylesheet forward — precisely what already happened once through `#220`'s own pass.
**Recommended refactoring:** Remove Dead Code — delete the 5 identical blocks (partial delete for `NewSenderPopup.vue`) plus the 8 isolated dead selectors.
**Effort estimate:** 2-3 hours.

---

### [STRUCTURAL] Q-12: CTA button variants (base/outline/destructive) duplicate the same 7-property typography contract

**Smell:** Duplicate Code · **Found by:** both, on the narrow CTA-variant claim · **Confidence signal:** convergent on the 3-variant CTA claim; **cross-model disagreement** on Claude's broader 15-site/12-file "brutalist uppercase label" claim — Codex explicitly rejected the wider scope ("the instances differ in font family, spacing, weight, size, and role"), so this finding is scoped to the convergent core only. The broader letter-spacing-drift observation is preserved in Cross-cutting observations below as an unresolved, lower-confidence lead.
**Blast radius:** 1 file (`Button.vue`) + ~15 production consumer files using CTA variants · **Change frequency:** 6 commits to `Button.vue` since May 2026
**Instances:** `packages/design/src/ui/Button.vue:302-312` (`.cta`), `:326-336` (`.cta_outline`), `:347-357` (`.cta_destructive`)
**Evidence:** all three selectors independently declare `width: 100%`, the same headline font, `font-weight: 700`, `font-size: 14px`, `letter-spacing: 0.2em`, `text-transform: uppercase`, and `padding: 20px 0` — 7 identical declarations × 3 variants; only background/foreground/border/interaction genuinely differ.
**Why it harms future change:** a design-wide CTA height/tracking/font adjustment requires 3 synchronized edits, and a 4th CTA variant is likely to copy the whole block again rather than just the genuinely variant-specific part.
**Recommended refactoring:** group the 3 selectors' shared declarations into one CSS rule (e.g. a shared `.cta-base` class or a comma-joined selector list), leaving only color/border/interaction per variant.
**Effort estimate:** 1-2 hours.

---

### [STRUCTURAL] Q-13: `handleRegisterToken` / `handleGrantPublicAuthwit` reimplement the dispatcher's session-account-authorization helper, with weaker error handling

**Smell:** Duplicate Code → Divergent Change · **Found by:** claude · **Confidence signal:** single-model (cross-model disagreement — Codex's `pkg-bridge-trio` pass did not surface this gap; it isn't explicitly rejected either, it's simply an uncontested coverage gap). Kept despite single-model status: the divergence is security-relevant (which account a dApp may act as on the user's behalf) and the evidence is concrete and mechanical, not speculative.
**Blast radius:** 1 file (`dispatcher.ts`, 1383 lines, 17 commits/120 days) — 2 methods today, the natural next-copy site for any future dApp-facing RPC needing a `from` account · **Change frequency:** `dispatcher.ts` is a 17-commit/120-day hotspot
**Instances:** `packages/wallet-bridge/src/dispatcher.ts:774-786` (`handleRegisterToken`), `:821-829` (`handleGrantPublicAuthwit`); pre-existing shared helper at `:1350-1378` (`resolveNetworkAndAccount`, correctly used by `handleSendTx:650` and `handleCreateAuthWit:718`)
**Evidence:** both handlers hand-roll the identical 6-line resolve-and-validate sequence (`resolveNetwork` → `getAccounts` → `getSessionAccountAddresses` → `find()` → throw) that `resolveNetworkAndAccount` already implements — and it has already diverged: the shared helper distinctly handles the `allAccounts.length === 0` and empty-session-accounts cases with more specific errors, while both inline copies fall through `find()` returning `undefined` and surface only a generic "is not authorized" message.
**Why it harms future change:** this is the code deciding which account a dApp is allowed to act as — a security-relevant surface now living in 3 places (1 correct, 2 weaker) instead of 1, with nothing enforcing they stay in sync.
**Recommended refactoring:** Extract Function/reuse — replace both inline blocks with a direct call into `resolveNetworkAndAccount(ctx, dappSession, requestedAccount)`.
**Effort estimate:** 1-2 hours.

---

### [LOCAL] Q-14: `WalletError` subclasses repeat an identical 2-line ctor identity-setup tail 11 times

**Smell:** Duplicate Code · **Found by:** both · **Confidence signal:** convergent
**Blast radius:** 1 file (`errors.ts`, 344 LOC), 11 subclasses · **Change frequency:** 7 commits to the file; the pattern is re-copied once per new subclass (most recently `ProfileIdConflictError`, `RestoreTornError`)
**Instances:** `packages/extension-messaging/src/errors.ts` — `RpcTimeoutError`, `RpcDisconnectedError`, `UserRejectedError`, `JobCancelledError`, `CapabilityNotGrantedError`, `TooManyPendingError`, `ValidationError`, `InvalidPasswordError`, `AccountAddressInconsistencyError`, `RestoreTornError`, `ProfileIdConflictError` (11 constructors, exact ranges ~lines 47-268 per both raw reports)
**Evidence:** every subclass ctor ends with `this.name = "X"` then `Object.setPrototypeOf(this, X.prototype)`; the base class's own comment documents this as a known, repeated ritual ("subclasses repeat this in their ctors").
**Why it harms future change:** nothing enforces that a 12th subclass gets both lines right — a missed `setPrototypeOf` silently breaks `instanceof WalletError` across the RPC boundary, the exact bug class the comment calls out.
**Recommended refactoring:** Pull Up Constructor Behavior — set `this.name` and use `new.target.prototype` once in the base ctor; subclasses drop both lines.
**Effort estimate:** 1-2 hours.

---

### [LOCAL] Q-15: `Tooltip.vue`'s cross-axis position resolver duplicates its own 3-case switch across all 4 sides

**Smell:** Duplicate Code (parallel switch statements) · **Found by:** both · **Confidence signal:** convergent
**Blast radius:** 1 file (`Tooltip.vue`, 280 LOC, the package's largest UI-logic file); imported by `Input.vue` and used package-wide · **Change frequency:** 3-4 commits to the file
**Instances:** `packages/design/src/ui/Tooltip.vue:70-82` (top, `xPos` switch), `:88-100` (bottom, identical `xPos` switch), `:106-118` (left, `yPos` switch), `:124-136` (right, identical `yPos` switch)
**Evidence:** the `center`/`start`/`end` 3-case switch computing `xPos` for `top` is byte-identical to the one for `bottom`; same for the `yPos` switch shared between `left` and `right` — only the perpendicular offset differs between each pair.
**Why it harms future change:** this is real geometry logic, not styling — a rounding fix or viewport-clamp applied to one copy and forgotten in its sibling produces a tooltip correctly positioned on top/bottom but subtly wrong on left/right, a bug class that's easy to ship because the two axes are rarely compared side-by-side.
**Recommended refactoring:** Extract Function — `crossAxisOffset(position, start, end, size)` parameterized by which rect dimension feeds it; call once for top/bottom (width) and once for left/right (height).
**Effort estimate:** 1 hour.

---

## Dropped (with one-line reasoning)

**Cross-model disagreements (one scanner's non-findings explicitly rejected the other's finding):**

- claude/pkg-aztec-runtime:"PxeService is a Large Class bundling 4 concerns" — codex explicitly rejected: "size alone is insufficient here: its RPC methods consistently centralize the offscreen trust boundary and shared concurrency protocol."
- codex/pkg-aztec-runtime:"Timeout fetch is a local fork of the SDK transport" — claude explicitly rejected: "a deliberate, documented near-copy of *external* logic to bolt on a missing feature, not internal duplication."
- claude/pkg-design:"Bordered-surface box primitive reimplemented 6x" — codex explicitly rejected: "different semantics, layout, padding, and interaction behavior… already centralized in CSS variables."
- claude/ext-services:"`ensureInitialized`+`requireActiveProfile` preamble duplicated 35x" — codex explicitly rejected: "short service-boundary guards whose parameters and required ordering vary; extracting them would mainly conceal access semantics."
- claude/ext-ui-popups:"'Already exist(s)' uniqueness-validation triple duplicated 10x" — codex explicitly rejected: "too small to justify a validation abstraction beyond the existing form API."
- claude/ext-ui-popups:"5 New*/Edit* popup pairs share an un-extracted structural shape" — codex explicitly rejected: "a single parameterized CRUD component would introduce conditional configuration rather than remove a stable duplicate algorithm."
- claude/ext-pages-composables:"Multi-service-client connect/disconnect wiring hand-written per page" — codex explicitly rejected: "parent-owned connect/disconnect is the repository's explicit C1 convention… a generic ownership helper would hide rather than remove that responsibility."
- claude/ext-utils-runtime:"`comma()` reimplements `formatBaseUnits()`'s job" — codex explicitly rejected: "different input and rounding semantics; merging them would conflate" them.

**Convergent but trimmed for density (both scanners found these; smallest blast radius among the "local" tier, superseded in priority by Q-14/Q-15's stronger instance counts):**

- claude+codex/pkg-messaging-core-crypto:"`applyNuloSchemaPatch` repeats install-or-validate 3x" — real and convergent, but only 3 instances in 1 file; genuine low-effort pickup, not selected for the 15-cap.
- claude+codex/ext-utils-runtime:"`LoggerStore.log()`/`.logWithContext()` duplicate body" — real and convergent, but only 2 instances in 1 file; smallest blast radius of the convergent local-tier candidates.

**Single-model, not selected for density (real findings, genuine evidence, but crowded out by higher-blast-radius or better-corroborated items above):**

- codex/pkg-aztec-runtime:"Retired profile-switch behavior remains as an empty subscribed hook" (Dead Code/Speculative Generality) — local, 1 file; folded into cross-cutting note below.
- claude/pkg-aztec-runtime:"Identical warn/debug logger-adapter lambda duplicated in service.ts" — local/cosmetic, 2 sites in 1 file.
- codex/pkg-design:"Public components advertise two unimplemented API features" (`suffix` prop, `onKeybind` event) — real dead code, structural (3 files), not selected for density.
- claude/pkg-messaging-core-crypto:"`EntityStorage`'s four enumeration methods re-derive the same root-prefix filter loop" — structural, single-model, 4 methods in 1 file.
- codex/pkg-bridge-trio:"Pre-v2 record-sealing API remains as test-only production code" (`sealRecordSecret`/`openRecordSecret`) — confirmed dead (no production callers), local, single-model.
- codex/ext-services:"`IncomingTransferService` owns several independently changing subsystems" (Large Class/Divergent Change) — single-model; Claude explicitly self-excluded the same file's size as "out of focus for this pass" given the declared duplication focus. Not a duplication finding by either scanner's own framing.
- claude/ext-pages-composables:"Two of four account-state subpages hand-roll fetch/loading/error instead of using `useEntityCrud`" — partial disagreement (Codex rejected the watch/mount/unmount-triad half of the argument); the useEntityCrud-adoption-gap half is single-model and not selected for density.
- codex/ext-pages-composables:"`restoreBackup` is a 532-line restore transaction" (Long Method) — single-model; Claude's non-findings self-excluded the same file's size on identical "out of declared duplication focus" grounds.
- claude/ext-utils-runtime:"Three independently-maintained switch statements map `JobErrorKind` to display text" — single-model, local, contained to 1 file.
- claude/ext-utils-runtime:"`isTerminal`/`TERMINAL_STAGES` reimplemented via 2 hand-rolled enumerations" — single-model, structural but low current risk (stable 8-stage FSM).
- codex/ext-utils-runtime:"`simulate()` constructs the same `FunctionCall` on both execution branches" — single-model, local, 2 sites in 1 file.

---

## Cross-cutting observations

- **Clipboard-copy duplication (Q-06) is the clearest cross-cluster case in this run** — both `ext-ui-popups` and `ext-pages-composables` scanners independently found overlapping instances of the same root cause (a hand-rolled `navigator.clipboard.writeText` + toast pattern, with a known-fixed-but-not-propagated correctness bug). Consolidated into one finding with a merged, deduplicated instance list.
- **"Shared primitive with only raw enter/exit, no convenience wrapper" is a recurring shape**: `Lock` (Q-01, the `withLock()` gap) is the sharpest instance, but `pkg-messaging-core-crypto`'s `Lock` vs `ReadWriteGuard` comparison (both scanners' non-finding, correctly rejected as unmergeable state machines) shows the same package family has more than one concurrency primitive that could benefit from an ergonomic wrapper, even where a *shared base class* isn't warranted.
- **pkg-design's broader "uppercase brutalist label" claim (Claude, 15 sites / 12 files, letter-spacing drifting across 6 values) did not survive cross-model scrutiny** as a single actionable finding — Codex's read is that most of the 12 non-CTA sites differ enough in font-family/size/weight/role that a shared utility class would either be a no-op or force artificial uniformity. The convergent CTA-only core is Q-12. The wider claim is a legitimate lower-confidence lead (the letter-spacing values genuinely do vary: `0.04em`/`0.08em`×4/`0.1em`×2/`0.12em`×2/`0.2em`×3/`-0.04em`) worth a follow-up design-system-specific pass rather than a duplication-audit action item.
- **Prior-survey items NOT rediscovered by any scanner this run** (from the withheld prior UI-surface survey — listed here per the coordinator brief, not promoted to findings):
  - Two icon languages mixed in the same components (`SettingItem.vue:60,94` vs `SubPageHeaderBase.vue:37,43` — custom `Icon` set vs `MaterialIcon` web-font). Both `pkg-design` scanners explicitly examined and rejected the two-icon-systems pattern as non-duplication ("different technology… not one reimplemented twice"), which is a *different* observation than the prior survey's narrower claim about these two specific call sites choosing inconsistently between them — the narrower claim was not independently re-examined.
  - Pre-refresh "double hero" headers still on `activity.vue` and `settings/index.vue`.
  - `send.vue` leftover `console.log` statements + a hardcoded `rgba(35,31,28,1)` instead of the border token (correctness/style-adjacent, outside this audit's duplication focus regardless).
  - `tokens/[id].vue`'s `isRefreshingBalance` ref, never set anywhere (dead state wired into the template) — in-scope for `ext-pages-composables` but not caught this run.
  - `RevokeAuthwitsPopup.vue` as a 377-line monolith (largest popup) — its *dead CSS* was caught (folded into Q-11 via Codex's superset), but the size/monolith framing itself was not raised by either scanner (out of declared duplication focus).
  - `ConfirmPopup`'s destructive-variant defect (red intent passed to the native `type` attribute instead of `variant`) — correctness, explicitly out of scope for a duplication audit per the prior survey's own note.

## Coordinator remarks

- **Inputs**: all 16 raw scanner reports were present and substantive (9-22KB each); none were empty or degenerate. No repo-map re-reads were needed beyond what's cited above (no direct file:line factual conflicts arose — all disagreements were interpretive/scope calls with concrete reasoning on both sides, not "which line number is correct" disputes), so no source spot-checks were performed.
- **Unusually high convergence**: this run produced far more independently-convergent findings (16 candidate root causes both scanners agreed on) than the ~10-finding target accommodates. Rather than diluting the list with weak single-model additions, the two smallest-blast-radius convergent "local" findings (`applyNuloSchemaPatch` x3, `LoggerStore` dup) were trimmed to the dropped list in favor of keeping every higher-blast-radius/architectural convergent finding plus one security-relevant single-model finding (Q-13). Final count (15) sits at the stated hard cap rather than the ~10 target, which reflects the density of *real, cross-validated* duplication this run surfaced rather than under-filtering.
- **Disagreement resolution**: 8 cases where one scanner's own "Non-findings" section explicitly and concretely rejected the other scanner's finding. All 8 were resolved by siding with the rejecting scanner, since in every case its rejection cited a specific, checkable distinction (a documented deliberate convention, materially different underlying data structures, or an explicit repo-convention citation) rather than a vaguer "not sure this counts" — see the Dropped section for the specific reasoning per case.
- **Cluster coverage**: all 8 clusters contributed at least 1 surviving finding (`pkg-aztec-runtime`: 1, `pkg-design`: 2, `pkg-messaging-core-crypto`: 2, `pkg-bridge-trio`: 3, `ext-services`: 2, `ext-ui-popups`: 3 incl. the shared cross-cutting one, `ext-pages-composables`: 2 incl. the shared cross-cutting one, `ext-utils-runtime`: 1).
