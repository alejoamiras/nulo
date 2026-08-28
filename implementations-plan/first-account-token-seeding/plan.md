# first-account-token-seeding — default tokens never seed for a wallet's first account

**Tier:** `light` (owner-selected). **`eli5_mode`:** Artifact.
**Budget:** recon 2 agents (spent) · `/code-review` level `low` · codex fix loop ≤3 rounds.
**Base:** `origin/dev` @ `6de63585`. **Worktree/branch:** `first-account-token-seeding` / `worktree-first-account-token-seeding`.

## Problem

`DEFAULT_TOKEN_SEEDS` never seeds for a profile's first account. `TokenService.init()` triggers a seed pass from exactly two events (`token/service.ts:116-117`, unchanged since #309):

```ts
this.profiles.onActiveProfileChanged.add(this.onActiveProfileChangedSeed)
this.networks.onActiveNetworkChanged.add(this.onActiveNetworkChangedSeed)
```

Both fire **before the first account row exists**, because networks and the first account are created by the popup/onboarding UI *after* profile activation:

| # | Event | Seeder outcome |
|---|---|---|
| 1 | `createProfile` → `open()` → `onActiveProfileChanged` (`session-manager.ts:299` → `profile/service.ts:263`, synchronous in-process fan-out) | pass #1 → `getActiveNetwork()` is `null` (no networks yet) → `return` (`seeder.ts:190`) |
| 2 | `useProfileBootstrap.initNetworks` → `getOrInitNetworks()` writes the active pointer **without emitting** (`network/service.ts:259`) → then `setActiveNetwork(id)` **emits** (`network/service.ts:465`) | pass #2 → profile ✓, network ✓, `getAccounts()` → `[]` → every seed hits `if (!account) continue` (`seeder.ts:236`) |
| 3 | `useProfileBootstrap.initAccount` → `ensureDefaultAccount` → first account persisted → `onAccountAdded` (`account/service.ts:241`) | **no subscriber** — nothing re-triggers the seeder |

`useProfileBootstrap.ts:120-122` sequences `initNetworks` before `initAccount`, so this is deterministic, not a race. The `!account` branch is documented "skip WITHOUT consuming an attempt; retried on the next trigger" — but production has no next trigger. The seeder's own unit test papers over it by calling `run()` a second time by hand (`seeder.test.ts:111-121`).

**The same defect reproduces on the network-switch path**, which is what makes it hermetically testable: `setActiveNetwork` fires the seeder first, and `createNetworkSwitchHandler` only then calls `ensureDefaultAccount` for a chain with zero accounts (`popup/network-switch.ts:69-75`).

**Why the user's workaround appears to work.** Adding an account seeds nothing (`NewAccountPopup.vue:68` → `createAccount` emits only `onAccountAdded`); switching accounts is a pure store write (`app.store.ts:138-143`). What actually happens is that a *later popup open* re-runs `bootstrapActiveProfile` → `setActiveNetwork` → `onActiveNetworkChanged` → a seed pass that now finds an account; the account switch then trips `TokensView`'s `watch([account.address, network.id])` (`TokensView.vue:349`) and the list re-reads. The account dance is the view refresh, not the seeding.

## Scope

**In:** the missing `onAccountAdded` trigger; unit + composition + network-e2e coverage; the e2e-only seam that makes seeding observable on the ephemeral sandbox; docs.

**Out (with reasons):**
- **A `TokensView` → `onTokenAdded` subscription.** `TokenBalanceService.onTokenAdded` (`token-balance/service.ts:282-299`) already backfills balance rows for every account on the token's chain via `getAccounts(profile.id, chainId, true)`, which emits `onTokenBalanceAdded`, which `TokensView.vue:180` already pushes live. A second subscription duplicates that path and risks double-inserting rows. `TokensView` being the only token view not subscribed to `onTokenAdded` is a real inconsistency, but it is not load-bearing for this bug.
- **Changing the attempt-cap / SW-death accounting** (`seeder.ts:227-234`). Recording the attempt *before* the risky preview is a deliberate anti-infinite-crash-retry property from the token-prices audit. Changing it is a behavioral change to a hardened surface with no observed field failure. Documented as a known hazard; not fixed here.
- **Extracting a shared single-flight/epoch helper.** Three call sites with divergent semantics (`recon.md`); premature.
- **Adding `seedDefaultTokens` to the RPC surface.** Widening the popup↔SW method surface for a test is the wrong trade.

## Architecture & Implementation

### Proposed change (production code)

One subscription in `TokenService.init()`, alongside the existing two:

```ts
this.accounts.onAccountAdded.add(this.onAccountAddedSeed)
```

