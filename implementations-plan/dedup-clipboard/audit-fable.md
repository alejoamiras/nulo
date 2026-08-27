# Fable plan audit (dual-audit leg 2)

All code read; here is the audit.

# Dual-audit (Fable side) — implementations-plan/dedup-clipboard/plan.md

Scope confirmed: no implementation exists yet (working tree has only `?? implementations-plan/dedup-clipboard/`); this is a pre-phase-2/3 plan audit. I read the reference, both export pages, and all ~20 real call sites plus their test pins.

## Findings by severity

### HIGH

**H1 — The plan's sanitization inventory is factually wrong: ScopeClassId.vue is a third sanitizing site, and the plan says there are two.**
- Plan, Fact 1 (plan.md:8): "Only it (and `ScopeAddress.vue`'s byte-copied sanitization WITHOUT the await/catch) sanitize; the other sites copy raw." And Architecture (plan.md:14): "only the two sites that sanitize today pass true."
- Reality: `apps/extension/src/components/ScopeClassId.vue:23` — `window.navigator.clipboard.writeText(stripWireControl(props.id))`. Three call sites sanitize: header-copy-address.ts:14, ScopeAddress.vue:52, ScopeClassId.vue:23.
- Impact: an implementer following the plan's own fact list migrates ScopeClassId with `sanitize: false`, silently dropping bidi/zero-width stripping on a hostile-dApp trust surface — a copied-bytes change that violates the plan's own D2 invariant ("no site's copied BYTES change"). Mitigation exists — `ScopeClassId.test.ts:65-73` pins the stripped payload (`expect(writeText).toHaveBeenCalledWith("0xabcdefgh")`) and would fail — but a plan whose fact list contradicts its own frozen invariant on the exact property the invariant protects must be corrected, not rescued by a test the implementer might "update to match the plan."

### MEDIUM

