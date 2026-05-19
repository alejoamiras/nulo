# Documentation Improvement — Plan v2 (post-audit)

> v2 deltas (over v1): both auditors flagged P0/P1 gaps. Codex caught a regression risk (the `phase [0-9]` grep arm matches LIVE runtime phase docs in `wallet-core/src/base/`). Opus caught CLAUDE.md compression risk + 8 strong package-opener sentences. Both flagged: ARCHITECTURE.md TOC is incomplete, full Storybook build (not spot-check), commit-3 review burden.

## 0. Locked decisions

1. README depth: tight reference (~80–120 lines).
2. Architecture: root `ARCHITECTURE.md` + tighter `CLAUDE.md`.
3. Strip every milestone tag; keep WHY/invariant; reword for clarity; delete if residue is uninformative.
4. PR shape: one PR. Commit shape: **see §4 — open user question**.

## 1. Scope inventory (revised)

### Two-pass grep

**Pass 1 — historical tags (sweep target):**
```
grep -rEn "(M[0-9]+(\.[0-9]+)?\b|A11\.|pre-[A-Z][0-9]|PR[- ][0-9]+|Stage [A-Z]|implementations?-plan|implementation plan)" packages/ --include="*.ts" --include="*.vue" | grep -E "^\s*[^:]+:[0-9]+:\s*(//|/\*|\*)"
```

**Pass 2 — `phase [0-9]` arm, ONLY in non-runtime-doc files:**
Whitelist `packages/wallet-core/src/base/**` and any other file where `phase` describes live runtime behavior (service startup phases, parallel-dispatch phases). Verified live-runtime sites:
- `packages/wallet-core/src/base/index.ts` (lines 25, 56, 62)
- `packages/wallet-core/src/base/topology.ts:47`
- `packages/extension/src/wallet/services/profile/service.ts:143` — verify before sweep

Everywhere else, `phase N` is milestone vocabulary and gets stripped.

**Excluded from sweep (keep verbatim):** `AUDIT [A-Z]\d+` — security markers, content-rich, not vocabulary.

### Per-package counts (re-estimated)

Final counts will be measured per-pass post-grep. Original v1 numbers (`237 across 123 files`) were under-counted; revised expectation **≈ 300+ in ≈ 122 files** once PR-N (42 hits), bare M\d (34 hits), and pre-X\d-beyond-A11 (18 hits) are included. The plan does not depend on the exact number — buckets are what matter.

## 2. Outputs

### 2.1 Root README (≤120 lines)

Sections:
1. What is Nulo — one paragraph.
2. Status — what works / what's locked / what's fluid. Avoid volatile counts (no "46/66 passing").
3. Quick start — 3 commands.
4. Monorepo at a glance — package table.
5. Where to read next — links.
6. Build + dev commands — minimal.
7. Quality gates — pre-commit, commitlint, biome.
8. Download placeholder.

### 2.2 ARCHITECTURE.md (≤350 lines)

Sections (expanded post-audit):
1. **Process boundaries** — service worker, popup, content script, offscreen. ASCII diagram.
2. **Package layer hierarchy** — moves from CLAUDE.md.
3. **Message flow** — `ServiceClient` ↔ `Service` ↔ `OffscreenService`. File:line citations to base classes.
4. **State surface** — Pinia stores, chrome.storage, PXE IndexedDB.
5. **Storage versioning + destructive migration** — `migrate.ts:1`, version gates, 0.11.0 wipe of legacy account/tx/balance state, PXE IndexedDB clear. Live compat boundary: "pre-0.11.0 wallets are not migratable" — kept verbatim.
6. **Offscreen lifecycle** — `utils/offscreen.ts:206`-area. `ensureOffscreenRunning` → `isOffscreenHealthy` → zombie recreate. SW-restart resilience.
7. **Profile + session model** — password vs passkey. `session-manager.ts:196` strict-mode restore semantics. Late activation pattern post-restore.
8. **dApp session + capability surface** — `wallet-sdk/background.ts:289` auto-approve lifecycle, `wallet-bridge/capability-map.ts`, scope enforcement. Capability bundles live in playground README, not here.
9. **Concurrency model** — `wallet-core/src/utils/rw-guard.ts:21` reader/writer guard; manual `enterWrite/leaveWrite` for destructive cross-await ops (profile switch/delete). Service `Lock` class for single-flight per service.
10. **Auth + crypto model** — wallet-crypto ownership, KDF / `PasswordSecretBox` / passkey PRF→HKDF derivation chain, vector lock at `wallet/crypto/key-vectors.test.ts`. Buffer-ownership invariants.
11. **Account contract** — upstream `@aztec/accounts/schnorr` adapter (`NuloAccount`), `DefaultAccountEntrypoint`, `DefaultMultiCallEntrypoint` for ctor+app, recursive payload chunking (>5 calls), `Fr.ZERO` instantiation salt.
12. **Fee-payment model** — what's wired, what's gapped (private cold-start), pointer to incomplete plan if any.
13. **Build artifacts** — Chrome vs Firefox manifests, where bundles land, vite env propagation.
14. **Test taxonomy** — unit colocated, component layer, e2e smoke (`vitest.e2e.config.ts`), e2e network (`vitest.e2e.network.config.ts` + `e2e:agent`). Each gate's scope + invocation. Note: `audit:vue` does NOT run e2e (per `vitest.config.ts:68` excludes); smoke e2e is the separate gate.

