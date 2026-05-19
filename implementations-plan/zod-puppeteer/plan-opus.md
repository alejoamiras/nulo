# Zod 4 + Puppeteer 25 — parallel plan (Opus reviewer)

Independent draft for consolidation. Read-only investigation; nothing installed/changed. Both bumps were deferred out of PR #95 with documented blockers: Zod 4 hits ~55 typecheck errors at the RPC schema layer; Puppeteer 25 hit a Bun 1.3.1 resolver quirk + the 7-day `minimumReleaseAge` gate.

---

## 1. Goals & non-goals

**Goals.**
1. Land Zod 4 across the wire-boundary schema layer with no regression in the structured-error contract that crosses the SW↔popup, content-script↔SW, and offscreen↔SW seams.
2. Land Puppeteer 25 across the e2e fixtures. Test-infra surface only — recoverable.
3. Drop the `||^4` peer-dep transition affordance on `extension-messaging`. Two Zod majors coexisting at runtime is exactly the failure mode the boundary type was designed to surface.
4. Cleanly bridge the `@aztec/foundation/schemas` Zod 3 constraint to our Zod 4 code without forking Aztec.

**Non-goals.** Aztec line bumps (the `ZodFor<T> = ZodType<T, any, any>` shim in `@aztec/foundation/schemas/types.d.ts:2` is the root cause of the type errors; we work around it, not through Aztec). Adding new Zod schemas. `bun audit` policy changes. Bun lockfile-text migration. Puppeteer 25 feature adoption — type-and-runtime parity only. vue-router 5, jsdom 30.

---

## 2. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Wire corruption at the dApp RPC seam.** Zod 4 changes parser internals (`_zod` marker), `ZodIssue.path` is `PropertyKey[]` (was `(string \| number)[]`), and `discriminatedUnion` semantics tightened. Mis-translation could silently coerce a value that should reject. | **High** | Phase A preserves `zod-helpers.ts` behavior byte-for-byte: same `safeParse → ValidationError` shape, same human-readable summary, same `details.issues` payload. Wire-level changes are typing-only. Boundary-pin test added (§5). |
| R2 | **Two zod instances at runtime** during transition. `instanceof z.ZodType` / `instanceof z.ZodError` is not stable across instances. | **Med** | Audited: zero `instanceof.*Zod` checks in our code. Bun's resolver collapses peer + dev deps when ranges allow, so we should end up with one zod copy. PR-1 ends the dual-range affordance to keep it that way. |
| R3 | **`@aztec/foundation/schemas` returns Zod 3-typed schemas.** Every `AztecAddress.schema`, `Fr.schema`, `EventSelector.schema`, `Note.schema`, `TxHash.schema`, `BlockNumberSchema`, `ContractArtifactSchema`, `ContractInstanceWithAddressSchema`, `AuthWitness.schema`, `TxExecutionRequest.schema`, `TxProvingResult.schema`, `TxProfileResult.schema`, `TxSimulationResult.schema`, `UtilityExecutionResult.schema`, `CompleteAddress.schema`, `BlockHeader.schema`, `SimulationOverrides.schema`, `AbiTypeSchema`, `PrivateEventFilterSchema`, `FunctionCall.schema` is `ZodType<T, any, any>`. Composing with Zod 4's `z.array(...)` fails the `SomeType` constraint. | **High** | §3-A1 — single typed bridge helper. |
| R4 | **Peer-dep tightening** breaks downstream consumers running Zod 3. | **Low** | `@nulo/extension-messaging` has exactly one consumer (`@nulo/extension`); no external consumers. Move them in lockstep in PR-1. |
| R5 | **`ZodIssue.path` widens to `PropertyKey[]`.** `zod-helpers.ts:24-31` declares `(string \| number)[]`. | **Low** | One-line: widen the param type and coerce via `String(p)`. We never produce symbol keys (no `z.record(z.symbol(), …)`). |
| R6 | **Puppeteer 25 API drift** breaks 12 import sites. | **Low** | Stable exports across 24/25 per release notes. Typecheck is the canary. |
| R7 | **Puppeteer 25 launch/MV3 regression** in headless mode. Past majors shifted `headless` default and `--load-extension` semantics. | **Med** | Smoke catches popup-boot regression in <2 min. Network suite advisory, per `tests/e2e/README.md:109` baseline (46/66). |
| R8 | **Age gate** on Puppeteer 25.x: 25.0.0–25.0.4 are all <7d old today. 25.0.0 ages out ~2026-05-19 16:08 UTC (~26h). | **Low** | Wait. Lockfile is happy on 24.43.x; no forcing function. Carve-out is available but not justified — see §4-B2. |

