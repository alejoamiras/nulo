# Phase 1 — Q16: remove dead symbol-level surface

Branch `refactor/q16-dead-symbols` off `dev` (7a3b373).

## Re-verified vs current dev (the stale-snapshot lesson)
Grepped every symbol's call-sites (incl. tests) before deleting:
- `lazy-listener.ts` / `subscribe-with-snapshot.ts`: 0 importers (the "subscribeWithSnapshot" hits were comments + an unrelated local test helper). Deleted both + their colocated tests.
- `getRandomElement`, `dequeueBatch`: 0 call-sites anywhere (not even tests) — fully dead.
- `getVersion`/`setVersion`/`findByPredicate`: only `entity_storage.test.ts` exercised them (test-only) — removed the methods + the 3 test blocks.
- `@aztec/stdlib`: declared in `wallet-crypto/package.json`, never imported — removed; `bun install` synced `bun.lock`.
- `ENCRYPTION_GUARD`: the **index re-export** is dead (canary test + internal use both go via the relative `./password-secret-box` path) — removed only the re-export, kept the symbol.
- Kept `PARSE_FAILURE_PREVIEW_MAX` (still used by the get/getAll malformed-row path) and the `Queue` class (only `dequeueBatch` was dead).
- Reworded one operation-journal comment that named the now-deleted `subscribeWithSnapshot` module.

## Gate result
| Check | Exit | Result |
|---|---|---|
| typecheck (wallet-core, wallet-crypto, extension-messaging) | 0 each | clean |
| lint (repo) | 0 | no new errors |
| test (wallet-core / wallet-crypto / extension-messaging) | 0 each | green (canary test intact; removed-method tests gone) |
| bun.lock | synced | `@aztec/stdlib` dropped (frozen-lockfile-safe) |

Network-e2e: NOT gated (dead-code in `private` pkgs). Auto-merge on Quality green.

LESSONS_FILE=implementations-plan/quality-dedup-quick-wins/lessons/phase-1.md
