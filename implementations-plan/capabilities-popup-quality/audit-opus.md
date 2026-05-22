# Opus audit — capabilities-popup-quality plan

Returned by an opus subagent invoked in parallel with codex (Tier-B dual audit per CLAUDE.md). The full transcript follows verbatim.

## 1. Honesty critique

- **Current copy IS wrong.** Verified: `transaction` cap's "Submit transactions to the network on your behalf" reads as blanket authority. Reality is `dispatcher.ts:401-568` accepts the request, `scope-enforcement.ts:90-107` permits only calls within `c.scope`, and `service.ts:354-362` forces a per-op popup whenever `feePayer === undefined`. So a `transaction.scope = "*"` grant + dApp-embedded `feePayer` = silent transactions; otherwise per-op popup. The plan's framing "Request transactions within the scope below. Each transaction still requires your approval." is **honest only when `feePayer === undefined`**. If the dApp embeds a feePayer (legitimate use case — sponsored fees / paymasters), per-op popups are skipped per `service.ts:357-359`. The "Each transaction still requires your approval" sentence is therefore *false in the embedded-feePayer case*. Concrete fix: either say "Each transaction requires approval unless the app pays its own fees" or remove the absolute promise. The current promise survives in the plan's `transaction` head description AND the detail-panel footer (preserved verbatim per plan §3) — both are misleading in the embedded-fee path.

- **`accounts.canCreateAuthWit` framing is OK.** Confirmed `AccessLevel.PrivateData` ≥ default `confirmationLevel` (the default is `AppState`, see PrivateData enum value), so authwit creation does force a popup. The plan's "Request signatures (you approve each one)" is accurate.

- **`simulation.*` framing is OK** — pure local PXE work.

- **`contracts.canRegister` framing — caveat.** Plan keeps "Register contracts" unchanged labeled silent. But `register_contract` (lower-case wire kind, see `service.ts:381`) returns `AccessLevel.PxeState`. The default session `confirmationLevel` per the codebase is `AppState` ≥ `PxeState`, so silent. **However:** `service.ts:347-349` short-circuits with `return true` when the active profile id doesn't match the session's `profileId`. If the user switches profiles, *every* register call triggers a popup. Plan doesn't mention this nuance — minor. Acceptable to leave as "silent" since the wrong-profile case is degenerate.

- **`data.addressBook` framing.** Plan says "Read address book". Verified `AccessLevel.AppState` (line 402), which equals default confirmation level. Silent. OK.

## 2. Adversarial / security analysis

- **Trust-display injection on unknown types (HIGH).** `capability-meta.ts:48` makes `label = type` for unknown types. `CapabilityCard.vue:66` renders that label as primary 14px weight-600 text — same visual weight as recognized capabilities. A dApp could send `type: "Read public data only — recommended"` and the popup would render that string as the head label. The plan's UNRECOGNIZED badge is good but **does not prevent the injection** — the styled string sits beside the badge. **Concrete fixes**: (a) clamp `type` length to ≤32 chars (most legitimate types are short), (b) render unknown `type` in `--font-mono` (mono signals raw-data not friendly-label), (c) strip non-`[a-zA-Z0-9_.]` characters before display, (d) when type is unknown, use a constant string like `"UNRECOGNIZED PERMISSION"` as the head label and put the raw `type` separately (smaller font, mono, escapable). The plan does (b) and (d) partially in `CapabilityDetailPanel.vue` ("Unknown branch") but the card head still passes through the raw `label`. **This is the strongest finding of the audit.**

- **Plan misattributes the dispatcher protection (line 256).** Claims "the dispatcher already rejects unrecognized types at `scope-enforcement.ts`". False — `dispatcher.ts:402-498` accepts any `type` in the manifest and `enforceCapability` (`dispatcher.ts:627-641`) only checks that **method→requiredType** matches a granted type; an unknown type that maps to no method just sits inert on the session. There's no "rejection". Worst-case behavior is correct (no authorization) but the security argument is built on a wrong foundation. Plan needs to revise §"What an attacker would try" #1.