---

## 3. Phase A — Zod 4 (PR-1)

### A1 — Bridge strategy for Aztec's Zod 3 schemas

**Recommendation: a single typed cast helper. Reject the rebuild approach. Reject bare inline casts.**

- **(a) Rebuild ~6 schemas in Zod 4.** Aztec's `AztecAddress.schema` is an effect chain (`z.string()...transform → AztecAddress`); Fr enforces prime-field bounds; EventSelector is a 4-byte hex-coerced buffer; Note is recursively shaped. We'd own a parallel validator surface that drifts every Aztec release. Hard no.
- **(b) Bare inline casts (`schema as unknown as z.ZodTypeAny`).** Works, but spreads the same load-bearing assertion across 10+ call sites with no greppable anchor.
- **(c) Type-only re-exports.** Doesn't help. The mismatch is in the structural `_zod`/`_def` internals, not in surface re-exports.
- **(d) Hybrid.** Unnecessary. (b) routed through a helper is sufficient.

**Shape** — new file `packages/aztec-runtime/src/zod-bridge.ts`:

```ts
import type { ZodType } from "zod"

// Single load-bearing cast. Aztec's *.schema exports are Zod 3-typed
// (ZodType<T, any, any>). Our wire layer is Zod 4. Same runtime values,
// non-unifying type internals. This helper centralises the assertion.
// biome-ignore lint/suspicious/noExplicitAny: bridges two Zod major versions
export function az<T>(s: unknown): ZodType<T> {
  return s as ZodType<T>
}
```

Use sites: every `z.array(AztecAddress.schema)` becomes `z.array(az<AztecAddress>(AztecAddress.schema))`. `.parseAsync(x)` calls stay — they work at runtime regardless of our local types.

Edge case — `satisfies ZodFor<X>` clauses (`pxe/schemas.ts:33,42`). Drop them, bind structurally:

```ts
export const PackedPrivateEventSchema: ZodType<PackedPrivateEvent> = z.intersection(
  az<InTx>(inTxSchema()),
  z.object({ packedEvent: z.array(az<Fr>(Fr.schema)), eventSelector: az<EventSelector>(EventSelector.schema) }),
)
```

We trade a Zod 3 type-shape check for a Zod 4 one, expressed in our surface.

### A2 — Fix `zod-helpers.ts`

Two changes:

1. **Path widening.** `formatPath(path: readonly PropertyKey[])` + `path.map(String).join(".")`. `summariseIssues` widens to match. The `ZodType<T>` single-generic in the `validate*` signatures is already Zod 4-native.
2. **Add a regression-pin test** that `ValidationError.details.issues` survives the bump with non-empty `path` array, and that the human-readable summary still contains the method name.

The helpers see only *our* schemas (`network/spec.ts`, `operation-journal/spec.ts`, `content-script-validator.ts`), all of which are written by us in plain Zod — no Aztec schemas pass through.

### A3 — Fix the 6 source files

| File | Change |
|---|---|
| `extension-messaging/src/zod-helpers.ts` | `formatPath`/`summariseIssues` widen to `PropertyKey[]`. |
| `aztec-runtime/src/pxe/schemas.ts` | Adopt `az()` at 6 site refs; replace `satisfies ZodFor<X>` with `: ZodType<X>`. |
| `aztec-runtime/src/pxe/client.ts` | `z.array(az(AztecAddress.schema))` at `:107, :117, :137, :178`. Direct `.parseAsync` calls unchanged. |
| `aztec-runtime/src/pxe/service.ts` | `AccessScopesSchema = z.array(az(AztecAddress.schema))` at `:28`; `z.array(az(AuthWitness.schema)).optional()` at `:330`; `z.array(az(AztecAddress.schema))` at `:266`. |
| `extension/.../execution/authwit-discoverer.ts` | `z.array(az(AbiTypeSchema))` at `:229`. |
| `extension/.../execution/service.ts` | `z.array(az(Fr.schema))` (`:2143`), `z.array(az(AbiTypeSchema))` (`:2144`), `z.array(az(AuthWitness.schema)).optional()` (`:1817`), `z.array(az(AztecAddress.schema))` (`:1818`). |

`content-script-validator.ts`, `network/spec.ts`, `operation-journal/spec.ts` are our-schemas-only and need no touch.

### A4 — Peer-dep on `extension-messaging`

**Recommendation: drop the dual range, pin to `^4`.**

