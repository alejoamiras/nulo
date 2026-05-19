# Documentation Improvement — Plan v1

> User outcome: a first-time contributor opens the repo and within 15 minutes understands what Nulo is, how the monorepo is wired, where to find what, how to test, and how this codebase comments itself. A returning contributor (or Claude) opens any file and the surrounding comments explain WHY/INVARIANTS without dragging in milestone numbers nobody outside the room remembers.

## 0. Locked decisions (from user)

1. **README depth**: tight reference (~80–120 lines per package). Mirror style of `packages/extension/tests/e2e/README.md`.
2. **Cross-package architecture**: lives at root in `ARCHITECTURE.md`; `CLAUDE.md` becomes a tight ops/conventions ruleset that references it.
3. **Milestone tags in code comments**: strip every `M4.2 / A11.1 / phase 4b / PR-2` tag. Keep the comment when the WHY/invariant is non-obvious; reword for clarity. Drop the entire comment if the residue would not orient a reader.
4. **PR shape**: one PR, three labeled commits in order (docs → READMEs → comment cleanup).

## 1. Scope inventory (verified)

### Existing docs

| File | State | Action |
|---|---|---|
| `README.md` (root) | 339 bytes — marketing one-liner only | Rewrite |
| `CLAUDE.md` | 380 lines; decent but leaks milestone vocab into prose, no comment-style guide, no plan-dir reference | Rewrite (tight) |
| `packages/playground/README.md` | Solid; testid catalog references one historical plan path | Light update (drop the plan-path reference; keep the testid catalog) |
| `packages/extension/tests/e2e/README.md` | Excellent — already the style we want to mirror | Leave; reference from package READMEs |
| `implementations-plan/M2/README.md`, `M3/README.md`, `M4/README.md` | Historical | Leave (they live inside `implementations-plan/`) |

### New docs

| File | Purpose |
|---|---|
| `ARCHITECTURE.md` (root) | Cross-package picture: monorepo layout, layer hierarchy, message flow (SW ↔ popup ↔ offscreen ↔ content), build outputs, entry points |
| `implementations-plan/README.md` | What this directory is, when to create a plan, retention policy, link conventions |
| `packages/wallet-core/README.md` | New |
| `packages/wallet-crypto/README.md` | New |
| `packages/extension-messaging/README.md` | New |
| `packages/aztec-runtime/README.md` | New |
| `packages/wallet-bridge/README.md` | New |
| `packages/extension/README.md` | New |
| `packages/landing/README.md` | New |

### Comment-cleanup scope

Verified counts of comments referencing `M<n>.<m> | A11.* | pre-A11 | implementations-plan | implementation plan | phase <n>`:

| Package | Comment refs |
|---|---|
| `wallet-core` | 16 |
| `wallet-crypto` | 10 |
| `extension-messaging` | 9 |
| `aztec-runtime` | 11 |
| `wallet-bridge` | 9 |
| `extension` | 182 |
| `playground` | 0 |
| `landing` | 0 |
| **Total** | **237 across 123 files** |

## 2. Outputs

### 2.1 Root README (one page)

Sections, in order:

1. **What is Nulo** — one paragraph, the product pitch in technical terms (privacy-first Aztec wallet, Chrome MV3, account abstraction).
2. **Status** — what works, what doesn't, where the surface is locked vs. fluid.
3. **Quick start** — clone → bun install → build → load unpacked. Three commands.
4. **Monorepo at a glance** — the existing package table from `CLAUDE.md`, sized for a human (not Claude).
5. **Where to read next** — `ARCHITECTURE.md`, per-package READMEs, `tests/e2e/README.md`, `implementations-plan/README.md`, `CLAUDE.md`.
6. **Build + dev commands** — minimal: `bun run dev`, `bun run build`, `bun run test`, `bun run audit:vue`, `bun run e2e:agent`.
7. **Quality gates** — pre-commit hooks, commitlint, biome.
8. **Download link** placeholder (TODO existing).

Target: ≤120 lines.

### 2.2 ARCHITECTURE.md (root)

Sections:

1. **Process boundaries** — service worker, popup, content script, offscreen (PXE). Diagram in ASCII.
2. **Package layer hierarchy** — moves from CLAUDE.md (currently the canonical home).
3. **Message flow** — `ServiceClient` → `chrome.runtime.connect()` → `Service`; offscreen ↔ SW path via offscreen messaging package. Cite base classes by file path.
4. **State surface** — Pinia stores in the popup; chrome.storage usage; PXE IndexedDB in offscreen.
5. **dApp surface** — wallet-sdk dispatcher + capability map, in-page injection.
6. **Auth + crypto model** — password vs passkey profiles, what `wallet-crypto` owns, what derivation chains are vector-locked.
7. **Build artifacts** — Chrome vs Firefox builds, manifest split, where bundles land.
8. **Test taxonomy** — unit (colocated `.test.ts`), component (`src/components/**/*.test.ts`), e2e smoke (`tests/e2e/*.test.ts`), e2e network (`tests/e2e/network/**`). Cite which gate each runs under.

