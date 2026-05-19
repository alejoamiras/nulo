# M3.7 — Boundary enforcement + final thin-shell audit (~2-3 days)

**Status (2026-04-25)**: revised — skips M3.6 (deferred indefinitely), drops CI integration (separate epic), prefers Biome over dependency-cruiser (already installed, bun-native, faster).
**Prerequisite**: M3.1–M3.5 + typecheck cleanup all shipped (master at `954b4d2`, 0.13.0). 8 packages, all `bun run typecheck:all` clean.

## Why M3.7 exists

You spent the M3 arc cutting `packages/extension/` into 7 packages, each with a job. The boundaries are conceptual right now — they exist because we typed them into the right files. **Nothing physically prevents the next PR from adding `import { ConfigServiceClient } from "@nulo/extension"` inside `wallet-core` and breaking what we just built.**

M3.7's job: weld those boundaries shut so drift can't slip in.

Three pillars:
1. **Audit** — confirm extension is actually thin. Catch any orphaned files that should have moved.
2. **Boundary enforcement** — make architecturally-illegal imports into typecheck/lint errors.
3. **Per-package scripts** — every package has explicit `typecheck` + `test` scripts so each can be exercised in isolation.

Out of scope: CI integration (separate epic), Vue component tests (M5.1).

## What `@nulo/extension` contains after M3.5 + typecheck cleanup

Concrete inventory (no M3.6, so UI primitives stay):

| Path | Why it stays |
|---|---|
| `src/wallet/index.ts` | MV3 service-worker entry |
| `src/wallet/services/account/` | AccountService (SW) + AccountServiceClient (popup) |
| `src/wallet/services/network/` | NetworkService |
| `src/wallet/services/profile/` | ProfileService + SessionManager + PasswordSecretBox |
| `src/wallet/services/execution/` | ExecutionService + all M2.2 seams (FeeStrategy, TxRequestBuilder, AuthwitDiscoverer, ContractResolver, ExecutionCoordinator) |
| `src/wallet/services/token/` + `token-balance/` | TokenService + TokenBalanceService |
| `src/wallet/services/dapp-interaction/` | DappInteractionService |
| `src/wallet/services/dapp-session/` | DappSessionService |
| `src/wallet/services/passkey/` | PasskeyService |
| `src/wallet/services/transaction/` | TransactionService (re-exports OriginType from wallet-bridge) |
| `src/wallet/services/contact/`, `auth-registry/`, `fpc/`, `task/`, `wallet-sdk/`, `pxe/` (client/), `config/`, `logger/`, `operation-journal/` | Other services |
| `src/wallet/storage/migrate.ts` | Storage migration (chrome.storage) |
| `src/wallet/utils/`, `src/wallet/logger/` (store + utils) | Chrome-bound impls |
| `src/core/adapters/` | ChromeBrowserApiAdapter + ClockTickerAdapter + … |
| `src/core/testing/fake-node-factory.ts` | Test double |
| `src/popup/` | All Vue popup pages, windows, components |
| `src/components/` | All UI components (M3.6 deferred) |
| `src/composables/` | All composables (.ts and .js) |
| `src/stores/` | Pinia stores |
| `src/content-script/`, `src/setup/`, `src/offscreen/` | Other entry points |
| `src/utils/`, `src/assets/`, `src/types/` | Misc |
| `manifest/`, `vite.*.config.*ts`, `tsconfig.json`, `vitest.*.config.ts` | Build system |
| `tests/` | E2E tests |

## Audit tasks (Pillar 1)

### A1 — Phantom extraction misses

Search for files in `packages/extension/src/` that, by their content, *should* have moved in M3.1–M3.5 but didn't. Common candidates:

- **Pure crypto in `wallet/services/`** that should have moved to `@nulo/wallet-crypto`
  ```bash
  grep -rln "subtle\.\(encrypt\|decrypt\|deriveBits\|importKey\)\|HKDF\|PBKDF2" packages/extension/src/wallet/services/ \
    | grep -v ".test.ts"
  ```
- **Pure types/utils in `wallet/services/`** with zero Chrome dep that could live in `wallet-core`
  ```bash
  for f in $(find packages/extension/src/wallet/services -name "*.ts" -not -name "*.test.ts"); do
    if ! grep -q "chrome\.\|@aztec/" "$f"; then
      echo "$f"
    fi
  done
  ```