The `^3.23.8 || ^4.0.0` peer was a transition affordance from PR #95. Its job is done. Keeping it (a) invites the R2 failure mode if a downstream consumer ever runs Zod 3, (b) lets the resolver land on either major depending on resolution order, (c) signals to maintainers that we still tolerate Zod 3 callers. We don't. Tighten to `^4.4.3`:

- `extension-messaging/package.json` — peer + dev `zod` → `^4.4.3`.
- `extension/package.json:73` — `zod` `^4.4.3`.
- `aztec-runtime/package.json:35` — `zod` `^4.4.3`.

`^4.4.3` exact-floor (not `^4`) so the gate resolves deterministically — 4.4.3 was published 2026-05-04 (14d old, comfortably aged).

---

## 4. Phase B — Puppeteer 25 (PR-2)

### B1 — Age gate today

25.0.0 publishes-out at 2026-05-19 16:08 UTC (~26h). All 25.x is currently blocked.

### B2 — Three options

(a) **Wait ~26h, install 25.0.0 exact.** Smallest reflex change. Gate resolves the moment the version ages out.

(b) **Carve-out via `minimumReleaseAgeExcludes = ["puppeteer"]`.** Same mechanism as the CVE-on-Friday runbook in `SECURITY.md:316` and `bunfig.toml:27`. Wrong reflex though: there's no advisory, just an impatience. We just bought ourselves the gate as a security control; spending it twice in a month on dev tools normalises a behaviour we should keep rare.

(c) **Pin to older 25.** No older 25 exists; all of 25.0.0–25.0.4 are inside the gate window.

**Recommendation: (a).** If user wants this today, (b) with an explicit single-line note in the PR description and a follow-up commit promised to remove the exclude after the window passes.

### B3 — Bun 1.3.13 resolver quirk

PR #95's attempt under Bun 1.3.1 hit `error: No version matching "puppeteer" found for specifier "^25.0.0" (but package exists)`. That's a separate bug from the age gate (different message text). Bun 1.3.13 *may* have fixed it; we don't know. Try `^25.0.0` first; if it recurs, fall back to `bun add puppeteer@25.0.0` (explicit version, documented workaround). Don't pre-design around the bug.

### B4 — Type/runtime parity

Surveyed our 12 import sites: `puppeteer`, `TimeoutError`, `Browser`, `Page`, `Target`, `ConsoleMessage`. All stable across 24/25 per upstream notes. `puppeteer.launch({ headless, args, ignoreDefaultArgs, protocolTimeout })`, `browser.waitForTarget`, `browser.targets()`, `browser.pages()`, `page.goto`, `page.waitForFunction` — all unchanged.

Risk concentrates in launch-time MV3 behavior (R7), not the API surface. Touches `packages/extension/package.json:95` only — no code changes anticipated.

---

## 5. Test strategy per phase

### Phase A — Zod 4

| Gate | Why |
|---|---|
| `bun run typecheck:all` | Primary canary; covers the 6 touched files + every transitive consumer. |
| `bun run test --filter @nulo/extension-messaging` | `zod-helpers.test.ts` is the boundary contract — pinning `path` widening, `ValidationError` shape, method-name surfacing. |
| `bun run test --filter @nulo/extension` | Covers `content-script-validator.test.ts`, `operation-journal/service.test.ts`. The dApp-message envelope and the journal FSM are where a Zod 4 `discriminatedUnion`-semantics regression would surface. |
| `bun run test:e2e` (smoke) | Popup-boot wires service-clients on mount; `validateParams`/`validateResult` fire at the boundary. A subtle wire-shape break shows up here. |
| `bun run e2e:agent` | **Skip.** Baseline-flaky (46/66 per `tests/e2e/README.md:109`); adds noise without signal. If a reviewer wants confidence, run advisory and read the diff against baseline, not absolute pass count. |

Add two regression-pin tests:
- `zod-helpers.test.ts` — issues' `path` survives as a non-empty array with stringifiable components after a multi-field failure.
- `operation-journal/service.test.ts` — `transitionOperation` rejects `succeeded` for `kind: "transfer"` when `txHash` is absent (already exists; confirm it still passes — a `discriminatedUnion` semantic shift would surface here).

### Phase B — Puppeteer 25

| Gate | Why |
|---|---|
| `bun run test:e2e` | Smoke uses puppeteer in every fixture; <2 min, catches launch/MV3 regressions. |
| `bun run e2e:agent` | Advisory, same posture as the hardening plan §7c. Run it, log, don't gate. |
| Manual load `dist/chrome/` unpacked in real Chrome | Defensive — caught past version-skew issues headless missed. |

