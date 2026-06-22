# C5 Round-2 push-back — Claude side self-critique

## Missed (source-verified)

- **`account/nulo-account.ts` was never audited** despite being in scope (`packages/aztec-runtime/src/**`). Neither Claude report mentions it, even in non-findings. Concrete miss inside it: the init-nullifier probe (`computeSiloedPrivateInitializationNullifier` + `getNullifierMembershipWitness("latest", ...)`) is duplicated at `nulo-account.ts:129-131` and `:144-146`, synced only by the doc comment "Reuses the same init-nullifier check" (`:139-142`) — the exact sync-by-comment pattern Claude F8 flagged elsewhere. Small/local, but the asymmetric coverage is the real finding.
- Same blind spot for `utils/chain-identity.ts`, `offscreen/entry.ts`, `ports/` — zero mentions, not even rejections. Coverage tracked the map's focus list, not the scope list.

## Over-asserted

- **Claude-1's `walletErrorFromPayload` non-finding cites phantom consumers.** `popup/utils/cancellable-rejection.ts:19` and `wallet-core/src/jobs/fsm.ts:89` are doc comments, not imports (grep-verified). The real production consumer is `extension-messaging/src/background/client.ts:7,112`. Conclusion (not tests-only) correct; evidence wrong. Codex's rebuttal caught this; the Claude rebuttal did not self-correct.
- **Claude-1 F1's "14 shim-path vs 14 direct-path" split is inflated.** The 14 direct importers of `@nulo/aztec-runtime/pxe` include the shim itself plus 4 test files — production direct importers are 9. The rebuttal silently drifted to "~10" without flagging the correction. Directionally fine, numerically sloppy.
- **Claude-2's counts are wrong twice:** `Methods` has 21 entries, not "~19" (enumerated, `spec.ts:24-81` — `getPrivateEvents<_T>` and `getNoteSchemas` evade naive grep); `IPXE`/`PXEProxy` have 18 methods, not 17 (`ipxe.ts:27-50` verified). Claude-1's 21/18 are correct; the rebuttal flagged codex's "19" while soft-pedaling Claude-2's identical error.
- **F4 instance lists exceed cluster scope** (`operation-journal/client.ts`, `profile/client.test.ts` are outside C5 per `clusters.md`). Repo-wide grep is required to prove dead code, but promoting out-of-scope files to "Instances" double-books them against C2's cluster. Codex's objection stands.

## Anchoring

- Claude F1/F2/F3/F4/F9 map one-to-one onto `clusters.md`'s focus line ("5-surface enumeration, bg-vs-offscreen duplication, divergent error surfaces, dead subpaths, dead exports, NetworkInfo"). Genuinely independent finds exist (F6 composite keys, F7 intra-file dup, `DEFAULT_REQUEST_TIMEOUT_MS` collision, Claude-2's `clear()` lying doc), but the architectural-bucket assignments and effort allocation followed the map. The unaudited `account/`+`utils/`+`ports/` files are precisely the ones the focus list omitted — anchoring shaped coverage, not just emphasis.
- Verified intact: gate-split claim (root `test` = `--cwd packages/extension`; `test:all` separate) and all F9 dead-export greps reproduce.
