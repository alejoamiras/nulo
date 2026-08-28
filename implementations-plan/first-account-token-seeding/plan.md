# first-account-token-seeding — default tokens never seed for a wallet's first account

**Tier:** `light` (owner-selected). **`eli5_mode`:** Artifact.
**Budget:** recon 2 agents (spent) · `/code-review` level **`medium`** (raised from `low` on codex's finding that a runtime-controlled zero-interaction seed source plus publication guards warrants a security-focused pass) · codex fix loop ≤3 rounds.
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
| 1 | `createProfile` → `open()` → `onActiveProfileChanged` (`session-manager.ts:299` → `profile/service.ts:263`, synchronous in-process fan-out) | pass #1 returns early — `getActiveNetwork()` is `null`, no networks exist yet (`seeder.ts:190`) |
| 2 | `useProfileBootstrap.initNetworks` → `getOrInitNetworks()` writes the active pointer **without emitting** (`network/service.ts:259`) → then `setActiveNetwork(id)` **emits** (`network/service.ts:466`) | pass #2 runs fully: profile ✓, network ✓, but `getAccounts()` → `[]`, so every seed in the loop hits `if (!account) continue` (`seeder.ts:234`) — no attempt consumed |
| 3 | `useProfileBootstrap.initAccount` → `ensureDefaultAccount` → first account persisted → `onAccountAdded` (`account/service.ts:256`) | **no subscriber** — nothing re-triggers the seeder |

`useProfileBootstrap.ts:119-121` sequences `initNetworks` before `initAccount`, so this is deterministic, not a race. The `!account` branch is documented "skip WITHOUT consuming an attempt; retried on the next trigger" — but production has no next trigger. The seeder's own unit test papers over it by calling `run()` a second time by hand (`seeder.test.ts:111-121`).

**The same defect reproduces on the network-switch path**, which is what makes it hermetically testable: `setActiveNetwork` fires the seeder first, and `createNetworkSwitchHandler` only then calls `ensureDefaultAccount` for a chain with zero accounts (`popup/network-switch.ts:57-75`).

**Why the user's workaround appears to work.** Adding an account seeds nothing (`NewAccountPopup.vue:68` → `createAccount` emits only `onAccountAdded`); switching accounts is a pure store write (`app.store.ts:138-143`). What actually happens is that a *later popup open* re-runs `bootstrapActiveProfile` → `setActiveNetwork` → `onActiveNetworkChanged` → a seed pass that now finds an account; the account switch then trips `TokensView`'s `watch([account.address, network.id])` (`TokensView.vue:349`) and the list re-reads. The account dance is the view refresh, not the seeding.

## Scope

**In:** the missing `onAccountAdded` trigger; unit + composition + network-e2e coverage; the e2e-only seam that makes seeding observable on the ephemeral sandbox; CI isolation so the fix does not point existing suites at a public RPC; docs.

**Out (with reasons):**
- **A `TokensView` → `onTokenAdded` subscription.** `TokenBalanceService.onTokenAdded` (`token-balance/service.ts:284-300`) already backfills balance rows for every account on the token's chain, which emits `onTokenBalanceAdded`, which `TokensView.vue:180` already pushes live; with the popup closed the durable row is read on the next mount (`TokensView.vue:305`, `:359`). A second subscription duplicates that path, risks a second presentation path, and cannot help while the popup is closed.
- **Changing the attempt-cap / SW-death accounting** (`seeder.ts:236-240`) — see Deferred hazards.
- **Extracting a shared single-flight/epoch helper.** Three call sites with divergent semantics (`recon.md`); premature.
- **Adding `seedDefaultTokens` to the RPC surface.** Widening the popup↔SW method surface for a test is the wrong trade.

## Architecture & Implementation

### Production change

One subscription in `TokenService.init()`, alongside the existing two:

```ts
this.accounts.onAccountAdded.add(this.onAccountAddedSeed)
```

with `onAccountAddedSeed = (): void => { void this.seeder.run() }`.

**No guard at the subscription site**, deliberately: `TokenSeeder.doRun()` re-derives the active profile and network and re-checks its purge epoch before every write (`seeder.ts:185-208`), and `run()` single-flights and coalesces a trigger arriving mid-pass (`seeder.ts:103-121`). A generation counter here would duplicate machinery the seeder owns, and the two existing handlers are one-liners for the same reason.

`onAccountAdded` fires only after a durable row write, from `createAccountInternal` (`account/service.ts:256` — reached by `createAccount` and `ensureDefaultAccount`) and `importAccount` (`:487`). **`AccountService.restore()` does not emit it** — the full-backup path writes rows through `restoreRows` with no event, and its correctness comes from activating the profile only after accounts are restored (`useFullBackupImport.ts:900,923`), not from event coalescing.

### E2E observability seam

`seedsForChain(0)` is empty by design and the sandbox token's address is minted per run; the bundle is also built before the chain exists (`agent.sh:80-104` vs `global-setup.ts:639-713`), so a just-deployed address cannot be baked in. The repo's established answer to that shape is runtime injection through a production interface with a no-op default and a `chrome.storage`-backed implementation constructed only inside a statically-false branch (`ProofGate` / `RestoreGate` / `IncomingPollGate`).

- **`TokenSeederDeps.seeds` (static array, unit-test-only, no production caller) becomes `getSeeds(): Promise<readonly DefaultTokenSeed[]>`, resolved inside `doRun()`.** The values must be readable at pass time, not construction time. No new `TokenSeedSource` interface: `TokenSeederDeps` already *is* the narrow port, and the production default (`() => DEFAULT_TOKEN_SEEDS`) stays in the token domain. Only the Chrome-backed reader lives in `src/e2e/chrome-storage-token-seeds.ts`, matching the repo's existing interface/default-vs-Chrome-impl split.
- **Double opt-in, fail-closed**, mirroring `E2E_PROVERLESS` (`e2e/config.ts:29-40`): both `VITE_NULO_E2E_TOKEN_SEEDS=1` and `VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1` are required; exactly one set throws at module eval. A single flag is *not* sufficient here, because the armed semantics below make an accidentally-armed production build silently stop seeding defaults — a different and worse failure mode than the inert migration fixture's.
- **Armed semantics: the e2e reader REPLACES the production list, and an absent or malformed key yields an empty list.** These are only reachable in an armed build, which double opt-in makes implausible outside e2e.
- **The injected payload is minimal and validated:** exactly one entry, `chainId === 0` (the sandbox) or it is rejected; `contract` and `expectedClassId` must match canonical 0x-hex field shapes; `expectedSymbol` is **hardcoded to `"TST"` in the e2e reader**, never taken from storage. The reader treats the blob as hostile and returns `[]` on any violation. This keeps the storage writer from choosing what counts as "expected" beyond the one field it genuinely cannot know ahead of time (the per-run address).
- **The pins themselves are untouched.** The seam decides *which* seeds are considered; `parseTokenInterface`'s pre-registration class-id check (`token/service.ts:463-473`) and `metadataValid` (`seeder.ts:297-320`) still run unchanged. Codex's fair objection stands and is recorded honestly: in an armed build the injected `expectedClassId` proves self-consistency with the chosen contract, not product identity. That is acceptable **only** because the implementation is absent from production bundles — bundle absence, not storage write-access, is the trust boundary (as `chrome-storage-proof-gate.ts:36-44` already states).

### Publication guards (all four required — the seam's real control)

1. **Normal top-level import** + construction inside `if (E2E_TOKEN_SEEDS)` so Vite statically replaces the `import.meta.env` reference and Rollup drops it. A dynamic `import()` is explicitly forbidden: the repo tried it and Rollup still emitted a code-split chunk (`chrome-storage-proof-gate.ts:40-42`).
2. **Live-pinned build stamp.** A bare exported stamp constant is itself tree-shaken; the proverless stamp survives only because it is assigned as live data (`e2e/config.ts:43` + `offscreen/index.ts:84`). The token-seed stamp needs the same pin, or the negative grep tests nothing.
3. **Fail-fast on the env in CI, before building** — both flags, mirroring the CoinGecko guard's rationale at `_build-extension.yml:57` ("Vite bakes any `VITE_*` env into the bundle, so fail FAST if the variable is even set — stronger than only grepping the artifact afterwards").
4. **Negative bundle-grep** over `dist/chrome` *and* `dist/firefox` (`_build-extension.yml:93`), adding **both** the stamp literal and the functional storage-key literal to the marker list. Plus a positive propagation grep in `agent.sh` alongside the existing ones, so a silently-unpropagated flag fails the e2e run instead of quietly testing nothing.

### CI isolation (the condition I had missed)

Post-fix, *any* wallet booted on Testnet attempts a live seed against the public dRPC endpoint (`network/service.ts:108`) on its first account, because Testnet carries a real seed (`default-tokens.ts:60-69`).

- **Network e2e** (`agent.sh`) — arm the seam. The injected chain-0 entry is what the new test asserts.
- **Source-built smoke** (`_smoke-e2e.yml:62-75`, which builds with `VITE_NULO_E2E_DEFAULT_NET: testnet`) — arm the seam with **no** injected key, so the list resolves empty. Without this, every fresh smoke profile makes a live dRPC call and a required gate acquires an external dependency. The build step is already conditional on `inputs.artifact_name == '' && inputs.extension_path == ''`, so this touches source builds only.
- **Artifact smoke (release / nightly)** — deliberately **not** armed: those runs load the production artifact, and testing production behavior is their purpose. **Accepted residual:** post-fix, artifact-smoke profile registrations will make a real Testnet seed attempt. It is asynchronous, failure-tolerant (logged warning, attempt counted), and no smoke test asserts on the token list (`registration.test.ts:14-78` asserts `balance-amount` / `actions-send` / `actions-receive`). Phase 4 verifies the smoke suite stays green rather than assuming it.

### File-level change map

| File | Change |
|---|---|
| `apps/extension/src/wallet/services/token/service.ts` | subscribe `onAccountAdded`; pass `getSeeds` into `TokenSeeder` |
| `apps/extension/src/wallet/services/token/seeder.ts` | `seeds` → `getSeeds()`, awaited in `doRun()` |
| `apps/extension/src/e2e/config.ts` | `E2E_TOKEN_SEEDS` double opt-in + live-pinned stamp |
| `apps/extension/src/e2e/chrome-storage-token-seeds.ts` | **new** — validated single-entry chain-0 reader |
| `apps/extension/src/wallet/runtime.ts` | construct the reader under the flag; pin the stamp |
| `apps/extension/scripts/e2e/agent.sh` | set both flags; positive stamp grep |
| `.github/workflows/_smoke-e2e.yml` | arm both flags on the source build only |
| `.github/workflows/_build-extension.yml` | fail-fast env rejection + two new negative-grep markers |
| `apps/extension/src/wallet/services/token/seeder.test.ts` | adapt `makeSeeder` to `getSeeds`; add the retry-on-new-trigger pin |
| `apps/extension/src/wallet/services/token/service.composition.test.ts` | `onAccountAdded` wiring assertion |
| `apps/extension/src/e2e/chrome-storage-token-seeds.test.ts` | **new** — hostile-blob rejection cases |
| `apps/extension/tests/e2e/fixtures/aztec.ts` | expose the deployed token's class id |
| `apps/extension/tests/e2e/fixtures/token-seeds.ts` | **new** — injection helper mirroring `fixtures/proof-gate.ts` |
| `apps/extension/tests/e2e/network/default-token-seeding.test.ts` | **new** |
| `ARCHITECTURE.md`, `apps/extension/tests/e2e/README.md`, `implementations-plan/index.md` | docs |

### Trade-offs / alternatives not taken

- **Seed against the live public Testnet instead of the sandbox.** Rejected: makes a *required* CI gate depend on external RPC availability and on the token still being deployed after a network reset — the precise failure `default-tokens.ts:20-24` records for cUSD.
- **Pin a deploy salt and hardcode a chainId-0 seed** (recon option A). Rejected: puts test-only data inside the production `DEFAULT_TOKEN_SEEDS` constant, still needs a live-captured class-id pin, and re-breaks whenever the aztec-standards line moves.
- **A `TokenSeedSource` interface + module.** Rejected on codex's critique: `TokenSeederDeps` is already the port, and a module holding both the production default and the Chrome impl cannot be dropped wholesale — only its unused exports would be, blurring the DCE boundary the seam depends on.
- **Trigger the seeder from `useProfileBootstrap` (UI side) after `initAccount`.** Rejected: puts a background-service concern in the popup, does not cover the network-switch path, and leaves the SW-side invariant unfixed.
- **Stopping at composition coverage.** Rejected: a composition test can only prove the event calls `TokenSeeder.run()` — the normative rules send instance fetch, registration, and simulation to network e2e (`COMPOSITION-TESTS.md:19,56`), and the regression being fixed is exactly a lifecycle failure that a unit test hid by calling `run()` twice.

## Assumptions

### Facts (verified in this worktree at `6de63585`; corrected after the codex audit)

1. `TokenService` subscribes only `onActiveProfileChanged` + `onActiveNetworkChanged` for seeding — `token/service.ts:116-117`. `git blame` attributes both to #309.
2. A pass with zero accounts does **not** abort: it reads marker state and iterates every matching seed, hitting `continue` per entry (`seeder.ts:210,213,234`), consuming no attempt.
3. Bootstrap sequences networks before accounts — `useProfileBootstrap.ts:119-121`.
4. `getOrInitNetworks()` writes the active-network pointer without emitting; only `setActiveNetwork` emits — `network/service.ts:259` vs `:466`.
5. `SessionManager.restore()` is silent by design and does **not** emit `onActiveProfileChanged` — `session-manager.ts:493-498`. A bare SW restart never re-triggers seeding; the de-facto recovery trigger is the unconditional `setActiveNetwork` on every popup bootstrap (`useProfileBootstrap.ts:80-83`).
6. `onAccountAdded` is emitted from `createAccountInternal` (`account/service.ts:256`) and `importAccount` (`:487`) only. **`AccountService.restore()` emits nothing** — full-backup restore writes rows via `restoreRows` with no event, and activates the profile afterwards (`useFullBackupImport.ts:900,923`). `TokenService` does not subscribe today; only `TokenBalanceService` (`token-balance/service.ts:121`) and `IncomingTransferService` (`incoming-transfer/service.ts:274`) do.
7. `seedDefaultTokens()` is not in `defineRpcMethods` (`token/service.ts:46-54`) and has zero call sites.
8. `seedsForChain(0)` is empty — `default-tokens.ts:38-70`; `implementations-plan/token-prices/plan.md:168-174` records "no seeding network-e2e" as the accepted 2026-07-21 position.
9. **Both** e2e paths boot the wallet on Testnet, and Testnet carries a real seed: network e2e via `agent.sh` and source-built smoke via `_smoke-e2e.yml:62-75`, both setting `VITE_NULO_E2E_DEFAULT_NET: testnet`; the seed is `default-tokens.ts:60-69` against `network/service.ts:108`.
10. The sandbox token is deployed per run with no salt, symbol `"TST"` — `fixtures/aztec.ts:143-160`; `tests/e2e/README.md:79-88` records differing addresses across concurrent runs. Its class id is reachable at test time (`fixtures/aztec.ts:236` already fetches a deployed instance exposing `currentContractClassId`).
11. `TokenBalanceService.onTokenAdded` backfills balance rows for all accounts on the chain — `token-balance/service.ts:284-300`.
12. A new file under `apps/extension/tests/e2e/network/` runs in CI with no workflow edit — both paths-filters include `apps/extension/**` wholesale (`pr-network-e2e.yml:55`, `pr-smoke-e2e.yml:50`).
13. `chrome.storage.session` is writable from a trusted extension page in e2e — `fixtures/proof-gate.ts:21-27` is the working template. It is not exposed to content scripts (no `setAccessLevel` call in the repo), and the dApp method registry has no account-creation or seed method and rejects unknown methods (`wallet-bridge/src/method-descriptors.ts:171,379`).
14. `_build-extension.yml` already fails fast on a baked env var (`:57`, CoinGecko) and greps both `dist/chrome` and `dist/firefox` for test-only markers (`:93`); release publication goes through that workflow (`release.yml:226`).

### Inferences (unverified — attack these)

1. **A one-line unguarded subscription is safe.** The scope/epoch argument holds and production events follow durable writes, so traffic is bounded by a finite static list with success/tombstone short-circuits and a 3-attempt cap. Corrected from the draft: **sequential** account events *do* start additional passes (`seeder.ts:103` only coalesces triggers overlapping an in-flight pass), and the earlier "restore emits a burst" premise was simply wrong (Fact 6). The residual is bounded-but-not-single: N accounts created in sequence can drive up to N passes over a settled marker blob, each mostly storage reads.
2. **Arming empty replacement in both source-built e2e paths leaves the existing suites' behavior unchanged.** Recon found zero tests referencing the seeder, so nothing should depend on a default token existing. Proven, not assumed, by Phase 4's full smoke + network runs.
3. **Artifact smoke's new live seed attempt is harmless.** No smoke test asserts on the token list, and the attempt is async and failure-tolerant. Verified by Phase 4.
4. **Dropping the `TokensView` change is correct.** Token persistence precedes `onTokenAdded`; balance persistence precedes `onTokenBalanceAdded`; the view subscribes to the latter and re-reads durable rows on mount. The genuine hole is SW death between the two — recorded as a deferred hazard, and a view listener would not repair it anyway.

### Asks — all resolved by codex (the owner delegated these)

1. **E2E seam proportionate?** *Yes — keep one network e2e and the seam.* The 2026-07-21 "no seeding network-e2e" position was explicit but contextual; the regression now on the table is precisely the lifecycle failure a unit test hid by calling `run()` a second time. Composition proves wiring, not instance fetch/registration/simulation/balance creation/browser event timing. A public-network assertion would swap a deterministic seam for an external dependency.
2. **Replace or augment?** *Replace.* Augmenting makes every Testnet-first e2e profile attempt the live Testnet seed and can add a USDC card to unrelated tests. Production pin semantics stay covered by the existing pin/mismatch suites (`seeder.test.ts:145`, `service.composition.test.ts:216`).
3. **Fix the attempt-burn now?** *No — explicitly defer* (see Deferred hazards).
4. **Drop the `TokensView` change?** *Yes, correct* (see Inference 4).
5. **(New, surfaced by codex) Absent-key semantics.** *Absent or malformed → empty list, armed builds only*, safe because double opt-in makes accidental arming implausible.
6. **(New, surfaced by codex) Is source-built smoke armed?** *Yes, with no key (empty list). Artifact smoke is never armed.*

## Deferred hazards (recorded, not fixed here)

- **MV3 attempt-burn.** Event dispatch does not await subscribers (`event-handler.ts:47`) and the account RPC's keepalive ends when the account method returns, not when the seeder finishes (`base-service.ts:109,129`); the attempt is deliberately persisted before the slow preview (`seeder.ts:236-240`). Three service-worker deaths mid-preview can therefore cap a real seed until the next extension version. **Do not simply move the attempt write after the preview** — that deletes the crash-loop bound pinned by `seeder.test.ts:199,215`. A correct fix needs a durable in-progress lease that distinguishes routine MV3 suspension from repeatedly-crashing work. Tracked separately; residual field risk accepted for this change.
- **Balance-row reconciliation on SW restart.** `TokenBalanceService` init hydrates only the token map and does not reconcile missing balance rows (`token-balance/service.ts:127`), so a worker death between token persistence and balance backfill leaves a token with no row. Pre-existing; unrelated to this trigger fix.

## Security & Adversarial Considerations

- **Threat model.** The seed list is a TOFU trust boundary: a hostile RPC that could get an arbitrary contract seeded would place an attacker-controlled token in every wallet with zero user interaction. Its defenses are the pinned `expectedClassId` enforced on the fetched instance *before* PXE registration, the pinned `expectedSymbol`, and metadata bounds (`seeder.ts:297-320`, `token/service.ts:463-473`) — all unchanged by this plan.
- **The e2e seam is the only new attack surface,** and its control is *absence from production bundles*, enforced by the four publication guards above. In an armed build the injected `expectedClassId` proves only self-consistency with the chosen contract, which is why arming is double-opt-in, the payload is restricted to one validated chain-0 entry, and `expectedSymbol` is hardcoded rather than accepted from storage.
- **A compromised trusted extension page could write the session key** (that is exactly how the proof-gate fixture works). It gains nothing in a production build because the reader is not present. This reinforces that bundle absence — not storage ACLs — is the boundary.
- **`chrome.storage.session` is not content-script-reachable** (no `setAccessLevel` in the repo) and offscreen documents have no `chrome.storage`. No dApp-reachable path creates accounts or seeds (`method-descriptors.ts:171,379`).
- **No new RPC surface.** `seedDefaultTokens` stays off `defineRpcMethods`; the trigger is an internal event subscription.
- **Traffic.** Replacement *reduces* outbound calls in CI. In production the new trigger adds at most one bounded pass per account creation, capped per seed per version.
- **Supply chain / crypto:** unchanged. No new dependencies, no lockfile change, no key material touched.

## Phases

### Phase 1 — Trigger fix + unit/composition coverage

- `token/service.ts`: add `onAccountAddedSeed` next to the existing two handlers, inside the same `seederOverrides?.enabled !== false` guard.
- `token/service.composition.test.ts`: extend `seedHarness()`'s stub `AccountService` with `onAccountAdded: new EventHandler()`; extend the trigger-wiring test at `:344-358` to a third trigger.
- `token/seeder.test.ts`: add a pin that a pass which skipped on zero accounts seeds on the *next* trigger, having consumed no attempt.

**Validation gate.** `bun run lint && bun run typecheck && bun run --cwd apps/extension vitest run src/wallet/services/token/`. Pass: exit 0, new assertions green. Layers: lint · typecheck · unit + composition.

### Phase 2 — E2E seed seam + publication guards

- `e2e/config.ts`: `E2E_TOKEN_SEEDS` double opt-in (fail-closed on exactly-one) + live-pinned stamp.
- `e2e/chrome-storage-token-seeds.ts` (new) + colocated test: single-entry, `chainId === 0`, canonical-hex, `"TST"`-hardcoded reader; `[]` on absent or hostile blobs.
- `seeder.ts`: `seeds` → `getSeeds()`, awaited in `doRun()`; production default `() => DEFAULT_TOKEN_SEEDS` stays in the token domain; update `makeSeeder`.
- `runtime.ts`: construct under the flag; pin the stamp as live data.
- `agent.sh`: set both flags + positive stamp grep. `_smoke-e2e.yml`: arm both flags on the source build only.
- `_build-extension.yml`: fail-fast env rejection for both flags; add the stamp and the storage-key literals to the negative-grep list.

**Validation gate.** `bun run lint && bun run typecheck && bun run --cwd apps/extension vitest run src/wallet/services/token/ src/e2e/ && bun run lint:actions && bun run build`, then assert the production bundle is clean:
`! grep -rq "NULO_E2E_TOKEN_SEEDS_BUILD_STAMP" apps/extension/dist/chrome && ! grep -rq "nulo:e2e:token-seeds" apps/extension/dist/chrome`.
Also assert the guard bites: an armed build **does** contain both literals. Pass: exit 0 and both greps as specified. Layers: lint · typecheck · unit · actionlint · production build + negative/positive grep.

### Phase 3 — Network e2e

New `apps/extension/tests/e2e/network/default-token-seeding.test.ts`:

1. Register a fresh profile (`registerProfile`).
2. Write the seed entry (`chainId: 0`, the sandbox token's address + class id) into `nulo:e2e:token-seeds` via the `fixtures/proof-gate.ts:21` pattern.
3. Switch to Local Network — the chain with zero accounts, so `network-switch.ts:57-75` creates its first account *after* `setActiveNetwork` already fired the seeder: the production shape of the bug.
4. Assert the assets view renders `[data-testid="tokens-card"] [data-testid="token-symbol"][data-symbol="TST"]` with **no** manual `importToken()`, and that `nulo:core:token-seeded@<profileId>` records `outcome: "seeded"`.

The test **must be verified red on the pre-Phase-1 code** (revert the `service.ts` subscription, re-run, confirm failure) — a regression test that passes both ways proves nothing. Record the red and green evidence in `lessons/phase-3.md`.

**Validation gate.** `bun run e2e:agent tests/e2e/network/default-token-seeding.test.ts`, plus the recorded pre-fix red run. Pass: new file green; documented red without the Phase 1 subscription. Layers: network e2e (real sandbox).

### Phase 4 — Regression sweep + docs

- Full suites: units + components, smoke, and the **whole** network suite — the new trigger fires in every profile-registering test, so Inferences 2 and 3 must be proven, not assumed.
- Docs: `ARCHITECTURE.md` (the seeding trigger set), `apps/extension/tests/e2e/README.md` (new flags + storage key), `implementations-plan/index.md`.

**Validation gate.** `bun run audit:vue && bun run test:e2e && bun run e2e:agent`. Pass: all exit 0. Layers: typecheck · unit + component · lint · build · smoke e2e · full network e2e.

## Delivery

**Single arc, single PR** → `dev`. Branch `worktree-first-account-token-seeding`; plain `gh pr create` (no `gh stack`). `/code-review` level: **`medium`**.

PR title (≤93 chars, leaving room for the ` (#NN)` squash suffix):
`fix(token): seed default tokens when a chain's first account is created`

## Post-implementation

Run in order once every phase is ✓ (single arc, so each step runs once over the whole diff):

1. **`/code-review medium --fix`** on the net diff from the plan baseline. Skim the applied fixes for unintended changes, then commit them **separately** from implementation commits.
2. **Codex audit** (`/codex xhigh`) with: the net diff, a summary of the code-review commits, this plan.md, an explicit adversarial/security ask, and both rules below verbatim.
   - *No over-engineering:* "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - *Comment quality:* "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
3. **Iterative fix loop.** Verify each codex claim against the repo before acting, apply accepted fixes, commit, log the round in `lessons/`, then **resume the same codex session** with the fix diff for re-review. Loop until a round yields no new material findings; stop and surface if still material after 3 rounds.
4. **Delivery.** Only now open the PR: `gh pr create --base dev`, then `gh pr checks --watch` until `quality-status`, `smoke-e2e-status`, and `network-e2e-status` are green. Re-run genuine flakes; fix real breakage. Never weaken a gate. Then update `implementations-plan/index.md`.

**Post-implementation hardening:** no repo-wide `/harden` pass. The seam's security review is folded into the `medium` `/code-review` plus the codex loop's adversarial ask, per codex's finding that a `low` review understated it.

## Seeds

*(draft — finalized after the approval gate)*

```
/goal All four phases marked ✓ in implementations-plan/first-account-token-seeding/plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript — including Phase 2's negative+positive bundle greps and Phase 3's documented pre-fix RED run; for each phase the agent has printed LESSONS_FILE=implementations-plan/first-account-token-seeding/lessons/phase-N.md in the transcript; /code-review medium --fix complete with findings applied and committed separately; the codex fix loop converged, evidenced by a resumed codex pass reporting no new material findings quoted in the transcript; a PR against dev exists (created only after the loop converged) with gh pr view output in the transcript; bun run audit:vue and bun run test:e2e and bun run e2e:agent all report exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/first-account-token-seeding forward. Never idle waiting for my input. Each firing: (1) Reality check: read plan.md + lessons/ (authoritative state), git status, git log --oneline -5; if a PR exists, gh pr view --json statusCheckRollup. (2) Waiting on CI is fine — use the wait to review the diff or prep the next phase. (3) No task in hand? Pick the next pending step from plan.md and start it; after each meaningful edit run bun run lint + bun run --cwd apps/extension vitest run for the touched dirs; commit → push. (4) Stuck or facing a decision? Call /codex xhigh, reach a defensible decision, act, log the consult in lessons/phase-N.md. Hard limits stay hard: never merge to dev/main, never publish, never expand scope beyond plan.md. (5) Same step failed 5 times? Stop retrying; reassess with codex. (6) Phase green? Run the phase's full validation gate as written in plan.md, paste the result, mark ✓ in plan.md, print LESSONS_FILE=implementations-plan/first-account-token-seeding/lessons/phase-N.md, advance. (7) All phases ✓? Run /code-review medium --fix → commit fixes separately → codex post-impl audit (net diff + code-review commit summary + adversarial ask + the no-over-engineering and comment-quality rules) → loop until clean → gh pr create --base dev → gh pr checks --watch → wrap-up report and stop.
```

## Audit verdicts

**Codex (session `01a049c6-3770-72d1-81ad-3cc5948c0a6e`, `gpt-5.6-sol` xhigh, 2026-08-28): `conditional approve`** — conditions: (1) double-opt-in and bundle-pin the e2e source; (2) restrict it to one validated chain-0 seed; (3) arm empty replacement in source-built smoke but never artifact/release builds; (4) correct the restore/coalescing claims; (5) explicitly defer the MV3 attempt-burn and balance-reconciliation hazards. **All five adopted** in this revision. Full transcript: `audit-codex.md`.

### Adopted vs rejected

| Finding | Severity | Disposition |
|---|---|---|
| Single-flag "inert without key" contradicts replacement semantics | High | **Adopted** — double opt-in, fail-closed; absent/garbage → empty in armed builds only |
| Seam weakens the pins as a *trust anchor* even without bypassing them | High | **Adopted** — one validated chain-0 entry, canonical-hex checks, `expectedSymbol` hardcoded in the e2e reader; honesty note kept in Security |
| DCE enforcement incomplete (module can't be dropped wholesale; stamp tree-shaken; env is not an authority boundary) | High | **Adopted** — Chrome reader split into its own module, live-pinned stamp, fail-fast env rejection, stamp + key literals in the negative grep |
| Source-built smoke not isolated | High | **Adopted** — arm empty replacement in `_smoke-e2e.yml`'s source build; artifact smoke deliberately unarmed with the residual stated |
| `AccountService.restore()` does not emit `onAccountAdded` (Fact was wrong) | Medium | **Adopted** — Fact 6 and `recon.md` corrected |
| "At most two passes" wrong for sequential events | Medium | **Adopted** — Inference 1 rewritten |
| `TokenSeedSource` is more abstraction than needed | Medium | **Adopted** — dropped in favour of `getSeeds()` on the existing `TokenSeederDeps` port |
| `low` review level understates the seam | Medium | **Adopted** — raised to `medium` |
| MV3 attempt-burn is real | Medium | **Adopted as an explicit deferral**, with the "don't just move the write" caveat |
| Balance-row reconciliation hole on SW restart | Medium | **Adopted as a separate follow-up** — pre-existing, unrelated to this trigger |
| Fact 2 wording ("aborts the pass") | Low | **Adopted** — reworded |
| Stale line citations | Low | **Adopted** — all corrected against `6de63585` |
| Session key not dApp/content-script writable | Low | **Adopted as supporting evidence** in Security |
| Unguarded subscription creates no unbounded production traffic | Low | **Adopted** — recorded in Inference 1 |
| Composition coverage alone insufficient; pre-fix-red check valuable | Medium | **Adopted** — Phase 3 keeps the mandatory red run |