Target: ≤300 lines. This is the deepest doc; it earns its length.

### 2.3 CLAUDE.md (rewrite — tighter)

Strip every milestone tag from prose. Sections:

1. **What this file is** — one sentence: Claude-operating ruleset, not architecture.
2. **Pointers** — read `ARCHITECTURE.md` for the picture, per-package READMEs for surface area, `tests/e2e/README.md` for e2e setup, `implementations-plan/README.md` for plans.
3. **Working in this repo** — Bun-only, biome, commitlint, pre-commit hooks, `audit:vue` gate.
4. **Package boundaries** — short version (importing rules) + reference to `biome.json` for enforcement.
5. **Extension component layer model** — L0–L6 with the import rules. Keep this; it's actionable.
6. **Composables layer** — C0 / C1; the "parent owns connect/disconnect, composable exposes dispose()" rule.
7. **Vue component test conventions** — colocation, mount, stubs, coverage minimums.
8. **`onBeforeUnmount` cleanup order** — keep verbatim.
9. **Vue SFC ordering convention** — keep; it's load-bearing for diff legibility.
10. **Code-comment style guide** — NEW section. See §2.4 below.
11. **Quality gates + when to run them** — `audit:vue`, `test:e2e`, `e2e:agent` with one-liner triggers.

Target: ≤350 lines.

### 2.4 Code-comment style guide (new section in CLAUDE.md)

Rules:

- **Default: no comment.** Identifiers carry intent.
- **Add a comment only when removing it would surprise a reader** — a hidden constraint, a subtle invariant, a workaround for a specific bug, behavior dictated by an external spec.
- **Comments explain WHY/INVARIANT, not WHAT.** "Re-derive passhash here because the session was closed during restore" — yes. "This is the password hash." — no.
- **No milestone, plan, PR, or phase tags.** Not `M4.10`, `A11.1`, `pre-A11`, `phase 4b`, `PR-2`. The repo history is in git. Cross-references rot.
- **Live cross-references are OK** — link to `implementations-plan/<dir>/<file>.md` only when the target is a maintained living doc (current examples: `passkey-e2e/PRF-NON-PORTABLE.md`, `network-test-triage/plan.md`). Drop if the target is a finished historical record.
- **TSDoc shape for public APIs** — `/** ... */` block above exports. One-line summary, optional follow-up paragraph. `@param` only when the name doesn't say it. `@returns` only when the return type doesn't say it. No over-specifying.
- **Inline comments are full sentences** with terminal punctuation. Soft cap 100 chars per line; break at sentence boundaries.
- **`// biome-ignore`** must carry a reason: `// biome-ignore lint/X: reason`.
- **Bug-pin comments** in tests get a `(BUG PIN)` prefix and explain why the pre-existing behavior is preserved verbatim.

### 2.5 implementations-plan/README.md (new)

Sections:

1. **What this directory is** — repo-tracked planning artifacts. Multi-phase plans, audit transcripts, decision logs.
2. **When to create a plan** — non-trivial implementation tasks. Single-file fixes do not need a plan.
3. **Suggested layout per plan** — `plan.md` (the spec), optional `audit-*.md` (review responses), optional `decisions.md` (open/closed Qs), optional `STATUS.md` (live progress).
4. **Naming** — kebab-case topic name; one directory per topic (`backup-import-repair/`, `passkey-modal-export-import/`, …).
5. **Retention** — plans stay after the work lands. They serve as the "why was this built like this" archive. Code comments do NOT reference them by milestone number — only by path, and only when the target is still load-bearing.
6. **History snapshot** — short paragraph: M-series and A11 are historical milestones that ran from 2025 through early 2026; the repo refers to that vocabulary only inside this directory now.

### 2.6 Package READMEs (8)

Each follows this template (~80–120 lines):

```
# @nulo/<package>

One-paragraph purpose. What does this package own, what does it deliberately not own.

## Position in the stack

Where this sits in the package layer hierarchy (link to ARCHITECTURE.md §layer-hierarchy).

## File map

| Path | Purpose |
| --- | --- |
| `src/foo.ts` | … |

## Scripts

`bun run test`, `bun run typecheck` (whatever is defined in package.json). One line each.

## Testing

- Unit: `vitest` colocated `.test.ts`.
- Vectors / integration: explicit callouts.
- Coverage expectations (if any).

## Key invariants / gotchas

The 3–6 things a contributor must not break (vector compatibility, layer rules, no chrome.* in pure packages, etc.).
```

Per-package focus:

- **wallet-core** — pure ports + utilities; chrome.* banned; what each port abstracts; topology for service ordering.
- **wallet-crypto** — derivation chains; vector lock; buffer-ownership invariants.
- **extension-messaging** — Service / ServiceClient / OffscreenService; error reconstruction across the boundary; telemetry sidecar.
- **aztec-runtime** — PXE + Nulo schnorr account adapter; offscreen entry; class-id verification; payload chunking.
- **wallet-bridge** — wallet-sdk dispatcher, capability map, services-contract narrowing, scope enforcement.
- **extension** — the sink; entry points (SW, popup, content, offscreen), component model L0–L6 reference, where services live.
- **playground** — update existing README only minimally; drop the historical plan-path reference at the bottom.
- **landing** — short scaffold README.

