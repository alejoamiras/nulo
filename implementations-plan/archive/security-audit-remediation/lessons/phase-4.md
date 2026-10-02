# Phase 4 — F-001 + F-002 Frame-vs-tab defense-in-depth

## Closed findings
- **F-001** (partial, Nulo-side): subframe-originated content-script messages are rejected at the wallet-sdk wrapper. Default ON; flag-controlled via `VITE_NULO_ALLOW_IFRAME_DAPPS`.
- **F-002** (NOT fully closed): full fix requires upstream `BackgroundConnectionHandler` to expose frame-targeted `sendToTab`. Marked as upstream coordination item per the plan.

## Implementation
- `packages/extension/src/wallet/services/wallet-sdk/content-script-validator.ts`: new pure helper `isSubframeSender(sender)` — returns `true` when `sender.tab` exists AND `sender.frameId !== 0`. Returns `false` for top-frame messages, non-tab senders (extension internals), and undefined `frameId`.
- `packages/extension/src/wallet/services/wallet-sdk/background.ts`:
  - New module-scope `NULO_ALLOW_IFRAME_DAPPS` constant — reads `import.meta.env.VITE_NULO_ALLOW_IFRAME_DAPPS === "1"`. Build-time flag (not runtime) so an attacker can't flip it via storage/popup compromise.
  - In `addContentListener` (wrapper for `chrome.runtime.onMessage.addListener`), before invoking `validateContentScriptMessage`, check `!NULO_ALLOW_IFRAME_DAPPS && isSubframeSender(sender)`. If true: log Debug + return without forwarding.

## What's NOT in this phase (deferred per audit Round 1 codex B-3)
- Frame-targeted `sendToTab` (the F-002 full fix) is INFEASIBLE with the current upstream wallet-sdk transport. Upstream's `sendToTab` signature is `(tabId, message)` — no `frameId` option. Adding `chrome.tabs.sendMessage(tabId, msg, {frameId})` requires upstream changes. The plan correctly marks this as upstream coordination.
- Content-script pending-request correlation: minimal value once the wrapper-layer subframe rejection is in place. The iframe can't reach the SW. Skipped.

## Tests added (4)
- `isSubframeSender` returns:
  - false for top-frame (`frameId: 0`)
  - true for subframe (`frameId: 1`, `frameId: 99`) — the F-001 attack signature
  - false for non-tab senders (extension internals, ServiceClient, offscreen)
  - false for undefined `frameId` (defensive fail-open)

## Verification
- `bun --cwd packages/extension test -- wallet-sdk/content-script-validator.test.ts`: 14 pass (10 existing + 4 new).
- `bun --cwd packages/extension typecheck`: clean.

## Surprises
- The audit recommended a "feature flag" but it wasn't clear whether runtime or build-time. Picked build-time (`import.meta.env.VITE_*`) because runtime config opens a widening primitive an attacker could try to flip via storage poisoning. Build-time keeps the policy immutable per release.
- `validateContentScriptMessage`'s test file was the natural home for `isSubframeSender` tests. Same module + same shape.

## Upstream coordination item (NOT blocking)
File against `@aztec/wallet-sdk` (per audit Phase 5 plan):
- Extend `MessageSender` interface with `frameId?: number` and `url?: string`
- Use `sender.url || sender.tab?.url` for origin attribution (the F-001 root cause)
- Track `frameId` in `ActiveSession` so callbacks know which frame
- Expose `frameId` on `sendToTab` so frame-targeted replies are possible (closes F-002 fully)

## Open follow-ups
- Once upstream lands the changes above, revisit and add frame-scoped session keying.

LESSONS_FILE=implementations-plan/security-audit-remediation/lessons/phase-4.md
