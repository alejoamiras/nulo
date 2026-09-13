You are a Phase 2 cluster auditor in a map-reduce security audit. Working directory is the repo root (a git worktree of origin/dev). READ FIRST, in this order: `audit/security/2026-09-13-high-prerelease/raw/CONTEXT.md`, then `audit/security/2026-09-13-high-prerelease/raw/SECURITY-PROMPT.md` (the exact audit prompt + negative list + output format — follow it exactly), then the repo-map files named below for orientation. Then read the cluster source files IN FULL (not excerpts). Verify every claim against the code; cite file:line. Do not modify any file except your output file.

# Cluster c06-dapp-bridge-dispatch — dApp RPC boundary: content script → wallet-sdk background → dispatcher, sessions, capabilities, scopes

Repo maps: `raw/repo-map/wallet-bridge.md`, `raw/repo-map/extension-services-dapp-exec.md` (§0 lifecycle, §3a/3b).

Source files (read all, in full):
- `packages/wallet-bridge/src/*.ts` (all non-test)
- `packages/wallet-sdk-schema-patch/src/*.ts`
- `apps/extension/src/content-script/content.ts`
- `apps/extension/src/wallet/services/wallet-sdk/*.ts` (all non-test: background, session-established, session-baton, content-message-relay, content-script-validator, discovery-approval, tab-lifecycle, queued-journal, queued-wait-vouching, pending-verification, error-envelope, to-json-safe, profile-switch-teardown)
- `apps/extension/src/wallet/services/dapp-session/*.ts` (service, spec, integrity, mac-storage, capability-meta)
- Upstream reference (read-only, for the trust assumptions the wallet inherits): `node_modules/@aztec/wallet-sdk/dest/extension/handlers/*.js` — specifically how `BackgroundConnectionHandler` attributes origin from `sender.tab.url`, how `sessionId` is chosen, and the ECDH/AES channel setup.
- Tests as evidence: `packages/wallet-bridge/src/dispatcher.test.ts` (skim widening + scope sections), `scope-enforcement.test.ts`, `background.discovery-race.pins.test.ts`, `session-established.test.ts`.

Specific questions:
1. Origin attribution: upstream uses `sender.tab?.url` (top frame). With `isSubframeSender` rejecting `frameId !== 0`, what about: `sender.tab` undefined (prerender, service-worker-initiated, extension pages), `about:blank`/`data:` top frames, `sender.origin` vs `sender.url` disagreement, a top-frame navigation mid-session (origin changes but tab id persists), sandboxed iframes with `allow-same-origin`. Any way for origin A to obtain a session attributed to origin B?
2. Session establishment + verify window: the pending-verification marker keyed by request id, freshness window, profile equality, the URL-carried `verificationHash`. Can a dApp force reuse of a previous approval; can two concurrent handshakes for the same `(origin, chainId)` cross; is the verify window's decision (trusted vs not) bound to the right session after a SW restart?
3. `requestCapabilities` + accounts widening (#582): construct an attack where a dApp learns held accounts, escalates flags, or gets an account it declined; check `accountsAdditions` echo-binding, `requiresGrant` under the lock, `membership-only` shortcut answered WITHOUT a popup — can a dApp use that to enumerate?
4. Scope enforcement per method: for each `METHOD_REGISTRY` row, verify the checker actually inspects every dApp-controlled target field (contract address, function name AND selector, account scopes, `additionalScopes`, capsules, authwit contents). Empty-name rule, wildcard rules, `encoded_call` vs `call` parity, `batch` leg re-checks.
5. `createAuthWit`/`grantPublicAuthwit`: raw-hash rejection (fix A) — verify no remaining path signs an opaque hash; is the silent (no-popup) route for createAuthWit correctly bounded by tx/simulation scope; can an authwit be minted for a caller/contract outside scope; replay/chain-id binding of the authwit message.
6. DappSession MAC (F-12): key derivation per profile, canonicalisation completeness (are ALL authority-bearing fields under the MAC: accounts, grants, rejections, aliases, verificationHash, trusted flag, chainId, origin, profileId?), verify-or-drop semantics, and what a storage writer can do with a dropped row (DoS? forced re-prompt?).
7. Fail-closed audit: every place the dispatcher/handler returns an empty grant list, `undefined` session, or catches an error and continues — is it fail-closed?
8. `registerToken`/`isTokenRegistered`/`getWalletFeatures` schema patch: arg schemas, and the reachability of any method NOT in the registry (prototype names, upstream methods the SDK adds later).
9. Discovery flood + locked queue: caps, coalescing keys (can origin spoofing via subdomains defeat the per-origin cap?), badge painting from attacker strings.
10. Response epoch / profile-switch suppression: can a response composed for profile A be delivered to a session established by profile B?

Write your report to `audit/security/2026-09-13-high-prerelease/raw/c06-dapp-bridge-dispatch-claude.md`.