- **Pure protocol types** still in extension that should be in `wallet-bridge`
  ```bash
  grep -rln "Operation\|OperationRequest\|Capability\|SessionContext" packages/extension/src/wallet/services/ \
    | grep -v ".test.ts"
  ```

For each hit, decide: move it, or document why it stays. Output: a 1-paragraph audit summary in `implementations-plan/M3/7/audit-findings.md`.

### A2 — Dead path aliases

`packages/extension/tsconfig.json` declares aliases. Some may point to directories that no longer exist after M3 moves:

```bash
# Find aliases declared
grep -A 5 "\"paths\"" packages/extension/tsconfig.json

# For each alias path, check the dir exists
ls packages/extension/src/...   # for each declared alias target
```

Specifically check:
- `@assets/*` → 0 src usages today (typecheck-cleanup audit confirmed). Decide: delete the alias or keep dormant.
- `@/*` → still in use; keep.
- `~/*`, `src/*` → check usage; delete if dormant.

### A3 — Stale workspace deps

Check each package's `package.json` for workspace deps that aren't actually imported:

```bash
for pkg in packages/*/package.json; do
  echo "=== $pkg"
  cat "$pkg" | grep "@nulo/"
done

# Then for each workspace dep, grep the package's src for actual usage
```

Drop deps that aren't imported.

## Boundary enforcement (Pillar 2)

### Tool choice — biome-first

> **Audit note (codex xhigh)**: rule lives at `style.noRestrictedImports`, not `correctness`. All examples below use `style`. Biome bans both runtime and `import type` imports — see "Type-only imports" subsection at the end of this section for policy.

We already have **Biome 2.x** installed (`biome.json` at root). Biome's `noRestrictedImports` rule can express:
- Per-package "this layer cannot import from these layers"
- Per-directory "components/ui cannot import services"

Biome is **bun-native ergonomics** — single binary, Rust-fast, integrated with the existing pre-commit hook. No new tooling, no Node startup overhead per check.

**Fallback**: dependency-cruiser is the industry standard for cross-package import graphs and supports more expressive rules (from→to matrix, transitive deps, `tsPreCompilationDeps`). We'll add it ONLY if biome can't express a critical rule. Predicted likelihood: low — every rule we need is "package X cannot import from packages [Y, Z, …]" which biome's `paths` array handles natively.

### Rules — package layering

Layer hierarchy (each package can import only the layers BELOW it):

```
wallet-core         (foundation; pure ports + types)
  ↑
wallet-crypto       (KDF + encryption; depends on wallet-core)
  ↑
extension-messaging (RPC plumbing; depends on wallet-core)
  ↑
aztec-runtime       (PXE + account; depends on wallet-core + extension-messaging)
  ↑
wallet-bridge       (wallet-sdk dispatcher; depends on wallet-core + extension-messaging — NOT aztec-runtime today)
  ↑
extension           (sink; can import anything below)
```

> **Audit verified (codex)**: `wallet-bridge` does NOT currently import `aztec-runtime`. Rule below preserves that cleaner-than-claimed boundary by adding `aztec-runtime` to wallet-bridge's denylist.

### Subpath exports — must use patterns

The repo's cross-package imports use subpath exports (`@nulo/extension-messaging/offscreen`, `@nulo/aztec-runtime/pxe`, `@nulo/wallet-core/logger`, etc.). Banning bare package names alone misses these. Each rule below uses both forms: the bare package + the subpath glob.

Biome's `noRestrictedImports.paths` matches **literal module specifiers**. To catch subpaths, list each package twice: `"@nulo/X"` and `"@nulo/X/*"` — but biome does not natively expand `*` in paths-key form. Verified workaround: use the broader `patterns` key (biome 2.x supports it) for prefix matching:

```json
"noRestrictedImports": {
  "level": "error",
  "options": {
    "paths": {
      "@nulo/extension": "wallet-core cannot import extension"
    },
    "patterns": [
      { "group": ["@nulo/extension/*"], "message": "wallet-core cannot import extension subpaths" }
    ]
  }
}
```

If biome 2.x's `noRestrictedImports.patterns` shape differs from the above, fall back to listing every concrete subpath that exists today (extracted from each package's `exports` field). Inventory:

