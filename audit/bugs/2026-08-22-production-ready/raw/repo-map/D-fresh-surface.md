# Map D — Fresh-surface diff since ~2026-08-08

> Mapper (explore agent), 2026-08-22. NOTE: agent's returned output began mid-map (head truncated in transit — the KDF-v2/passkey/import-export sections were covered by Map B instead; this file holds the tail: fee refactor, TODO inventory, half-migrations, cross-subsystem interactions).

## Fee-strategies refactor (#415)

- `execution/fee-strategies/` (new): pure typed dispatch map `Map<FeeSettings["paymentMethod"]["kind"], FeeStrategy>` — keys deliberately literal (`fj`/`fjwc`/`fpc`/`embedded`), never derived from `strategy.kind`; composition pin asserts kind/slot agreement.
- `wallet-sdk/tab-lifecycle.ts` (78 ln, new): wireTabLifecycle(deps) extracts the two chrome.tabs listeners binding dApp session life to tab close/navigation; documents that the onUpdated URL guard is MOSTLY DEAD (permission-gated; only explicit host_permissions destinations fire it) and why that's acceptable (realm teardown is the real boundary, not session-id secrecy); malformed-URL catch terminates the tab's sessions fail-closed. ExecutionService.init() keeps FeeStrategyDeps construction at the root; pins in strategies-structural.test.ts + service.composition.test.ts.

## TODO/FIXME inventory (recent surfaces)

Only two, both pre-existing, both in `wallet-sdk/background.ts`: line 281 `TODO(queued-visibility-for-batch)` (batched sendTx legs) and line 345 `TODO: Remove this monkey-patch if wallet-sdk adds a proper serialization API`. None in wallet-crypto, profile/account services, usePopupEntity, useFullBackupImport, or new pages. KDF arcs left open items as documented accepted-limitations — notably exportBackupMaterial's KNOWN LIMITATION block (service.ts:1618-1634): backups grant FORWARD reach via long-lived profile DEK; closing it means per-backup transfer keys + export-time coordination ("follow-up arc, not a patch here").

## Half-migrations / coexisting paths / gated behavior

1. **confirmProfileOperation survivor** — service.ts:1472-1474 says Path-B SW-window flow "is gone for this entry point" yet RPC remains live with exactly ONE production caller left (ConfirmPopup.vue:52). Candidate for retirement; its passkey branch still routes through recovery coordinator.
2. **PATH A/B dual-path plumbing preserved** in createPasskeyProfile/unlockPasskeyProfile: PATH B has NO production callers but deliberately kept for future dApp-triggered flows.
3. **Deprecated-but-present schema fields**: Session.passhash (spec.ts:109-112) written only by pre-F-11 code, never accepted by restore() (silentClose + one-time re-unlock); Session.lockedAt optional with read-time derivation from since+ttl.
4. **MAC v1→v2**: master-keyed 3-slot MAC retired; rows predating v2 lack envelopeMac; verification treats them via degradation state machine rather than blocking — soft old/new coexistence resolved on next password change (self-heal).
5. **Account export/import UX**: fully migrated popups→pages in #433 within days of #419 creating them — clean, no stragglers (zero references to AccountExportPopup/AccountImportPopup; no dangling export/key.vue links).
6. **Version/config gates observed** (not half-migrations): E2E_PROVERLESS statically-false constant gating three gate classes with prod negative-grep enforcement (runtime.ts:217,234,287); VITE_NULO_ALLOW_IFRAME_DAPPS build flag mirrored in relay; VITE_NULO_ACCELERATOR_REQUIRED unchanged; regime binding compile-time-only — no runtime KDF/regime selection anywhere.
7. **Duplication checks**: account-seed formula has exactly one implementation (doc warns stale-duplicate-in-coordinator is THE regression to watch; e2e canary keeps independent recompute BY DESIGN). Enter-guard predicate collapsed from five hand copies into usePopupEntity. Fee-engine unification (#381) merged two composables.

## Cross-subsystem interaction summary

- **Session manager**: DEK copy-in/copy-out contract, bearer wraps master‖dek, degraded sessions persist no bearer, proactive TTL alarm actually wired since composition root passes browserApi (runtime.ts:242-247).
- **Backup service**: epoch-4 shape requires entropy + importedKeysDek (password) / dekSealed (passkey); restore = checksum → compat → version → pairing-check → duplicate guard → marker-before-row with compensation → fresh destination DEK → rewrap context; backup slices for imported keys ride ImportedKeysRepository.backup.
- **Journal**: token ops created inside persistToken under lock; cold-wake relay avoids double-journaling sendTx via single-listener ownership; journal boot cutoff anchored before services.start() (runtime.ts:304).
- **PXE/deletion fencing**: every new profile row mints pxeGeneration (spec.ts:96-99), including same-id re-imports; pxe-store-key provider re-reads generation after slow HKDF (runtime.ts:256-271).
- **Address freeze**: account-export files embed all four regime digests + kdfDigest; freeze record's ack string forces intent into any digest-touching diff.