No independent typecheck gate beyond the global pass.

---

## 6. UX copy concerns

Surveyed user-visible surfaces produced by zod validators.

- **`zod-helpers.ts` error messages** (`"Invalid params for ${method}: …"`) cross the wire as `WalletError.message`. The dApp-side branch in `content-script-validator.ts` drops malformed envelopes silently and debug-logs; nothing reaches the dApp UI. The popup uses these via `openToast` only in service-error toasts; the strings aren't localised or user-tuned. No copy change needed; behaviour preserved.
- **`content-script-validator.ts`** rejection logs `parsed.error.issues` at debug-level in `wallet-sdk/background.ts:120-124`. Path-shape widens; no surface impact.
- **`OperationJournalService.transitionOperation` errors** are programmer-facing; never displayed.
- Toast text — no consumer stringifies a zod error directly.

Net: zero user-facing copy changes. R1 is the only thing worth a careful review, and the §5 boundary pin catches it.

---

## 7. Open questions for user

1. **One PR or two?** Recommendation = **two**. Different blast radii (Zod = RPC schema; Puppeteer = test infra). Distinct rollback signals.
2. **Peer-dep tightening on `extension-messaging`?** Recommendation = **drop the dual `||^4` range, pin to `^4.4.3`**. We're the only consumer; the affordance is unjustified runtime risk going forward.
3. **`zod-bridge.ts` lives where?** Recommendation = `packages/aztec-runtime/src/`. That's where the impedance lives. `wallet-core` would be symmetric but pulls a Zod 3-flavoured concern up a layer.
4. **Puppeteer 25 path?** Recommendation = **wait ~26h** for 25.0.0 to age out. Option (b) carve-out only if user wants it today, with a removal commit promised.
5. **Network e2e during Puppeteer 25 PR** = **advisory**, consistent with the hardening plan.
6. **`z.intersection`, `z.nativeEnum` deprecations.** Zod 4 keeps both working but flags them. Recommendation = **don't refactor under a major bump**; track as a separate cleanup follow-up.

---

## 8. PR map

**Two PRs, NOT stacked.** Orthogonal change sets.

### PR-1 — `chore(deps): bump zod to 4`

Branch: `deps/zod-4`. Base: `dev`. Contents: (1) new `aztec-runtime/src/zod-bridge.ts`, (2) `aztec-runtime/src/pxe/{schemas,client,service}.ts` migrations, (3) `extension/.../execution/{service,authwit-discoverer}.ts` migrations, (4) `extension-messaging/src/zod-helpers.ts` path-widening + new regression test, (5) three manifest bumps (peer + dev) to `^4.4.3`. Gates: `typecheck:all`, unit tests in the two affected workspaces, smoke e2e.

### PR-2 — `chore(deps): bump puppeteer to 25`

Branch: `deps/puppeteer-25`. Base: `dev`. Contents: one manifest bump in `extension/package.json:95` plus lockfile diff. Gates: smoke e2e (required), network e2e (advisory), manual unpacked-extension load. Trigger: when 25.0.0 has aged past the 7-day gate (~26h from now).

Commit-message convention (per `.commitlintrc.json`): `chore(deps): ...` lower-case subject.

---

## 9. Notable flags

1. **Upstream Aztec Zod 4 status unknown.** Worth confirming whether Aztec has a Zod 4 branch or roadmap. If yes, we may shorten future maintenance by waiting an Aztec release. If no, our `az()` bridge is the long-term shape.
2. **`z.intersection` is deprecated in Zod 4** in favour of `.extend()` / `.and()`. Used at `pxe/schemas.ts:27-33`. Still works; flag as a separate cleanup follow-up — don't refactor under a major bump.
3. **`z.nativeEnum` deprecation.** Used at `operation-journal/spec.ts:175,190` and `network/spec.ts:93`. Zod 4 keeps it working but recommends `z.enum`. Same posture.
4. **Bun frozen-lockfile gate is still empirically tighter than Bun's docs claim** (`bunfig.toml:9-23`). Out of scope here; tracked in the hardening plan's followups.
5. **Reviewer note**: the original 55-error count should drop to 0 after applying `az()`. If residual non-zero, the deltas are either (a) a missed `z.array(AztecSchema)` site or (b) a `satisfies ZodFor<X>` that needs the structural-binding rewrite. Mechanical; doesn't indicate strategy is wrong.

---

*Drafted as a parallel independent plan for consolidation. Read-only investigation against `dev` at commit `1e5505fc` (vitest 4 + vite 8 merge).*
