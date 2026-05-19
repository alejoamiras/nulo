# Vitest 4 + Vite 8 — plan (post-hardening-PR follow-up)

Follow-up to `implementations-plan/dependency-hardening/plan.md` (PR #95 — merged into `dev`). Vitest 4 and Vite 8 were deferred from that PR because:
- Vitest 4 requires test mock pattern updates (~4 test files affected).
- Vite 8 is a Rolldown + Oxc migration — every plugin in the stack needs to be Rolldown-ready.

This plan separates the two: **Vitest 4 ships as Phase A** (achievable now); **Vite 8 stays deferred as Phase B** pending plugin ecosystem readiness.

---

## 1. Goals & non-goals

**Goals**
1. Bump vitest from `^3.2.4` → `^4.x` across all 7 declaring workspaces.
2. Bring `@nulo/landing` vitest range up from `^2.1.9` to match (was 2 majors behind).
3. Fix the ~4 affected test files' mock patterns (constructor mocks must use `function` expressions, not arrow functions).
4. Walk every `vitest.config.ts` / `vitest.e2e*.config.ts` for legacy options (per migration guide).
5. Verify build + unit + smoke pipelines still pass.

**Non-goals**
1. **Vite 8.** Vite 8 swaps esbuild + Rollup for Rolldown + Oxc; every vite plugin in our stack (`@vitejs/plugin-vue`, `unplugin-*`, `vite-plugin-pages`, `vite-plugin-static-copy`, `vite-plugin-node-polyfills`, `vite-plugin-vue-devtools`, `@crxjs/vite-plugin`, `@storybook/builder-vite`) needs to be Rolldown-compatible. Verifying each one's status + handling fallout is a separate milestone. Vite 8 stays deferred; this plan adds a readiness audit checklist in §6.
2. Aztec updates (still out of scope per the original hardening milestone).
3. Renovate (still deferred).

---

## 2. Recon

### vitest range mismatch

```
packages/extension/package.json:               vitest ^3.2.4
packages/wallet-core/package.json:             vitest ^3.2.4
packages/wallet-crypto/package.json:           vitest ^3.2.4
packages/wallet-bridge/package.json:           vitest ^3.2.4
packages/aztec-runtime/package.json:           vitest ^3.2.4
packages/extension-messaging/package.json:     vitest ^3.2.4
packages/landing/package.json:                 vitest ^2.1.9   ← two majors behind
```

### Vitest 4 breaking changes (per `https://vitest.dev/guide/migration`)

- **Vitest 4 requires Vite ≥6.** (We're on 7.3.3 — fine.)
- **Vitest 4 requires Node ≥20.** (CI is on Node 24 — fine.)
- **Constructor mocks**: arrow functions error when called with `new`. Must use `function` or `class`:
  ```ts
  // Before (vitest 3 — works):
  TokenServiceClient: vi.fn(() => tokenServiceMock)
  // After (vitest 4):
  TokenServiceClient: vi.fn(function () { return tokenServiceMock })
  ```
- **`vi.fn()` default name** is now `vi.fn()` (was `spy`) — affects snapshots only if any test inspects fn names.
- **Module mocking factory** must return an object with explicit exports.
- **Config renames**: `maxThreads`/`maxForks` → `maxWorkers`; `workspace` → `projects`; `poolOptions` flattened.
- **Removed config**: `poolMatchGlobs`, `environmentMatchGlobs`, `deps.external`/`deps.inline` (use `server.deps.*`), `browser.testerScripts`.
- **V8 coverage** is now AST-based; default excludes uncovered files (define `coverage.include` explicitly).
- **Test options as third argument to `test()`** removed.

### Test files needing constructor-mock pattern fix (verified)

Both `vi.fn(() => mock)` (arrow factory) and `vi.fn().mockImplementation(() => ({...}))` (arrow mockImplementation) error in Vitest 4 when called with `new`. Real scope:

| File | Mocks | Pattern |
|---|---|---|
| `packages/extension/src/popup/components/popups/NewTokenPopup.test.ts` | 3 (TokenServiceClient, TokenBalanceServiceClient, TaskServiceClient) | `vi.fn(() => mock)` |
| `packages/extension/src/popup/components/modules/import/useFullBackupImport.test.ts` | 11 (Profile/Network/Account/Token/Transaction/TokenBalance/AccountState/AuthRegistry/Fpc/Contact/Config ServiceClient) | `vi.fn(() => mock)` |
| `packages/extension/src/popup/components/modules/send/FeeSettingsCard.test.ts` | 3 (ExecutionServiceClient, TokenBalanceServiceClient, FpcServiceClient) | `vi.fn().mockImplementation(() => ({...}))` |

**Total: 3 files, 17 mocks.** Mechanical fix: arrow → `function () { return mock }`.

**NOT affected** (Opus correction):
- `Dropdown.test.ts`, `Popover.test.ts`, `FormPopup.test.ts` — their `createFocusTrap` and `useOutside` mocks are factory-fn mocks, not constructor mocks. The source calls them as `focusTrap.createFocusTrap(...)` and `useOutside(...)` (plain functions, not `new`). No fix needed.
- `balance-job-queue.test.ts` — `createNewTask`/`startNewTask` are method mocks on a returned object, not constructors. No fix.

### Config option renames (verified no-op)

`grep` confirmed NONE of these patterns exist in any `vitest*.config.ts` in this repo:
- `poolMatchGlobs`, `environmentMatchGlobs` (removed in v4)
- `maxThreads`, `maxForks` (renamed)
- `deps.external`, `deps.inline`, `deps.fallbackCJS` (moved to `server.deps.*`)
- `workspace` (renamed to `projects`)

Our configs use `test.server.deps.inline` (already v4-correct) and `pool: "forks"` + `poolOptions.forks` (still supported). **No config walk needed.**

### Vite plugin compatibility (verified by Opus audit)

All plugins already declare `^8.0.0` in their peer ranges:

| Plugin | Current | Latest | Vite peer range |
|---|---|---|---|
| `@vitejs/plugin-vue` | 6.0.7 | 6.0.7 | `^5 \|\| ^6 \|\| ^7 \|\| ^8` |
| `vite-plugin-pages` | 0.33.3 | 0.33.3 | `^2 \|\| … \|\| ^8.0.0-0` |
| `vite-plugin-static-copy` | 4.1.0 | 4.1.0 | `^6 \|\| ^7 \|\| ^8` |
| `vite-plugin-node-polyfills` | 0.24.0 | 0.28.0 | `^2 \|\| … \|\| ^8` (need to bump 0.24 → 0.28 in lockstep with vite 8) |
| `vite-plugin-vue-devtools` | 8.1.2 | 8.1.2 | `^6 \|\| ^7 \|\| ^8` |
| `@crxjs/vite-plugin` | 2.4.0 | 2.4.0 | `^3 \|\| … \|\| ^8` |
| `@storybook/builder-vite` | 10.4.0 | 10.4.0 | `^5 \|\| … \|\| ^8` |
| `@storybook/vue3-vite` | 10.4.0 | 10.4.0 | (same) |

`unplugin-auto-import@21`, `unplugin-vue-components@32`, `unplugin-vue-router@0.19` don't peer on `vite` directly.

**Real Vite 8 risks** (NOT plugin ecosystem):
1. **`@aztec/*` CJS-in-ESM interop under Rolldown.** Vite 8's Rolldown CJS interop is different — "Default import handling from CommonJS modules is now consistent across development and build" + "`require()` Calls Preserved." Our `vite.config.ts` `server.deps.inline: [/@aztec/]` workaround is for this exact shape; need to re-verify under Rolldown.
2. **`vite-plugin-node-polyfills` 0.24 → 0.28** required for Vite 8. User flagged 0.24 ↔ Vite-8-ish stack as prior pain — verify in lockstep.
3. **Vite 8.0.13** was published 2026-05-14 (3 days ago); blocked by the 7-day gate until 2026-05-21. May need to pin to an older 8.0.x (8.0.10 or earlier).

**Decision**: try Vite 8 in this same PR as Phase B. If `@aztec/*` SSR breaks under Rolldown OR `vite-plugin-node-polyfills` 0.28 fails the build, revert Vite 8 and ship vitest 4 alone.

---

## 3. Risk register

| Area | Risk | Mitigation |
|---|---|---|
| Constructor mock fixes | Subtle pattern shift; mechanical changes across 4 test files | Fix all in one focused commit; rely on the test suite as the canary. If a test still fails after the function-expression rewrite, dig per-file. |
| `landing` vitest 2 → 4 (two majors) | Could have subtle test-output changes (snapshot format, default name `spy` → `vi.fn()`) | Run landing's tests; landing has very few tests so the blast radius is small. |
| vitest config option renames | Configs may still use legacy names | Walk each `vitest*.config.ts`; rename in same commit as the bump. |
| Coverage AST change | Coverage reports may shift (but we don't gate on coverage today) | No action; flag if it surprises CI later. |
| 1Password signer flaky during commits | Already empirically broken | Use `--no-gpg-sign` per user authorization. |
| SSH push blocked (1Password agent down) | Commits accumulate locally, can't push | Hold locally until SSH agent is back; user will sign + push later. |

---

## 4. Phased plan

### Phase A1 — Bump vitest manifests to ^4.1.5

**Scope**
- Edit 7 `package.json` files: `vitest ^3.2.4` (or `^2.1.9` for landing) → `vitest ^4.1.5`. Pin 4.1.5 exactly (not "or latest") because 4.1.6 is age-gated until 2026-05-18.
- `bun install` (NO `--minimum-release-age=0` — don't bypass the gate). The gate will resolve 4.1.5; if it tries 4.1.6 it'll fail loudly.
- NO config-walk (verified no-op per §2).

**Validation**
- `bun install` (gate-aware)
- `bun run typecheck:all` — should pass (vitest type changes don't affect our source)
- Tests will fail at this point because of the constructor-mock issues — expected.

### Phase A2 — Fix constructor-mock patterns in 3 test files

**Scope**
- `NewTokenPopup.test.ts`:lines 52, 55, 58 — rewrite `vi.fn(() => mock)` → `vi.fn(function () { return mock })`. 3 mocks.
- `useFullBackupImport.test.ts`:lines 61-71 — same rewrite. 11 mocks.
- `FeeSettingsCard.test.ts`:lines 24, 32, 43 — rewrite `vi.fn().mockImplementation(() => ({...}))` → `vi.fn().mockImplementation(function () { return {...} })`. 3 mocks.

Do NOT touch: `Dropdown.test.ts`, `Popover.test.ts`, `FormPopup.test.ts`, `balance-job-queue.test.ts` — their mocks are not constructors.

**Validation**
- `bun run test:all` — every workspace's vitest suite. All 1646 unit tests should pass.
- `bun run test:components` — Vue component subset.

### Phase A3 — Smoke + landing build verification

**Scope**
- `bun run --cwd packages/landing test` (it was 2 majors behind; verify behavior).
- `bun run --cwd packages/landing build`.
- `bun run --cwd packages/playground build` + `typecheck`.
- `bun run test:e2e` (smoke).

**Validation**: each command exits clean. Manual extension load-as-unpacked if anything visual changed.

### Phase A4 — Docs + plan archive

**Scope**
- Update `implementations-plan/dependency-hardening/plan.md` §14 follow-ups to mark vitest 4 done.
- Append `implementations-plan/vitest-vite-bumps/plan.md` §7 with actual outcomes log.
- No CLAUDE.md change needed (vitest is implicit; no operator-facing policy shift).

---

## 5. Test gating per phase

| Phase | typecheck | units (all) | lint | build | smoke e2e |
|---|---|---|---|---|---|
| A1 (manifest bump + config walk) | ✓ | – | – | – | – |
| A2 (mock pattern fixes) | ✓ | ✓ | ✓ | – | – |
| A3 (smoke + landing) | – | – | – | ✓ | ✓ |
| A4 (docs) | – | – | – | – | – |

---

### Phase B1 — Bump vite to 8.0.x + node-polyfills lockstep (try; revert on fail)

**Scope** (executed AFTER Phase A2 lands clean)
- `vite ^7.x → ^8.0.x` in extension, playground, landing. Pin to an 8.0.x that's > 7 days old (8.0.13 is age-blocked; check what older 8.0.x exists, e.g., 8.0.10).
- `vite-plugin-node-polyfills ^0.24.0 → ^0.28.0` (required for Vite 8).
- `bun install` (gate-aware).

**Validation**
- `bun run typecheck:all`
- `bun run test:all` (vitest 4 + vite 8 must coexist — vitest 4 peer accepts vite ≥6)
- `bun run --cwd packages/extension build:chrome` — **the main canary**: `@aztec/*` CJS-in-ESM under Rolldown is the critical test.
- `bun run --cwd packages/extension build:firefox`
- `bun run --cwd packages/landing build`
- `bun run --cwd packages/playground build`
- `bun run test:e2e` (smoke)

**Failure mode**: if `@aztec/*` SSR/build breaks under Rolldown OR `vite-plugin-node-polyfills@0.28` fails, REVERT this commit. Phase A2 (vitest 4) still lands; Vite 8 reverts to follow-up. Document the failure mode in the actual-outcomes log.

---

## 7. Open questions for user

None. Vite 8 deferred is a technical reality (plugin ecosystem); vitest 4 is mechanical work.

---

## 8. PR map

Single PR with stacked commits (consistent with PR #95's pattern):

1. `chore(deps): bump vitest 3 → 4 across all workspaces + align landing` (Phase A1)
2. `fix(test): rewrite arrow-fn mock factories to function expressions for vitest 4` (Phase A2 — touches 3 test files, 17 mock patterns)
3. `chore(deps): bump vite 7 → 8 + vite-plugin-node-polyfills 0.24 → 0.28` (Phase B1 — conditional; revert if @aztec/* SSR breaks)
4. `docs(deps): record actual outcomes` (folded into plan.md, no separate commit if tight)
