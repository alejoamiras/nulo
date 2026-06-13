# C5 Round-1 rebuttal — Claude side, vs c5-codex-1 + c5-codex-2

All contested claims re-verified against source.

## (c) Confirmed codex findings

- **C1-F1 / C2-F1 (five-surface PXE contract, Shotgun Surgery)** — confirmed. Drift evidence accurate: `getNoteSchemas`, `getBlockTimestamp`, `clearChainState` present in `spec.ts:41,74,80` / `service.ts:203,383,409` / `client.ts:90` but absent from `ipxe.ts:27-50` (18 methods) and `proxy.ts:32-102` (18 delegations, verified by enumeration). C1's "16 in-repo IPXE consumers" is exactly right (16 non-test files). Matches claude F1.
- **C1-F2 / C2-F2 (forked transport stacks, divergent error contracts)** — confirmed, including the offscreen telemetry sidecar cites (`offscreen/client.ts:22-27`, `recordTerminal` ~258-279) and string-vs-`WalletError` rejection split. C1's "43 production background consumers" ≈ 42 non-test importers of `@nulo/extension-messaging/background` — accurate. Matches claude F2/F3.
- **C1-F3 / C2-F3 (dead `/lazy-listener` + `/subscribe-with-snapshot` subpaths)** — confirmed; matches claude F4. Codex correctly pre-empted the auto-import caveat. Codex's "delete both" remedy is weaker than claude's: the snapshot-race pattern has two live hand re-implementations (`operation-journal/client.ts:87-126`, `profile/client.test.ts:38`), so adoption beats deletion for one of the two.
- **C1-F4 / C2-F4 (test-location inversion)** — confirmed; matches claude F5. C2 also caught the duplicated `errors.test.ts` round-trip overlap. C1 missed the two aztec-runtime test files (`chain-runtime.test.ts`, `artifact-registry.test.ts`) that C2 also missed — claude's instance count is the complete one.
- **C1-F5 / C2-F5 (PxeService Large Class)** — confirmed as a framing of the same evidence claude filed as intra-file duplication (deleteDatabase ×3+1, SYNC-DEBUG ×2, withPxeRead/Write twins).

## (b) Overconfident / wrong / DO-NOT-FLAG

- **DO-NOT-FLAG overreach in F1's remedy (both instances).** The prompt excludes the `spec.ts`/`service.ts`/`client.ts` triple itself. C1 prescribes "generate/shared-forward `PxeServiceClientBase`... from that descriptor"; C2 says "client, service, and proxy derive from that contract". Both target the sanctioned triple, not just the unsanctioned extra surfaces (`ipxe.ts`, `proxy.ts`). The drift evidence is legitimate; the refactoring scope is not. Claude F1 scoped this correctly (derive `IPXE`, generate the proxy, leave the triple).
- **C2-F5 count error (minor):** "the 19 RPC handlers" — `Methods` has 21 entries (enumerated from `spec.ts:24-81`); claude-2 made the same error, claude-1's 21 is correct.
- **C2 non-finding on `isAllowedRpcUrl` is right but rebuts a strawman:** the function IS live (`aztec-node-factory-adapter.ts:51`), so "dead code" is correctly rejected — but claude-1 F9 never claimed the function was dead, only that the `export` keyword is speculative (zero external refs; not re-exported by `adapters/index.ts` — verified, the barrel exports only `AztecNodeFactoryAdapter`). Both true; the precise statement is "live function, speculative export".

## Repo-map error check (per c5-claude-1's refutations)

**Codex did NOT repeat either error.** C1 explicitly rejected "loadProductionNoteSchemas dead" as a non-finding, citing the live caller `service.ts:203-209` (verified: `getNoteSchemas` calls it at :204). Neither codex instance repeated the "walletErrorFromPayload tests-only" claim. Credit where due.

## (a) Missed by codex (both instances, all source-verified)

1. **`${profileId}:${chainId}` + `pxe/<profile>/<chain>` stringly-typed key schemes** (claude F6/F7) — duplicated key builders (`service.ts:102-104` vs `chain-runtime.ts:188-190`), prefix-scan deletions (`service.ts:478-481`, `:488`; `chain-runtime.ts:265-277`), writer/deleter coupled only by matching literals. Highest-value miss: silent-mismatch failure mode on the profile-purge path.
2. **`DEFAULT_REQUEST_TIMEOUT_MS` exported twice with different values** — 60_000 (`utils/fetch.ts:18`) vs 90_000 (`offscreen/client.ts:20`). Verified; wrong-import trap, absent from codex.
3. **Lazy-init-retry-reset idiom ×3, synced by comment** (claude F8/F6) — `artifact-registry.ts:99-112`, `note-schemas.ts:64-94`, `chain-runtime.ts:214-229`.
4. **`ArtifactRegistry.clear()`'s lying doc** — doc claims "called during onProfileDeleted" while `service.ts:483-486` documents the deliberate decision not to (verified). C1 waved peek/clear off as "documented seams" without noticing the doc is wrong.
5. **`_resetNoteSchemasForTests` with zero callers including tests**, and the half-migrated shim (14 shim-path vs ~10 direct-path imports) — codex cites the shim but not the dual-import-path cost.

## (d) Contradictions

- Codex-1 vs codex-2: none material; non-findings align.
- Codex vs claude: `NetworkInfo`/`OFFSCREEN_KEEPALIVE` downgraded to non-findings by codex vs standalone evidence in claude F9 — defensible severity disagreement, not a factual one; the keepalive literal duplication itself is undisputed (verified `offscreen.ts:4` dead export vs `offscreen/service.ts:13` live private copy).
