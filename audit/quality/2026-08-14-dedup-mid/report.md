# Harden Quality Report

**Repo:** nulo (browser-extension monorepo)
**Date:** 2026-08-14
**Effort:** medium
**Run ID:** 2026-08-14-dedup-mid
**Models:** Phase 1 mappers — Claude Sonnet ×8 · Phase 2 scanners — Claude Sonnet + Codex gpt-5.6-sol (medium) per cluster, 16 total · Phase 3 coordinator — Claude Sonnet · Phase 4 verifiers — Claude Sonnet ×5 · orchestration — Claude Fable 5
**Scope:** `apps/extension` + all `packages/*` (~105k LOC; extension `src/` ≈81k, packages ≈24k). **Declared focus: duplication.** Excluded: `apps/faucet`, `apps/playground`, the landing, generated files (`auto-imports.d.ts`, `components.d.ts`, generated `tokens.ts`/`utilities.css`), `dist`, fixtures, fonts, stories; tests readable as evidence but not finding-eligible.

## Executive summary

The audit found the codebase healthy at the convention level — the deliberate service/client/spec triple, the layer bans, and the colocated-test discipline all held up under two independent model families, and none of them is a smell. What it found instead is one dominant failure shape repeated across layers: **a shared primitive exists, but it exposes only its raw mechanics, so every call site hand-rolls the ergonomic wrapper — and the copies have already measurably drifted.** `Lock` has no `withLock()` (68 hand-rolled try/finally sites across 14 service files, with three local divergences already live); the pxe promise-memoize idiom has been copied 6 times (the newest copy added four days before this audit ran) with a race guard present in exactly one of them; the client passthrough exhaustiveness guard is copy-pasted in 16 of 23 client files; the clipboard-copy helper that fixed a false-"copied"-toast bug was never propagated to ~19 sibling sites, which reintroduced the bug it fixed.

Two more themes: **mainnet/testnet conductor twins** in `bridge-core/scripts` (a 10-file bootstrap block that has already drifted silently on `proverEnabled`, plus the near-identical private-FPC deploy pair), and **duplication sitting directly on security surfaces** — the key/seed export clipboard-scrub timer duplicated byte-for-byte, the dApp identity strip (the anti-phishing trust anchor) forked three ways, and the dispatcher's session-account-authorization check reimplemented inline with weaker error handling.

Recommended priorities: the five verified findings (Q-01…Q-05) are all high-confidence and mostly mechanical — roughly 4–5 days of work that removes the three architectural smells outright. Independently, six findings are in the hours-not-days tier (Q-09, Q-11, Q-12, Q-13, Q-14, Q-15 — ≈1.5 days combined) and make a natural quick-wins PR.

## Methodology

Map-reduce per the harden-quality medium spec: 8 clusters (by package boundary and similarity), 2 scanners per cluster (Claude Sonnet + Codex medium — cross-model coverage never skipped), **no cross-rebuttal** (that phase exists only at `high`+; at medium the scanners stay blind to each other), Sonnet coordinator, top-5 verifier pass ordered by impact bucket (all architectural first), scan prompt with named-Fowler-smell requirement + negative list, ~4-function inter-procedural trace cap with handoff-edge escalation.

Run-specific notes, stated honestly:

- **Duplication weighting.** The user's directive ("for dedupping code") made Duplicate Code / Shotgun Surgery / Divergent Change / Dead Code the weighted smells. Scanners were told to report other qualifying smells too; both scanners' Large Class / Long Method candidates were deliberately dropped or demoted during reduce as out-of-focus (recorded in Findings NOT pursued).
- **Anchoring control.** Findings from an earlier evidence-based UI surface survey of this repo were **withheld from all 16 scanners** and given only to the Phase-3 coordinator, as convergence cross-check material. Two of them were independently rediscovered (dead popup CSS → Q-11; divergent address-copy → Q-06); the rest are listed under Cross-cutting observations.
- **Density.** 15 findings / 8 clusters = 1.9, above the ~1.2 target. The coordinator's judgment (recorded in `findings/consolidated.md`): this run produced 16 independently cross-model-convergent root causes; rather than diluting with single-model additions, two convergent-but-tiny local findings were trimmed and the count landed at the 15 hard cap. 14 of 15 findings are convergent; the single-model exception (Q-13) was kept for its security relevance and mechanical evidence.
- **Verification depth.** Top 5 by impact bucket (3 architectural + 2 structural). All five verifiers independently re-derived the evidence before reading the claim; all five verdicts were CONFIRMED-WITH-CORRECTIONS at high confidence. The corrections (site counts, a wrong dating claim, an instance-list trim) are folded into the findings below and detailed in `findings/verified.md`. Findings Q-06…Q-15 are consolidated-but-unverified; their confidence labels reflect that.
- **Disagreement resolution.** 8 cases where one scanner's non-findings explicitly rejected the other's finding were all resolved in favor of the rejecting scanner — in every case the rejection cited a specific checkable distinction (documented convention, materially different semantics). All 8 are in Findings NOT pursued.

## Findings

### [ARCHITECTURAL] Q-01: `Lock` exposes only `enter()`/`leave()` — the acquire/release protocol is hand-rolled at 68 call sites

