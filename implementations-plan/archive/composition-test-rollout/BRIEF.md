# BRIEF — Composition / PXE-injection test rollout (+ limits doc)

Shared grounding for THREE independent planners (main + codex + fable). Each drafts a full `plan.md` independently from this brief, then the main agent consolidates. Bring an adversarial, independent perspective; challenge framing where you disagree — EXCEPT the four settled decisions below (do not relitigate those).

## Mission

The `execution-pxe-injection-spike` proved an in-process "composition" test layer: drive the REAL service graph against dumb fakes, no Aztec sandbox / offscreen worker / proving / browser. Roll that pattern out to the highest-value targets, extract a shared seam so it isn't copy-pasted, and — most important — leave a **normative "limits" doc** so future contributors (human + AI) know when to use this, when NOT, and never re-implement the PXE.

Two deliverables, equal weight:
1. **The tests**: TokenService + FpcService (PXE-injection) and DappSessionService (no-PXE composition) each get an injectable seam + ≥1 composition test that exercises REAL orchestration (not fake-only theatre).
2. **The doc**: a canonical file codifying the discipline (the "second wallet" trap, dumb-fakes rule, when to reach for this vs unit vs e2e).

## Confirmed decisions (SETTLED — do NOT relitigate)

1. **Scope**: Token + Fpc + DappSession. Token/Fpc are PXE-injection exemplars (identical shallow PXE surface). DappSession is a **no-PXE** composition harness (storage/messaging boundary) — a SECOND pattern; sequence it LAST and keep it droppable.
2. **DI seam**: one **shared minimal typed port** over the shallow-PXE surface (`getContractInstance` / `getContractArtifact` / `registerContract`, plus `getPXE`) that `PxeServiceClient` already satisfies, with **one shared fake**. NOT per-service bespoke fakes. (DappSession's seam is storage/messaging — separate, not this port.)
3. **Limits doc**: a dedicated test-root file — `packages/extension/tests/COMPOSITION-TESTS.md` — linked from `CLAUDE.md` as a **normative** rule (contributors + AI assistants MUST follow), not a buried plan note.
4. **Fake-drift guard** is the ONE open fork — see below.

## Verified facts (this session)

- **Spike**: `ExecutionService` PXE made injectable via a defaulted `pxeClientFactory: (logger) => PxeServiceClient`; `service.composition.test.ts` drives the real graph in-process against a dumb fake + the REAL `OperationJournalService` FSM; ~1.4s, zero sandbox. On branch `feat/execution-pxe-injection-spike`.
- **Spike KEY finding**: `executeTransfer`'s fresh-build (`buildStandard`) is too deep to fake — it validates node chain-identity, resolves contracts, builds via the account contract = "a second wallet". The test used the **reuse fast-path** to skip it. ⇒ **deep PXE chains are NOT injection-test targets.** This is the central cautionary lesson the doc must encode.
- **TokenService** (`token/service.ts`): `new PxeServiceClient` at :58; uses `getPXE()` → `getContractInstance` / `getContractArtifact` / `registerContract` (:288-302, :373-387, :490). SHALLOW. **Zero tests.**
- **FpcService** (`fpc/service.ts`): `new PxeServiceClient` at :61; `getContractInstanceFromInstantiationParams` (pure `@aztec/stdlib`, no PXE) + `getPXE()` → `getContractInstance` / `getContractArtifact` / `registerContract` (:161-185, :244-258, :346-358). SHALLOW. **Zero tests.**
- **DappSessionService** (`dapp-session/service.ts`): touches **NO PXE**. Boundary is storage + messaging/session. Only `capability-meta.test.ts` exists (tests `capability-meta.ts`, NOT the service lifecycle). **Zero lifecycle tests.**
- **Precedent**: `ProfileService.service.integration.test.ts`, `IncomingTransferService.service.scenarios.test.ts` (50 fake-PXE cases), the spike's `service.composition.test.ts`. Fakes available: `FakeNodeFactory`, `FakeBrowserApi` (`@nulo/wallet-core/testing`), `NOOP_PROOF_GATE`.
- **`PxeServiceClient extends … ServiceClient`** wires `chrome.runtime` in its ctor ⇒ a fake CANNOT subclass it; must implement-subset + cast, OR satisfy a narrow port (the chosen seam). This is WHY the shared port is the right move — consumers type to the port, the cast lives in one place.
- **Validation layers** (real tooling): `bun run lint`; `bun run --cwd packages/extension typecheck`; `bun run --cwd packages/extension vitest run <path>` (unit + composition); `bun run --cwd packages/extension build:chrome` + `grep` for a fake marker in `dist/` (bundle-hygiene); `bun run test:e2e` (smoke); `bun run e2e:agent` / `NULO_E2E_PROVERLESS=1` (network). Composition tests are fast/no-sandbox BY DESIGN.

## Open fork — every planner takes a position AND attacks the others

**Fake-drift guard**: a dumb fake that drifts from the real PXE is confidence theatre (the strategic risk of this entire approach). How do we prevent it?

- **Main's lean**: author ONE `describe.skipIf(!ENV)` real-PXE canary per shallow-PXE service that pins the fake's shape/contract against the real client — runs in the network job, NOT the fast gate. Rationale: matches the repo testing philosophy ("for external-system data, always include a `describe.skipIf` real-data integration test") + codex's prior rollout ask.
- **Alternative**: rely solely on the existing Network e2e suite as the drift backstop; add no new canaries.
- **Attack both**: Is a per-service canary worth the maintenance, or pure duplication of the e2e backstop? Can a canary that doesn't exercise real *semantics* (only shape) actually catch the drift that matters? Is there a THIRD option (e.g. a type-level conformance test that the fake satisfies the port + a single shared canary, not one-per-service)?

## Required plan sections (all planners)

- Phased structure, each phase ending in a concrete **Validation gate** (exact commands from real tooling + pass criteria + layers; heavy e2e only where warranted).
- **Shared port design**: exact method set, the TypeScript shape, how `PxeServiceClient` satisfies it (structural), how the shared fake implements it, where the cast lives, how the 8-service rollout consumes it.
- **DappSession no-PXE harness**: what gets faked (storage/messaging), what real orchestration is exercised (the session lifecycle FSM).
- **Limits-doc CONTENTS**: the actual decision rules — concrete heuristics that stop someone re-implementing the PXE, not vibes. (e.g. "if your fake needs to model >N PXE methods or any proving/simulation semantics, STOP — that's e2e".)
- **Security & Adversarial Considerations** + **Assumptions (Facts / Inferences / Asks)**.

## Audit asks (every planner + every auditor must answer)

- **(a) adversarial / security**: the injectable seam as a "production reaches the fake" risk now across 3 MORE services; the single shared fake as one point of test-lie; bundle-hygiene proving the fake is absent from `dist/` for all targets; whether the port widens any real trust surface.
- **(b) assumption-attack**: is the "shallow PXE surface" actually shallow — do `getContractInstance` / `getContractArtifact` / `registerContract` trigger deep PXE sync/resolution under the hood (making Token/Fpc secretly "second-wallet" territory)? Is DappSession truly PXE-free across all its code paths? Is the shared port a real abstraction or a leaky union that will accrete methods until it's the whole client?
- **(c) the doc**: what RULES actually prevent re-implementing the PXE? Give concrete, testable heuristics a reviewer can apply, plus the failure-mode taxonomy (theatre, second-wallet, drift).

Prefer the SMALLEST root-cause changes over broad rewrites. Be concrete and opinionated. Output the full plan as markdown.
