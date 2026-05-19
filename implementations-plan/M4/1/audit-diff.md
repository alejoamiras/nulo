# M4.1 — audit-diff (post-dual-audit; DECISION MEMO)

Date: 2026-04-26

## Codex BLOCKERs

1. **Design 2 bootstrap mechanism missing (codex BLOCKING)**: today first-contact discovery only happens because the always-on content script forwards into `onPendingDiscovery` (`wallet-sdk/background.ts:106, 252`). Without a static script, new dApps cannot be discovered at all. **Fix**: memo must specify the bootstrap mechanism up front: extension action "Connect this site," context-menu flow, OR a tiny discovery-only static injector. Recommendation heuristic should hinge on willingness to add that UX, not on ecosystem size.
2. **Design 1 guard/test plan assigned to wrong seam (BOTH audits BLOCKING)**: today's `content.ts:9-22` is just `new ContentScriptConnectionHandler(...)` + `.start()` — no place to interpose origin checks without **wrapping or replacing** the upstream handler. **Fix**: commit to a `WrappedContentScriptHandler` (changes the upstream-thin invariant) OR propose an upstream PR.
3. **Design 2 migration/revocation state model underspecified (BOTH audits BLOCKING)**: existing-session catalog at `dapp-session/service.ts`; what happens on user denial (evict vs dormant)? Boot ordering vs M3.7 boundary checks? Memo handwaves the migration-heavy part.

## Codex SHOULD-FIX

- Design 2 tests miss risky transitions. Add tests for: existing-session denial fallback, host permission revocation mid-session, cross-profile dApp session migration.

## Plan agent SHOULD-FIX

- Missing **Design 1.5**: narrowed `matches` allowlist (e.g. `["https://app.aztec.network/*"]`) without dynamic registration. Strictly less code than Design 2 if dApp set is small.
- `all_frames: true` reduction not enumerated — near-free win.
- CWS re-review impact overstated.
- ContentScriptConnectionHandler audit is **gate condition**, not prework.
- Recommendation heuristic vague — pivot is **discovery vs explicit-connect axis**.

## Plan agent NIT

- "Malformed JSON rejected" — `chrome.runtime.onMessage` delivers structured objects, not strings. Drop test.

## Recommended execution-time absorption

1. **Memo expansion** to 3 designs:
   - **Design 1.5** (NEW): narrowed `matches` allowlist + drop `all_frames`. Strawman if dApp set is small/identifiable.
   - **Design 1 (broad+wrap)**: keep `*://*/*` + introduce `WrappedContentScriptHandler` with origin checks. Acknowledge upstream-thin invariant breaks.
   - **Design 2 (dynamic registration)**: spell out bootstrap mechanism (recommend extension-action "Connect this site"). Spell out migration: existing dApp sessions (from `dapp-session/service.ts`) need re-prompting on first boot post-M4.1.
2. **Recommendation pivot**: discovery-vs-explicit-connect axis (not ecosystem size).
3. **ContentScriptConnectionHandler audit** as gate condition before any design ships.
4. **Test expansions** per Design 2's risky paths.

## Status

- Plan v0 SHIPPED. Audits absorbed in this audit-diff.
- Plan v1 — memo-level revisions. Awaits M0.5.a product decision + bootstrap-mechanism decision before transition to execution plan.