with `onAccountAddedSeed = (): void => { void this.seeder.run() }`.

**No guard at the subscription site**, deliberately: `TokenSeeder.doRun()` already re-derives the active profile and network and re-checks its purge epoch before every write (`seeder.ts:186-208`), and `run()` already single-flights and coalesces a trigger arriving mid-pass (`seeder.ts:104-121`). Adding a generation counter here would duplicate machinery the seeder owns. This mirrors the existing two handlers, which are also one-liners.

This also covers `AccountService.restore()`'s emissions (`account/service.ts:487`) during a full-backup import — many events coalesce into at most two passes.

### E2E observability seam

`seedsForChain(0)` is empty by design and the sandbox token's address is minted per run (`recon.md`), so the sandbox cannot carry a literal seed entry. The extension bundle is also built *before* the chain exists (`agent.sh:80-104` vs `global-setup.ts:639-713`), so a just-deployed address cannot be baked in. The established answer to exactly this shape is runtime injection: `ProofGate`/`RestoreGate`/`IncomingPollGate` (`src/e2e/*.ts`) define a production interface with a no-op default and construct a `chrome.storage`-backed implementation only inside `if (E2E_*)`.

- New flag `E2E_TOKEN_SEEDS` in `src/e2e/config.ts` (single boolean, `VITE_NULO_E2E_TOKEN_SEEDS=1`; no proverless-style confirm pair — an accidentally-shipped source is inert without the storage key, unlike a proverless wallet).
- New `src/e2e/token-seed-source.ts`: `TokenSeedSource { get(): Promise<readonly DefaultTokenSeed[]> }`, production default `DEFAULT_TOKEN_SEED_SOURCE` returning `DEFAULT_TOKEN_SEEDS`; `ChromeStorageTokenSeedSource` reads key `nulo:e2e:token-seeds` from `chrome.storage.session`.
- **When armed, the e2e source REPLACES the production list, it does not augment it.** This is load-bearing for suite hygiene: with the trigger fixed, every network-e2e profile registration would otherwise fire a live seed attempt against the public Testnet dRPC endpoint (`network/service.ts:110`), because `agent.sh` boots the e2e wallet on Testnet (`VITE_NULO_E2E_DEFAULT_NET=testnet`) and Testnet *does* carry a real seed (`default-tokens.ts:60-69`). Replacement keeps the suite hermetic and keeps a surprise "USDC" card out of the ~85 existing network tests.
- `TokenSeederDeps.seeds?: readonly DefaultTokenSeed[]` (`seeder.ts:49-51`, unit-test-only, no production caller) becomes `getSeeds(): Promise<readonly DefaultTokenSeed[]>`, resolved inside `doRun()` — the values must be readable at pass time, not construction time.
- Layered enforcement, copied from `E2E_MIGRATION_FIXTURE`: statically-false constant → construction inside `if (E2E_TOKEN_SEEDS)` so Vite dead-code-eliminates it → build stamp + negative bundle-grep in `_build-extension.yml` → positive propagation grep in `agent.sh`.

### File-level change map

| File | Change |
|---|---|
| `apps/extension/src/wallet/services/token/service.ts` | subscribe `onAccountAdded`; pass `getSeeds` into `TokenSeeder` |
| `apps/extension/src/wallet/services/token/seeder.ts` | `seeds` → `getSeeds()`, resolved in `doRun()` |
| `apps/extension/src/e2e/config.ts` | `E2E_TOKEN_SEEDS` + build stamp |
| `apps/extension/src/e2e/token-seed-source.ts` | **new** — interface, production default, chrome.storage impl |
| `apps/extension/src/wallet/runtime.ts` | construct the e2e source under the flag |
| `apps/extension/scripts/e2e/agent.sh` | set the flag; positive stamp grep |
| `.github/workflows/_build-extension.yml` | negative marker grep |
| `apps/extension/src/wallet/services/token/seeder.test.ts` | adapt `makeSeeder` to `getSeeds`; add the retry-on-new-trigger pin |
| `apps/extension/src/wallet/services/token/service.composition.test.ts` | `onAccountAdded` wiring assertion |
| `apps/extension/tests/e2e/network/default-token-seeding.test.ts` | **new** |
| `apps/extension/tests/e2e/fixtures/*`, `helpers.ts` | seed-injection helper |
| `ARCHITECTURE.md`, `apps/extension/tests/e2e/README.md`, `implementations-plan/index.md` | docs |

### Trade-offs / alternatives not taken

