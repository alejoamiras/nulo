# M4.1 — Content-script scope review (DECISION MEMO + PREWORK; 3-7d execution after decision)

> **STATUS: RESHAPED — broad injection confirmed REQUIRED by `@aztec/wallet-sdk` discovery protocol** (2026-04-26 user decision + investigation — see `../DECISIONS.md`). Verified at `(Aztec packages source tree)/yarn-project/wallet-sdk/src/extension/handlers/content_script_connection_handler.ts`: the discovery protocol is page-initiated via `window.postMessage(WalletMessageType.DISCOVERY)`. Without a content-script listener already on the page, no discovery happens. Designs 1.5 (allowlist) and 2 (dynamic registration) both break the ecosystem. Final scope is light hardening: document threat model in SECURITY.md, audit + minimize local content script (already 22 LOC + a relay), tighten incoming message validation with zod schemas. ~1-2 days execution.
>
> **Audit tier**: dual (codex xhigh + Plan agent). Audited as decision memo.
>
> **Status**: NOT a step-by-step execution plan. M4.1 has a product decision (M0.5.a — is broad content-script injection a hard requirement?) that must close before execution.

## Why this is a memo, not an execution plan

**Codex audit pass-through**: M4.1 has two viable designs that aren't just "implementation paths." They have different manifest permission models, different runtime UX, and different test invariants. Decision must close before plan can be definitive.

The current state at `packages/extension/manifest/manifest.config.ts:25-32`:
```ts
content_scripts: [
  {
    all_frames: true,
    js: ["src/content-script/content.ts"],
    matches: ["*://*/*"],
    run_at: "document_start",
  },
],
```

This is **maximally broad**: every page, every frame, document-start. The injected script (`packages/extension/src/content-script/content.ts:9`) is just a relay around `ContentScriptConnectionHandler` from `@aztec/wallet-sdk/extension/handlers` — it doesn't read or write page state. But it IS injected everywhere, and the standard upstream relay's discovery + key-exchange code runs on every page load.

**Risk R4 in `architecture/plan/02-final-plan.md:292`**: content script injected on every page / frame / document-start = unnecessarily large attack surface.

**Codex audit pass-through (BLOCKING)**: today's content script is a thin upstream wrapper. "Hostile-frame envelope rejection" tests are wrong invariants UNLESS M4.1 also adds local filtering. If we keep the upstream relay verbatim, the test focus shifts to "scope was actually narrowed" rather than "envelope rejection works."

## Two viable designs

### Design 1 — Keep broad scope; minimize injected code; add hostile-frame defenses

**Idea**: Accept that the wallet must be discoverable from any dApp page. Tighten the injected script to do exactly what's needed (relay) and nothing more. Add defenses against malicious page content (e.g. iframe-spoofing, same-origin policy violations).

**Steps**:
1. Audit `@aztec/wallet-sdk/extension/handlers.ContentScriptConnectionHandler` for any page-state-touching code. Flag if found.
2. Add a same-origin / top-frame check before forwarding any message to the SW. If the message originates from a sub-frame whose origin doesn't match the top frame, reject.
3. Tighten `chrome.runtime.onMessage` listener to only forward messages from the offcial bridge handshake.
4. Tests focus on hostile-frame envelope rejection: an iframe injecting a forged "wallet request" message gets rejected.

**Pros**:
- No manifest permission changes (smallest deployment risk).
- Compatible with existing dApps without the user enabling permissions per-site.
- Smallest UX impact.

**Cons**:
- Attack surface still broad (every page runs the relay).
- Memory overhead per tab (~negligible per existing relay).

### Design 2 — Narrow scope via dynamic registration

**Idea**: Drop the static `content_scripts` block. Add `"scripting"` permission + `"optional_host_permissions": ["*://*/*"]`. On user-initiated dApp connect, request host permission for that origin and dynamically register the content script via `chrome.scripting.registerContentScripts`.

**Steps**:
1. Manifest change: drop `content_scripts`, add `"permissions": [..., "scripting"]`, `"optional_host_permissions": ["*://*/*"]`. (Or pin to specific dApps if the user-flow allows discovery — unclear without product input.)
2. New `ScriptInjector` service that registers per-dApp scripts on connect.
3. UX: first-time connect to a dApp shows a Chrome permission prompt ("This extension wants to access this site").
4. Existing dApp sessions without the permission: redirect through a connect flow that requests permission.

**Pros**:
- Minimum-privilege model. Wallet only sees pages the user explicitly approved.
- Aligns with Phantom + Backpack + most modern wallet UX.
- No content-script execution on random pages.

