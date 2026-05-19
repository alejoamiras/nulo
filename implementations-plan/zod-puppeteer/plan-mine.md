# Zod 4 + Puppeteer 25 — plan (mine)

Follow-up to `implementations-plan/dependency-hardening/plan.md` (PR #95) and `implementations-plan/vitest-vite-bumps/plan.md` (PR #97), both merged into `dev`. Both bumps were deferred from PR #95 with specific reasons — those reasons are still live, and this plan addresses each.

## 1. TL;DR

- **Zod 4**: the blocker isn't 55 typecheck errors — it's that `@aztec/foundation/schemas` exposes Zod 3 typed APIs (`ZodFor<T> = ZodType<T, any, any>`, `ZodEffects`, `ParseInput`, etc.) that **don't unify** with Zod 4's `SomeType` constraint. Strategy: build a small `aztec-zod4-schemas.ts` (~50 LOC, ~6 schemas) that wraps `AztecAddress`, `Fr`, `EventSelector`, etc. as native Zod 4 schemas. Consumers swap from `AztecAddress.schema` to our wrappers. Risk: wire-format drift if a default/coercion shifts — mitigated by network e2e (advisory baseline 46/66 but new failures = signal).
- **Puppeteer 25**: clean bump on the breaking-change axis (Node 22 min ✓, TS 5.0.1 min ✓, ESM-only — we already use ESM imports ✓, `executablePath`/`defaultArgs` Promise return — we don't call those). Real blocker is the 7-day age gate: ALL 25.x is currently inside the window. Options: temp-exclude in `bunfig.toml` (CVE-runbook pattern, but for a non-CVE bump) OR wait ~26h for 25.0.0 to age.
- Both ship as **one PR, stacked commits**. Each commit keeps the tree green.

## 2. Goals + non-goals

**Goals**
1. Bump `zod` from `^3.23.8` → `^4.4.3` across `extension`, `aztec-runtime`, `extension-messaging`.
2. Bump `puppeteer` from `^24.43.0` → `^25.0.x` (whichever passes the gate at install time).
3. Preserve wire-format: no service response shape changes; RPC stays compatible.
4. Keep 1648 unit tests + 61 smoke e2e green.

**Non-goals**
- Aztec updates (they stay on Zod 3 internally; we handle the interop).
- Removing `extension-messaging`'s zod peerDep dual range yet — keep `^3.23.8 || ^4.0.0` until external consumers are confirmed migrated (none today, but the dual range is defensive).
- Renovate (still user-deferred).
- Any other dep bumps.
- Removing the existing `server.deps.inline: [/@aztec/]` workaround in `vite.config.ts`.

## 3. Recon (verified)

### Today's data
- **2026-05-18 ~12:30 UTC**. 7-day gate boundary: 2026-05-11 ~12:30 UTC.

### Puppeteer 25.x publish ages
- 25.0.0: 5d 20h ago (blocked, ~28h from passing)
- 25.0.1: 4d 23h (blocked)
- 25.0.2: 3d 0h (blocked)
- 25.0.3: ~5h (blocked)
- 25.0.4: ~30m (blocked)

### Zod 4.4.3 publish age
- 14 days ago — passes gate easily.

### Zod 4 typecheck errors (empirical, from throwaway recon branch)
- **55 errors across 6 unique files** (10 reports because errors surface from both extension and aztec-runtime typecheck contexts via cross-workspace path resolution).
- Per-file count: zod-helpers (2), pxe/client (4), pxe/schemas (5), pxe/service (7), authwit-discoverer (?), execution/service (?).

### Root cause
`@aztec/foundation/dest/schemas/types.d.ts` declares:
```ts
import type { ZodType } from 'zod';
export type ZodFor<T> = ZodType<T, any, any>;
```
That's Zod 3's 3-arg `ZodType<Output, Def, Input>`. Zod 4's `ZodType<Output, Input>` is 2-arg with a different internal marker (`_zod` vs Zod 3's `_def`). When our Zod 4 code calls `z.array(AztecAddress.schema)`, the type system rejects the Aztec schema as not assignable to `SomeType` (Zod 4's base class).

### Puppeteer 25 breaking changes
1. Node 22 min — CI is Node 24 ✓
2. TS 5.0.1 min — we're on TS 6 ✓
3. ESM-only — our tests already use ESM imports ✓
4. `executablePath()` + `defaultArgs()` now return Promises — we don't call either (verified via grep)

### Zod imports today
Direct imports:
- `extension-messaging/src/zod-helpers.ts` (wire-boundary helper)
- `extension/src/wallet/base/zod-helpers.test.ts` (tests the helper)
- `extension/src/wallet/services/wallet-sdk/content-script-validator.ts`
- `extension/src/wallet/services/operation-journal/spec.ts`
- `extension/src/wallet/services/network/spec.ts`
- `extension/src/wallet/services/execution/{authwit-discoverer,service}.ts`
- `aztec-runtime/src/pxe/{client,schemas,service}.ts`

Helper imports (`@nulo/extension-messaging/zod`):
- `extension/src/wallet/services/{operation-journal,network}/{client,service}.ts`

### UX copy
Zod failures only surface as developer logs (`ValidationError` thrown, `details: parsed.error.issues` in `validateContentScriptMessage`). No user-facing toasts. **No copy work needed.**

## 4. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| RPC wire-format silently drifts under Zod 4 | High | Network e2e is the canary (advisory due to 46/66 baseline; new failures = real signal). Audit each schema for default/coercion changes. |
| Mixed Zod runtime instances (Aztec v3, ours v4) | High | **Rebuild** Aztec class schemas in our own Zod 4 — don't pass Aztec `.schema` into our `z.*`. Runtime instance markers (`_zod` vs `_def`) won't get crossed. |
| Aztec's `inTxSchema()`/`BlockNumberSchema` exports | Medium | Rebuild those too — they're imported in `pxe/schemas.ts`. |
| Puppeteer 25 age gate | Medium | Temp-exclude in bunfig (documented CVE-runbook pattern) OR wait 26h. User decision. |
| Puppeteer 25 ESM-only with crxjs/vite/vitest pipeline | Low | All ESM-first today (vitest 4 + vite 8 Rolldown). Verify build canary still works. |
| Test-mock pattern drift (Vitest 4 fragility) | Low | We just landed vitest 4 in PR #97 — schemas don't change vitest-side behavior. |
| 1Password agent flaky (history) | Operational | Use `--no-gpg-sign` per existing user authorization. Re-sign as a sweep after. |

## 5. Phased plan

Single PR, stacked commits. Each commit keeps typecheck + units green.

### Commit 1 — `chore(deps): zod 3 → 4 (full migration)`

Single atomic commit covering:
1. **Add `aztec-runtime/src/pxe/aztec-zod4-schemas.ts`** (new file, ~50 LOC):
   ```ts
   import { z } from "zod"
   import { AztecAddress } from "@aztec/stdlib/aztec-address"
   import { Fr } from "@aztec/foundation/curves/bn254"
   import { EventSelector } from "@aztec/stdlib/abi"
   import { TxHash } from "@aztec/stdlib/tx"
   // ...

   export const aztecAddressSchema = z
     .string()
     .transform((s) => AztecAddress.fromString(s))
     .pipe(z.instanceof(AztecAddress))

   export const frSchema = z
     .string()
     .transform((s) => Fr.fromString(s))
     .pipe(z.instanceof(Fr))

   // Same pattern for: eventSelectorSchema, txHashSchema, noteSchema,
   // blockNumberSchema (the brand type from foundation).
   ```
2. **Bump manifest**: `zod ^3.23.8 → ^4.4.3` in `extension`, `aztec-runtime`, `extension-messaging` (peer + dev).
3. **Fix `zod-helpers.ts`** (2 errors):
   ```ts
   // Was: path: readonly (string | number)[]
   // Now: path: readonly PropertyKey[]  (string | number | symbol)
   function formatPath(path: readonly PropertyKey[]): string {
     return path.length === 0 ? "<root>" : path.map(String).join(".")
   }
   ```
   `validateParams`/`validateResult` work without further changes (the `ZodType<T>` import generic still has 1-2 params compatible with Zod 4).
4. **Refactor `pxe/schemas.ts`** (5 errors): swap `AztecAddress.schema` → `aztecAddressSchema` etc. Replace `inTxSchema()` usage with our equivalent or cast at boundary.
5. **Refactor `pxe/client.ts`, `pxe/service.ts`** (4 + 7 errors): same swap.
6. **Refactor `execution/authwit-discoverer.ts`, `execution/service.ts`** (~10 errors expected): same swap.

**Validation**:
- `bun ci` → succeeds
- `bun run typecheck:all` → 0 errors
- `bun run test` → 1648 pass
- `bun run lint` → green
- `bun run build` → green
- `bun run test:e2e` (smoke) → 61 pass / 6 skipped
- `bun run e2e:agent` (network) → advisory; compare failures to known 46/66 baseline. NEW failures = stop & investigate.

### Commit 2 — `chore(deps): puppeteer 24 → 25`

Depends on user choice for age gate (Q1 below).

**Option A (recommended)**: temp-exclude in bunfig.toml for this commit, follow-up commit removes the exclude after 25.0.0 ages out.
- Edit `bunfig.toml` to add `"puppeteer"` to `minimumReleaseAgeExcludes`.
- Bump `puppeteer ^24.43.0 → ^25.0.0` in `packages/extension/package.json`.
- `bun install` resolves the latest 25.x.
- Smoke e2e validates.

**Option B**: wait ~26h, then `bun install` resolves cleanly. No bunfig change.

**Validation**:
- `bun ci`
- `bun run typecheck:all` (puppeteer types are major-bumped; verify no test-helper drift)
- `bun run test:e2e` (smoke; the canary) → 61 pass / 6 skipped
- `bun run e2e:agent` (network, advisory)
- Manual: open extension via puppeteer in dev mode if any issue surfaces

### Commit 3 (optional) — `chore(security): remove puppeteer gate exclude`

Only if Commit 2 used Option A. After 25.0.0 ages past 7d (~2026-05-19 16:08 UTC), remove `"puppeteer"` from `minimumReleaseAgeExcludes`. Can be part of this PR or a follow-up.

## 6. Test gating per phase

| Phase | typecheck:all | test:all | lint | build | smoke e2e | network e2e (adv.) |
|---|---|---|---|---|---|---|
| Commit 1 (zod 4) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (canary for wire-format) |
| Commit 2 (puppeteer 25) | ✓ | – | – | – | ✓ | ✓ |
| Commit 3 (remove exclude) | – | – | – | – | – | – |

## 7. UX copy

None. Zod errors are dev-only (logs + `ValidationError` objects). Puppeteer is e2e tooling, no UX surface.

## 8. Open questions for user

1. **Aztec interop strategy for Zod 4** — rebuild ~6 schemas (Strategy 2, recommended) or cast-only (Strategy 1)?
2. **Puppeteer age gate** — temp-exclude (ship today) or wait 26h (clean)?
3. **`extension-messaging` peerDep range** — keep `^3.23.8 || ^4.0.0` (defensive) or tighten to `^4.4.3` (cleaner)? Recommend keep dual.
4. **Single PR with 3 commits** or 2 PRs (Zod, Puppeteer)? Recommend single — both bumps are quick and reviewing them together is fine.
5. **Network e2e baseline 46/66** — if we see 47 failures (one new), block on it? Recommend yes — wire-format drift is exactly what we're guarding against.

## 9. PR map

Single PR, 2-3 commits:
1. `chore(deps): zod 3 → 4 (full migration)` — schemas wrapper file, manifest bump, all consumer fixes
2. `chore(deps): puppeteer 24 → 25` (+ temp gate exclude if Option A)
3. `chore(security): remove puppeteer gate exclude` (only if Option A — can be follow-up)

Total: 2-3 commits, 1 PR.

## 10. Things I'd watch for in CI

- Network e2e may surface new failures that are wire-format drift, not infra flakes. Compare to the 18 known-bad list in `implementations-plan/network-test-triage/plan.md`.
- `bun audit` advisory may surface advisories on the new zod/puppeteer transitive deps. Re-baseline if it does.
- Build size may shift (Zod 4 has different bundle profile). Compare `dist/chrome/` listings.
