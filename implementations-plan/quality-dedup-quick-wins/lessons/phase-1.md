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

## PR #105 result — required gate green, advisory network red = known flakiness
- `Quality / Status` = SUCCESS (Commitlint, Lint+Typecheck, Unit, Build chrome/firefox/faucet, smoke Vitest+Puppeteer all green).
- `Network e2e / Status` = FAILURE (advisory on dev). 2/5 shards red:
  - shard 1/5: `authwit-lifecycle.test.ts:136` — `expected 'ok' to be 'error'` (post-revoke state-propagation race).
  - shard 5/5: `multi-account-from.test.ts:49` — "sendTx … reaches active stage" (proving-progress race).
- **Confirmed pre-existing flakiness, NOT a Q16 regression:**
  - `authwit-lifecycle` is under active de-flaking — `#97` (200dd3f) just landed; my base 7a3b373 already contains it, yet it still flaked → de-flake incomplete, test still flaky.
  - Recent network-e2e failed on unrelated branches too (`fix/measure-f1-authwits`, `fix/network-e2e-gate-plumbing`) — systemic.
  - Q16 removed only provably-dead code (zero call-sites) in private pkgs not exercised by these network tests; removing an unused dep / dead re-export cannot alter the bundle. Build green confirms.
- Decision: merged on Quality green per the approved auto-merge rule (network advisory for Q16).

LESSONS_FILE=implementations-plan/quality-dedup-quick-wins/lessons/phase-1.md