### 2.3 CLAUDE.md (rewrite — tighter)

**DO NOT COMPRESS — preserve verbatim:**
- `onBeforeUnmount` cleanup-order code block (current `CLAUDE.md:132-147`). Order is load-bearing.
- Coverage minimums per layer (≥5 / ≥10 / ≥10) (current `CLAUDE.md:100-104`).
- Vue SFC 10-section script-setup ordering template (current `CLAUDE.md:296-378`).
- `chrome.*` stub file:line citation `tests/vitest.setup.ts:88-113` (current `CLAUDE.md:98`).
- **`data-testid` preservation rule** (current `CLAUDE.md:118-120`).
- **`noExplicitAny` + `biome-ignore` discipline** (current `CLAUDE.md:178`).

**Sections of the new CLAUDE.md:**
1. What this file is — one sentence (Claude-operating ruleset, not architecture).
2. Pointers — `ARCHITECTURE.md`, per-package READMEs, `tests/e2e/README.md`, `implementations-plan/README.md`.
3. Working in this repo — Bun, biome, commitlint, hooks, `audit:vue` gate.
4. Package boundaries — short rules + `biome.json` reference.
5. **L0–L6 component layer model** — verbatim.
6. **C0/C1 composable rules** — "parent owns connect/disconnect; composable exposes dispose()".
7. **Vue component test conventions** — verbatim coverage minimums + `chrome.*` stub citation.
8. **`onBeforeUnmount` cleanup order** — verbatim code block.
9. **Vue SFC ordering convention** — verbatim 10-section template.
10. **testid preservation rule** — verbatim.
11. **Lint-suppression discipline** — `noExplicitAny`, `biome-ignore` format.
12. **Code-comment style guide** — new; see §2.4.
13. Quality gates + when to run them.

Account-contract narrative + storage-migration narrative move to ARCHITECTURE.md (§11 + §5). CLAUDE.md keeps the layer/test/cleanup rules.

### 2.4 Code-comment style guide (new CLAUDE.md section)

- **Default: no comment.** Identifiers carry intent.
- **Add a comment only when removing it would surprise a reader** — hidden constraint, subtle invariant, workaround for a specific bug, behavior dictated by external spec.
- **Comments explain WHY/INVARIANT, not WHAT.**
- **No milestone, plan, PR, phase, or stage tags.** Not `M4.10`, `A11.1`, `pre-A11`, `phase 4b`, `PR-2`, `Stage D`. Git history is in git.
- **Exception — `AUDIT [A-Z]\d`** stays. These mark security-relevant decisions, are short, content-rich, and pair with code in test files.
- **Exception — runtime phase docs** (`wallet-core/src/base/`) stay. `phase 0/1/2/3` there describes parallel-dispatch behavior, not milestones.
- **Live cross-references OK** to `implementations-plan/<dir>/<file>.md` only if the target is in the allow-list (§2.6).
- **External-string fork history** (e.g. user-facing "Legacy Faucet" strings) is product copy, not a tag — out of scope for this sweep.
- **Live compat-boundary version refs** (e.g. "pre-0.11.0 wallets are not migratable") stay.
- **TSDoc shape for public APIs** — `/** ... */` block. One-line summary, optional follow-up paragraph. `@param` / `@returns` only when name/type don't say it.
- **Inline comments are full sentences** with terminal punctuation. Soft cap 100 chars.
- **`// biome-ignore`** carries a reason: `// biome-ignore lint/X: reason`.
- **Bug pins** in tests use `(BUG PIN)` prefix.

### 2.5 implementations-plan/README.md

