# Audit transcript — Claude `Plan` subagent (fable substitute; Fable 5 unavailable)

**Verdict:** `reject (blocking: Q21 + Q19 + Q14 scoped against a stale tree — instance lists wrong, carve-outs materially incomplete; re-scope before any merge)`

## Blocking findings
1. **Q21 mostly moot.** PR #91 (`e9c51dd`, merged *after* the 2026-06-11 audit) moved every checker body to `method-scope-checkers.ts` + derived `METHOD_SCOPE_CHECKER` from `method-descriptors.ts`. `scope-enforcement.ts` (106 lines) now holds only `enforceScope`/`enforceScopeWithSession`/`validateAccountScopes`. The audit's cited lines are gone; the "byte-identical" claim is also wrong on substance (`checkGetAccounts` filters accounts/`canGet`; `checkGetAddressBook`/`checkRegisterSender` filter data/`addressBook` — different cap, field, label). Several checkers already parameterized by `methodName`. Q21 ≈ done by #91.
2. **Q19 carve-outs materially incomplete (authz risk).** Of 87 (now 90) `getActiveProfile()` non-test sites, ~37 do NOT throw (`profile/client.ts`, `execution-lane.ts`, `incoming-transfer/service.ts` ×6, `token-balance`, `transaction`, `network`, `dapp-interaction`, …). A mechanical thrower-sweep must distinguish ~50 throwers from ~37 deliberate non-throwers; the plan named 2. Counts off; **2** `"Unauthorized"` not 1.
3. **Q14 list incomplete.** 14 files have `restoreError` loops, not 10 — omits `profile/service.ts` (2 loops), `account-state` has 2 sites, plus non-service `useFullBackupImport.ts`/`full-backup-helpers.ts`; unnamed carve-out at `fpc/service.ts:485` (hardcoded `restoreError`, not err-derived).
4. **Q20 overstated.** Bridge already owns the CAIP types (extension imports them via `dapp-interaction/spec` re-export); only runtime fns dup. The "fix Used by: dispatcher header" instruction targets text that doesn't exist.

## Process findings
5. Network-e2e per arc wasteful for Q16/Q20/Q7 (no RPC path); recommend network-e2e gate only on RPC/auth arcs.
6. Auto-merge "re-run once then surface" can still merge over a real regression that flakes-green; for auth arcs require 2 consecutive greens / human sign-off.

## Looks fine
Q22 (constraints accurate; serialization.ts ≠ jobs/error.ts, no cross-import; share Error-shaping subset only), Q16 (per-symbol grep gating sound), Q7 (drift real, riskiest config arc). Per-arc sequencing better than package-batched once network-e2e is selective.

---
**Resolution:** both audits converged → batch re-scoped to Q16/Q20/Q22/Q7/Q14 (5 arcs); **Q21 dropped** (mooted by #91), **Q19 demoted** to its own plan (90 sites + ~37 non-throw carve-outs = not a quick win). See plan.md Decision ledger.
