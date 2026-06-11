# C4 — Round 2 push-back (Claude self-critique)

All checks re-run against source on `feat/security-audit-remediation`. Paths repo-relative under `packages/extension/src/`.

## (1) MISSED

1. **Copy-feedback micro-family never aggregated.** The `openToast("... is copied", icon: "copy")` + `isCopied`/`setTimeout` reset pattern recurs across in-scope files — popup/onboarding import `handleCopyError` (flagged only inside F1's wholesale dup), `SplittedBalancesView.vue:44-48`, `ScopeAddress.vue:53`, plus the write-only `isCopied` corpses in BalanceView/SplittedBalancesView (F6). Each fragment landed in a different finding; no `useCopyFeedback` extraction was ever named. Verified live sites by grep (10 files repo-wide, ≥5 in scope).
2. **`utils/card-subtitle.ts` is explicitly in cluster scope and neither Claude agent mentions it** — not even as a non-finding. It is fine code (deliberate extraction, exhaustiveness test pin), so a one-line non-finding was owed; silence is a coverage gap.
3. **`execute/index.vue` (top hotspot, 5 commits, in scope "UI side")** got one non-finding (init() switch) and drive-by mentions; its `UIError` `type`-field shape — the very variant F4/F5 blame for the dead `processingError.type` copy in NewFpcPopup — was never assessed at its origin.

## (2) OVER-ASSERTED

1. **Claude-1 F4's remedy contradicts Claude-2 F4(d), and the source sides with Claude-2.** `useEntityCrud.ts:7-8` documents "Initial fetch — runs immediately on setup"; show-gated popups can't adopt it as the claimed "mechanical" Replace-Inline-Code — a lazy mode must be built first. The rebuttal never reconciled this; Claude-1's "smallest safe refactoring" is not safe as written.
2. **Unreconciled internals carried into Round 1:** RAV "7 service clients" (Claude-1) vs "6" (Claude-2); fee-twin line ranges cited three different ways (33-93/45-88/45-92). Sloppy, not wrong.
3. **Claude-1 F8's "structural as a family" bucket is inflation** — 4 chip-CSS copies in card files is cosmetic-per-instance duplication; "de-facto design-system components" is framing, not evidence.
4. No DO-NOT-FLAG violations found; behavioral items were correctly exiled to out-of-scope.

## (3) ANCHORING

1. **Both F10 layer-gap findings were pre-seeded verbatim by `clusters.md` Focus** ("CapabilityDetailPanel/DappIdentityBlock in composite/, onboarding→PasskeyCeremonyDialog import") yet presented as discoveries and ranked architectural. Genuine value-add was only the biome-glob analysis + sanitizer Move Function.
2. **Finding sets track repo-map §4's nine families nearly 1:1** (F1=map5, F2/F3=map4, F4/F5=map1...). Net-new beyond the map: dead-code F6, Enter-key family, Claude-2's useFormState inversion. Claude-2 F8 bled into C6's remit (`utils/fee-estimation.ts`, `send/fee-helpers.ts`) chasing map family 3 — then the rebuttal scored that out-of-scope item as a "codex miss".
3. Change-frequency fields mostly cite "map §8" rather than independent git; spot-checks (import.vue=4, RAV=5) confirm the numbers, so anchoring without harm.