- **Seed against the live public Testnet instead of the sandbox.** Rejected: makes a *required* CI gate depend on external RPC availability and on the token still being deployed after a network reset — the precise failure `default-tokens.ts:20-24` records for cUSD.
- **Pin a deploy salt so the sandbox token address is deterministic and hardcode a chainId-0 seed** (recon option A). Rejected: puts test-only data inside the production `DEFAULT_TOKEN_SEEDS` constant, still needs a live-captured class-id pin, and re-breaks whenever the aztec-standards line moves.
- **Trigger the seeder from `useProfileBootstrap` (UI side) after `initAccount`.** Rejected: puts a background-service concern in the popup, does not cover the network-switch path or `AccountService.restore()`, and leaves the SW-side invariant unfixed.

## Assumptions

### Facts (verified in this worktree at `6de63585`)

1. `TokenService` subscribes only `onActiveProfileChanged` + `onActiveNetworkChanged` for seeding — `token/service.ts:116-117`. `git blame` attributes both to #309.
2. The seeder aborts a pass with zero accounts without consuming an attempt — `seeder.ts:211`, `:236`.
3. Bootstrap sequences networks before accounts — `useProfileBootstrap.ts:120-122`; `initNetworks` at `:60-84`, `initAccount` at `:87-100`.
4. `getOrInitNetworks()` writes the active-network pointer without emitting; only `setActiveNetwork` emits — `network/service.ts:259` vs `:465`.
5. `SessionManager.restore()` is silent by design and does **not** emit `onActiveProfileChanged` — `session-manager.ts:494-498`. So a bare SW restart never re-triggers seeding; the recovery trigger in practice is the unconditional `setActiveNetwork` on every popup bootstrap (`useProfileBootstrap.ts:80-83`).
6. `TokenService` does not subscribe to `onAccountAdded`; only `TokenBalanceService` (`token-balance/service.ts:121`) and `IncomingTransferService` (`incoming-transfer/service.ts:274`) do.
7. `seedDefaultTokens()` is not in `defineRpcMethods` (`token/service.ts:46-54`) and has zero call sites.
8. `seedsForChain(0)` is empty — `default-tokens.ts:38-70`; `implementations-plan/token-prices/plan.md:170,174` records "no seeding network-e2e" as the accepted 2026-07-21 position.
9. The e2e wallet boots on Testnet (`agent.sh` sets `VITE_NULO_E2E_DEFAULT_NET=testnet`; `network/service.ts:96,114`) and the Testnet seed is real (`default-tokens.ts:60-69`).
10. The sandbox token is deployed per run with no salt, symbol `"TST"` — `fixtures/aztec.ts:143-160`; `tests/e2e/README.md:79-88` records differing addresses across concurrent runs.
11. `TokenBalanceService.onTokenAdded` backfills balance rows for all accounts on the chain — `token-balance/service.ts:282-299`.
12. A new file under `apps/extension/tests/e2e/network/` runs in CI with no workflow edit — both paths-filters include `apps/extension/**` wholesale (`pr-network-e2e.yml:39-40`, `pr-smoke-e2e.yml:30-31`).

### Inferences (unverified — attack these)

1. **A one-line unguarded subscription is safe** because `doRun()` re-derives profile/network and re-checks the epoch. Risk: a burst of `onAccountAdded` during a large backup restore coalesces to ≤2 passes, but each pass re-reads the marker blob and may issue chain previews; unproven under load.
2. **Replacing (not augmenting) the seed list under the e2e flag keeps the existing suite unchanged.** Assumes no current network test depends on the real Testnet seed ever seeding — recon found zero tests referencing the seeder, so this should hold.
3. **The class id of the sandbox-deployed `TokenContract` is readable at test runtime** from the deployed instance, so the injected seed can carry a real pin rather than a bypass. Unverified against the fixture's API surface.
4. **The `TokensView` live path suffices** post-fix (Facts 11 + `TokensView.vue:180`), so no view change is needed.
5. **`chrome.storage.session` is writable from the e2e test into the SW's context** the way `ProofGate` is driven. Unverified for this specific key.

### Asks (routed to codex per the owner's instruction, not left silent)

1. Is the e2e seam proportionate, or is composition-level coverage plus a smoke assertion the right stopping point?
2. Replace-vs-augment for the e2e seed list — is replacement the right hygiene call?
3. Should the attempt-burn-on-SW-death hazard be fixed in this change or explicitly deferred?
4. Is dropping the `TokensView` change correct, or does the live path have a hole?

## Security & Adversarial Considerations

