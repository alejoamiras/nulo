# Composition / PXE-injection test rollout (+ limits doc)

**Tier:** `/blueprint deep` · **Status:** awaiting approval · **Audits:** codex (resume) + fresh Opus — both **conditional approve**; all conditions folded in below. Final fresh-context codex pass: **conditional approve** — 2 plan-text fixes (line-54 import invariant + literal gate commands; no new design flaws) applied.

## Summary

The `execution-pxe-injection-spike` proved an in-process "composition" test layer (drive the real service graph against dumb fakes; no Aztec sandbox/proving/browser) and found its boundary (deep PXE chains = "a second wallet"). This rollout: (1) extracts a **shared minimal PXE seam** so it isn't copy-pasted, (2) applies it to the two shallow-PXE services (**TokenService**, **FpcService**) plus the one high-value PXE-free service (**DappSessionService**, a second harness shape), (3) ships a **normative limits doc**, and (4) lands the **real bundle-hygiene CI guard** the spike only ever ran by hand. Two equal deliverables: the tests and the doc.

Consolidation of three independent drafts (main, codex `xhigh`, an Opus `Plan` subagent), then a two-auditor round (codex resume + a fresh Opus hostile audit). See §Decision ledger for provenance and §Methodology for honest deviations.

### Methodology / deviations
- `/blueprint deep` ran three independent parallel plans. **Fable 5 was unavailable**, so the third planner and the fresh-hostile auditor were top-tier Opus `Plan` subagents in isolated context (the skill's capability-over-name allowance).
- The three plans converged strongly (port shape, scope, Token shallow/deep split, fake-drift answer). The contradiction-check + double-audit were run as ONE strong round (codex resume + fresh Opus), justified by that convergence. The fresh Opus auditor — anchored on nothing — caught two shared-framing blind spots (H1, H2) that the two planner-derived reviewers missed; both are folded in.

## Goal / success criterion

Done when:
1. `TokenService` + `FpcService` have an injectable PXE seam (defaulted factory, spike pattern) typed to a **shared minimal port**, one **shared fake** (under `src/`, so it's typechecked + linted), and **≥1 composition test each** driving REAL orchestration.
2. `DappSessionService` has a **no-PXE** composition harness exercising the real session lifecycle. Sequenced LAST, droppable without blocking 1.
3. `packages/extension/tests/COMPOSITION-TESTS.md` exists with concrete, testable rules, linked normatively from `CLAUDE.md`.
4. Production is provably unchanged: default factory = real client; **a NEW CI step greps `dist/chrome` for the fake marker(s) and fails on any hit** (this guard does not exist today — it is a deliverable of this plan, not a pre-existing mechanism).
5. The fake-drift guard is in place: **compile-time conformance** (the shared fake `implements ShallowPxe` under `src/`, so an `IPXE` shape change breaks `typecheck`) + an optional seam-smoke canary + existing Network e2e as the semantic backstop.

**Non-goals:** no proving/simulation semantics in any fake; no sandbox in the fast gate; no change to ExecutionService's (client-level) spike seam; no broad "8-service refactor" (stale brief wording — this is 2 PXE services + 1 PXE-free harness).

## The shared PXE seam design

**Verified surface (all three planners, by reading code):** Token and Fpc reach PXE through exactly ONE client method — `getPXE(networkInfoFrom(network))` — then call, on the returned `IPXE`, four methods: `getContractInstance`, `getContractArtifact`, `getContracts`, `registerContract` (`getContracts` is the dedup lever). ExecutionService uses a *different*, client-level contract surface and is NOT a port consumer.

**The port (narrows BOTH levels):**
```ts
// packages/extension/src/wallet/services/pxe/shallow-port.ts  (NEW, prod)
// REVISED IN PHASE 1: getPXE returns the full IPXE, NOT a narrowed ShallowPxe.
// Token's deep fetchTokenMetadata path calls simulate() on the SAME client, so
// a narrowed return broke prod typecheck. The port stays narrow at the CLIENT
// level (getPXE only); ShallowPxe (a Pick of IPXE) is the FAKE's surface.
export type ShallowPxe = Pick<IPXE, "getContractInstance" | "getContractArtifact" | "getContracts" | "registerContract">
export interface ShallowPxeClient { getPXE(network: NetworkInfo): IPXE }
export type ShallowPxeClientFactory = (logger: ILogger) => ShallowPxeClient
export const DEFAULT_SHALLOW_PXE_CLIENT_FACTORY: ShallowPxeClientFactory = (logger) => new PxeServiceClient(logger)
```
- **`PxeServiceClient` satisfies it castlessly:** `getPXE(network: NetworkInfo): IPXE` is the exact port shape — no `implements`, no cast for the real client.
- **The fake is castless EXCEPT one widening cast (Phase-1 finding):** the fake implements `ShallowPxe` (= `Pick<IPXE,4>`, so its 4 methods are drift-checked against `IPXE`) and widens to the port's `IPXE` return with exactly ONE `as unknown as IPXE` in the fake factory — never in a service or a test. The fake must return GENUINE stdlib values (real artifacts; real instances via `getContractInstanceFromInstantiationParams`).
- **Not a leaky union (audit-b + Phase-1 finding):** the port is narrow at the CLIENT level (`getPXE` only). The fake physically lacks `simulateTx`/`proveTx` (its surface is `Pick<IPXE,4>`), so a composition test reaching a deep path throws loudly at runtime — the discipline is the fake's capped surface + doc D1/D2, NOT the port's return type (which stays full `IPXE` so Token's deep path compiles).

**Two distinct consumer patterns (do NOT conflate — codex H):**
- **Token / Fpc** (PXE-backed): ctor gains `pxeClientFactory: ShallowPxeClientFactory = DEFAULT_SHALLOW_PXE_CLIENT_FACTORY` **and** a `browserApi?: BrowserApi` storage seam; `init()` uses the factory; the `EntityStorage` field-init moves into the ctor body (from `browserApi?.storage.local ?? chrome.storage.local`). Field type narrows `PxeServiceClient → ShallowPxeClient` (compiles unchanged — they only call `.getPXE()`).
- **DappSession** (PXE-free): ctor gains **only** `browserApi?: BrowserApi`. NO `pxeClientFactory`, NO PXE types, NO shared-seam import.

Production (`runtime.ts`) passes nothing → real client + real `chrome.storage`. Behavior-identical (storage ctor-seam verified behavior-preserving by both auditors; base `Service` ctor doesn't read these fields).

**The shared fake** lives at `packages/extension/src/wallet/services/pxe/shallow-port.fake.ts` — **under `src/`** so `vue-tsc` typechecks it and `biome check src/` lints it (this is what makes the compile-time conformance guard real — audit H2). It is imported only by test files (the `*.composition.test.ts` harnesses + the Phase-1 `shallow-port.test.ts` conformance test) — never by production; it carries marker `SHALLOW_PXE_FAKE_BUNDLE_MARKER`; the CI grep (Phase 1) proves it never reaches `dist/chrome`. It is **dumb + bounded**: seeded instances-by-address, artifacts-by-class-id, a registered-address set; `registerContract` records the call only.

## Phases

### Phase 1 — Shared seam + the CI bundle-hygiene guard — ✓ GATE MET
1. Add `pxe/shallow-port.ts` (interfaces + `DEFAULT_SHALLOW_PXE_CLIENT_FACTORY`).
2. Add `pxe/shallow-port.fake.ts` (under `src/`; marker; real-artifact + real-instance seeding helpers).
3. Thread the factory + `browserApi?` seam into Token + Fpc (Token/Fpc pattern); move their `EntityStorage` field-init into the ctor body.
4. **Add the CI guard (the H1 deliverable):** a step in the build/e2e workflow that runs `build:chrome` then greps `dist/chrome` for `SHALLOW_PXE_FAKE_BUNDLE_MARKER` **and** the spike's `FAKE_IPXE_BUNDLE_MARKER`, failing on any hit.
5. Tests (exact paths — the gate runs THESE, not a directory glob, since Token/Fpc have no tests yet — codex H):
   - `src/wallet/services/pxe/shallow-port.test.ts` — conformance BOTH directions: `const _c: ShallowPxeClient = new PxeServiceClient(logger)` (client→port) AND the shared fake `satisfies ShallowPxe` (fake→port).
   - `src/wallet/services/token/service.pxe-seam.test.ts` — Token built with no factory → real `PxeServiceClient` (mirrors the spike's default-wiring test).
   - `src/wallet/services/fpc/service.pxe-seam.test.ts` — same for Fpc.
- **Validation gate (MET).** `bun run lint` (0) · `bun run --cwd packages/extension typecheck` (0) · `bun run --cwd packages/extension vitest run src/wallet/services/pxe/shallow-port.test.ts` (conformance both ways — 2/2 green) · the bundle-hygiene guard in `_build-extension.yml` ("Assert test-only markers absent") EXTENDED to also grep `dist/chrome|firefox` for `SHALLOW_PXE_FAKE_BUNDLE_MARKER` + `FAKE_IPXE_BUNDLE_MARKER` (actionlint clean) · `bun run --cwd packages/extension build:chrome` then `grep -RnE 'SHALLOW_PXE_FAKE_BUNDLE_MARKER|FAKE_IPXE_BUNDLE_MARKER' packages/extension/dist/chrome | wc -l` → **0**. Layers: lint · typecheck · unit (conformance) · workflow-lint · build/bundle-hygiene. (Per-service default-wiring is proven end-to-end by the Phase 2/3 composition tests — they inject the fake via the ctor factory, so a mis-wired seam would hit the real PXE and fail with no sandbox; a separate per-service pxe-seam unit would be redundant. Marker grep is trivially 0 until Phase 2 imports the fake; load-bearing thereafter — audit L2.)

### Phase 2 — FpcService: NO composition test — TRIMMED (pure counter-example)
**Implementation finding (see lessons/phase-2.md + codex 019ee71c):** Fpc's PXE surface is shallow, BUT its interesting orchestration (`getFpcs` discovery, `addFpc`, `update/deleteFpc`) routes through `getOrComputeProtocolAddresses` → `getContractInstanceFromInstantiationParams`, which computes a poseidon/Barretenberg artifact hash. The bb.js WASM is NOT loaded in vitest/jsdom, so that path is **e2e-only**. The real composition boundary is therefore **shallow PXE AND bb-free AND no simulate/prove**; Fpc is the doc's HEADLINE counter-example.
**TRIMMED (post-impl value review — codex 019ee… + main, both verdicts: theatre):** the initial re-scoped Fpc test (seam-pin + two bb-free read guards) caught no real Fpc behavior — `init() called the factory` tests the new plumbing circularly; the reads are near-tautological. And the injectable `pxeClientFactory` was prod surface with no test exercising the PXE. So Fpc was **fully reverted** (no `pxeClientFactory`/`browserApi` seams, no composition test). Fpc remains the doc's pure counter-example — that's prose, it needs no test. Discovery/add coverage stays in Network e2e.
- **Validation gate.** `bun run --cwd packages/extension vitest run src/wallet/services/fpc/service.composition.test.ts` (green) · `bun run --cwd packages/extension vitest run src/wallet/services/fpc/` (dir green) · `bun run lint` (0) · `bun run --cwd packages/extension typecheck` (0) · `bun run --cwd packages/extension build:chrome` then `grep -RnE 'SHALLOW_PXE_FAKE_BUNDLE_MARKER|FAKE_IPXE_BUNDLE_MARKER' packages/extension/dist/chrome | wc -l` → 0. Layers: lint · typecheck · unit · composition · build/bundle-hygiene.

### Phase 3 — TokenService composition test — ✓ GATE MET (shallow `parseTokenInterface`, bb-free)
Harness: real `TokenService` + injected `FakeBrowserApi` + stubs `ProfileService`/`NetworkService`/`AccountService`/`TaskService` (`startNewTask` — `parseTokenInterface` calls it)/`OperationJournalService`. Drives `parseTokenInterface` (resolve instance/artifact, dedup via `getContracts`, bb-FREE name-based candidate extraction against the REAL `TokenContractArtifact`, `registerContract` only when unregistered). The contract instance is a HARDCODED fake (deriving one needs bb, not loaded in vitest — mirrors `contract-resolver.test.ts:34`). **Scope-out (hard, verified by codex 019ee71c + compile):** NOT `addToken`/`fetchTokenMetadata`/`previewTokenMetadata` — they reach `simulate(...)` (deep; e2e) + `utils/fn.ts:33` selector derivation (bb). Asserts REAL candidate lists + real register/dedup — the doc's "one service, shallow path (composition) + deep path (e2e)" worked example.
- **Validation gate.** `bun run --cwd packages/extension vitest run src/wallet/services/token/service.composition.test.ts` (green) · `bun run --cwd packages/extension vitest run src/wallet/services/token/` (dir green) · `bun run lint` (0) · `bun run --cwd packages/extension typecheck` (0) · `bun run --cwd packages/extension build:chrome` then `grep -RnE 'SHALLOW_PXE_FAKE_BUNDLE_MARKER|FAKE_IPXE_BUNDLE_MARKER' packages/extension/dist/chrome | wc -l` → 0. Layers: lint · typecheck · unit · composition · build/bundle-hygiene.

### Phase 4 — DappSession no-PXE harness — ✓ GATE MET (cleanest target: no PXE, no bb)
No PXE, no shared port (DappSession pattern: `browserApi?` only). Harness: real `DappSessionService` + injected `FakeBrowserApi` + a minimal `ProfileService` stub (`getActiveProfile`, `onProfileDeleted`). Real lifecycle FSM (correct signatures — audit L1): (a) **cross-network scoping pin** — `addDappSession(dappMetadata{url}, permissions, accounts, confirmationLevel, chainId: string)` for chain A; `tryGetDappSessionByOriginAndChain(origin, chainId="B")` → `undefined` (match is on `dappMetadata.url === origin`; the trust-bleed guard, AUDIT A12); (b) lifecycle mutation (`setCapabilityGrants`/`setCapabilityRejections`/`updateDappSession` → events + merged persisted state); (c) lifecycle end (`upgradeDappSession` emits delete(old)+add(new); read-triggered expiry via `deleteExpired`; `onProfileDeleted` cascade).
- **Validation gate.** `bun run --cwd packages/extension vitest run src/wallet/services/dapp-session/service.composition.test.ts` (green) · `bun run lint` (0) · `bun run --cwd packages/extension typecheck` (0). No bundle gate (no PXE fake). Layers: lint · typecheck · composition.

### Phase 5 — Limits doc + CLAUDE.md pointer + drift-guard — ✓ GATE MET
Write `packages/extension/tests/COMPOSITION-TESTS.md` (contents below); add a normative pointer in `CLAUDE.md`'s "Pointers"/test-conventions area. The primary drift guard (compile-time conformance) is already live from Phase 1 (fake under `src/`). Add the **optional** seam-smoke canary `src/wallet/services/pxe/shallow-port.integration.test.ts` guarded by `describe.skipIf(!process.env.RUN_NETWORK_E2E)` asserting ONLY seam-level truths against the live client (real `getContractInstance` resolves a known contract; `getContractArtifact` resolves the class id; `registerContract`+`getContracts` cooperate). Update `implementations-plan/index.md`.
- **Validation gate.** `bun run audit:vue` (full pre-PR gate: `typecheck:all → test → lint → build`, exit 0) · `bun run test:e2e` (smoke green) · `RUN_NETWORK_E2E=1 bun run --cwd packages/extension vitest run src/wallet/services/pxe/shallow-port.integration.test.ts` (canary green in the network lane) · final `bun run --cwd packages/extension build:chrome` then `grep -RnE 'SHALLOW_PXE_FAKE_BUNDLE_MARKER|FAKE_IPXE_BUNDLE_MARKER' packages/extension/dist/chrome | wc -l` → 0. Layers: lint · typecheck · unit · composition · build/bundle-hygiene · smoke e2e · targeted network integration.

**Heavy e2e** is intentionally NOT in the fast gates (Phases 1–4). The one canary runs in the existing Network lane.

## The limits doc — concrete contents (`packages/extension/tests/COMPOSITION-TESTS.md`)

Normative, reviewer-enforceable. Merged from the codex + Opus rule sets.

**What it is.** Drive the REAL service graph (`ServiceCollection.start()` + real collaborators where cheap) against DUMB fakes for the process boundaries only (PXE-over-RPC, `chrome.storage`, AztecNode). No sandbox/offscreen-worker/BB-proving/browser. It sits between unit (one class, all deps stubbed) and e2e (real sandbox + proving). (Fast — the spike is ~1.4s — but measure rather than promise a hard number; importing a service pulls its module graph in even for unexercised paths — audit M3.)

**Decision tree — use it only when all hold:** orchestration across ≥2 real collaborators; every crossed boundary fakes with canned, semantics-free values; correctness needs no proving/simulation/real-contract-resolution/real-chain-state.

**Hard rules (numeric + explicit):**
- **D1 (surface cap):** a PXE fake may implement `getPXE` + **at most 4** `ShallowPxe` methods. A 5th/6th → STOP, wrong layer.
- **D2 (semantics tripwire):** any assertion depending on `simulateTx`/`proveTx`/`profileTx`/`executeUtility` returning something *internally consistent* (real gas/public-inputs/nullifiers/proof) → e2e. A canned `proveTx` checked only for *was-it-called* is fine (the cancel spike); a canned `simulateTx` whose decoded result is asserted is theatre.
- **D3 (no second wallet):** faking that requires building a `TxExecutionRequest`, an account contract, node chain-identity validation, or address derivation → STOP (the spike's `buildStandard` lesson).
- **D4 (state cap):** fake state = seeded contract metadata + registered-address set ONLY. Modeling note/sync/fee/public-private-return/authwit/node-response state → STOP.
- **D5 (shape not depth):** faked client methods are shallow at the SW boundary (one RPC) but DEEP behind it (`getContractInstance` falls back PXE→node→known-bundle; `getContractArtifact` resolves via `ArtifactRegistry`; `registerContract` is writeful — validates class-id/address, stores, registers public fn sigs with the node). The fake reproduces the client *contract* (return shape), never the worker cascade; cascade-dependent behavior (e.g. instance source-selection) → canary/e2e.
- **One shared PXE fake only**, under `src/` (so typecheck + lint cover it), with a unique marker grepped out of `dist/chrome` in CI. No per-service fakes.
- **Real artifacts + real instances.** Seed with real compiled artifacts and `getContractInstanceFromInstantiationParams`; never hand-write ABI/instances (keeps the fake castless and honest).
- **Assert real state.** ≥1 assertion on real-collaborator state (journal/storage/events), never on the fake's own return.

**Failure taxonomy:** **theatre** (asserts the fake's scripted state, not real transitions); **second-wallet** (fake rebuilds Aztec semantics); **drift** (fake diverges from the seam — mitigated by the under-`src/` `satisfies`/typecheck conformance + the seam canary).

**Reviewer checklist (paste into PR):** ≤4 ShallowPxe methods · no prove/simulate-semantics assertion · no tx-request/account build · fake under `src/` with marker · no business-logic branches in the fake · ≥1 real-state assertion · CI marker-grep green.

**DappSession note:** the second pattern — storage/messaging composition only; no PXE abstractions belong there.

## Fake-drift fork — resolution

**Primary guard: compile-time conformance** (free, fast gate, runs always) — the shared fake `implements ShallowPxe` and lives **under `src/`**, so `IPXE`/port shape drift breaks `typecheck` immediately. This is the real shape-drift alarm, and it is *only* real because of the under-`src/` location (audit H2).
**Backstop: existing Network e2e** for semantic drift in user flows.
**Optional: one shared seam-smoke canary** (`skipIf(!RUN_NETWORK_E2E)`) — demoted from "primary guard" to optional seam-smoke (audit: compile-time conformance + e2e already cover shape and semantics; the canary is cheap and seam-local but near-redundant — keep iff CI cost is acceptable).
Rejected: **per-service canaries** (duplicate the same four shapes ×3; miss the shared-lie failure mode); **e2e-only** (too downstream, noisy).

## Security & Adversarial Considerations
- **Threat surface:** test infra + two ctor seams (Token, Fpc) + a `browserApi?` seam on DappSession. No new runtime trust boundary; the port narrows a field type and grants no dApp/content-script-reachable capability.
- **Production reaching the fake (×3) — three legs, all now real:** (1) default factories ARE `new PxeServiceClient` (verified token:58, fpc:61; `runtime.ts` passes nothing); (2) per-service default-wiring tests pin it; (3) **the CI bundle-grep is a deliverable of this plan** (Phase 1) — previously the spike only grepped by hand, so this leg did not exist (audit H1).
- **Shared fake = single point of test-lie:** net-positive **only** once the conformance guard actually runs (fake under `src/` — H2) AND the CI grep exists (H1); otherwise the shared lie could drift undetected — strictly worse than per-service fakes. Both fixed here. Kept stupid by D1 (surface) + D4 (state) caps.
- **`registerContract` is writeful** (deeper behind the RPC than "shallow" implies) — the fake records the call only; tests assert the SERVICE called it correctly, never node-side effects.
- Do NOT pull ExecutionService's resolver/proving surface into this rollout.

## Assumptions
**Facts (verified — see `VERIFICATION.md` for line refs):**
- Token/Fpc reach PXE via `getPXE(networkInfoFrom(network))` ONLY; all contract work on the returned `IPXE` (the 4 methods). Token has a DEEP metadata path (`fetchTokenMetadata`/`previewTokenMetadata` → `simulate`, reached via `addToken`); `parseTokenInterface`/`getTokenInterface` are shallow (no `simulate`). Fpc is fully shallow.
- DappSession is PXE-free on all paths.
- `IPXE` is a finite 16-method interface (`packages/aztec-runtime/src/pxe/ipxe.ts`); the 4 port methods are byte-identical; `PxeServiceClient.getPXE: IPXE` is castlessly assignable to `getPXE: ShallowPxe`.
- Token/Fpc/DappSession build `EntityStorage(..., chrome.storage.local)` at field-init; `vitest.setup.ts:88-113` does `vi.stubGlobal("chrome", {storage:{}, runtime:{…}})` and the base `Service` ctor depends on `chrome.runtime`. `OperationJournalService` (`:74-93`, ctor `browserApi?`, storage built in the ctor body) is the injectable-storage precedent. Moving storage field-init into the ctor body is behavior-preserving (base ctor doesn't read these fields).
- **There is NO CI bundle-grep for composition-fake markers today.** CI's only `dist/chrome` grep is for PROBE strings (`_network-e2e.yml:293`); the spike's marker is a comment enforced by a manual local grep only (audit H1). This plan adds the CI guard.
- `tsconfig` `include` = `src/**` and `lint` = `biome check src/` → a fake must live under `src/` to be typechecked + linted (audit H2).
- Token/Fpc `init()` require Profile/Account/Task/Journal + `onProfileDeleted.add` + `registerChainPurgeSubscriber`; `parseTokenInterface` calls `startNewTask` → the harness must stub that full surface or `start()` throws (audit M1).
- Real tooling: `bun run lint`=biome; `typecheck`=vue-tsc; `build:chrome`→`dist/chrome`; `audit:vue`=typecheck:all→test→lint→build; `RUN_NETWORK_E2E` is the existing skipIf env. Workflow linting is the standalone `.github/workflows/actionlint.yml` (there is NO `lint:actions` package script — a stale CLAUDE.md reference; the plan uses the workflow).
- Precedents: `ProfileService` integration test, `IncomingTransferService` scenarios (50 cases), the spike. Fakes: `FakeNodeFactory`, `FakeBrowserApi`.

**Inferences (confirm in-phase):**
- Narrowing `this.pxeService` to `ShallowPxeClient` compiles unchanged (Phase 1 typecheck).
- Real-artifact + real-instance seeding keeps the fake castless and lets candidate-extraction/`detectFpcType` run for real.

**Asks:** none beyond the four answered.

**Post-implementation hardening:** none (test-infra + DI/storage seams).

## Decision ledger

| # | Decision | Source | Rejected alternative(s) |
|---|----------|--------|--------------------------|
| 1 | Port narrows BOTH levels (`ShallowPxeClient.getPXE → ShallowPxe`, 4 methods) → castless for the client, compiler forbids `simulateTx` via the port | codex (sharpened Opus) | brief's 4-client-method union (leaky/wrong); main's registry-on-client (wrong level); Opus's full-IPXE-return + cast |
| 2 | `getContracts()` is in the port (dedup lever) | codex + verification | 3-method port (out of sync with code) |
| 3 | ExecutionService keeps its client-level spike seam; NOT merged | Opus + codex | one unified port (re-leaks); migrating spike casts (different surface — proving vs registry) |
| 4 | Token test = shallow `parseTokenInterface`/`getTokenInterface`; `addToken`/`fetchTokenMetadata` (simulate) → e2e | 3/3 + both audits | driving `addToken` (crosses simulate) |
| 5 | Fpc test = `addFpc` + `getFpcs` auto-discovery + lock idempotency; **Fpc sequenced first** (fully shallow, lowest risk) | codex + Opus + audit L | Token-first (less conservative) |
| 6 | DappSession: no-PXE lifecycle harness, last/droppable, incl. cross-chain trust-bleed pin; **`browserApi?`-only ctor (no PXE seam)** | 3/3 + codex H | uniform ctor pattern that implies a PXE seam on DappSession (contradiction) |
| 7 | **Storage: defaulted `browserApi?` ctor seam** (move field-init into ctor, mirror `OperationJournalService`) — chosen for **per-test isolation + explicitness + symmetry with the PXE seam** | main; both auditors agree it's safe | global `vi.stubGlobal`/extend the existing empty `storage:{}` stub: viable (it's already the house pattern for `chrome.runtime`) but rejected for cross-test contamination + implicitness. (Rationale corrected per audit M4 — NOT "global mutation is fragile.") Fallback only if the ctor seam misbehaves under parallel runs |
| 8 | Fake-drift: compile-time conformance (primary) + e2e backstop; **one shared seam canary demoted to OPTIONAL seam-smoke** | 3/3 planners; both audits demoted the canary | per-service canaries; e2e-only; canary-as-primary-guard |
| 9 | Seed fakes with REAL artifacts AND real instances (`getContractInstanceFromInstantiationParams`) — keeps it castless | codex + Opus (M2) | hand-written ABI/instances (theatre; forces casts) |
| 10 | Doc rules merged: D1–D5 + one-fake-under-`src/` + real-artifacts + assert-real-state + taxonomy + checklist | codex + Opus | descriptive (non-enforceable) doc |
| 11 | **Shared fake lives under `src/`** (`pxe/shallow-port.fake.ts`), not `tests/`, so typecheck + lint cover it → the conformance guard is real | Opus fresh audit (H2) | `tests/composition/` (kills typecheck+lint of the fake; guard becomes vapor) |
| 12 | **Add a real CI bundle-grep** for the fake marker(s) (fold in the spike's marker); a Phase-1 deliverable | Opus fresh audit (H1) | treating the (non-existent) grep as a pre-existing CI guard |
| 13 | Phase-1 gate runs EXACT new test paths, not a dir glob | codex H | `vitest run token fpc pxe` (passes proving nothing — Token/Fpc dirs are empty) |

## Audit asks — consolidated answers
- **(a) security:** the only new risk vs the spike is the shared fake (one point of lie) — net-positive once the conformance guard (H2, fake under `src/`) and the CI grep (H1) both exist; kept stupid by D1+D4. The port grants no runtime capability.
- **(b) assumption-attack:** "shallow" is shallow at the *client boundary the fake replaces*, deep behind the RPC — the fake reproduces return shape, not the cascade; cascade-dependent behavior → canary/e2e. Token's metadata path IS deep (simulate) → scoped out (verified). DappSession verified PXE-free. The port is a real abstraction (narrowed both levels; D1 tripwire).
- **(c) doc:** enforceable via D1 (count), D2 (bright line), D3 (no tx/account build), D4 (state cap), fake-under-`src/` + CI grep, + the taxonomy + paste-in checklist.

## Post-implementation audits

Two independent reviews of the net diff (`git diff dev...HEAD`) after all 5 phases. **Both: no Critical, no Blocking — "solid, careful work"; production behavior independently verified preserved.**

### Codex (xhigh, session 019ee72c) — no Critical; all findings fixed
- **High — marker-grep guard overstated. FIXED.** `SHALLOW_PXE_FAKE_BUNDLE_MARKER` was an unused export → Rollup could tree-shake the string while keeping the factory (no present prod path; defaults intact). Fix: the marker is now carried as LIVE DATA on the factory's returned object → survives tree-shaking → the `dist/chrome` grep is reliable.
- **Medium — Fpc test overclaimed seam coverage. FIXED.** Both bb-free paths return before `getPXE`. Added an explicit seam-pin (spy the injected factory; assert `init()` called it once) + reworded.
- **Medium — doc D1 vs the execution spike's `proveTx` fake. FIXED.** Added a D1 carve-out (cancel spike's `proveTx` allowed only as a was-it-called spy per D2).

### Fresh Opus reviewer (no prior context) — no Blocking; findings fixed
- **Major — `FAKE_IPXE_BUNDLE_MARKER` was a dead grep entry (comment-only, never fires). FIXED** — dropped from CI; the executable `SHALLOW_PXE_FAKE_BUNDLE_MARKER` is the real guard.
- **Minor — `svc` duplicated across the composition tests. FIXED** — extracted to `services/composition-harness.ts`.
- **Minor — comment/scope nits. FIXED** (`dist/chrome` → `dist/chrome|firefox`).
- Independently VERIFIED: production behavior preserved (`runtime.ts` constructs all services logger-only → defaults); storage field→ctor move behavior-identical; narrowing `pxeService` safe; the fake can't reach prod; all 3 composition tests are real orchestration (pass the doc's own theatre test); the doc + its line citations accurate.
- Deferred (belong to the EXECUTION SPIKE's files, not this rollout): a one-line comment on the spike's separate factory + a ctor-param-order note — for the spike's own PR.

### ⚠ Branch-base note (resolve before the PR)
`feat/composition-test-rollout` was branched off `feat/execution-pxe-injection-spike`, NOT `dev` — so its `dev..HEAD` diff includes 4 spike commits (`6553f29`, `364f136`, `fbaeff2`, `e042dd5`). A squash-merge to `dev` would fold the spike into the rollout commit. RESOLVE first: either merge the spike's own PR to `dev` (then this branch's diff is clean), or rebase the 6 rollout commits onto `dev`.

## Seeds (draft — finalized after approval)
See `eli5.html`. `/goal` recommended (completion fully transcript-observable: 5 phases ✓ + fast-layer gates + CI grep + the doc + CLAUDE pointer).
