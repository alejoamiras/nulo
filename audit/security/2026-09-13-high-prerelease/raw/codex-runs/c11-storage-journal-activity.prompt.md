NOTE FOR CODEX: This is a DEFENSIVE hardening review of our own code, commissioned by the code owner, so we can fix weaknesses before release. Report weaknesses with concrete traces and recommended fixes. You run in a read-only sandbox: do NOT try to write files. Output your FULL report as your response text (it will be saved as raw/c11-storage-journal-activity-codex.md by the orchestrator). Ignore the 'Write your report to …-claude.md' line at the end. Where the instructions say to read SECURITY-PROMPT.md, read audit/security/2026-09-13-high-prerelease/raw/SECURITY-PROMPT-codex.md instead.

You are a Phase 2 cluster auditor in a map-reduce security audit. Working directory is the repo root (a git worktree of origin/dev). READ FIRST, in this order: `audit/security/2026-09-13-high-prerelease/raw/CONTEXT.md`, then `audit/security/2026-09-13-high-prerelease/raw/SECURITY-PROMPT.md` (the exact audit prompt + negative list + output format — follow it exactly), then the repo-map files named below for orientation. Then read the cluster source files IN FULL (not excerpts). Verify every claim against the code; cite file:line. Do not modify any file except your output file.

# Cluster c11-storage-journal-activity — cross-profile isolation of persisted rows, journal/activity/transaction/token-balance/contact stores, id allocation

Repo maps: `raw/repo-map/extension-services-dapp-exec.md` (§1, §3b), `raw/repo-map/wallet-core.md` (§3, §8 activity gap), `raw/repo-map/extension-services-secrets.md` (storage table).

Source files (read all, in full):
- `apps/extension/src/wallet/services/{operation-journal,activity-protocol,transaction,token-balance,contact,token}/*.ts` (all non-test; for token: service.ts, spec.ts, seeding/TOFU pin logic)
- `apps/extension/src/wallet/services/{require-owned-row.ts, purge-rows.ts, restore-rows.ts, id-allocators.ts, storage-codecs.test.ts (read as spec), cross-profile-isolation.test.ts (read as spec)}`
- `packages/wallet-core/src/{jobs/*.ts, activity/*.ts, utils/{serialization.ts, error-json.ts, queue.ts, arrays.ts}}`
- `packages/wallet-core/src/storage/entity_storage.ts` (re-read the identity-match opt-in) and grep every `new EntityStorage(` / `new ValueStorage(` in `apps/extension/src` to build the table of roots → codec → identity-match mode → owner service.
- `apps/extension/src/wallet/services/dapp-session/service.ts` + `token/service.ts` + `fpc/service.ts` + `network/service.ts` — only their `getX`/`getXs`/`deleteX` by-id paths for the ownership check.
- Popup consumers that display these rows: `apps/extension/src/popup/pages/activity/**` (or wherever), `popup/components/modules/{TokenCard,ContactRow}*`.

Specific questions:
1. Build the complete table: storage root → row schema → `requireKeyIdentityMatch`/`keyIdentityMode` → which fields carry profile/chain ownership → which by-id getters/deleters check ownership against the ACTIVE profile (via `requireOwnedRow` or inline) and which do NOT. For every unchecked getter/deleter reachable from the popup RPC surface or the dApp dispatcher, describe the cross-profile read/delete.
2. Row transplant: for roots WITHOUT identity matching, copy profile B's row under a key in profile A's namespace (or vice-versa) — which consumers trust the embedded ids (profileId, chainId, account) and what breaks (wrong-profile balance display, journal attribution, activity feed, auth-registry revocation of another profile's authwit?).
3. Id allocation: `nextNumericId`/`nextRandomId`/`randomIdNotIn`/`preferOrReallocId` — collision under concurrency, predictability, and whether a untrusted backup can force id collisions that overwrite live rows on restore.
4. Operation journal: FSM transitions callable from the popup (`transitionOperation`, `setOperationMeta`, `deleteOperation`) — can the popup (or a untrusted backup) mark a real in-flight tx as succeeded/cancelled, or resurrect a cancelled one; `JobCancelledSentinel` leakage; reaper/GC deleting records still referenced by execution.
5. Activity protocol: the documented causal-snapshot gap (`causal.ts:172-181`) — is the coordinator now wired into production; if yes, describe the retired-incarnation replay and say what a user sees. Envelope-vs-record scope verification (`model.ts:44-46`) — done by the coordinator?
6. Transaction rows + token-balance rows: identity triple invariant; tampering to show fake balances/confirmations; refresh logic trusting node data (DROPPED debounce) — user-visible integrity impact.
7. Token registry: seeded default tokens are "TOFU-pinned" — pin what? Can a first-run on a hostile network (or a tampered seed row) pin an untrusted party token as the default \"USDC\"/fee token; token rename by user vs metadata refresh from chain (overwrite?); `deleteToken` cascade.
8. Contacts: name/address rendering, lookalike names vs stored addresses, import size/shape caps, any contact field reaching a URL or log.
9. `jsonSanitize`/`jsonStringify` (zero direct tests): hostile objects (getters that throw, cyclic, huge, BigInt, Proxy) reaching storage or the wire — crash, quota exhaustion, or silent field drop that removes a security-relevant field.

Write your report to `audit/security/2026-09-13-high-prerelease/raw/c11-storage-journal-activity-claude.md`.