- `@nulo/wallet-core` — `.`, `./logger`, `./utils`, `./base`, `./ports` (verify)
- `@nulo/wallet-crypto` — `.`
- `@nulo/extension-messaging` — `./background`, `./offscreen`, `./messages`
- `@nulo/aztec-runtime` — `.`, `./pxe`, `./account`, `./ports`, `./adapters`, `./utils`, `./offscreen/entry`
- `@nulo/wallet-bridge` — `.`
- `@nulo/extension` — `.` (no subpath exports today)

Translated to `biome.json` overrides per-package — each layer gets a forbidden-imports list:

```json
{
  "overrides": [
    {
      "includes": ["packages/wallet-core/src/**"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "paths": {
                  "@nulo/wallet-crypto":      "wallet-core is the foundation — cannot import wallet-crypto",
                  "@nulo/extension-messaging": "wallet-core cannot import extension-messaging",
                  "@nulo/aztec-runtime":      "wallet-core cannot import aztec-runtime",
                  "@nulo/wallet-bridge":      "wallet-core cannot import wallet-bridge",
                  "@nulo/extension":          "wallet-core cannot import extension"
                }
              }
            }
          }
        }
      }
    },
    {
      "includes": ["packages/wallet-crypto/src/**"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "paths": {
                  "@nulo/extension-messaging": "wallet-crypto cannot import extension-messaging",
                  "@nulo/aztec-runtime":       "wallet-crypto cannot import aztec-runtime",
                  "@nulo/wallet-bridge":       "wallet-crypto cannot import wallet-bridge",
                  "@nulo/extension":           "wallet-crypto cannot import extension"
                }
              }
            }
          }
        }
      }
    },
    {
      "includes": ["packages/extension-messaging/src/**"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "paths": {
                  "@nulo/wallet-crypto":  "extension-messaging cannot import wallet-crypto",
                  "@nulo/aztec-runtime":  "extension-messaging cannot import aztec-runtime",
                  "@nulo/wallet-bridge":  "extension-messaging cannot import wallet-bridge",
                  "@nulo/extension":      "extension-messaging cannot import extension"
                }
              }
            }
          }
        }
      }
    },
    {
      "includes": ["packages/aztec-runtime/src/**"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "paths": {
                  "@nulo/wallet-bridge": "aztec-runtime cannot import wallet-bridge",
                  "@nulo/extension":     "aztec-runtime cannot import extension"
                },
                "patterns": [
                  { "group": ["@nulo/wallet-bridge/*"], "message": "aztec-runtime cannot import wallet-bridge subpaths" },
                  { "group": ["@nulo/extension/*"],     "message": "aztec-runtime cannot import extension subpaths" }
                ]
              }
            }
          }
        }
      }
    },
    {
      "includes": ["packages/wallet-bridge/src/**"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "paths": {
                  "@nulo/aztec-runtime": "wallet-bridge cannot import aztec-runtime (preserves current cleaner boundary)",
                  "@nulo/extension":     "wallet-bridge cannot import extension"
                },
                "patterns": [
                  { "group": ["@nulo/aztec-runtime/*"], "message": "wallet-bridge cannot import aztec-runtime subpaths" },
                  { "group": ["@nulo/extension/*"],    "message": "wallet-bridge cannot import extension subpaths" }
                ]
              }
            }
          }
        }
      }
    }
  ]
}
```

`@nulo/extension` is the sink — no forbidden imports.

### Rule — UI primitives boundary inside extension (compensates for M3.6 deferral)

Without M3.6, UI primitives in `src/components/` live alongside service-bound code. We still want the boundary: **a Button shouldn't import a service client.** Express via biome override.

> **Audit note (codex)**: original denylist missed `@/utils/core`, `@/stores/notification.store`, `@/wallet/services/account-state/client`, `@/wallet/services/transaction/client`, `@/wallet/services/log-viewer/client`, `@/wallet/services/note/client`. Real components proved the gap (`Popup.vue` uses `@/utils/core`; `NotificationManager.vue` uses `notification.store`). The list below is now exhaustive — verified against `find packages/extension/src/wallet/services -name "client.ts"` + the actual store/composable inventory at master `954b4d2`.