- **Threat model.** The seed list is a TOFU trust boundary: a hostile RPC that could get an arbitrary contract seeded would place an attacker-controlled token in every wallet with zero user interaction. Its defenses are the pinned `expectedClassId` enforced on the fetched instance *before* PXE registration, the pinned `expectedSymbol`, and the metadata bounds (`seeder.ts:305-320`, `service.ts:435-473`).
- **The e2e seam is the only new attack surface.** It must not weaken those pins. Mitigations, in the order the repo already uses them: (1) `E2E_TOKEN_SEEDS` is a statically-false constant in any non-e2e build, so the source module is dead-code-eliminated; (2) the source is constructed only inside `if (E2E_TOKEN_SEEDS)`; (3) `_build-extension.yml` greps release bundles for the marker and fails on a hit; (4) `agent.sh` greps for the stamp positively so a silently-unpropagated flag fails the run. The injected entries still flow through the **unchanged** `metadataValid` + pin checks — the seam supplies *which* seeds to consider, never a bypass of *how* they are validated.
- **No new RPC surface.** `seedDefaultTokens` stays off `defineRpcMethods`; the trigger is an internal event subscription. No dApp-reachable behavior changes.
- **Storage key is session-scoped** (`chrome.storage.session`), cleared on browser restart, consistent with the other e2e gates.
- **Supply chain / crypto:** unchanged. No new dependencies, no lockfile change, no key material touched.
- **Least privilege:** no new `host_permissions`; replacement of the seed list under the flag *reduces* outbound traffic in CI (no live dRPC seeding attempts).

## Phases

### Phase 1 — Trigger fix + unit/composition coverage

Subscribe `TokenService` to `AccountService.onAccountAdded` and prove it through the real init wiring.

- `token/service.ts`: add `onAccountAddedSeed` next to the existing two handlers, inside the same `seederOverrides?.enabled !== false` guard.
- `token/service.composition.test.ts`: extend `seedHarness()`'s stub `AccountService` with `onAccountAdded: new EventHandler()`; extend the existing `"unlock + active-network-change both trigger a seed pass through the REAL init wiring"` test (`:344-358`) to a third trigger.
- `token/seeder.test.ts`: keep `:111-121` and add a pin that a pass which skipped on zero accounts seeds on the *next* trigger without having consumed an attempt.

**Validation gate.** Commands: `bun run lint && bun run typecheck && bun run --cwd apps/extension vitest run src/wallet/services/token/`. Pass: exit 0; the new composition assertion and seeder pin green. Layers: lint · typecheck · unit + composition.

### Phase 2 — E2E seed-source seam

- `src/e2e/config.ts`: `E2E_TOKEN_SEEDS` + `E2E_TOKEN_SEEDS_BUILD_STAMP`, mirroring `E2E_MIGRATION_FIXTURE`'s doc comment discipline.
- `src/e2e/token-seed-source.ts` (new) + colocated unit test: production default returns `DEFAULT_TOKEN_SEEDS`; the chrome.storage impl reads `nulo:e2e:token-seeds`, treats the blob as hostile (shape-validate, empty array on garbage), and **replaces** the production list.
- `seeder.ts`: `seeds` → `getSeeds()`, awaited in `doRun()`; update `makeSeeder`.
- `runtime.ts`: construct the source under the flag and thread it into `TokenService`.
- `agent.sh`: set `VITE_NULO_E2E_TOKEN_SEEDS=1`; add the positive stamp grep next to the existing ones.
- `_build-extension.yml`: add the marker to the negative grep list.

**Validation gate.** Commands: `bun run lint && bun run typecheck && bun run --cwd apps/extension vitest run src/wallet/services/token/ src/e2e/ && bun run lint:actions && bun run build`. Pass: exit 0; a plain `bun run build` bundle contains **no** occurrence of the marker (`! grep -r "<marker>" apps/extension/dist/chrome`). Layers: lint · typecheck · unit · actionlint · production build + negative grep.

### Phase 3 — Network e2e

New `apps/extension/tests/e2e/network/default-token-seeding.test.ts`:

1. Register a fresh profile (`registerProfile`).
2. Read the sandbox token's address + contract-class id from the deployed fixture instance; write the seed entry (`chainId: 0`, symbol `"TST"`) into `nulo:e2e:token-seeds`.
3. Switch to Local Network — this is the chain with zero accounts, so `network-switch.ts:69-75` creates its first account *after* `setActiveNetwork` already fired the seeder: the exact production shape of the bug.
4. Assert the assets view renders `[data-testid="tokens-card"] [data-testid="token-symbol"][data-symbol="TST"]` without any manual `importToken()`, and that the seed marker `nulo:core:token-seeded@<profileId>` records `outcome: "seeded"`.