## 3. Comment cleanup methodology

The 237 references break into roughly four shapes. For each, the rule:

### 3.1 KEEP, drop tag

> "M4.4 send_failed: chrome.runtime.sendMessage rejected"

The body is useful; the tag is noise. Becomes:

> "send_failed: chrome.runtime.sendMessage rejected"

Apply to: most `M<n>.<m>: <real explanation>` shapes (~110 instances expected).

### 3.2 REWORD: tag was the only structure

> "M3.1: extracted from extension into wallet-core, pure now."

The migration is in git history; the live invariant is "pure, no chrome.*". Becomes:

> "Pure package — no chrome.* allowed; foundation of the layer hierarchy."

Apply to: migration-flavored module-level docs (~50 instances).

### 3.3 DELETE entire comment

> "// Pre-M2.4-a behavior preserved verbatim."

No live invariant; the tag was the only content. Delete.

Apply to: dead historical pins (~30 instances).

### 3.4 REPLACE cross-ref with live one (or delete)

> "see implementations-plan/M6/conventions.md"

If the target still drives behavior, point at it via path. If the target has been folded into CLAUDE.md / ARCHITECTURE.md / a package README, point there instead. If neither, delete.

Apply to: ~47 instances. Live targets that stay: `passkey-e2e/PRF-NON-PORTABLE.md`, `network-test-triage/plan.md`. Everything else gets re-pointed or dropped.

### 3.5 Bug pins

Already follow `(BUG PIN)` convention. Keep verbatim; only strip embedded milestone numbers if any.

### 3.6 Audit security tags

`AUDIT A1`, `audit:` — keep. These mark security-relevant decisions and are short enough to be useful.

## 4. Execution order

Single branch `docs/improvement-pass`. Three commits in order:

### Commit 1 — Top-level docs + plan-dir doc

Files:
- `README.md` (rewrite)
- `ARCHITECTURE.md` (new)
- `CLAUDE.md` (rewrite)
- `implementations-plan/README.md` (new)

### Commit 2 — Package READMEs

Files:
- `packages/wallet-core/README.md` (new)
- `packages/wallet-crypto/README.md` (new)
- `packages/extension-messaging/README.md` (new)
- `packages/aztec-runtime/README.md` (new)
- `packages/wallet-bridge/README.md` (new)
- `packages/extension/README.md` (new)
- `packages/playground/README.md` (update — drop plan-path tail reference)
- `packages/landing/README.md` (new)

### Commit 3 — Code-comment cleanup

Sweep order (alphabetical, single commit but split touch per-package mentally):
1. `wallet-core` (16)
2. `wallet-crypto` (10)
3. `extension-messaging` (9)
4. `aztec-runtime` (11)
5. `wallet-bridge` (9)
6. `extension` (182) — biggest; split mental review by subfolder (`src/wallet/services/`, `src/wallet/utils/`, `src/popup/`, `src/components/`, `src/design/`, `tests/e2e/`).

## 5. Validation gates

After commit 3, before opening the PR:

1. **`bun run audit:vue`** — root level. Runs `typecheck:all → test → lint → build`. Comments shouldn't affect any of these; if they do, that's a TSDoc-parsing or biome rule we want to know about.
2. **`bun run test:e2e`** — smoke suite (no Aztec sandbox). Confirms popup renders, no regressions from doc-block edits inside Vue SFCs.
3. **Spot-check Storybook builds** — `bun run --cwd packages/extension build-storybook` for one component to confirm story-header comments still parse.

Not needed:
- `bun run e2e:agent` (no runtime code touched).
- Network e2e suite (no runtime code touched).

If any gate fails, fix in place before opening the PR.

## 6. Risks + mitigations

| Risk | Mitigation |
|---|---|
| TSDoc parser chokes on reworded JSDoc | Run `audit:vue` after each commit; revert the offending file and reword if so. |
| A "useful WHY" gets lost when a tag is stripped because the WHY was actually the milestone story | When in doubt, fold the milestone story into one prose sentence ("Previously each service had its own crypto; consolidated here for vector-locking") rather than deleting. |
| Live cross-references become stale because the targeted plan doc gets moved | Limit cross-refs to docs we explicitly mark "load-bearing" inside `implementations-plan/README.md`. Anything else is git history. |
| 237 edits + 9 markdown files is too big a single PR | Three labeled commits (already chosen) keep review tractable; reviewer reads commit-by-commit. |
| Stories.ts header comments are visible in Storybook UI | We're rewording, not deleting; the prose stays useful. Spot-check one story renders post-edit. |

## 7. Out of scope

- New tests.
- Refactoring `noExplicitAny` or any source behavior.
- Touching `implementations-plan/<historical>/*.md` content (those are git-tracked artifacts; we don't rewrite history).
- Visual changes to the popup.
- Changing the e2e helper conventions.