```json
{
  "includes": [
    "packages/extension/src/components/core/**",
    "packages/extension/src/components/ui/**"
  ],
  "linter": {
    "rules": {
      "correctness": {
        "noRestrictedImports": {
          "level": "error",
          "options": {
            "paths": {
              "@/utils/core": "UI primitives cannot use the managers/core utilities (service clients hide here)",
              "@/wallet/services/network/client":             "UI primitives cannot import service clients",
              "@/wallet/services/account/client":             "UI primitives cannot import service clients",
              "@/wallet/services/account-state/client":       "UI primitives cannot import service clients",
              "@/wallet/services/profile/client":             "UI primitives cannot import service clients",
              "@/wallet/services/execution/client":           "UI primitives cannot import service clients",
              "@/wallet/services/token/client":               "UI primitives cannot import service clients",
              "@/wallet/services/token-balance/client":       "UI primitives cannot import service clients",
              "@/wallet/services/dapp-session/client":        "UI primitives cannot import service clients",
              "@/wallet/services/dapp-interaction/client":    "UI primitives cannot import service clients",
              "@/wallet/services/passkey/client":             "UI primitives cannot import service clients",
              "@/wallet/services/contact/client":             "UI primitives cannot import service clients",
              "@/wallet/services/fpc/client":                 "UI primitives cannot import service clients",
              "@/wallet/services/auth-registry/client":       "UI primitives cannot import service clients",
              "@/wallet/services/operation-journal/client":   "UI primitives cannot import service clients",
              "@/wallet/services/task/client":                "UI primitives cannot import service clients",
              "@/wallet/services/transaction/client":         "UI primitives cannot import service clients",
              "@/wallet/services/log-viewer/client":          "UI primitives cannot import service clients",
              "@/wallet/services/note/client":                "UI primitives cannot import service clients",
              "@/wallet/services/config/client":              "UI primitives cannot import service clients",
              "@/wallet/services/logger/client":              "UI primitives cannot import service clients",
              "@/wallet/services/pxe/client":                 "UI primitives cannot import service clients",
              "@/wallet/services/wallet-sdk/background":      "UI primitives cannot import service clients",
              "@/stores/app.store":           "UI primitives cannot import stores",
              "@/stores/popup.store":         "UI primitives cannot import stores",
              "@/stores/cache.store":         "UI primitives cannot import stores",
              "@/stores/notification.store":  "UI primitives cannot import stores",
              "@/composables/configClient":   "UI primitives cannot import service-client composables",
              "@/composables/externalLinks": "UI primitives cannot import service-client composables",
              "@/composables/externalImage": "UI primitives cannot import service-client composables"
            },
            "patterns": [
              { "group": ["@/wallet/services/*/client"], "message": "UI primitives cannot import any *Service client" },
              { "group": ["@/stores/*"],                 "message": "UI primitives cannot import any Pinia store" }
            ]
          }
        }
      }
    }
  }
}
```

**Exemptions (already known)** — these components legitimately use stores/services and stay outside the rule. Codify them as exclusions or move them into `src/components/` (not `core/` or `ui/`):
- `src/components/Header.vue` (already outside `ui/`)
- `src/components/ui/AddressDisplay.vue` ← needs to move to `src/components/` OR get marked as legitimate exception
- `src/components/ui/GlobalLoader.vue` ← same
- `src/components/ui/NotificationManager.vue` ← same
- `src/components/ui/Popup/PopupCard.vue` and `Popup.vue` ← same
- `src/components/ui/JsonViewer/JsonViewer.vue` and `LogsViewer.vue` ← same

**Recommendation**: move the 7 service-bound files OUT of `ui/` into `src/components/` flat (or a new `src/components/composite/` namespace) **as part of this milestone**. This way the directory-level rule's exclusion list stays empty and the boundary is obvious. The brutalist redesign already accepts that pattern (Header.vue is outside `ui/` already).

### Rule — chrome.* hard-blocked in non-Chrome packages

