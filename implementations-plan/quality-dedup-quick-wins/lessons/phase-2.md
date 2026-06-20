# Phase 2 — Q22: share the Error-to-JSON projection

Branch `refactor/q22-error-json` off `dev` (5472733, post-Q16).

## Re-verified vs current dev (stale-snapshot guard)
- `serialization.ts` ↔ `jobs/error.ts` still **independent** (no cross-import) — extraction is greenfield, not untangling a cycle.
- Plan's line refs were stale: the load-bearing never-throw fallback is now `jobs/error.ts:48` (outer-catch envelope), not `:37` (that's the function signature). Substance unchanged.
- The genuine overlap is small + the rest is **deliberately divergent**:
  - shared: `Error → { name, message, stack? }` (the non-enumerable trio JSON.stringify drops).
  - `serialization.ts` extras: plain bigint (`"123"`), `WalletError` `code`/`details`. Vendored from `@aztec/foundation/json-rpc`.
  - `jobs/error.ts` extras: `__error: true` discriminant, `"123n"` bigint suffix, truncation, never-throw fallback.

## What shipped
- New `utils/error-json.ts#baseErrorJson(err)` owns ONLY the shared projection (`stack` omitted when absent → wire-identical for both callers).
- `serialization.ts`: one-line import + `{ ...baseErrorJson(err), ...code, ...details }` (vendored file kept minimal).
- `jobs/error.ts`: `jsonReplacer` Error branch → `{ __error: true, ...baseErrorJson(value) }`; bigint suffix + never-throw untouched.
- New `utils/error-json.test.ts` (5 cases: projection, subclass name, stack-omit, no code/__error leak, empty message).

## Pin-before-refactor (D7/D13) — added BEFORE the extraction, proven green on un-refactored code
- `jobs/error.test.ts`: `__error:true` envelope pin; `"123n"` bigint-suffix pin (`{"value":"123n"}`); tightened the never-throw test to assert the **exact** outer-catch envelope `{ kind, message: "<unrenderable error>", normalizedRaw: null }` (was loose "didn't throw").

## Gate result (local)
| Check | Exit | Result |
|---|---|---|
| wallet-core typecheck | 0 | clean |
| wallet-core test | 0 | 11 files / 93 tests (incl. error-json ×5, error pins ×7) |
| extension `serialization.test.ts` (wire-pins) | 0 | 11/11 — Error shaping byte-identical |
| lint (repo) | 0 | Q22 files clean (53 pre-existing warnings unrelated) |

Network-e2e: **GATED** (wire-format on the RPC path). Local gate green → push → label `e2e:network` → confirm Quality green AND network shards ran+green before merge.

LESSONS_FILE=implementations-plan/quality-dedup-quick-wins/lessons/phase-2.md
