NOTE FOR CODEX: This is a DEFENSIVE hardening review of our own code, commissioned by the code owner, so we can fix weaknesses before release. Report weaknesses with concrete traces and recommended fixes. You run in a read-only sandbox: do NOT try to write files. Output your FULL report as your response text (it will be saved as raw/c05-messaging-transport-codex.md by the orchestrator). Ignore the 'Write your report to …-claude.md' line at the end. Where the instructions say to read SECURITY-PROMPT.md, read audit/security/2026-09-13-high-prerelease/raw/SECURITY-PROMPT-codex.md instead.

You are a Phase 2 cluster auditor in a map-reduce security audit. Working directory is the repo root (a git worktree of origin/dev). READ FIRST, in this order: `audit/security/2026-09-13-high-prerelease/raw/CONTEXT.md`, then `audit/security/2026-09-13-high-prerelease/raw/SECURITY-PROMPT.md` (the exact audit prompt + negative list + output format — follow it exactly), then the repo-map files named below for orientation. Then read the cluster source files IN FULL (not excerpts). Verify every claim against the code; cite file:line. Do not modify any file except your output file.

# Cluster c05-messaging-transport — process-boundary RPC (SW ↔ popup ↔ offscreen), sender auth, boot/runtime, SW restart

Repo maps: `raw/repo-map/extension-messaging.md`, `raw/repo-map/extension-shell.md`, `raw/repo-map/wallet-core.md` (§2 base/ports).

Source files (read all, in full):
- `packages/extension-messaging/src/**/*.ts` (all non-test)
- `apps/extension/src/core/**` (adapters: chrome-browser-api etc.), `apps/extension/src/offscreen/{index.ts,index.html}`, `packages/aztec-runtime/src/offscreen/entry.ts`, `apps/extension/src/wallet/utils/offscreen*.ts`
- `apps/extension/src/wallet/index.ts`, `apps/extension/src/wallet/runtime.ts`, `apps/extension/src/wallet/base/*`
- `packages/wallet-core/src/base/*.ts`, `packages/wallet-core/src/utils/{serialization.ts, error-json.ts, errors.ts, lock.ts, keyed-lock.ts, rw-guard.ts}`
- `apps/extension/src/wallet/services/pxe/{client.ts, shallow-port.ts}` and `packages/aztec-runtime/src/pxe/{client.ts, service.ts (dispatch parts), spec.ts, descriptors.ts}` for the SW↔offscreen channel and the store-key provisioning message
- `apps/extension/src/wallet/services/logger/*`, `log-viewer/*` (RPC facades)
- Tests as behaviour evidence: `packages/extension-messaging/src/**/*.test.ts` (skim the sender-auth, dispatch allowlist, arity/pending caps).

Specific questions:
1. `isTrustedInternalSender`: exact predicate. Enumerate every listener (`onConnect`, `onMessage`, offscreen client `onMessageListener` at `offscreen/client.ts:60` which reportedly never reads `sender`) and say which are gated. For the ungated one(s), describe what a content script (same extension id! `sender.id === chrome.runtime.id` is TRUE for the extension's own content script; `sender.url` is the PAGE url) or a compromised popup could inject, and what handler it reaches. Note: the content script runs in every page (`all_frames`, `*://*/*`) — a page cannot call `chrome.runtime.sendMessage` itself, but XSS in the extension's own pages, or the content script being compromised via the page's ability to influence what it relays, must be modelled precisely: state exactly what the content script relays and whether the relay can be steered to hit an internal listener.
2. Firefox: no offscreen API → hidden window fallback + "instance token" (fix G). How is the token minted/checked; can a page-context or another extension window impersonat it; what happens across SW restart?
3. Dynamic dispatch: `BaseService.invoke` allowlist and `handleEvent` allowlist — prototype pollution / `__proto__` / `constructor` method names; `requestId` type confusion; params arity; pending-request caps (`TOO_MANY_PENDING`); per-port isolation (can popup A receive popup B's responses/events? are events broadcast to all ports?).
4. Serialization: `jsonSanitize`/`jsonStringify`, `WalletError` reconstruction from payload (`walletErrorFromPayload`) — can a hostile payload reconstruct an error type that a caller treats as a security signal (e.g. an "already verified" or "cancelled" error)? BigInt/Buffer/Map handling; error messages carrying secrets (the passhash/PRF params of a failed unlock call — is the request envelope logged on failure? see `envelope-summary.ts` and `telemetry.ts` scrubbers).
5. Store-key provisioning to the offscreen PXE: the 32-byte key crosses `chrome.runtime.sendMessage` base64. Who can receive that message (any extension page with a listener? the content script's `onMessage`?), is it bound to a generation/incarnation, can a stale or replayed provision re-open a store for a locked profile?
6. Boot order and SW restart: what runs before the migration gate; can a popup/dApp message arrive before services are ready and be dispatched against half-initialised state; what state is reconstructed from chrome.storage.session after restart and is it re-validated (envelope MAC, bearer)?
7. Ports and lifecycle: unlimited ports per client? disconnect handling that drops locks (`Lock` tickets, `ReadWriteGuard` force-release) — can a hostile popup wedge or force-release a lock another context holds?
8. Logger service: `log` RPC from any internal context — can a page-influenced string reach the persisted log and defeat the key-name redactor (the interpolated-string false negative), and can the log viewer render it unsafely?

Write your report to `audit/security/2026-09-13-high-prerelease/raw/c05-messaging-transport-claude.md`.