`wallet-core` MUST NOT use `chrome.*` directly (it's the pure-port layer). Biome rule:

```json
{
  "includes": ["packages/wallet-core/src/**"],
  "linter": {
    "rules": {
      "correctness": {
        "noRestrictedImports": {
          "level": "error",
          "options": {
            "paths": {
              "chrome-types": "wallet-core is platform-agnostic — no chrome-types"
            }
          }
        }
      }
    }
  }
}
```

`wallet-crypto` is also pure but already typecheck-clean without `chrome-types` — leave its `paths` empty unless we see drift.

### Why we don't need dependency-cruiser yet

Biome covers:
- ✅ Per-package layer rules (`@nulo/X` cannot be imported from `@nulo/Y`)
- ✅ Per-directory rules (`components/ui` cannot import service clients)
- ✅ chrome-types blocking

Biome does NOT cover:
- ❌ "Y can import X but not Z" matrix (only "Y cannot import Z")
- ❌ Transitive dependency analysis
- ❌ `@/` alias resolution to internal extension paths (biome 2.x's import resolution may handle this — needs verification during execution)
- ❌ `.vue` file analysis (biome has limited `.vue` support)

For our current architecture, the boundary checks are **package-level** (the package import graph) plus **one directory rule**. Both are within biome's expressive range.

If, during execution, we discover biome can't express a rule we need (e.g., `.vue` files in `components/ui/` need the directory rule applied), we'll add dependency-cruiser as a supplement. **Predict: this won't happen** because biome 2.x added VCS-aware + import-graph features, our rules are simple, and codex confirmed `.vue` files are in scope (existing `.vue` override at `biome.json:47`).

### Type-only import policy

Biome's `noRestrictedImports` bans both `import X from "..."` and `import type X from "..."` against the same path. Default policy for M3.7:

- **Boundary-violating runtime imports**: hard error (catches the real architectural drift).
- **Boundary-violating type-only imports**: also hard error. Reasoning: if `wallet-core` could `import type` from `extension`, it's still depending on `extension`'s shape, just at compile time. The whole point of the layer hierarchy is the lower layer doesn't know about higher layers — even structurally.
- **Exception escape hatch**: if we hit a legitimate cross-layer type-only need (e.g. an interface that has to be defined somewhere), the right move is to LIFT the type to the lower layer (where it should have lived anyway). If that's not possible, codify with a `// biome-ignore lint/style/noRestrictedImports: <reason>` comment + a tracking task. No silent exemptions.

## Per-package test/typecheck scripts (Pillar 3)

`bun run --filter '@nulo/*' typecheck` already works (typecheck cleanup shipped this). Verify each package has the script.

> **Audit note (codex)**: actual current state at master `954b4d2`:
> - `wallet-core`, `wallet-crypto`, `extension-messaging` already have `test` scripts
> - `wallet-bridge` has `scope-enforcement.test.ts` but no `test` script
> - `aztec-runtime`, `playground`, `landing` have no `test` scripts
>
> **`bun run --filter '@nulo/*' --if-present test` works** — packages without the script are silently skipped. No-op stubs are optional, not required.

Decision: use `--if-present` instead of stubs. Cleaner, less file churn, packages that don't have tests don't lie about it.

Update / add scripts:

| Package | Has `test`? | Action |
|---|---|---|
| `@nulo/wallet-core` | yes | verify still `"vitest run"` |
| `@nulo/wallet-crypto` | yes | verify |
| `@nulo/extension-messaging` | yes | verify |
| `@nulo/aztec-runtime` | no | leave as-is (no tests in this package) |
| `@nulo/wallet-bridge` | no | **add `"test": "vitest run"`** — exercises `scope-enforcement.test.ts` |
| `@nulo/extension` | yes | verify |
| `@nulo/playground` | no | leave as-is |
| `@nulo/landing` | no | leave as-is |

Add to root `package.json`:
```json
"test:all": "bun run --filter '@nulo/*' --if-present test",
"check:imports": "biome check packages/"
```

`check:imports` is a wrapper for boundary checking. Existing pre-commit hook already runs `biome check --staged`, which catches violations on changed files. The `check:imports` script is for full-repo audits (one-shot or pre-merge).

## Cleanup tasks

### C1 — Delete dead path aliases

Per audit A2. Most likely candidates:
- `@assets/*` in `packages/extension/tsconfig.json` (0 src usages)
- Other aliases that resolved to extracted packages

### C2 — Update CLAUDE.md with package graph

Add a one-section diagram at the top of `CLAUDE.md` showing the layer hierarchy, so future contributors (and future-Claude) know which package can import what.

### C3 — Fix any stale commits in `architecture/plan/03-final-plan-v3.md`

The master plan still mentions M3.6 as live. Update with the deferral note + a one-liner reference to `implementations-plan/M3/7/plan.md`.

## Step-by-step execution

### Step 0 — Branch + baseline (15 min)

```bash
git checkout -b m3/7-boundary-enforcement master
bun run typecheck:all         # baseline: 0 errors expected
bun run test                  # 458/458 expected
```

### Step 1 — Audit sweep (1-3 hours)

Run A1 + A2 + A3 grep audits. Capture findings in `implementations-plan/M3/7/audit-findings.md`.

If A1 surfaces a "should have moved" file:
- Small file: move it now (treat as M3.7 sub-task).
- Big file: defer + open task ID, document in audit-findings.md.

### Step 2 — Move service-bound components OUT of `ui/` (1 hour)

To keep the UI-primitives boundary rule's exclusion list empty.

> **Audit note (codex)**: `JsonViewer.vue` imports `./theme.js` and `LogsViewer.vue` imports `./creator.js` — local helpers. Move them too. `components.d.ts` is auto-generated and hardcodes the old paths — delete + regenerate **before** running typecheck.

Move components + helper files:

```bash
mkdir -p packages/extension/src/components/Popup
mkdir -p packages/extension/src/components/JsonViewer

git mv packages/extension/src/components/ui/AddressDisplay.vue       packages/extension/src/components/
git mv packages/extension/src/components/ui/GlobalLoader.vue          packages/extension/src/components/
git mv packages/extension/src/components/ui/NotificationManager.vue   packages/extension/src/components/

git mv packages/extension/src/components/ui/Popup/Popup.vue           packages/extension/src/components/Popup/
git mv packages/extension/src/components/ui/Popup/PopupCard.vue       packages/extension/src/components/Popup/
# PopupHeader.vue STAYS in ui/Popup/ — no service deps

git mv packages/extension/src/components/ui/JsonViewer/JsonViewer.vue packages/extension/src/components/JsonViewer/
git mv packages/extension/src/components/ui/JsonViewer/LogsViewer.vue packages/extension/src/components/JsonViewer/
git mv packages/extension/src/components/ui/JsonViewer/theme.js       packages/extension/src/components/JsonViewer/
git mv packages/extension/src/components/ui/JsonViewer/creator.js     packages/extension/src/components/JsonViewer/
# verify ./theme.js + ./creator.js are the only relatives — adjust if more
```

If `ui/Popup/` or `ui/JsonViewer/` is now empty (PopupHeader stayed in ui/Popup), keep the dirs that have remaining files; remove ones that became empty:

```bash
ls packages/extension/src/components/ui/JsonViewer/    # likely empty → rmdir
ls packages/extension/src/components/ui/Popup/         # has PopupHeader → keep
```

**CRITICAL**: delete the auto-generated `components.d.ts` BEFORE the next typecheck:

```bash
rm packages/extension/src/types/components.d.ts
```

Run `bun run dev` once briefly (or trigger a build via `bun run build`) so `unplugin-vue-components` regenerates `components.d.ts` with the new paths. Cancel dev server when components.d.ts shows the moved entries.

Then verify:

```bash
bun run typecheck    # 0 errors
bun run build        # clean
```

If explicit imports broke (likely some `.vue` files import via full path rather than auto-import), `bun run build` will surface them. Fix in batch.

### Step 3 — Add biome layering rules to `biome.json` (30 min)

Apply the per-package overrides + UI directory rule + chrome-types rule from the Boundary Enforcement section. Run:
```bash
bun run lint
```
Expected: zero violations (current code is already clean — we're locking in correctness).

### Step 4 — Add per-package test scripts (15 min)

Audit each package's `package.json`. Add `"test": "vitest run"` where tests exist; `"test": "echo 'no tests in this package'"` where they don't. Add `test:all` + `check:imports` to root.

```bash
bun run test:all       # all packages should pass (or echo no-tests)
bun run check:imports  # full-repo biome run; 0 violations expected
```

### Step 5 — Cleanup tasks (1 hour)

- C1: Delete `@assets/*` if A2 confirmed unused.
- C2: Add the layer-hierarchy diagram to `CLAUDE.md`.
- C3: Update `architecture/plan/03-final-plan-v3.md` with the M3.6 deferral note.

### Step 6 — Verify + commit (30 min)

```bash
bun run typecheck:all   # 0 errors across 8 packages
bun run test:all        # all green
bun run check:imports   # 0 boundary violations
bun run build           # clean

git add -A
git commit -m "refactor(boundaries): biome-enforced package layers + UI primitives boundary [M3.7]"
```

### Step 7 — QA (10 min)

Sanity check: open a UI primitive, add `import { useAppStore } from "@/stores/app.store"`, run `bun run lint`. Expect: error fires. Revert.

### Step 8 — Merge

When green:
```bash
git checkout master && git merge --no-ff m3/7-boundary-enforcement
git push origin master
```

Bump version to 0.13.1.

## Verification matrix

| Check | Expected |
|---|---|
| `bun run typecheck:all` | 8 packages exit 0 |
| `bun run test:all` | All packages report green or no-op |
| `bun run check:imports` | 0 violations |
| `bun run build` | clean |
| **Adversarial test**: add forbidden import in `wallet-core` | biome rejects |
| **Adversarial test**: add `useAppStore` to `Button.vue` | biome rejects |
| **Adversarial test**: add `import "chrome-types"` in `wallet-core` | biome rejects |

## Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | Biome's `noRestrictedImports` doesn't resolve `@/` aliases | MED | Verify on Step 3 — adversarial test catches false negatives. If broken, add literal-path entries (`packages/extension/src/wallet/services/...`) as second-layer rule |
| 2 | Pre-commit hook (`biome check --staged`) misses violations on unchanged files | LOW | `check:imports` script does full-repo run; manual gate before merge |
| 3 | Component-move pass (Step 2) breaks import paths that weren't auto-imported | LOW-MED | Run `bun run build` after Step 2; broken explicit imports surface immediately |
| 4 | A1 audit surfaces a big file that "should have moved" mid-milestone | LOW | Defer to a follow-up task; document in audit-findings.md |
| 5 | Biome 2.x `noRestrictedImports` doesn't support `paths` as object-with-messages on this version | LOW | Verify against installed biome version; fall back to array form if needed |

## Out-of-scope (deferred)

- **CI integration** — separate epic. M3.7 sets up the scripts; CI wiring (pre-commit hook expansion, GitHub Actions) is a future plan. Pre-commit `biome check --staged` already runs on every commit and catches new violations.
- **dependency-cruiser** — not adopted. Will be revisited only if biome can't express a rule we need.
- **`.vue` file analysis** — biome has limited Vue support. The directory-level rule will catch `<script lang="ts">` imports inside SFCs but not `<script>` (no lang) imports. Mitigation: blanket `*.vue` shim already enforces `lang="ts"` in newly-typed components, and the brutalist redesign + typecheck cleanup arc already typed the components that need defineSlots.
- **Vue component tests** — M5.1 territory.
- **Per-package build scripts** — not needed yet; only `extension` builds (it's the consumer; other packages are source-only via subpath exports).

## Open questions for auditor

1. Does biome 2.x's `noRestrictedImports` actually resolve `@/` paths in the rule definitions, or do we need to specify literal `packages/extension/src/wallet/services/...` paths?
2. The `paths` object-with-messages form (`"@nulo/extension": "message"`) — does biome 2.x parse this, or is it array-only? Needs version-check.
3. For the UI-primitives directory rule: does biome's `includes` glob match `.vue` files for purposes of `noRestrictedImports`? If not, the rule only catches `.ts`/`.tsx` consumers — a real-world UI primitive in a `.vue` file could still violate.
4. Is moving 7 components out of `src/components/ui/` (Step 2) worth doing within M3.7, or should they stay where they are with a documented exclusion list? Tradeoff: clean rule vs. file churn.
5. `@nulo/playground` and `@nulo/landing` — should they get layer rules too (e.g., "playground cannot import wallet-core")? Likely not — they're dApp scaffolds, may legitimately import various packages for testing.
6. Should the layer hierarchy in CLAUDE.md include `@nulo/extension-ui` as a phantom future layer (with a deferred note), or only the 7 real packages today?

## Size estimate

**2-3 days** of work:
- 0.5 day: audit sweep (Step 1)
- 0.5 day: component move + biome rules (Steps 2-3)
- 0.5 day: per-package scripts + cleanup (Steps 4-5)
- 0.5 day: verify + adversarial tests (Steps 6-7)
- 0.5 day: buffer for biome quirks
