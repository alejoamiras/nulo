# Zod 4 + Puppeteer 25 — consolidated plan

Consolidated from two parallel drafts (`plan-mine.md` + `plan-opus.md`) and a recon spike on `deps/zod-puppeteer-recon` (since deleted). Both bumps were deferred from PR #95 with documented reasons that this plan addresses directly.

## 0z. SPIKE OUTCOME — Zod 4 IS DEFERRED (Aztec runtime needs migration)

**Status (2026-05-18)**: ran Option B spike on `deps/zod4-pup25`. Confirmed at runtime:

The override works for resolution — `bun pm why zod` shows a single `zod@4.4.3` and `node_modules/.bun/` has only the one copy. Type-bridge with `az<T>(s): ZodType<T>` brings all 75 typecheck errors to 0. Build succeeds (verified).

**But module-load fails** the moment any test imports a code path that pulls in `@aztec/foundation/schemas/utils.js`:

```
SyntaxError: The requested module 'zod' does not provide an export named 'OK'
 ❯ src/wallet/utils/auth-registry.ts:1
```

The Aztec foundation runtime does:
```js
import { OK, ZodFirstPartyTypeKind, ZodOptional, ZodParsedType, z } from 'zod';
```

All four of `OK`, `ZodFirstPartyTypeKind`, `ZodParsedType` are Zod 3 internal exports. Zod 4 ships them on `zod/v3` but NOT on the main `zod` entry. Without per-package zod aliasing (which bun doesn't expose), there's no way to give Aztec a v3-compatible main entry while we use v4.

**34 of 141 test suites failed to load.** The same failure would hit production at module-import time.

### Decision

**Zod 4 deferred until either (a) Aztec ships Zod 4-typed schemas upstream OR (b) we restructure to never compose Aztec schemas into our Zod combinators** (the proper mixed-major pattern from `https://zod.dev/library-authors`, but a substantial refactor — ~20 site changes through `parseAsync(unknown)` plumbing rather than `z.array(...)` composition).

Codex's pre-implementation warning was 100% correct. The spike validated the pessimistic prediction.

This PR ships **Puppeteer 25 only**. Zod 4 reverted clean.

---

## 0a. Codex review verdict — Zod 4 strategy is RUNTIME-BROKEN

**Codex empirically reproduced** that the cast-helper strategy (recommended by Opus and adopted in this plan) is invalid:

> `z4.array(z3.string()).parse(["a"])` throws `TypeError: Cannot read properties of undefined (reading 'run')`.

Zod 4 object schemas eagerly reject children without the `_zod` internal marker (verified at `node_modules/.bun/zod@4.4.3/node_modules/zod/src/v4/core/schemas.ts:1838`). The cast doesn't just type-bridge; it builds a schema that throws on parse. The biggest miss: `pxe/schemas.ts` would blow up at **module-import time**, not parse time, because its top-level `z.object(...)` shapes contain Zod 3 children that fail the eager `_zod` check during schema construction.

Bun's symlinked install model is dependency-isolating per the bun docs — Aztec's `@aztec/foundation@4.2.0/package.json:168` declares `"zod": "^3.23.8"`, so Aztec gets its own Zod 3 install regardless of what we pin. The two zod copies cannot be unified by hoisting.

**This plan section (§3-A1) is invalidated.** Three real paths forward, each with its own trade-offs:

### Option A: Defer Zod 4 again
- Wait for Aztec to ship Zod 4-typed schemas in a future upstream release.
- **Cost**: status quo. Zod 3 keeps working today.
- **Risk**: open-ended wait (no public Aztec Zod 4 roadmap we've seen).

### Option B: Bun overrides to force single Zod 4 across tree
- Use `package.json#overrides` (bun supports `pnpm.overrides` and `overrides` field) to force `@aztec/foundation`'s transitive `zod` to resolve to `^4.4.3`.
- Aztec's compiled JS does `require("zod")` and gets v4. The Zod 4 package ships a `v3` subpath, but Aztec doesn't import it — its bundled `.schema` instances would be constructed by **v4's `z` callable**, which has different internal markers.
- **Risk**: Aztec's compiled code was *typed* against Zod 3 but its runtime API surface is `.string()`, `.transform()`, `.pipe()`, `.instanceof()` — all of these exist in Zod 4 with mostly-compatible semantics. **Likely works**, but unverified. A spike (try the override + run network e2e) is the only way to know.
- **Pros**: ~~most of plan §3 stays valid~~ — actually the cast helper STILL is wrong because Aztec's TypeScript types are v3-typed but the runtime objects would now be v4. Cast helper becomes type-only (no runtime risk because they're the same runtime instance), and the helper's purpose collapses to a one-line `as ZodType<T>` annotation.
- **Validation**: smoke + network e2e MUST pass to confirm Aztec's runtime behavior is preserved under the override. If anything in Aztec's compiled JS uses `instanceof ZodType` or accesses `._def`, it breaks.

### Option C: Zod's official mixed-major pattern
- Per [Zod's library-authors guide](https://zod.dev/library-authors), use explicit `zod/v3` + `zod/v4/core` imports with runtime `_zod` detection.
- We'd add explicit `import * as z3 from "zod/v3"` for Aztec-schema composition sites, and `import { z } from "zod"` for our own.
- At wire-boundary, parse each side independently and merge results post-parse (no cross-major composition into one `z.array`/`z.object`).
- **Cost**: more invasive — every site where we composed Zod 3 inputs into Zod 4 schemas needs restructuring.
- **Risk**: code complexity (two zod styles in the codebase), but correctness is well-defined.

### Recommendation

**Run Option B as a spike** first — it's one `overrides` line + reinstall + e2e validation, ~30 minutes. If it works, the migration becomes a type-only cast (Opus's plan but as a typing aid, not a runtime bridge). If it fails, fall back to **Option A (defer)** unless the user wants the Option C complexity.

**Puppeteer 25 path is unaffected.** Codex confirmed: wait ~24h for 25.0.0 to age past the 7d gate is correct. The only delta: import inventory missed `CDPSession` in `packages/extension/tests/e2e/fixtures/passkey.ts:1`. Doesn't change risk call.

---

## 0. Plan deltas vs my draft (key Opus corrections)

1. **Bridge strategy = cast helper, NOT rebuild.** My draft proposed rebuilding ~6 Aztec class schemas in our own Zod 4 syntax. Opus rejected this: Aztec's `.schema` exports are non-trivial effect chains (prime-field bounds on `Fr`, hex coercion + recursive shape on `Note`, etc.) and the affected surface is **~20 schemas**, not 6 — including `ContractArtifactSchema`, `TxExecutionRequest.schema`, `TxProvingResult.schema`, etc. A parallel validator surface would drift every Aztec release. **Single typed cast helper `az<T>(s): ZodType<T>` in `aztec-runtime/src/zod-bridge.ts` is the recommended shape.**
2. **Two PRs, not one stacked PR.** Different blast radii (Zod = RPC schema corruption risk; Puppeteer = test-infra recoverable). Distinct rollback signals.
3. **Wait 26h for Puppeteer 25.0.0 to age past the 7-day gate.** Carve-out is the CVE-runbook pattern; using it for a dev-tool bump twice in a month normalizes a behavior we just bought.
4. **Drop the `extension-messaging` peerDep dual range.** Verified empirically: current peer is `^3.23.8` only (the dual `||^4` range I thought PR #95 had set up was never shipped or was reverted). Tighten to `^4.4.3` exact-floor — we're the only consumer.
5. **Schema-affected sites are wider than my recon flagged**: Opus enumerated `AztecAddress`, `Fr`, `EventSelector`, `Note`, `TxHash`, `BlockNumberSchema`, `ContractArtifactSchema`, `ContractInstanceWithAddressSchema`, `AuthWitness.schema`, `TxExecutionRequest.schema`, `TxProvingResult.schema`, `TxProfileResult.schema`, `TxSimulationResult.schema`, `UtilityExecutionResult.schema`, `CompleteAddress.schema`, `BlockHeader.schema`, `SimulationOverrides.schema`, `AbiTypeSchema`, `PrivateEventFilterSchema`, `FunctionCall.schema`. The cast helper handles all of them; rebuild would not have been tractable.

---

## 1. Goals & non-goals

**Goals**
1. Land Zod 4 across the wire-boundary schema layer with no regression in the structured-error contract crossing the SW↔popup, content-script↔SW, and offscreen↔SW seams.
2. Land Puppeteer 25 across e2e fixtures (test-infra surface only).
3. Tighten `extension-messaging` zod peerDep from `^3.23.8` → `^4.4.3` (no external consumers — internal lockstep).
4. Cleanly bridge the `@aztec/foundation/schemas` Zod 3 constraint without forking Aztec.

**Non-goals**
- Aztec line bumps (Aztec stays on Zod 3 internally; we use a single cast helper at the boundary).
- Adding new Zod schemas (no spec changes; this is a structural migration).
- `bun audit` policy changes; bunfig age-gate tweaks (still 7d).
- Bun lockfile-text migration (Bun 1.3.x still has the frozen-lockfile bug).
- Puppeteer 25 feature adoption — type-and-runtime parity only.
- `z.intersection` / `z.nativeEnum` deprecation cleanups (Zod 4 still supports both; track as a separate follow-up).

---

## 2. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Wire corruption at the dApp RPC seam.** Zod 4 changes parser internals (`_zod` marker), `ZodIssue.path` widens to `PropertyKey[]`, `discriminatedUnion` semantics tightened. Mis-translation could silently coerce a value that should reject. | **High** | `zod-helpers.ts` behavior preserved byte-for-byte (same `safeParse → ValidationError` shape, same human-readable summary, same `details.issues` payload). New regression-pin test in `zod-helpers.test.ts`. |
| R2 | **Two zod instances at runtime** during transition (`instanceof` instability across instances). | **Med** | Audit done: zero `instanceof.*Zod` checks in our code. Bun dedupes when ranges allow; PR-1's peer-dep tightening ends the dual-range affordance so the resolver lands on a single major. |
| R3 | **`@aztec/foundation/schemas` returns Zod 3-typed schemas** (`ZodFor<T> = ZodType<T, any, any>`). Composing with Zod 4's `z.array(...)` fails the `SomeType` constraint. | **High** | Single typed cast helper `az<T>(s): ZodType<T>` in `aztec-runtime/src/zod-bridge.ts`. ~20 sites swap to `z.array(az<Fr>(Fr.schema))` shape. |
| R4 | **Peer-dep tightening breaks downstream consumers running Zod 3.** | **Low** | `@nulo/extension-messaging` has one consumer (`@nulo/extension`). No external consumers. Both move in lockstep in PR-1. |
| R5 | **`ZodIssue.path` widens to `PropertyKey[]`.** `zod-helpers.ts:24-31` declares `(string \| number)[]`. | **Low** | One-line widen + `String(p)` coerce. We don't produce symbol keys. |
| R6 | **Puppeteer 25 API drift** breaks 12 import sites. | **Low** | Stable exports across 24/25 per upstream notes. Typecheck is the canary. |
| R7 | **Puppeteer 25 launch/MV3 regression** (past majors shifted `headless` default + `--load-extension` semantics). | **Med** | Smoke catches popup-boot regression in <2 min. Network suite advisory (baseline 46/66 per `tests/e2e/README.md:109`). Manual unpacked-extension load as belt-and-suspenders. |
| R8 | **Age gate** on Puppeteer 25.x: all 25.x is <7d old today; 25.0.0 ages out ~2026-05-19 16:08 UTC (~26h). | **Low** | Wait. Lockfile is happy on 24.43.x; no forcing function. Carve-out available but not justified — see §4-B2. |
| R9 | **Bun 1.3.1 resolver quirk** ("No version matching ... but package exists") seen on puppeteer in PR #95 attempt. | **Med** | PR #95 pinned Bun to 1.3.13 in CI but local is still 1.3.1. May have been fixed upstream. Try `^25.0.0` first; if it recurs, fall back to `bun add puppeteer@25.0.0` (explicit version, documented workaround). |

---

## 3. Phase A — Zod 4 (PR-1: `deps/zod-4`)

### A1 — Bridge strategy: single typed cast helper

**File**: `packages/aztec-runtime/src/zod-bridge.ts` (new, ~10 LOC):

```ts
import type { ZodType } from "zod"

/**
 * Bridge between Aztec's Zod 3-typed schema exports and our Zod 4
 * wire-boundary layer. Same runtime values, non-unifying type internals
 * (Zod 3's `_def` vs Zod 4's `_zod`). This helper centralises the cast
 * so the assertion is greppable and removable when Aztec ships Zod 4
 * typings.
 */
// biome-ignore lint/suspicious/noExplicitAny: bridges two Zod major versions
export function az<T>(s: unknown): ZodType<T> {
  return s as ZodType<T>
}
```

Use sites become e.g. `z.array(az<Fr>(Fr.schema))` instead of `z.array(Fr.schema)`. Where the previous code used `satisfies ZodFor<X>`, bind structurally with `: ZodType<X>`:

```ts
// Before (Zod 3 satisfies):
export const PackedPrivateEventSchema = z.intersection(
  inTxSchema(),
  z.object({ packedEvent: z.array(Fr.schema), eventSelector: EventSelector.schema }),
) satisfies ZodFor<PackedPrivateEvent>

// After (Zod 4 structural):
export const PackedPrivateEventSchema: ZodType<PackedPrivateEvent> = z.intersection(
  az<InTx>(inTxSchema()),
  z.object({
    packedEvent: z.array(az<Fr>(Fr.schema)),
    eventSelector: az<EventSelector>(EventSelector.schema),
  }),
)
```

### A2 — Fix `zod-helpers.ts`

Two changes:

1. **Widen `formatPath` / `summariseIssues`** from `(string | number)[]` to `PropertyKey[]`, coerce via `String(p)`. The `ZodType<T>` single-generic in the `validate*` signatures is already Zod 4-native.
2. **Regression-pin test**: assert `ValidationError.details.issues` survives the bump with a non-empty `path` array; assert the human-readable summary still contains the method name.

The helpers see only OUR schemas (`network/spec.ts`, `operation-journal/spec.ts`, `content-script-validator.ts`), all plain Zod — no Aztec schemas pass through the helpers.

### A3 — Migration sites (the 6 source files)

| File | Change |
|---|---|
| `extension-messaging/src/zod-helpers.ts` | `formatPath` / `summariseIssues` widen to `PropertyKey[]`. |
| `aztec-runtime/src/pxe/schemas.ts` | Adopt `az()` at ~6 schema refs; replace `satisfies ZodFor<X>` with `: ZodType<X>`. |
| `aztec-runtime/src/pxe/client.ts` | `z.array(az(AztecAddress.schema))` at `:107, :117, :137, :178`. Direct `.parseAsync` calls unchanged. |
| `aztec-runtime/src/pxe/service.ts` | `AccessScopesSchema = z.array(az(AztecAddress.schema))` at `:28`; `z.array(az(AuthWitness.schema)).optional()` at `:330`; `z.array(az(AztecAddress.schema))` at `:266`. |
| `extension/src/wallet/services/execution/authwit-discoverer.ts` | `z.array(az(AbiTypeSchema))` at `:229`. |
| `extension/src/wallet/services/execution/service.ts` | `z.array(az(Fr.schema))` (`:2143`), `z.array(az(AbiTypeSchema))` (`:2144`), `z.array(az(AuthWitness.schema)).optional()` (`:1817`), `z.array(az(AztecAddress.schema))` (`:1818`). |

`content-script-validator.ts`, `network/spec.ts`, `operation-journal/spec.ts` are our-schemas-only and need no touch.

### A4 — Peer-dep tightening

**Drop the dual range, pin to `^4.4.3` exact-floor.**

- `extension-messaging/package.json` — peer + dev `zod` → `^4.4.3`.
- `extension/package.json` — `zod` → `^4.4.3`.
- `aztec-runtime/package.json` — `zod` → `^4.4.3`.

`^4.4.3` floor (not `^4`) so the gate resolves deterministically — 4.4.3 was published 2026-05-04 (14d old, comfortably aged).

### A5 — Validation

Required gates before push:
- `bun ci`
- `bun run typecheck:all` → 0 errors (down from 55)
- `bun run test --filter @nulo/extension-messaging` (boundary contract)
- `bun run test --filter @nulo/extension` (content-script validator + journal FSM)
- `bun run lint`
- `bun run build`
- `bun run test:e2e` (smoke; popup-boot is the wire-shape canary)

**Skip** `bun run e2e:agent` for PR-1. Network suite is baseline-flaky (46/66 per `tests/e2e/README.md:109`); adds noise without signal. If a reviewer wants confidence, run advisory and read the **diff** against baseline, not absolute pass count.

---

## 4. Phase B — Puppeteer 25 (PR-2: `deps/puppeteer-25`)

### B1 — Age-gate today

All 25.x is <7d old. 25.0.0 ages out at ~2026-05-19 16:08 UTC (~26h from now).

### B2 — Recommendation: wait

**Primary path: wait ~26h, install 25.0.0 cleanly.** The age gate is a security control we just bought. Burning it on a dev-tool bump twice in a month normalizes a behavior we should keep rare. The lockfile is happy on 24.43.x; there's no forcing function.

**Fallback if user wants today**: temp-exclude `puppeteer` in `bunfig.toml` `minimumReleaseAgeExcludes`, push PR-2 with the exclude flip in the same commit, and a follow-up commit (or same PR) removes the exclude after the window passes. Clear single-line PR-description note acknowledging the trade-off.

### B3 — Bun resolver quirk

PR #95's puppeteer 25 attempt under Bun 1.3.1 hit `error: No version matching "puppeteer" found for specifier "^25.0.0" (but package exists)`. That's a separate bug from the age gate. Bun 1.3.13 (CI pin) *may* have fixed it; local is still 1.3.1.

Try `^25.0.0` first; if it recurs, fall back to `bun add puppeteer@25.0.0` (explicit version, documented workaround). Don't pre-design around the bug.

### B4 — Code surface

12 puppeteer import sites:
- `tests/e2e/fixtures/extension.ts` — `puppeteer, { TimeoutError, type Browser, type Page, type ConsoleMessage }`
- `tests/e2e/fixtures/popups.ts` — `type Page, Target`
- `tests/e2e/fixtures/helpers.ts` — `type Page`
- Various e2e test files importing types from the fixtures

All stable across 24/25 per upstream release notes. `puppeteer.launch({ headless, args, ignoreDefaultArgs, protocolTimeout })`, `browser.waitForTarget`, `browser.targets()`, `browser.pages()`, `page.goto`, `page.waitForFunction` — unchanged. Risk concentrates in launch-time MV3 behavior (R7), not the API surface.

**Changes**: one manifest bump in `packages/extension/package.json` (`puppeteer ^24.43.0 → ^25.0.0`). No code changes anticipated.

### B5 — Validation

- `bun ci`
- `bun run typecheck:all` (puppeteer types are major-bumped; this is the cheap canary)
- `bun run test:e2e` (smoke; required — fast and captures launch/MV3 regressions)
- `bun run e2e:agent` (network, advisory; log don't gate)
- Manual: load `dist/chrome/` unpacked in real Chrome (defensive — past version-skews surfaced here that headless missed)

---

## 5. Test strategy per phase

| Phase | typecheck:all | unit tests | lint | build | smoke e2e | network e2e | extra |
|---|---|---|---|---|---|---|---|
| PR-1 Zod 4 | ✓ | ✓ (extension-messaging + extension) | ✓ | ✓ | ✓ | advisory only | zod-helpers regression-pin |
| PR-2 Puppeteer 25 | ✓ | – | – | – | ✓ | advisory only | manual unpacked load |

**Justification**:
- PR-1: every gate matters because wire-format risk is the headline concern.
- PR-2: typecheck catches API drift; smoke catches MV3 regressions in <2 min; manual unpacked load catches headed/headless skew.
- Neither needs the full `audit:vue` chain twice — typecheck/lint/build are covered.

**Regression-pin tests added in PR-1**:
- `zod-helpers.test.ts`: assert `ValidationError.details.issues` has non-empty `path` array with stringifiable components after a multi-field failure; assert the human-readable summary contains the method name.
- Existing `operation-journal/service.test.ts` `transitionOperation` test stays the canary for `discriminatedUnion` semantic shifts.

---

## 6. UX copy

Surveyed. **Zero user-facing copy changes.**

- `zod-helpers.ts` error messages (`"Invalid params for ${method}: …"`) become `WalletError.message` payloads. They surface in `openToast(...)` for service errors but the strings aren't localized or user-tuned; behavior preserved.
- `content-script-validator.ts` rejection paths debug-log `parsed.error.issues`; nothing reaches dApp UI.
- `OperationJournalService.transitionOperation` errors are programmer-facing.
- No toast text directly stringifies a zod error.

---

## 7. Open questions for user

1. **One PR or two?** Recommendation = **two**. Different blast radii (Zod = RPC schema; Puppeteer = test infra). Distinct rollback signals.
2. **Peer-dep tightening on `extension-messaging`?** Recommendation = **drop the `^3.23.8`-only peer, pin to `^4.4.3`**. We're the only consumer.
3. **`zod-bridge.ts` lives where?** Recommendation = `packages/aztec-runtime/src/`. That's where the impedance lives. `wallet-core` would be symmetric but pulls a Zod 3-flavoured concern up a layer.
4. **Puppeteer 25 path?** Recommendation = **wait ~26h** for 25.0.0 to age past the gate. Carve-out only if you want this today, with a removal commit promised.
5. **Network e2e during Zod 4 PR**? Recommendation = **skip** (baseline-flaky masks signal). Advisory in Puppeteer PR only.
6. **`z.intersection` / `z.nativeEnum` deprecations** — Zod 4 keeps both working but flags them. Recommendation = **don't refactor under a major bump**; track as a separate cleanup follow-up.

---

## 8. PR map

**Two PRs, NOT stacked.**

### PR-1 — `chore(deps): bump zod to 4`

Branch: `deps/zod-4`. Base: `dev`.

Commit map (3 commits, all atomic with typecheck green):
1. `feat(zod): add Aztec-schema bridge helper for Zod 4 migration` — new `aztec-runtime/src/zod-bridge.ts`. Self-contained, lockstep with the migration.
2. `chore(deps): bump zod to 4.4.3 + migrate schema layer` — manifest bumps (3 packages), helper widening, all 6-file consumer migration in one atomic commit. (Splitting risks broken-tree mid-PR.)
3. `test(zod): regression-pin issue-path widening + ValidationError shape` — new test in `zod-helpers.test.ts`.

### PR-2 — `chore(deps): bump puppeteer to 25`

Branch: `deps/puppeteer-25`. Base: `dev`.

One manifest bump in `extension/package.json` + lockfile diff. Trigger ~2026-05-19 16:08 UTC (when 25.0.0 ages out). No code changes anticipated.

Commit-message convention: `chore(deps): ...` lower-case subject per `.commitlintrc.json`.

---

## 9. Notable flags

1. **Upstream Aztec Zod 4 status unknown.** If Aztec ships Zod 4-typed schemas in a future release, the `az()` helper becomes a removable line. Worth a one-line follow-up commit when that happens.
2. **`z.intersection` deprecated in Zod 4** (used at `pxe/schemas.ts:27-33`). Still works. Separate cleanup.
3. **`z.nativeEnum` deprecated** (used at `operation-journal/spec.ts:175,190`, `network/spec.ts:93`). Still works. Separate cleanup.
4. **Bun frozen-lockfile gate semantics** — still empirically tighter than docs claim (`bunfig.toml:9-23`). Out of scope here.
5. **Original 55-error count → 0** after applying `az()` and the helper widening. If residual non-zero, the deltas are either (a) a missed `z.array(AztecSchema)` site or (b) a `satisfies ZodFor<X>` that needs structural-binding. Mechanical; doesn't indicate strategy is wrong.
6. **1Password agent flakiness history** — use `--no-gpg-sign` per existing user authorization; re-sign via rebase as a sweep after.

---

*Consolidated from `plan-mine.md` + `plan-opus.md`. Ready for Codex review.*