**Cons**:
- Manifest permission change = potential Chrome Web Store re-review.
- UX regression: first-time connect to a dApp adds a permission prompt step.
- Migration: existing dApp sessions need re-prompting on first M4.1 boot.
- Larger code change.

## Which design ships?

**Recommendation, pending product decision**: **Design 2** if Aztec dApp ecosystem is small + identifiable; **Design 1** if dApps are sprawling + need zero-friction connect.

The user (or product) decides based on:
- Is wallet discovery on every page a feature dApp authors rely on, or a relic?
- Are users tolerant of a one-time per-dApp permission prompt?
- Is the Chrome Web Store re-review cost acceptable?

If unsure, **Design 1** is the conservative path — it ships sooner, tightens the scope where possible, and leaves the door open for Design 2 in M5.x.

## Prework (safe to do now)

1. **Audit `ContentScriptConnectionHandler`**: read the upstream code; document what it does, what it touches, what data it passes through. If it does anything beyond message relay, flag for upstream PR or local override.
2. **Inventory dApp connect flows**: list every entry point for "user connects to dApp." Both designs need to know this surface to ship a coherent migration.
3. **Sketch the `dynamic content-script registration` adapter** for Design 2: type-only file showing what `ScriptInjector` would look like. Ship as a PR if Design 2 is picked.
4. **Hostile-frame test fixtures** for Design 1: pre-write the malicious-iframe + same-origin-spoofing + forged-handshake test cases. They're independent of which design ships (Design 2 needs the same defenses for already-injected scripts).

## What execution looks like

### Design 1 (Keep broad; minimize)

**Step 1 — Audit upstream relay**:
- Document `ContentScriptConnectionHandler`'s full behavior.
- If anything dangerous (e.g. eval, postMessage to non-bridge endpoints), open an upstream issue + add a local filter.

**Step 2 — Add same-origin / top-frame guards**:
- In `content.ts`, before forwarding any message: check `event.source` and origin matches top-level page (or expected sub-frame).
- Reject + log otherwise.

**Step 3 — Tighten message envelope**:
- Verify `chrome.runtime.onMessage` listener matches only well-formed bridge envelopes (zod schema or hand-rolled).

**Step 4 — Tests** (`packages/extension/src/content-script/content.test.ts`):
1. Top-frame message forwarded.
2. Sub-frame message with mismatched origin rejected.
3. Forged envelope (missing/invalid fields) rejected.
4. Malformed JSON rejected without crashing.
5. Race: two top-frame messages forwarded in order.

### Design 2 (Dynamic registration)

**Step 1 — Manifest change** + Chrome Web Store coordination.

**Step 2 — `ScriptInjector` service** in `wallet/services/script-injector/`. Registers scripts via `chrome.scripting.registerContentScripts`. Persists registered hosts via M4.7 migrator.

**Step 3 — Connect-flow UX**:
- New "request site access" step in the connect popup.
- Existing dApp sessions: M4.1 ships a "re-authorize" prompt on first boot post-M4.1.

**Step 4 — Tests**:
1. New dApp connect → permission prompt → script registered → bridge live.
2. Existing dApp sessions migrated (re-prompt path).
3. Permission denied → connect fails gracefully.

## Verification commands (post-execution)

```bash
bun run --filter '@nulo/extension' test
bun run typecheck:all
bun run test:all                           # M2.6 unaffected
bun run check:imports
bun run build                              # manifest changes pick up
```

Manual QA depends on design:
- **Design 1**: visit hostile test pages (jsdom + a malicious iframe); verify rejection + no crash.
- **Design 2**: full dApp connect flow on a fresh install; verify permission prompt; verify post-permission bridge works.

## Risks tracked

**Both designs**:
1. **Existing dApp compatibility** — design 2 requires re-prompt; design 1 requires no migration but leaves attack surface.
2. **Upstream `ContentScriptConnectionHandler` behavior** — both designs depend on it being safe + minimal.

**Design 1 specific**:
3. **Same-origin spoofing** — defense is best-effort; sophisticated attackers can craft same-origin payloads. Document.

**Design 2 specific**:
4. **Chrome Web Store re-review** — adds release latency. Schedule accordingly.
5. **`optional_host_permissions: ["*://*/*"]`** — Chrome may still treat this as broad. Verify against Chrome's policy at execution time.
6. **User confusion** — first-time per-dApp prompt is a new UX step. Beta feedback critical.

## Audit prep

When this memo goes to codex + Plan agent for audit:
- Both audits agreed M4.1 should be planned branch-aware. This memo absorbs that.
- The audit now focuses on: (1) is the design recommendation right? (2) are the hostile-frame test fixtures comprehensive? (3) does Design 2's migration story handle the existing-session edge cases?
