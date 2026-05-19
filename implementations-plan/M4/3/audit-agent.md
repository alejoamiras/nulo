# M4.3 — Plan agent audit

Date: 2026-04-26

**BLOCKING**
- M4.7 dependency claim wrong — clarify M4.3 owns no persisted state (M4.7 NOT a hard prereq). Risk #3 fixture must be **build-time JSON file** in repo, not chrome.storage, to confirm ordering.

**SHOULD-FIX**
- Defense-in-depth on "known" branch is wrong: `known.artifacts.get(classId.toString())` lookup at line 197 IS a class-id match by definition (load-time `loadProductionKnownArtifacts` keys by computed class id). Recomputing is hash twice. **Drop recompute on "known" branch.**
- Performance: commit up-front to `Set<string>` of verified class-id strings cache. Don't "decide at execution time."
- Test #6 (schema-invalid smoke) tests upstream library. Drop or rephrase as "pin existing behavior."
- Test #1 — explicit assertion that URL was `/api/artifacts/${classId-B}` while payload computes to class-A. Otherwise reads as generic mismatch.
- Missing scenario: `pxeOnly: true` + mismatched pxe-local test.
- ExecutionService checks at `:557, 1100` — defense-in-depth survives **only on dApp-provided-artifact path** (`:551, :1091`), NOT registry path. Plan should say so.

**NIT**
- Import path: `@aztec/stdlib/contract` (verified at `execution/service.ts:24`, `known-artifacts.ts:15`). Drop "verify exact import path" caveat.
- Build-time allowlist deferral right call.