**Impact:** architectural · blast radius 14 service modules over one shared primitive · change frequency high (~26 commits/120 days on the affected files)
**Confidence:** high — **verified** (independent re-count matched Codex's enumeration exactly; the "71" headline overcounted by 3)
**Smell:** Duplicate Code → Shotgun Surgery
**Found by:** both

**Instances** (68 `try { enter() } finally { leave() }` pairs): `apps/extension/src/wallet/services/{network (14), dapp-session (12), operation-journal (8), fpc (7), auth-registry (6), contact (5), token (5), transaction (4), dapp-interaction (1), profile (1), incoming-transfer (1)}/service.ts`, `services/activity-protocol/coordinator.ts` (2), `services/wallet-sdk/queued-journal.ts` (1); primitive at `packages/wallet-core/src/utils/lock.ts`. Definitive file:line list in `findings/verified/Q-01.md`.

**Evidence:** every write path hand-rolls the same acquire/release protocol. Three divergences are already live: `profile/service.ts` and `incoming-transfer/service.ts` each grew a local ad-hoc exclusive-run wrapper, and `token/service.ts` uses a `holdsLock` boolean guard instead of the bare pattern — drift that only exists because the idiom was copied ~70 times instead of centralized.

**Why it harms future change:** the "always release in `finally`" contract is enforced by convention only. One forgotten `finally` in a new write method silently reintroduces the starvation bug the `Lock`'s force-release timer exists to paper over.

**Recommended refactoring:** Extract Method — `Lock.withLock<T>(fn): Promise<T>` on the primitive; mechanical inline at the call sites. The verifier flags a handful of sites with catch/journal-transition logic wrapped around the critical section that need non-mechanical care; the two ad-hoc wrappers and `holdsLock` disappear.

**Effort estimate:** 1–2 days.

---

### [ARCHITECTURAL] Q-02: L1+L2 client-bootstrap block copy-pasted across 10 `bridge-core/scripts` conductors

**Impact:** architectural · blast radius 10 files, ~3,568 combined lines · change frequency high (most-edited part of the cluster; one dependency upgrade touched 9 of them together)
**Confidence:** high — **verified** (instance list corrected: Codex's 2 extra files are L1-only reads and don't carry the block; `proverEnabled` drift confirmed exactly)
**Smell:** Duplicate Code → Shotgun Surgery
**Found by:** both

**Instances:** `packages/bridge-core/scripts/{deposit-testnet, fuel-testnet, deploy-bridge-testnet, smoke-swap-existing-testnet, fpc-dust-canary-mainnet, deploy-bridge-mainnet, smoke-existing-testnet, deploy-sandbox, smoke-existing-mainnet, fee-juice-canary-testnet}.ts`. Per-file block ranges in `findings/verified/Q-02.md`.

**Evidence:** the same four-part sequence — viem `defineChain` + public/wallet clients, `createAztecNodeClient`, `EmbeddedWallet.create`, `--config` manifest load — recurs near-verbatim, plus an elapsed-timer helper in 9 of the 10 (`deploy-sandbox.ts` has none, contrary to the original claim). Already drifted: `deploy-sandbox.ts:148` passes `proverEnabled: false` where all 13 sibling occurrences pass `true`, with nothing marking it intentional.

**Why it harms future change:** a fleet-wide fix (retry policy after a flaky-RPC incident, RPC URL rotation) means hand-editing 10 files, and every miss reintroduces the bug in one script while looking fixed everywhere. The repo already established the shared-`scripts/`-helper precedent (`deploy-manifest.ts`, `deployer-keys.ts`) — it was never applied to the bootstrap itself.

**Recommended refactoring:** Extract Function into `scripts/script-bootstrap.ts`: `createBridgeScriptClients({chain, rpcUrl, nodeUrl, proverEnabled})`, `loadManifestFromConfigArg(argv)`, `stopwatch()`. Each conductor keeps only its genuine network-specific deltas — and the sandbox's `proverEnabled: false` becomes an explicit, visible parameter instead of a silent divergence.

**Effort estimate:** 1 day.

---

### [ARCHITECTURAL] Q-03: `useFeeEstimation` and `useFeeEstimationMap` maintain two copies of the same cancel/debounce/handoff state machine

**Impact:** architectural · blast radius 2 composables on the fee-estimation hot path (`send.vue` + dApp execute windows) · change frequency: both files edited in the same two commits
**Confidence:** high — **verified** (state-machine mirror + cross-reference comment confirmed; dating corrected — the two co-change commits landed the *same day* (2026-08-07), not six days apart)
**Smell:** Duplicate Code → Shotgun Surgery (observed in git history, not inferred)
**Found by:** both

**Instances:** `apps/extension/src/composables/useFeeEstimation.ts:70-148` ↔ `useFeeEstimationMap.ts:73-169`.

**Evidence:** both implement the identical algorithm — debounce-then-fire, monotonic counter invalidating stale in-flight promises, inflight/completed token pair, fire-and-forget `cancelRemote`, a `handedOff` set disarming cancellation on submit, `dispose`/`onScopeDispose` — once scalar, once `Map`-keyed. The keyed file's own comment cross-references the scalar one; commits `5f115286` (cancellable estimates) and `204f2bf4` (estimate-to-confirm handoff) each hand-wrote the same logic into both files.

**Why it harms future change:** concurrency-sensitive code whose every lifecycle change has already twice required manual dual maintenance, with no compiler or test forcing parity between the copies.

**Recommended refactoring:** the keyed version generalizes the scalar one — reimplement `useFeeEstimation` as a thin wrapper over the Map engine with a fixed sentinel key, deleting the ~90-line duplicate. Verifier-confirmed feasible without changing either consumer-visible API, with two seams needing deliberate handling: the keyed-only `flowKey` third argument, and the genuine `handoff()` vs `handoffAll()` in-flight-inclusion asymmetry (a real behavioral difference to preserve, not a naming difference).

**Effort estimate:** 0.5–1 day.

---

### [STRUCTURAL] Q-04: Async memoize-with-retry idiom hand-rolled 6 times in `pxe/`

**Impact:** structural · blast radius 5 files in `packages/aztec-runtime/src/pxe/` · change frequency: recurring — copied at least 3 separate times over ~3 months, **most recently 4 days before this audit ran**
**Confidence:** high — **verified** (6/6 instances confirmed; race-guard divergence confirmed; dating corrected — `service.ts`'s copy is the *newest*, added 2026-08-10 in `9ca9308e`, so the idiom is still actively spreading)
**Smell:** Duplicate Code
**Found by:** both (the 6th instance by Claude only)

**Instances:** `packages/aztec-runtime/src/pxe/artifact-catalog.ts:88,93-106` · `note-schemas.ts:61,63-89` · `public-events.ts:169-182` · `public-events.ts:184-194` · `artifact-registry.ts:52,99-112` · `service.ts:508-524`.

**Evidence:** each independently implements "cache a promise; clear it on rejection so a retry is possible" — and only `artifact-catalog.ts` guards against clearing a newer promise on an old rejection; the other five clear unconditionally. `note-schemas.ts`'s own comment ("matches ArtifactRegistry pattern") shows the author knowingly re-implemented rather than extracted.

**Why it harms future change:** subtle retry/race semantics now live as six independently-typed micro-implementations with no single place to land a correctness fix; the missing race guard is already a silent behavioral gap between "identical-looking" instances, and the copy count is still growing.

**Recommended refactoring:** Extract Function — `pxe/async-memo.ts` exporting `memoizeAsync<T>()` and keyed `memoizeAsyncBy<K,V>()`, encoding cache-and-clear-on-reject with the race guard applied uniformly. Verifier: all six migrate mechanically.

**Effort estimate:** 0.5 day.

---

### [STRUCTURAL] Q-05: Client passthrough exhaustiveness-guard copy-pasted in 16 of 23 `client.ts` files

**Impact:** structural · blast radius 16 files over the shared `ServiceClient` + `definePassthroughs` · change frequency moderate (every new service RPC re-triggers the edit)
**Confidence:** high — **verified** (16/16 exact 3-way match; the proposed generic was *compiled against the repo's TS 6.0.3 strict mode* and both failure directions — missing key, typo'd key — still error at compile time)
**Smell:** Duplicate Code
**Found by:** both

**Instances:** `apps/extension/src/wallet/services/{account, account-state, auth-registry, contact, dapp-interaction, dapp-session, execution, fpc, incoming-transfer, log-viewer, note, passkey, task, token, token-balance, transaction}/client.ts`. The other 7 client files legitimately deviate (hand-written methods, zod validation, narrower signatures — enumerated in `findings/verified/Q-05.md`).

**Evidence:** an identical 4-part skeleton per file — `_METHODS` array, `Exclude<>`-based exhaustiveness type, dummy `void` const, verbatim biome-ignore comment, `definePassthroughs(...)` call. The factory's own docs ask callers to pair it with this assertion but can't enforce it through its signature.

**Why it harms future change:** an editor who forgets the guard step silently loses the compile-time proof — nothing complains; only a manual diff against a sibling would catch it.

**Recommended refactoring:** Extract Function — a curried `definePassthroughsExhaustive<Methods>()` in `extension-messaging`, constrained so `Exclude<keyof Methods, Tuple[number]>` must be `never`. Each client keeps a method array + one call; the guard becomes unforgettable.

**Effort estimate:** 0.5–1 day.

---

### [STRUCTURAL] Q-06: Clipboard-copy hand-rolled at ~19 sites — including the security-sensitive secret-export scrub logic

**Impact:** structural (cross-cutting: ext-ui-popups + ext-pages-composables) · blast radius ~19 call sites across components, popups, modules, pages, composables · change frequency high collectively
**Confidence:** high (unverified) — strongest convergence in the run: both scanners, independently, in both clusters, plus the prior survey
**Smell:** Duplicate Code → Shotgun Surgery
**Found by:** both ×2 clusters + prior survey

**Instances:** correct implementation `apps/extension/src/components/header-copy-address.ts:11-21` (awaited, try/catch, sanitizes); ~17 hand-rolled ordinary sites across `components/{ScopeAddress,ScopeClassId,JsonViewer}`, `popup/components/popups/{AccountsPopup,EditFpcPopup,TokenMetadataPopup,ReceivePopup,IncomingTrustPopup}`, `popup/components/modules/general/BalanceView`, `popup/pages/settings/{about,accounts,contacts,fpcs,connected-apps/[id]}`, `popup/pages/{tokens/[id],tx/[id],received/[id]}`, `popup/pages/settings/advanced/account-state/senders`, `composables/useProfileImportFlow.ts`; plus the byte-identical 60-second clipboard-scrub timer in `popup/pages/settings/security/export/key.vue:76-96,109-120` and `seed.vue:66-86,99-109`. Full list in `findings/consolidated.md`.

**Evidence:** the common shape is `navigator.clipboard.writeText(...)` then toast. Most sites fire the success toast unconditionally — a rejected clipboard write (documented Chromium behavior on popup focus-loss) shows a false "copied". That bug was already found and fixed once (`header-copy-address.ts`) and then reintroduced at 7+ sites by copy-paste; `ScopeAddress.vue` even copies the fix's sanitization byte-for-byte *without* the await/catch. Separately, `key.vue`/`seed.vue` duplicate the entire scrub-timer block word-for-word on the private-key/seed-export surface.

**Why it harms future change:** an already-fixed bug keeps re-entering the codebase instead of propagating from its one fix; and a scrub-window change drifting between the two export pages has security consequences, not cosmetic ones.

**Recommended refactoring:** Extract Function — generalize `header-copy-address.ts` into `copyToClipboard(text, openToast, {labels})` for the ~17 ordinary sites; Extract Composable `useSecretClipboardCopy` for the two export pages.

**Effort estimate:** 1 day + 0.5 day (secret-scrub composable, given the security sensitivity).

---

### [STRUCTURAL] Q-07: Background/offscreen messaging transports duplicate the same 5-method error-shaping quintet

**Impact:** structural · blast radius 2 files — the sole implementations of every popup↔SW and SW↔offscreen RPC · change frequency: 4 commits each since the base-class split, every one touching both in lockstep
**Confidence:** high (unverified — convergent)
**Smell:** Duplicate Code (residual to the completed `BaseServiceClient` extraction)
**Found by:** both

**Instances:** `packages/extension-messaging/src/background/client.ts:86-98,134-155` ↔ `offscreen/client.ts:68-85,113-134`; abstract contract at `core/base-client.ts:259-269`.

**Evidence:** `makeRemoteError`/`makeDisconnectError` byte-identical; `makeTimeoutError`/`makeSendFailureError` differ only in a message string; the offscreen file's own comment names the intent ("parity with the background transport") — known, hand-maintained duplication.

**Why it harms future change:** a wire-error-contract change must be made twice with no compiler link — exactly the drift class the base class was built to absorb.

**Recommended refactoring:** Pull Up Method for the identical pair; Template Method (message-template hook) for the two near-identical ones.

**Effort estimate:** 0.5 day.

---

### [STRUCTURAL] Q-08: dApp identity-strip trust anchor reimplemented independently 3 times

**Impact:** structural · blast radius: the anti-phishing identity anchor across discover, capabilities, execute, and verify windows · change frequency: 4 commits
**Confidence:** high (unverified — convergent; Codex found the 3rd instance)
**Smell:** Duplicate Code → Divergent Change
**Found by:** both

**Instances:** `apps/extension/src/components/composite/DappStatusStrip.vue` (discover + capabilities) · `popup/windows/execute/SignerIdentityStrip.vue` · `popup/windows/verify/index.vue:179-192,271-330` (inline 3rd copy).

**Evidence:** all three render the identical skeleton (status dot, account, separator, network, "NULO" brand mark) with class-for-class identical CSS; `SignerIdentityStrip`'s header comment confirms a deliberate fork.

**Why it harms future change:** a spacing/palette/status-semantics/a11y fix to one copy silently leaves the others inconsistent — drift in exactly the surface users rely on to confirm what they're signing.

**Recommended refactoring:** Extract Component — a presentation-only `IdentityStrip` frame; all three become thin callers.

**Effort estimate:** 0.5–1 day.

---

### [STRUCTURAL] Q-09: `trimAddress()` exists and is adopted, yet hand-rolled at 9 sites with 4 inconsistent separator styles

**Impact:** structural · blast radius 9 consumer files + 1 canonical · change frequency: the sites sit in actively-touched trees
**Confidence:** high (unverified — convergent + prior survey)
**Smell:** Duplicate Code → Shotgun Surgery
**Found by:** both + prior survey

**Instances:** canonical `apps/extension/src/utils/string.ts:6-9`; hand-rolled at `popup/windows/verify/index.vue:44`, `popup/components/popups/AccountsPopup.vue:76`, `popup/windows/capabilities/AccountSelectRow.vue:51`, `popup/pages/settings/connected-apps/[id].vue:231`, `popup/pages/settings/accounts/index.vue:79`, `components/Header.vue:250`, `popup/components/modules/general/TokenImportRow.vue:27`, `popup/pages/journal/[id].vue:125`, `popup/components/popups/ReceivePopup.vue:63-66`.

**Evidence:** all 9 reimplement the same slicing policy with 4 different separators (`..` canonical vs `...` ×6 vs `…` ×2 vs a `•••` two-span layout) — the copies have visibly drifted from each other and the helper.

**Why it harms future change:** a truncation-affordance rebrand or a11y separator change becomes a whole-tree grep instead of one function edit; the UI already disagrees with itself.

**Recommended refactoring:** Replace Inline Code with Function Call; optionally extend `trimAddress` with a separator parameter if the variety is intentional.

**Effort estimate:** 2–3 hours.

---

### [STRUCTURAL] Q-10: `deploy-private-fpc-mainnet.ts` / `-testnet.ts` duplicate the protocol-correctness-critical deploy conductor

**Impact:** structural · blast radius 2 files, ~92-line overlap · change frequency low but asymmetric (testnet 3 commits, mainnet 1 — already out of lockstep once)
**Confidence:** high (unverified — convergent)
**Smell:** Duplicate Code
**Found by:** both

**Instances:** `packages/bridge-core/scripts/deploy-private-fpc-mainnet.ts:26-34,58-70` ↔ `deploy-private-fpc-testnet.ts:25-33,61-73`.

**Evidence:** identical timer / node-client + canonical-pin / early-return-if-exists / deploy with `PRIVATE_FPC_SALT` + `universalDeploy` / assert-address-equals-pin / log sequence; only the fee-payment middle genuinely differs.

**Why it harms future change:** the pinned-address assertion is what proves the deployed contract lands where the faucet manifest and wallet hardcode expect; the asymmetric history shows the twins already diverged once.

**Recommended refactoring:** Extract Function — `deployCanonicalPrivateFpc({node, prepareDeployment})`; each network file keeps only its account/fee setup.

**Effort estimate:** 0.5 day.

---

### [STRUCTURAL] Q-11: Dead `<style module>` CSS block copy-pasted across 5 popups (~280 dead lines), plus dead selectors in 8 more files

**Impact:** structural · blast radius 13 files · change frequency: not dormant — a prior quality pass (#220) touched these exact files without removing it
**Confidence:** high (unverified — convergent + prior survey)
**Smell:** Dead Code + Duplicate Code
**Found by:** both + prior survey

**Instances:** identical dead block in `apps/extension/src/popup/components/popups/{NewAccountPopup.vue:137-194, EditAccountPopup.vue:96-153, NewNetworkPopup.vue:194-231, EditNetworkPopup.vue:133-170, NewSenderPopup.vue:180-217 (partial — `.shake` stays live)}`; isolated dead selectors in `EditContactPopup`, `EditProfilePopup`, `AccountsPopup`, `RevokeAuthwitsPopup`, `SelectProfilePopup`, `SelectTokenPopup`, `BalanceView`, `SelectNetworksPopup` (lines in `findings/consolidated.md`).

**Evidence:** the `.network`/`.icons`/`.item` rules are md5-identical across the 5 core files; zero live `$style` references anywhere in the owning templates.

**Why it harms future change:** every future editor must re-derive that none of it is live; every popup cloned from these 5 propagates another dead stylesheet — which is exactly how it spread.

**Recommended refactoring:** Remove Dead Code.

**Effort estimate:** 2–3 hours.

---

### [STRUCTURAL] Q-12: CTA button variants duplicate the same 7-property typography contract

**Impact:** structural · blast radius `Button.vue` + ~15 consumer files · change frequency: 6 commits since May 2026
**Confidence:** high (unverified — convergent on this narrow scope; Claude's broader 12-file "uppercase label" claim was rejected by Codex and lives in Cross-cutting as a lead)
**Smell:** Duplicate Code
**Found by:** both

**Instances:** `packages/design/src/ui/Button.vue:302-312` (`.cta`), `:326-336` (`.cta_outline`), `:347-357` (`.cta_destructive`).

**Evidence:** 7 identical declarations (width, font, weight, size, tracking, uppercase, padding) × 3 variants; only colors/border/interaction genuinely differ.

**Why it harms future change:** a CTA height/tracking change needs 3 synchronized edits; a 4th variant will copy the whole block.

**Recommended refactoring:** one shared rule (comma-joined selector or `.cta-base`), variants keep only their deltas.

**Effort estimate:** 1–2 hours.

---

### [STRUCTURAL] Q-13: `handleRegisterToken`/`handleGrantPublicAuthwit` reimplement the dispatcher's session-account-authorization helper, with weaker error handling

**Impact:** structural · blast radius 1 file (`dispatcher.ts`, 17 commits/120 days), 2 methods today — the natural next-copy site for any dApp-facing RPC needing a `from` account
**Confidence:** moderate — single-model (Codex neither found nor rejected it); kept for its security relevance and mechanical evidence
**Smell:** Duplicate Code → Divergent Change
**Found by:** claude

**Instances:** `packages/wallet-bridge/src/dispatcher.ts:774-786`, `:821-829`; correct shared helper at `:1350-1378` (`resolveNetworkAndAccount`, already used by `handleSendTx` and `handleCreateAuthWit`).

**Evidence:** both handlers hand-roll the 6-line resolve-and-validate sequence the helper implements — and have already diverged: the helper distinguishes no-accounts vs empty-session with specific errors; the inline copies fall through to a generic "is not authorized".

**Why it harms future change:** this decides which account a dApp may act as — a security-relevant check living in 3 places (1 correct, 2 weaker) with nothing keeping them in sync.

**Recommended refactoring:** replace both inline blocks with the existing helper call.

**Effort estimate:** 1–2 hours.

---

### [LOCAL] Q-14: `WalletError` subclasses repeat an identical ctor identity-setup tail 11 times

**Impact:** local · blast radius 1 file, 11 subclasses · change frequency: re-copied once per new subclass (twice recently)
**Confidence:** high (unverified — convergent)
**Smell:** Duplicate Code
**Found by:** both

**Instances:** `packages/extension-messaging/src/errors.ts` — 11 constructors (`RpcTimeoutError` … `ProfileIdConflictError`), each ending `this.name = "X"; Object.setPrototypeOf(this, X.prototype)`.

**Evidence:** the base class's own comment documents the ritual ("subclasses repeat this in their ctors").

**Why it harms future change:** nothing enforces a 12th subclass gets both lines right; a missed `setPrototypeOf` silently breaks `instanceof WalletError` across the RPC boundary — the exact bug class the comment warns about.

**Recommended refactoring:** Pull Up Constructor Behavior — `this.name` + `new.target.prototype` once in the base ctor.

**Effort estimate:** 1–2 hours.

---

### [LOCAL] Q-15: `Tooltip.vue`'s cross-axis position resolver duplicates its own 3-case switch across all 4 sides

**Impact:** local · blast radius 1 file, package-wide usage · change frequency: 3–4 commits
**Confidence:** high (unverified — convergent)
**Smell:** Duplicate Code (parallel switch statements)
**Found by:** both

**Instances:** `packages/design/src/ui/Tooltip.vue:70-82` ↔ `:88-100` (identical `xPos` switch for top/bottom); `:106-118` ↔ `:124-136` (identical `yPos` switch for left/right).

**Evidence:** byte-identical `center`/`start`/`end` switches per axis pair; only the perpendicular offset differs.

**Why it harms future change:** real geometry logic — a rounding or viewport-clamp fix applied to one copy and forgotten in its sibling ships a tooltip subtly wrong on two of four sides.

**Recommended refactoring:** Extract Function — `crossAxisOffset(position, start, end, size)`.

**Effort estimate:** 1 hour.

---

## Findings NOT pursued (with reasoning)

**Cross-model rejections (kept out; the rejecting scanner cited a checkable distinction):**

- `PxeService` as Large Class — Codex: its size centralizes the offscreen trust boundary + shared concurrency protocol; size alone insufficient.
- Timeout `fetch` as a fork of the SDK transport — Claude: deliberate, documented near-copy of *external* code to add a missing feature.
- Bordered-surface "box" primitive ×6 in `@nulo/design` — Codex: different semantics/layout/interaction; already centralized via CSS variables.
- `ensureInitialized`+`requireActiveProfile` preamble ×35 — Codex: short boundary guards with varying params/order; extraction would conceal access semantics.
- "Already exist(s)" validation triple ×10 — Codex: too small to justify an abstraction beyond the existing form API.
- 5 New\*/Edit\* popup pairs as one CRUD component — Codex: would introduce conditional configuration rather than remove a stable duplicate.
- Per-page multi-client connect/disconnect wiring — Codex: parent-owned lifecycle is the repo's explicit C1 convention.
- `comma()` vs `formatBaseUnits()` merge — Codex: different input and rounding semantics; merging would conflate them.

**Convergent but trimmed for density (real; natural quick pickups outside this list):** `applyNuloSchemaPatch`'s install-or-validate ×3 (1 file); `LoggerStore.log`/`logWithContext` body duplication (1 file).

**Single-model, crowded out (each real but small or out-of-focus):** empty retired profile-switch hook (aztec-runtime); duplicated logger-adapter lambda (service.ts); two advertised-but-unimplemented design-package API features (`suffix` prop, `onKeybind` event); `EntityStorage`'s 4 enumeration loops; dead pre-v2 `sealRecordSecret`/`openRecordSecret` (test-only); `IncomingTransferService` Divergent Change (size-framing, out of dedup focus); account-state subpages' partial `useEntityCrud` adoption gap; 532-line `restoreBackup` Long Method (out of focus); `JobErrorKind` display-text switches ×3; `isTerminal`/`TERMINAL_STAGES` re-enumeration ×2; `simulate()`'s duplicated `FunctionCall` construction.

## Cross-cutting observations

- **The dominant shape is "primitive without ergonomics":** Q-01 (Lock), Q-04 (memoize), Q-05 (passthrough guard), Q-06 (clipboard), Q-09 (trimAddress) are all the same story — the shared thing exists, the convenient entry point doesn't, so call sites hand-roll and drift. A house rule worth adopting: *when a helper is used at 3+ sites through the same ritual, the ritual belongs in the helper.*
- **Security surfaces carry duplication risk disproportionately:** Q-06 (key/seed scrub), Q-08 (identity strip), Q-13 (dispatcher authorization) all sit on trust-sensitive paths where copy drift is a security event, not a style nit.
- **The design package's letter-spacing spread** (`0.04em`–`0.2em` across 6 values, 12+ files) did not survive scrutiny as a duplication finding (Codex: the sites genuinely differ in role) but is a legitimate design-token lead for a design-system pass.
- **Prior-survey items NOT rediscovered this run** (in-scope but uncaught, or out-of-focus): the two-icon-language mix at `SettingItem.vue:60,94` / `SubPageHeaderBase.vue:37,43`; pre-refresh double heroes on `activity.vue` + `settings/index.vue`; `send.vue` stray `console.log`s + a hardcoded rgba border; `tokens/[id].vue`'s never-set `isRefreshingBalance` ref; `RevokeAuthwitsPopup.vue`'s 377-line monolith framing (its dead CSS *was* caught in Q-11); ConfirmPopup's destructive-variant defect (correctness, out of scope here).

## Run artifacts

- `findings/consolidated.md` — the full Phase-3 reduce (15 findings, dropped list, coordinator remarks)
- `findings/verified.md` (+ `findings/verified/Q-0N.md`) — the 5 Phase-4 verifications with independent pre-claim assessments
- `raw/` — 16 scanner reports + 8 cluster repo maps
- `report.html` — stakeholder-facing companion
