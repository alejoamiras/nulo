# DRAFT (main agent) — Composition / PXE-injection test rollout

> One of three independent drafts (main + codex + opus-Plan). Consolidated into `plan.md` afterward. Fable 5 was unavailable; the third planner is a top-tier Opus `Plan` subagent in isolated context (capability-over-name, per the blueprint skill) — noted in Methodology.

## Thesis

The spike proved the pattern on ONE service and found its boundary (deep PXE chains = "second wallet"). This rollout does three things: (1) extract the seam so it's not copy-pasted, (2) apply it to the two clean shallow-PXE services (Token, Fpc) + the one high-value no-PXE service (DappSession), (3) ship a **normative limits doc** so the pattern is used as a scalpel, not a hammer. The doc is the centerpiece deliverable, not an afterthought.

## The shared seam design (settled: shared port + one shared fake)

**The surface, traced (Phase 0 step 1 confirms):** Token (`token/service.ts:288-302,373-387,490`) and Fpc (`fpc/service.ts:161-185,244-258,346-358`) both reach PXE the same way: `this.pxeService.getPXE(networkInfo)` → `.getContractInstance(addr)` / `.getContractArtifact(classId)` / `.registerContract({instance, artifact})`. That is the entire shallow surface.

**The port (derived, not hand-authored):**
```ts
// prod-side, tiny boundary type — the methods services actually use.
// DERIVED from the real IPXE so a real signature change breaks fake typecheck.
type ContractRegistryPxe = Pick<IPXE, "getContractInstance" | "getContractArtifact" | "registerContract">
interface ContractRegistryClient {
  getPXE(networkInfo: NetworkInfo): ContractRegistryPxe
}
```
- `PxeServiceClient` **structurally satisfies** `ContractRegistryClient` (its `getPXE` returns the full `IPXE`, and `IPXE <: ContractRegistryPxe`). So the default factory `() => new PxeServiceClient(logger)` is assignable with no cast.
- Token/Fpc gain a defaulted ctor param `pxeClientFactory: (logger) => ContractRegistryClient = DEFAULT_CONTRACT_REGISTRY_CLIENT`. The field can stay typed to `PxeServiceClient` (default path) while the *factory* is port-typed — OR, if the trace confirms Token/Fpc use ONLY `getPXE`, narrow the field to the port (castless).
- **The shared fake** (`tests/.../fake-contract-registry-pxe.ts` or a `*.test.ts` helper) implements `ContractRegistryClient` directly — typed to the port, so **no `as unknown as` cast at all** (the spike needed a cast because it typed to the concrete client; the port removes it). If one cast is unavoidable it lives in exactly ONE place: the fake's factory.