The test must be verified to **fail on the pre-Phase-1 code** (stash the `service.ts` subscription, re-run, confirm red) — a regression test that passes both ways proves nothing. Log the red/green evidence in `lessons/phase-3.md`.

**Validation gate.** Commands: `bun run e2e:agent tests/e2e/network/default-token-seeding.test.ts`, plus the recorded pre-fix red run. Pass: the new file green; documented red without the Phase 1 subscription. Layers: network e2e (real sandbox).

### Phase 4 — Regression sweep + docs

- Full suites: units, smoke, and the whole network suite (the new trigger fires in every profile-registering test — Inference 2 must be proven, not assumed).
- Docs: `ARCHITECTURE.md` (the seeding trigger set), `apps/extension/tests/e2e/README.md` (the new flag + storage key), `implementations-plan/index.md`.

**Validation gate.** Commands: `bun run audit:vue && bun run test:e2e && bun run e2e:agent`. Pass: all exit 0. Layers: typecheck · unit + component · lint · build · smoke e2e · full network e2e.

## Delivery

**Single arc, single PR** → `dev`. Branch `worktree-first-account-token-seeding`; plain `gh pr create` (no `gh stack`). `/code-review` level: **`low`** — the diff is small and contained (one production one-liner, one narrow seam, tests).

Conventional-commit PR title, ≤93 chars to leave room for the ` (#NN)` squash suffix:
`fix(token): seed default tokens when a chain's first account is created`

## Post-implementation

Run in order once every phase is ✓ (single arc, so each step runs once over the whole diff):

1. **`/code-review low --fix`** on the net diff from the plan baseline. Skim the applied fixes for unintended changes, then commit them **separately** from implementation commits.
2. **Codex audit** (`/codex xhigh`) with: the net diff, a summary of the code-review commits, this plan.md, an explicit adversarial/security ask, and both rules below verbatim.
   - *No over-engineering:* "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - *Comment quality:* "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
3. **Iterative fix loop.** Verify each codex claim against the repo before acting, apply accepted fixes, commit, log the round in `lessons/`, then **resume the same codex session** with the fix diff for re-review. Loop until a round yields no new material findings; stop and surface if still material after 3 rounds.
4. **Delivery.** Only now open the PR: `gh pr create --base dev`, then `gh pr checks --watch` until `quality-status`, `smoke-e2e-status`, and `network-e2e-status` are green. Re-run genuine flakes; fix real breakage. Never weaken a gate. Then update `implementations-plan/index.md`.

**Post-implementation hardening:** no `/harden` pass scheduled — the change adds no new trust boundary beyond the flag-gated, DCE'd e2e seam already covered by the Security section.

## Seeds

*(draft — finalized after the approval gate)*

```
/goal All four phases marked ✓ in implementations-plan/first-account-token-seeding/plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript — including Phase 3's documented pre-fix RED run; for each phase the agent has printed LESSONS_FILE=implementations-plan/first-account-token-seeding/lessons/phase-N.md in the transcript; /code-review low --fix complete with findings applied and committed separately; the codex fix loop converged, evidenced by a resumed codex pass reporting no new material findings quoted in the transcript; a PR against dev exists (created only after the loop converged) with gh pr view output in the transcript; bun run audit:vue and bun run test:e2e and bun run e2e:agent all report exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/first-account-token-seeding forward. Never idle waiting for my input. Each firing: (1) Reality check: read plan.md + lessons/ (authoritative state), git status, git log --oneline -5; if a PR exists, gh pr view --json statusCheckRollup. (2) Waiting on CI is fine — use the wait to review the diff or prep the next phase. (3) No task in hand? Pick the next pending step from plan.md and start it; after each meaningful edit run bun run lint + bun run --cwd apps/extension vitest run for the touched dirs; commit → push. (4) Stuck or facing a decision? Call /codex xhigh, reach a defensible decision, act, log the consult in lessons/phase-N.md. Hard limits stay hard: never merge to dev/main, never publish, never expand scope beyond plan.md. (5) Same step failed 5 times? Stop retrying; reassess with codex. (6) Phase green? Run the phase's full validation gate as written in plan.md, paste the result, mark ✓ in plan.md, print LESSONS_FILE=implementations-plan/first-account-token-seeding/lessons/phase-N.md, advance. (7) All phases ✓? Run /code-review low --fix → commit fixes separately → codex post-impl audit (net diff + code-review commit summary + adversarial ask + the no-over-engineering and comment-quality rules) → loop until clean → gh pr create --base dev → gh pr checks --watch → wrap-up report and stop.
```

## Audit verdicts

*(pending — codex `xhigh`)*