Sections:
1. What this directory is.
2. When to create a plan.
3. Suggested per-plan layout (`plan.md`, `audit-*.md`, `decisions.md`, `STATUS.md`).
4. Naming (kebab-case topic).
5. Retention — plans stay; code does NOT reference them by milestone tag; only by path for the load-bearing allow-list.
6. **Migration history table** — 5-line map:
   - **M2** — wallet-crypto extraction (KDF / `PasswordSecretBox` / passkey PRF).
   - **M3** — layer-package split (wallet-core, wallet-crypto, extension-messaging, aztec-runtime, wallet-bridge as separate packages).
   - **M4** — profile / session / security model (`session-manager`, strict mode, lock TTL, network model rework).
   - **M6** — component refactor (L0–L6 layer model, composables C0/C1, Storybook stories, design tokens).
   - **A11** — `onBeforeUnmount` / lifecycle / service-client cleanup hardening.

### 2.6 Live cross-reference allow-list (the only `implementations-plan/...md` paths still cited from code post-cleanup)

- `passkey-e2e/PRF-NON-PORTABLE.md` — live; explains a real Chrome-side limitation tests rely on.
- `network-test-triage/plan.md` — live; tracks current 18-test failure bucket.

**Decided removals (per Opus + Codex):**
- `M6/conventions.md` — fold still-current rules into CLAUDE.md; rest is stale (Histoire, Lost Pixel, branch naming). Drop cross-refs from `Button.stories.ts:7`, `Button.test.ts:11`, `.storybook/main.ts:5`.
- `pre-a11-ux-cleanup/plan-v4.md` — DELETE cross-refs (`NewContactPopup.vue:112`, `send.vue:249`).
- `pr-8c-mixed-and-fee/consolidated.md` — DELETE cross-ref (`fast-path.ts:34`).
- `fee-estimation-init-race/plan.md` — DELETE cross-ref (`FeeSettingsCard.test.ts:9`); the test name + invariant inside the test already explains the regression class.

### 2.7 Package READMEs (8)