**Why this is a real abstraction, not a leaky union (codex's attack):** the port is FROZEN at the contract-registry surface and DERIVED via `Pick` from `IPXE`. Proving/simulation (`proveTx`/`simulateTx`) are deliberately EXCLUDED. The exclusion is enforceable: a service that needs `proveTx` cannot use this port — which is the signal that it's a deep service (execution), not a shallow one. The port cannot accrete into "the whole client" because adding proving methods is a documented rule violation (the doc's hard limit). Execution stays on its own spike fake; it is the doc's cited counter-example, not a port consumer.

## Phases

### Phase 0 — Extract the shared seam (port + fake); make Token + Fpc injectable
1. **Trace** the exact `this.pxeService` surface Token + Fpc use (confirm it's only `getPXE` + the three registry methods; if either uses more, the port grows to the traced set OR that service is reclassified as deeper — reassess).
2. Define `ContractRegistryPxe` (derived `Pick<IPXE, …>`) + `ContractRegistryClient` + `DEFAULT_CONTRACT_REGISTRY_CLIENT`.
3. Add the defaulted `pxeClientFactory` param to Token + Fpc; `init()` uses it. Production (no factory) is behavior-identical.
4. Build the ONE shared fake implementing the port (canned instance/artifact; `registerContract` = no-op spy). Carries a unique bundle marker (e.g. `FAKE_CONTRACT_REGISTRY_MARKER`).
5. Default-wiring unit test per service: constructed with no factory → real `PxeServiceClient`.
- **Validation gate.** `bun run lint` (0) + `bun run --cwd packages/extension typecheck` (0) + `bun run --cwd packages/extension vitest run src/wallet/services/token src/wallet/services/fpc` (default-wiring tests green; no regressions) + `bun run --cwd packages/extension build:chrome` then `grep -r FAKE_CONTRACT_REGISTRY_MARKER dist/` → 0 files. Layers: lint · typecheck · unit · build/bundle-hygiene.

### Phase 1 — Limits doc v1 + normative CLAUDE.md pointer (guardrail BEFORE more tests)
Write `packages/extension/tests/COMPOSITION-TESTS.md` (contents below). Add a pointer in `CLAUDE.md` under the test-conventions area marking it a rule contributors + AI assistants MUST follow. Rationale: the doc is the spec the next phases obey; Token/Fpc/DappSession become its first conformance cases. (Finalized in Phase 5 with anything learned.)
- **Validation gate.** Pre-commit guard passes (`scripts/check-no-brand.sh` — no legacy brand / absolute paths) + `bun run lint` (0; markdown not linted by biome, but the repo's doc checks pass) + the CLAUDE.md pointer resolves. Layers: docs/guard.

### Phase 2 — Token composition test (real import/register orchestration)
Drive the REAL `TokenService` import/register path in-process via the shared fake: `getActiveProfile`/`getNetwork` (stubs) → `getPXE` → `getContractInstance` → `getContractArtifact` → `registerContract` → the real token record/store (FakeBrowserApi-backed). Assert REAL orchestration: validation, dedup of an already-imported token, the persisted record/trust outcome, and ≥1 error path (e.g. instance-not-found → structured error, no record written). Assert REAL state (the service's store), not the fake's canned returns.
- **Validation gate.** `bun run --cwd packages/extension vitest run src/wallet/services/token/<test>` green + `…/token` dir green + `bun run lint` + `bun run --cwd packages/extension typecheck` (0) + build grep (marker absent). Layers: lint · typecheck · unit · composition.

### Phase 3 — Fpc composition test (real discovery/registration orchestration)
Same pattern for `FpcService`: drive sponsored-vs-private FPC instance derivation (`getContractInstanceFromInstantiationParams` is pure `@aztec/stdlib`) + `getPXE` registration; assert the real fee-picker population / fpc record outcome + ≥1 error path. Real state assertions.
- **Validation gate.** As Phase 2, scoped to `src/wallet/services/fpc/`. Layers: lint · typecheck · unit · composition.

### Phase 4 — DappSession no-PXE composition harness (sequenced LAST, droppable)
NO PXE. Fake storage (FakeBrowserApi) + fake messaging/session channel; drive the REAL session lifecycle (connect → grant capability → persist → reconnect → disconnect), asserting real capability persistence + state transitions through the real service. This is a SECOND harness shape (no shared PXE port) — the doc covers both. Droppable if time-boxed out.
- **Validation gate.** `bun run --cwd packages/extension vitest run src/wallet/services/dapp-session/<test>` green + dir green + lint + typecheck (0). Layers: lint · typecheck · unit · composition.

### Phase 5 — Fake-drift guard + doc finalize + index
Land the drift guard (see fork answer: type-derived ports + a compile-time conformance assertion; NO per-service network canaries). Finalize `COMPOSITION-TESTS.md` (fold in lessons). Update `implementations-plan/index.md`.
- **Validation gate.** A type-level conformance test (the fake `satisfies` the derived port; the real client `satisfies` the port) compiles + `bun run --cwd packages/extension vitest run src/wallet/services/{token,fpc,dapp-session}` all green + `bun run lint` + final `build:chrome` + grep. Layers: lint · typecheck (conformance) · unit · composition · build.

## The limits doc — concrete contents (`packages/extension/tests/COMPOSITION-TESTS.md`)

1. **What it is** — drive the real service graph in-process against dumb fakes; no sandbox/proving/browser. The 4 reference tests (Execution cancel = spike, Token import, Fpc discovery, DappSession lifecycle).
2. **Decision tree — when to reach for it**
   - USE when: real orchestration (sequencing / state machine / dedup / error-shaping) **AND** a shallow boundary (storage, node reads, the contract-registry PXE surface) **AND** currently only e2e-covered.
   - DON'T when: (a) logic is pure → unit-test the pure fn; (b) the value is in proving/simulation/crypto/real-PXE semantics → e2e (a fake proves nothing there); (c) faking the boundary needs Aztec semantics → STOP (second wallet).
3. **Hard limits (testable)**
   - The shared PXE port is FROZEN at the contract-registry surface. **`proveTx`/`simulateTx`/any proving or simulation method in a composition fake is forbidden** — that is the e2e boundary.
   - Fake-surface cap: a composition fake implementing **> ~5 PXE methods, or ANY proving/simulation method, is over the line** — the service is too deep ("a second wallet"); use e2e.
   - Fakes are DUMB: canned returns, zero Aztec branching. Conditional logic mirroring real PXE behavior = theatre.
   - Derive fake types from real types (`Pick`/`satisfies`) so the compiler is the drift alarm; never hand-author standalone fake interfaces (they rot silently).
   - Assert REAL state (real journal/store via FakeBrowserApi), never the fake's own canned output. Prove the negative (the bad thing did NOT happen).
4. **Failure taxonomy (named, so reviewers can call it)**
   - **Second wallet** — the fake re-implements Aztec semantics (contract resolution, chain identity, proving). Spike example: `buildStandard`.
   - **Theatre** — the test asserts the fake's behavior, not real orchestration. Symptom: assertions never touch real state transitions / FSM.
   - **Drift** — the fake silently diverges from the real PXE. Guard: type-derived ports + e2e backstop.
5. **Production-safety rules** — fakes live in `*.test.ts` (never imported by prod); default factory = real client; bundle-grep proves the marker is absent from `dist/`.
6. **When in doubt → e2e.** Composition tests are a scalpel; e2e is the source of truth for network semantics.

## Security & Adversarial Considerations
- **Threat surface:** test infra + DI seams across 3 more services. No new runtime trust boundary, auth/secret/network/crypto/supply-chain change.
- **Production reaching the fake (×3):** mitigated by (1) defaulted real factory per service; (2) per-service default-wiring tests; (3) fakes in `*.test.ts` + a build+grep that the marker is absent from `dist/` for ALL targets.
- **Shared fake = single point of test-lie:** if the one shared fake is wrong, Token + Fpc tests are wrong together. Mitigated by the type-derived port (compile-time shape lock), the dumb-fake rule, and the e2e semantic backstop.
- **The port as trust surface:** test-injection only; prod always gets the real client; the port grants no runtime capability and excludes proving/simulation by construction.

## Assumptions
**Facts (verified this session):** the recon (Token/Fpc hard-`new` + shallow registry surface; DappSession PXE-free; all three zero-test) — see BRIEF; the spike precedent + its "second wallet" finding; `PxeServiceClient` can't be subclassed (chrome.runtime ctor); validation tooling.
**Inferences (verify in Phase 0):** Token/Fpc use ONLY the registry PXE surface (trace); `getContractInstance`/`getContractArtifact`/`registerContract` are shallow (don't trigger deep PXE sync) — read IPXE impl; DappSession is PXE-free on ALL paths; the real client is structurally assignable to the derived port (confirm with typecheck).
**Asks:** none beyond the four answered. Fake-drift I am resolving (type-conformance + e2e, no per-service canary) — flagged for audit.

## Fake-drift fork — my INDEPENDENT answer (reverses the brief's lean)
Decompose the drift:
- **Signature/shape drift** (an `@aztec` bump changes a method signature/return type): caught AT COMPILE TIME for free IF the port is DERIVED from the real type (`Pick<IPXE,…>`) and the fake is typed to the port. This is the most common drift and the cheapest guard.
- **Semantic/behavior drift** (the real method now behaves differently though its type is unchanged): typecheck can't see it; only running real semantics catches it — which the EXISTING network e2e already does (it registers + reads real contracts).

A per-service `skipIf` shape-canary therefore sits in the dead zone: it duplicates typecheck (for shape) and e2e (for semantics) while adding maintenance. **So I REVERSE my brief lean: no per-service canaries.** The guard is (1) type-derived ports = compile-time drift alarm, (2) the existing network e2e = semantic backstop. Optional single shared canary only if audits show a realistic shape-drift typecheck misses — I doubt it. (Audit ask for codex/opus: can you construct a drift that BOTH typecheck and e2e miss but a shape-canary catches? If yes, I add one shared canary.)

## Audit asks — my answers
- **(a) security:** covered above; the only new risk vs the spike is the shared fake (one point of lie) — mitigated by type-derivation + e2e.
- **(b) assumption-attack:** the load-bearing inference is "shallow surface" — Phase 0's trace + reading IPXE's `getContractInstance`/`registerContract` impl must confirm they don't kick off a deep sync (if `registerContract` triggers note-discovery/sync, Token/Fpc are deeper than they look and the fake must NOT model that — it stays a no-op, and the test scopes to the register CALL, not its side effects). DappSession-PXE-free verified by grep but must be re-confirmed across `client.ts` + handlers.
- **(c) the doc:** the testable rules are the frozen-port + the >5-method / no-proving caps + derive-from-real-types + assert-real-state. These are reviewer-applicable without judgment calls.