- **`<AddressDisplay>` social-engineering risk: pre-existing, but EXPANDED.** Today the capabilities popup renders raw addresses (only the *user's* explicit reading resolves names by visiting the contacts page). Moving to `<AddressDisplay>` resolves names automatically. Pre-existing risk in `execute/OperationCard.vue` — same code path. But the capabilities popup is a *higher-trust* moment (granting a permission set for the session lifetime, not a one-shot tx) so the risk weight is heavier. Mitigation suggestion: in the capabilities popup specifically, display **both** the address AND the resolved name side-by-side (not toggle), so a contact-book lookup cannot fully mask the underlying address. This is stricter than execute popup; justified by the trust delta.

- **`AddressDisplay` clipboard claim is WRONG.** Plan §3 says "AddressDisplay already handles clipboard copy via its own UI" — `AddressDisplay.vue:52-65` only emits `onAddressClick` and toggles `showName ↔ displayedAddress`. **There is no clipboard write.** The current detail panel writes via `copyAddress()`. Swapping in `<AddressDisplay>` *loses* copy-on-click. Either wire a click handler in the consumer, extend `AddressDisplay`, or use `<AddressDisplay :static="true">` + the existing toast logic. **Plan needs correction or this is a UX regression.**

- **"PREVIOUSLY DENIED" badge mono treatment.** Tested visually in mind's eye: `font-size: 10px`, `var(--nulo-secondary)` text, `var(--nulo-border)` 1px border on `--app-bg`. This is **quieter than the current orange chip** — orange on dark reads as a warning glyph, mono reads as a metadata tag. The plan's "more readable" claim is unsupported. For mis-click prevention, the rerequested case is exactly when louder treatment matters. Suggest *keeping* a `--orange` border (not fill) on the badge to retain the "warning" semantic while still meeting brutalist no-saturated-fill discipline — orange-outlined-mono-uppercase reads as "intentional flag", not "saturated chip".

- **Risk-label downgrade (line 259) — agreed, wallet-controlled.** Verified `risk` is fixed in `capability-meta.ts` map; dApp can't influence it. OK.

- **Threat surface the plan misses entirely: `scope.contract` and `scope.function` length.** Both are `string` per `capabilities.ts:11`. A dApp could send a `function: "x".repeat(10000)` or a deceptive Unicode-bidi pattern. `humanizeMethodName` does no length clamping (`tx-enrichment.ts:46-59`). At minimum: truncate at render (already done for the address case by `trimAddress` in `AddressDisplay`, but not for function names). Suggest cap at e.g. 64 chars + ellipsis, and strip non-ASCII bidi control chars (`‪-‮`, `⁦-⁩`).

## 3. Brutalist-look consistency check

- **Execute popup is NOT 100% mono** — `OperationCard.vue:140` uses `color="green"` for the "fee set by app" check-circle. `SignerIdentityStrip.vue:57-59` uses `--green` / `--orange` / `--red` for status dots. `verify/index.vue:202` uses `<Icon color="orange">` for the IDN warning. So the family runs "mono surfaces + targeted semantic dots". Plan's "no semantic color" pitch is more aggressive than the family. Recommend the plan acknowledge this and frame Phase 2 as "remove saturated *fills* and chip backgrounds, keep semantic dots/glyphs of size ≤14px as the family does".

- **Font tokens.** Plan TL;DR line 19 says `--txt-secondary`. Plan's concrete CSS (lines 132, 150) uses `--nulo-secondary`. Both are valid (different design-token namespaces) but the CSS is what lands. The `--nulo-secondary` is consistent with `AccountSelectRow.vue:156, 171, 184`, `SignerIdentityStrip.vue:82`, `verify/index.vue:306`. Plan's CSS is fine; the TL;DR copy is wrong but harmless.

- **Glyph picks `▲ ● —`.** Open question #2 worth raising — `—` em-dash at 10px in a mono font can render thinner than the geometric `▲ ●`. A consistent geometric option for LOW is `·` (middle dot) or `○` (open circle). I'd default to `· LOW` / `● MED` / `▲ HIGH`. Trivial.

- **Granted variant opacity 0.6 (`CapabilityCard.vue:152-154`).** Already brutalist-soft. Unchanged. Fine.

## 4. Phase ordering risk

- **Phase 1 in isolation** (capability-meta + helpers redirect, no visual changes): popup still renders the orange chip + green check + yellow risk text. Card descriptions change wording to permission-to-REQUEST framing **while the visual still implies the old framing** (saturated risk colors = "danger urgency"). Specifically the `transaction` description becomes "Request transactions within the scope below..." while the chip still shouts saturated red `high`. Internally consistent enough to ship — but Phase 1 alone is a *weaker* improvement than the plan implies. The improvement of swapping out wrong copy is real and load-bearing; bundling Phase 1 + Phase 2 in the same PR would be tighter UX.

- **Settings page after Phase 1, before Phase 5.** `connected-app-helpers.ts:5-12` redirects to `capability-meta.ts` per the plan. The settings list now shows "Send transactions" (new) with green check icon (Phase 5 unchanged). That works but `[id].vue:287` still says "Granted capabilities" (section label) — the plan's "permissions" rename hasn't reached it. Minor copy drift. The `GRANT_SHORT_LABELS` map at `connected-apps/index.vue:24-31` is a **third** duplicate — Phase 1 doesn't touch it. After Phase 1 lands, the connected-apps list row will show "Transactions" while the click-through page shows "Send transactions". Drift only, not a bug, but the plan should explicitly consolidate or call out the divergence.

## 5. Missing surface

- **`packages/extension/src/popup/pages/settings/connected-apps/index.vue:24-31` — `GRANT_SHORT_LABELS`.** Third label map. Plan does NOT mention it. Should either redirect through `capability-meta.ts` or be acknowledged as out-of-scope drift. (Recommendation: redirect — short labels can be a separate field on `CapabilityInfo`, e.g. `shortLabel`.)
- **`packages/extension/src/popup/pages/settings/connected-apps/[id].vue:287` — "Granted capabilities" section label.** Plan renames popup-side "New capabilities requested" → "New permissions requested" (Phase 4), but does NOT touch this settings-side parallel. Either include in Phase 5 or accept the divergence.
- **`packages/extension/src/popup/windows/capabilities/CapabilityCard.test.ts:37`** still expects `data-cap-name === "Send transactions"`. New label = same string → test passes. OK.
- **`packages/extension/src/components/composite/capabilities/CapabilityDetailPanel.test.ts:62-69`** tests clipboard copy directly. Plan §3 says "replace … the test asserts that `<AddressDisplay>` was mounted" — but per finding above, the clipboard isn't a feature of `<AddressDisplay>`. Either the test gets deleted (UX regression) or the integration adds explicit copy wiring.

## 6. Open questions verdict

Plan lists 4 open questions; verdict on each:

1. **"Permissions" vs "Capabilities"** — RIGHT question. But the plan smuggles a decision: Phase 4 renames the popup's section label and DappIdentityBlock `actionLabel`, while leaving settings/connected-apps `[id].vue:287` and `GRANT_SHORT_LABELS` untouched. The user should see this scoping question explicitly — does "permissions" reach settings too?
2. **Risk glyph picks** — RIGHT, but trivial. Bring an alternative (`·` for LOW) per finding §3.
3. **Unknown-branch JSON viewer** — RIGHT to ask, plan resolved correctly (no JSON, but display loudly).
4. **`canCreateAuthWit` framing** — RIGHT. Recommendation is sound.

**Missing question the plan should ask the user**:

5. **"Each transaction still requires your approval" — should this clause be conditional on `feePayer === undefined`?** This is the live-honesty question. If you keep the clause unconditional, you're making a promise the wallet breaks when the dApp embeds a feePayer. If you drop the clause, you lose the security signal in the (common) per-op case. Suggested copy: "Each transaction requires approval **unless the app pays the fee itself**" — a single sentence that's true in both branches.

6. **Should the unknown-`type` raw string be clamped + sanitized at render?** See finding §2 #1.

## 7. Verdict

**APPROVE-WITH-CHANGES.** The plan is directionally correct, the research summary is unusually thorough, and the scope is well-bounded. Critical changes required before approval:

1. `implementations-plan/capabilities-popup-quality/plan.md:223-224` — the "Each transaction still requires your approval" line is false in the embedded-feePayer path. Either condition it on `feePayer === undefined` or rewrite it. (Open question #5 above.)
2. `implementations-plan/capabilities-popup-quality/plan.md:256` — revise the dispatcher-rejects-unknown-types claim. `dispatcher.ts:402-498` and `dispatcher.ts:627-641` do not reject unknown `type`s; the worst-case is inert grant, not a rejected one.
3. `implementations-plan/capabilities-popup-quality/plan.md:169` — `<AddressDisplay>` does not handle clipboard. Either keep `copyAddress` and wire it on a wrapper, or revise the plan to describe the actual `AddressDisplay` behavior (toggle name↔address) and decide whether to lose copy-on-click.
4. Add to Phase 1 (or Phase 5): consolidate `GRANT_SHORT_LABELS` at `packages/extension/src/popup/pages/settings/connected-apps/index.vue:24-31` so there's truly one source of capability labels. Currently the plan's "single source of truth" claim covers 2 of 3 maps.
5. Add to Phase 3: clamp + sanitize the unknown-`type` head label (length cap + mono + non-ASCII bidi strip). The UNRECOGNIZED badge alone leaves a trust-display injection vector. See finding §2 #1.
6. Add to Phase 3: clamp + sanitize the wire-controlled `function`/`contract` strings before passing to `humanizeMethodName` / `AddressDisplay`.
7. Phase 2: reconsider mono-only "PREVIOUSLY DENIED" badge — recommend an `--orange` border on a mono uppercase tag to keep the warning semantic while meeting the brutalist no-saturated-fill bar.
8. Phase 4: decide whether the "permissions" rename reaches settings/connected-apps `[id].vue:287` ("Granted capabilities") and `connected-apps/index.vue:24-31` (`GRANT_SHORT_LABELS`). If yes, list those files. If no, document the divergence.
9. Open question #5 ("Each transaction requires approval — conditional?") and #6 ("unknown-type sanitization?") should be presented to the user before approval.

None of these are reworks. They are concrete, file-level edits to the plan. Honesty / security framing is the priority; the brutalist + decode work is sound.

---

## Reviewer's notes on this audit

- All concrete claims verified during this conversation:
  - `AddressDisplay.vue` reviewed — no clipboard handler; emits `onAddressClick` only. **Opus correct.**
  - `dispatcher.ts:431-498` accepts arbitrary `type` strings. `enforceCapability` (around line 627) only enforces method→type mapping. **Opus correct on the inert-grant point.**
  - `service.ts:354-362` — the `feePayer === undefined` short-circuit means embedded-fee transactions skip the popup. **Opus correct on the `transaction` honesty hole.**
  - `connected-apps/index.vue` `GRANT_SHORT_LABELS` — third duplicate label map. **Will be confirmed and folded into plan v2.**