**M1 — The proposed `copyToClipboard` opts signature cannot express the real per-site toast matrix; byte-preservation of icons/durations is impossible as written.**
Plan.md:14 proposes `{ successLabel?, failureLabel?, icon?, duration?, sanitize? }` — ONE icon, ONE duration. The actual shapes in the tree:
- Reference (`components/header-copy-address.ts:16,19`): success `copy`/default(2000), failure `warning`/**3_000**.
- `popup/pages/received/[id].vue:139-146`: success `copy`/**2_000**, failure **`alert`**/**2_000**, label "Copy failed". A different failure *icon* and *duration* than the reference.
- `popup/components/popups/IncomingTrustPopup.vue:74-83`: success `copy`/**1_500**, failure `warning`/**default(2000)** — the inverse duration split of the reference.
A single `duration` cannot encode "success 1500 + failure 2000" and "success 2000 + failure 3000" and "success 2000 + failure 2000/alert" simultaneously. Any hardcoded failure shape changes bytes at one of the three already-correct sites, violating the "everything else preserved exactly" mandate. Fix: nested opts — e.g. `{ success: { label, icon?, duration? }, failure: { label, icon?, duration? }, sanitize? }` — or equivalent separate `failureIcon`/`failureDuration`/`successDuration` fields. (Note IncomingTrustPopup.test.ts:178 pins success duration only as `expect.any(Number)` and :192 pins failure icon but not duration — the test net will NOT catch a failure-duration drift there.)

**M2 — `received/[id].vue` is mischaracterized as an unconditional-toast site.**
Plan.md:10 lumps `received/[id]` into the list of sites sharing "the `writeText(...)` + unconditional `openToast(...)` shape." It is actually the third independently-correct await/catch site (received/[id].vue:139-146), with a unique failure shape ("Copy failed"/`alert`/2000) and no test file pinning it (`popup/pages/received/` contains only `[id].vue`). It must be flagged like IncomingTrustPopup — "independently correct, migrates for dedup, exact shape preserved" — otherwise the phase-3 subagent's "propagate the fix + preserve the label" instruction has nothing telling it this site's failure icon is `alert`, not `warning`.

**M3 — "Generalizes the reference verbatim" silently imports the reference's falsy-input guard into ~19 sites that don't have one.**
`header-copy-address.ts:12` — `if (!address) return false` (no toast, no write). Every other site today passes its value straight to `writeText`: e.g. key.vue:87 can pass `publicKey.value === undefined` (the empty `catch` at key.vue:58 leaves it unset), which today coerces to the string `"undefined"` + a success toast; BalanceView.vue:135-147 can pass an undefined balance. A verbatim-generalized guard converts these to silent no-ops — an edge-case behavior change outside the single authorized change. Decide explicitly: keep the guard only in the `copyAddressToClipboard` delegation (its original home) and make the shared helper guard-free, or authorize the guard everywhere and pin it. Either is defensible; the plan currently doesn't know the question exists.

**M4 — Flash-on-failure semantics after async adoption are unspecified, for both the composable and the four ordinary flash sites.**
Today every flash is set synchronously before the un-awaited write, so it fires even when the write would fail: key.vue:86, seed.vue:76 (`isCopied`, 2500ms), JsonViewer.vue:70-82 (1500ms), AccountsPopup.vue:44-54 (1500ms), senders/index.vue:46-55 (`copiedAddress` value-flash, 2000ms), useProfileImportFlow.ts:85-93 (1500ms). Once handlers await, a naive `if (await copyToClipboard(...)) { flash }` migration makes the flash success-only and microtask-delayed — a visual behavior change beyond the toast-honesty authorization, and one that existing synchronous test assertions may or may not catch. The plan's composable test list says "isCopied flash" without stating which semantic. Pin it: flash state is set synchronously at invocation regardless of outcome (byte-preserving; only the toast becomes conditional), or explicitly extend the authorization to flash-follows-success. Same decision applies to the composable's `isCopied` (failure will then show a warning toast while the card flashes "copied" — accept and document, or authorize the change).

### LOW

**L1 — Scrub-scheduling order vs. the new `await` is unspecified.**
Today key.vue:89-92/seed.vue:79-82 run `clearTimeout` + `setTimeout(scrub)` synchronously in the click tick, before the write settles. If `copySecret` schedules the scrub after `await writeText`, a hung/never-settling write leaves NO scrub scheduled — strictly weaker than today. D3 says "scheduled regardless of write outcome" but doesn't say *when*. Require: clearTimeout + schedule happen synchronously at `copySecret` invocation, before awaiting; pin with a test where the write promise never settles.

**L2 — Outline B's stated con is factually wrong (though the A choice survives).**
Plan.md:19 rejects B as "unusable from non-setup contexts." `packages/design/src/composables/toast.ts:19-27` shows `useToast()` closes over a module-scope singleton ref — it is callable from any plain module, including `header-copy-address.ts`'s context. B fails for the *real* reasons: it hides the toast dependency (every existing test injects/mocks `openToast` explicitly — ScopeAddress.test.ts:21 even has to `vi.stubGlobal("useToast", ...)` for auto-import, which B would force on every helper test), and it diverges from the established param-injection convention (`header-copy-address.ts:11` ToastFn param; `useProfileImportFlow.ts` `opts.openToast`). Fix the rationale so it survives the contradiction-check; keep A.

**L3 — C1 dispose-convention tension is a live future hazard, not addressed.**
CLAUDE.md:141-146,214: composables "Expose dispose() that the parent calls in onBeforeUnmount"; the sibling `useSecretCountdown.ts:50` even registers `onScopeDispose(clear)`. `useSecretClipboardCopy` must deliberately expose NO dispose and register NO scope-dispose — because a convention-following reviewer adding `dispose()` (and a parent dutifully calling it) would cancel the scrub timer on unmount and defeat the F-14 design. The plan pins "no lifecycle hooks registered" (good) but should also explicitly state "no dispose() export, by design" in the composable's doc comment and in the plan text.

**L4 — Test-count convention: CLAUDE.md:166 requires ≥10 cases for composables; the plan's composable list enumerates ~5-6. Not blocking, but phase 1's gate should state the minimum.**

**INFO — Gesture transience is safe as designed, with one requirement worth stating: the helper must invoke `writeText` synchronously as its first effect (no awaits/dynamic imports before it), so the write starts inside the click's transient user activation; every migrated handler calls the helper synchronously from the click handler, and the only pre-gesture-loss site (BalanceView.vue:139-147's `await nextTick()` before copy) is pre-existing and unchanged. No caller anywhere relies on the handler's synchronous *completion*. The 60s scrub `writeText("")` already runs gesture-less today and is documented best-effort — unchanged.**

## Site-by-site drop-in verdict

Clean drop-ins under a **corrected (M1) signature**: about.vue:19-22, accounts/index.vue:61-64, contacts/index.vue:121-124, fpcs/index.vue:70-73, connected-apps/[id].vue:132-135, tx/[id].vue:106-109, tokens/[id].vue:101-104 (dynamic label — pass computed string), BalanceView.vue:135-138 (dynamic label), ReceivePopup.vue:26-29, TokenMetadataPopup.vue:39-42, EditFpcPopup.vue:146-149, ScopeAddress.vue:47-54 (sanitize:true).

NOT clean drop-ins as the plan stands:
1. **ScopeClassId.vue:21-25** — needs sanitize:true; plan says otherwise (H1).
2. **received/[id].vue:139-146** — failure `alert`/2000 + success 2000 inexpressible (M1, M2).
3. **IncomingTrustPopup.vue:74-83** — success 1500 + failure default inexpressible (M1).
4. **JsonViewer.vue:70-82, AccountsPopup.vue:44-54, senders/index.vue:46-55, useProfileImportFlow.ts:85-93** — flash stays site-local; drop-in only once M4's semantic is pinned.
5. **header-copy-address.ts** — delegation fine; must keep the falsy guard and its exact success-default/failure-3000 split (M1/M3). Header.test.ts:80-89 pins it.
6. **key.vue/seed.vue** — composable absorbs cleanly: `copySecret(value)` with the page-side selector `key === "private" ? privateKey.value : publicKey.value` (key.vue:87) preserves the two-value flow, the shared single `isCopied` bound to both SecretRevealCards (key.vue:209,238), and per-page `toastLabel` ("Key is copied" / "Seed phrase is copied"). Watch the publicKey-undefined coercion (M3).

## F-14 preservation check (item 2 of the brief)

Verified against key.vue:76-96,109-120 and seed.vue:66-86,99-109 — the blocks are indeed byte-identical. The plan preserves: 60s unconditional `writeText("")` scrub (plan.md:15, D3), `.catch`-guard (plan.md:29 "preserved verbatim"), clearTimeout-on-recopy (test list "rescheduling on re-copy"), timer closure holding no secret (plan.md:29 explicit), no lifecycle registration / no unmount cancel with the load-bearing comments moving to the composable (plan.md:11,15), and pages keeping their own `onBeforeUnmount` secret-nulling (plan.md:23; note key.vue's unmount also removes its keydown listener — page-side, untouched). Gaps: scheduling *order* (L1) and the dispose-hazard (L3); otherwise faithful.

## Ledger attacks (item 3)

- **D2 — uphold.** Opt-in sanitize with frozen bytes is right for this arc. But note for an owner follow-up (not this arc): `IncomingTrustPopup.vue:78` copies a wire/chain-derived contract address raw, and `TokenMetadataPopup.vue:40` copies `token.contract` raw — these are dApp-adjacent values where the ScopeAddress rationale (bidi/zero-width injection into what the user pastes) applies. Recommend the plan add one line: "wire-derived raw-copy sites flagged for owner decision post-arc."
- **D3 — uphold, with the L1 ordering condition.** Unconditional scheduling is strictly safer and matches today; just fix *when* it is scheduled.
- **Async adoption — safe** per the INFO finding, provided the helper's first effect is the `writeText` call. No synchronous-completion dependents found; test churn (flushPromises) at migrated sites is the only cost.

## A vs B (item 4)

**A, affirmed** — but replace the incorrect "non-setup contexts" justification (L2) with: explicit dependency + param-injection matches `header-copy-address.ts:11` and `useProfileImportFlow`'s `opts.openToast`, and keeps every test mockable without `vi.stubGlobal`/`vi.mock`. Placement conforms: pure helper → `src/utils/clipboard.ts` (multi-parent, so utils not colocation; note utils are NOT auto-imported — sites need explicit imports); reactive scrub state → `src/composables/useSecretClipboardCopy.ts`, C0-shaped (no chrome.*, no service clients).

## Missing tests

1. Helper: falsy-text behavior pin (whichever way M3 is decided).
2. Helper: `writeText` invoked synchronously before any microtask (gesture-transience pin).
3. Helper: sanitize defaults to false (explicit D2 pin, not just "opt-in works").
4. Helper: distinct failure icon/duration passthrough (exists only after the M1 signature fix).
5. Composable: scrub fires with exact argument `""` at 60s even when the copy write rejected (D3 pin — "scrub scheduling" alone doesn't pin the rejected-write case).
6. Composable: scrub scheduled even if the copy promise never settles (L1 pin).
7. Composable: scrub `writeText("")` rejection produces no unhandled rejection (`.catch`-guard pin).
8. Site: post-migration exact-shape pin for `received/[id].vue`'s failure toast (`alert`/2000) — currently zero test coverage on that file.
9. Composable: two instances (key page then seed page) hold independent scrub timers — nice-to-have, pins today's cross-page behavior.

## Verdict

**Conditional approve.** The architecture (Outline A + no-lifecycle secret composable), phase ordering, and D2/D3 are sound and match the repo's conventions and the F-14 design. Conditions, all resolvable as plan edits before phase 1:

1. (H1) Correct the sanitization inventory to THREE sites — add ScopeClassId.vue:23 to the sanitize:true list.
2. (M1) Replace the flat `icon`/`duration` opts with separate success/failure `{label, icon, duration}` shapes capable of byte-preserving header-copy-address, received/[id], and IncomingTrustPopup.
3. (M2) Reclassify received/[id].vue as independently-correct with its exact failure shape (`"Copy failed"`/`alert`/2000) recorded in the plan.
4. (M3) Decide and pin the falsy-input guard scope (recommend: guard stays in the header delegation only; shared helper is guard-free).
5. (M4) Pin flash semantics: flash state set synchronously at invocation regardless of write outcome, at the composable and all four ordinary flash sites.
6. (L1) Specify scrub clearTimeout+schedule happens synchronously before the await; add the corresponding test.
7. (L2/L3) Fix the Outline-B rationale; add the "no dispose(), by design" note to the composable spec.

### Critical Files for Implementation
- implementations-plan/dedup-clipboard/plan.md
- apps/extension/src/components/header-copy-address.ts
- apps/extension/src/popup/pages/settings/security/export/key.vue
- apps/extension/src/popup/pages/settings/security/export/seed.vue
- apps/extension/src/popup/pages/received/[id].vue
