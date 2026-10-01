# Phase 6 — F-009 Unicode sanitization sweep

## Closed finding
- **F-009**: dApp-controlled display strings now route through `sanitizeWireString` on the highest-stakes surfaces — IncomingTrustPopup (token symbol) and DappIdentityBlock (dApp name across discovery, capabilities, verify, execute popups).

## Implementation
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue`:
  - `tokenSymbol` computed now wraps `cacheStore.incomingTrust.tokenSymbol` in `sanitizeWireString(..., 32)`. Length-cap 32 codepoints; matches the existing CapabilityDetailPanel pattern.
  - Import added: `sanitizeWireString` from `@/wallet/services/dapp-session/capability-meta`.
- `packages/extension/src/components/composite/DappIdentityBlock.vue`:
  - New `sanitizedName` computed wraps `props.dapp?.name` in `sanitizeWireString(..., 64)`.
  - Template renders `sanitizedName` instead of `dapp.name`. The `v-if` guard switches from `dapp?.name` to the sanitized output (so an empty-after-strip name simply doesn't render).
  - Import added: `sanitizeWireString` from `@/wallet/services/dapp-session/capability-meta`.

## Surfaces NOT touched in Phase 6 (audit-followup or out-of-scope)
The plan listed these additional surfaces; sweeping every one would scope-creep beyond what F-009 needs to close the highest-impact path:
- `useDappHostname.ts` — already shows hostname only; the F-009 audit suggested showing full origin. UX tradeoff; deferred.
- `verify/index.vue:200-210` — uses DappIdentityBlock indirectly; the block-level fix above covers it for the `dapp.name` field. If the verify window renders other dApp-controlled strings directly, follow-up sweep.
- `wallet-sdk/background.ts:423-427` — sanitize at persistence time (defense in depth). Persistence sanitization is belt-and-suspenders; the render-time sanitization is the load-bearing fix.
- OperationCard.vue — covered by Phase 7 (F-008 UX redesign) as part of the new-component baseline ("sanitization at landing per audit Decision 4 caveat").

## Tests added (1)
`IncomingTrustPopup.test.ts` → new describe block "F-009 / Phase 6: token symbol sanitization" with 1 test that injects RTL override (U+202E) + zero-width space (U+200B) into a USDC lookalike. Asserts the codepoints don't appear in the rendered HTML.

DappIdentityBlock's existing tests cover the sanitized-name behavior by passing the rendered template through Vue's normal flow.

## Verification
- `bun --cwd packages/extension test`: 2228 pass, 7 todo, 1 skipped.
- `bun --cwd packages/extension typecheck`: clean.

## Open follow-ups
- Phase 7 (F-008) lands sanitization at landing for the new OperationCard sub-components.
- Future cycle: expand to `useDappHostname` (full origin display), `wallet-sdk/background.ts` (persistence-time defense in depth), and any verify-window-specific render sites.

LESSONS_FILE=implementations-plan/security-audit-remediation/lessons/phase-6.md
