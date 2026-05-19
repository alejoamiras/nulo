# M4.8 — Plan agent audit

Date: 2026-04-26

**No BLOCKING** (memo-level).

**SHOULD-FIX**
- M4.7 inventory (`M4/7/plan.md:46-51`) lists exactly two `chrome.storage.session` roots: `nulo:core:session` and `nulo:journal`. Design Y's `nulo:passkey:pending` would be NEW and is NOT enumerated. Memo's "M4.7 territory" hand-wave (line 68) is too thin given M4.7's xhigh audit lock. Memo must explicitly say: "Design Y requires re-opening M4.7's plan to add `nulo:passkey:pending` to the session-storage inventory + migrator registry."
- Test list missing key scenarios:
  - **Mid-PRF SW restart**: popup is mid-PRF, SW dies before resolvePasskeyRequest. Stale `requestId` calls `getPendingRequest` → "Invalid request id" (`PasskeyService:43-45`). Pin error path.
  - **WindowManager.detach race on cold SW**: PasskeyService:57 calls detach before settle; on fresh SW, no handle. Verify `detach`/`settle` on unknown handleId is no-op.
  - **Stale lock-screen state** post-restart.
- `chrome.windows.get` reliability — memo never actually answers (line 155 hedges to "if not, Y degrades to X"). If Y is ever revived, needs verified empirical test.
- SECURITY.md cross-doc updates: post-M4.2+M4.8, "Session secret (passkey profiles)" section needs rewrite (no longer asymmetric); threat-model row needs joint update with M4.2; `architecture/codex-notes/08-passkey-flow.md:198` needs marking resolved.

**NIT**
- Design X recommendation holds. Failure mode is re-click on actively-engaged popup.
- PasskeyPendingStore type-only prework approach right (mirrors M4.2's `SessionToken` pattern).
- M4.8/M4.2 cross-PR coordination consistent.
- `WindowManager.reattach` doesn't exist today; sub-PR if Y revives.
- `handleId` is hex (random), NOT windowId. If Y revives, recovery sketch line 124 has a category bug (`parseInt(entry.handleId)` is wrong).