Each follows the template at v1 §2.6. Opening sentences (calibrated from Opus's suggestions):

- **`@nulo/extension`** — "The Chrome/Firefox Manifest V3 wallet extension. Service worker, popup UI, content script, and offscreen PXE host wired together."
- **`@nulo/wallet-bridge`** — "The dApp-facing dispatcher. Implements the wallet-sdk capability map, narrows protocol messages into typed service calls, and enforces session scope. Does not depend on the Aztec runtime — the bridge is transport-shaped, not chain-shaped."
- **`@nulo/aztec-runtime`** — "PXE lifecycle + Nulo's adapter over `@aztec/accounts/schnorr` (`NuloAccount`). Owns class-id verification and payload chunking. Runs inside the offscreen document; the service worker talks to it via `extension-messaging`."
- **`@nulo/extension-messaging`** — "Typed RPC plumbing between the service worker, popup, and offscreen document. Defines `Service` / `ServiceClient` / `OffscreenService` base classes; reconstructs `Error` instances across the boundary; ships a telemetry sidecar."
- **`@nulo/wallet-crypto`** — "Password and passkey-based KDF, `PasswordSecretBox` encryption, and the vector-locked derivation chain. Buffer ownership is explicit; secret material is zeroed on drop. Vectors must not change without ratcheting the storage version."
- **`@nulo/wallet-core`** — "The foundation. Pure ports, types, and platform-agnostic utilities. No `chrome.*` (enforced by biome `noRestrictedGlobals`); no I/O. Every package above depends on this; this depends on nothing."
- **`@nulo/playground`** — "Test dApp used by the network e2e suite. Exposes a known testid catalog, deploys a token contract on boot, and renders deterministic operations the suite drives end-to-end."
- **`@nulo/landing`** — "Marketing landing page. Standalone Vite app; ships independently of the extension."

Per-package focus same as v1 plus:
- **playground README** — owns the **capability bundles** explanation (per Codex P1-4: belongs here, not root architecture).
- **extension README** — owns links into the M6 layer model in CLAUDE.md; does NOT re-document it.

## 3. Comment cleanup methodology — six buckets (v2)

### 3.1 KEEP, drop tag
"M4.4 send_failed: chrome.runtime.sendMessage rejected" → "send_failed: chrome.runtime.sendMessage rejected"

### 3.2 REWORD
"M3.1: extracted from extension into wallet-core, pure now." → "Pure package — no chrome.* allowed; foundation of the layer hierarchy."

### 3.3 DELETE
"// Pre-M2.4-a behavior preserved verbatim." → delete.

### 3.4 REPLACE cross-ref (allow-list only) or DELETE
- Live → keep with path (allow-list §2.6).
- Folded → re-point to CLAUDE.md / ARCHITECTURE.md / package README.
- Dead → delete.

### 3.5 SPLIT-BLOCK (new)
When a single comment block mixes a live invariant with a removable tag-paragraph, split:
- `execution-coordinator.ts:3` — keep the live class contract; trim the PR-scope narration.
- `config.ts:13` — keep the `AUDIT A1` security note; drop the `M4.2` framing.
- `dapp-session/service.ts:78` — keep the live security rationale; drop the `PR-10` framing.

### 3.6 OUT-OF-SCOPE — runtime phase docs (new)
Comments where `phase N` describes live behavior (service startup phases in `wallet-core/src/base/`). Whitelist before sweep. Confirmed sites:
- `packages/wallet-core/src/base/index.ts:25, 56, 62`
- `packages/wallet-core/src/base/topology.ts:47`
- `packages/extension/src/wallet/services/profile/service.ts:143` — verify in place.

### Out-of-scope (don't touch)
- External strings (user-facing copy with fork-era branding).
- Live compat-boundary version refs ("pre-0.11.0 wallets are not migratable").
- Volatile metrics inside `tests/e2e/README.md` (test-pass counts, port tables). Already correctly placed.

## 4. Execution order — commit shape (OPEN — needs user pick)

Single branch `docs/improvement-pass`. Two shapes on the table:

**Shape A — three labeled commits (original lock):**
1. Top-level docs (README + ARCHITECTURE + CLAUDE + plan-dir README).
2. Package READMEs (8 files).
3. Code-comment cleanup (~300+ edits across ~120 files).

**Shape B — eight commits (post-audit recommendation):**
1. Top-level docs.
2. Package READMEs.
3. Comment cleanup — `wallet-core` (~16 refs).
4. Comment cleanup — `wallet-crypto` (~10).
5. Comment cleanup — `extension-messaging` (~9).
6. Comment cleanup — `aztec-runtime` (~11).
7. Comment cleanup — `wallet-bridge` (~9).
8. Comment cleanup — `extension` (~250+).

Both audits independently recommended Shape B for review tractability. Same PR; same total work. Shape B trades commit count for reviewability: GitHub renders 100+ file commits sluggishly and reviewers can't meaningfully scroll a single judgement-heavy diff that spans the whole repo.

## 5. Validation gates (revised)

Pre-PR:
1. **Baseline `bun run audit:vue` on master** — capture pre-existing failures so the docs PR doesn't get blamed for them.
2. **`bun run audit:vue`** on the branch — `typecheck:all → test → lint → build`.
3. **`bun run test:e2e`** — smoke suite. **Required**: `audit:vue` excludes `tests/e2e/**` (per `vitest.config.ts:68`), so this is the only gate exercising edited e2e comment files.
4. **`bun run --cwd packages/extension build-storybook`** — full Storybook build. Story-header rewrites are user-visible UX copy in the docs page; the full build catches autodocs render breakage.

Not needed:
- `bun run e2e:agent` (no runtime code touched).
- Network e2e suite.

## 6. Risks + mitigations (revised)

| Risk | Mitigation |
|---|---|
| Stripping `phase N` regresses live runtime docs | Whitelist `wallet-core/src/base/**` + verified sites before sweep (§3.6). |
| Reviewer can't read commit 3 | Shape B (per-package commits). User decides. |
| CLAUDE.md compression loses load-bearing rule | Verbatim list in §2.3 — six sections preserved character-for-character. |
| `M6/conventions.md` removal orphans live rules | Fold actionable content into CLAUDE.md / package READMEs before removing cross-refs. |
| Storybook autodocs UX text regresses silently | Full `build-storybook` runs; treat header rewrites as UX copy. |
| Comments that should have been promoted to README get deleted | When clean-up encounters non-obvious load-bearing prose, promote to the nearest README rather than delete. |
| New package readmes mirror volatile metrics | Plan §1 / §2.7 explicit: no test-pass counts or port tables in READMEs. |

## 7. Out of scope

- New tests; behavioral test changes (comment-only edits inside `.test.ts` files are in scope).
- Source-code behavior changes; refactors.
- Rewriting historical `implementations-plan/<topic>/*.md` content.
- Visual changes to the popup.
- E2E helper convention changes.
