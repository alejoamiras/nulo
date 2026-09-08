# Competing outline B — "one runner, one harness package, tools first"

Same Phase-0 decisions (facade, rename + protection runbook, advisory-then-required, full matrix sharded). Different structure and order.

## Shape

- **One test runner everywhere: Vitest.** The browser suite is Vitest + the `playwright` library (not `@playwright/test`): `apps/tools/vitest.browser.config.ts` with a `globalSetup` that boots the sandbox and launches one Chromium per worker; specs get a `page` from a small fixture helper. Rationale: the repo already spreads `sharedTest` from `vitest.base.ts` into every config, ships `describe.skipIf(!ENV)` as the rule for live-data tests, has `--shard` semantics in CI, and the owner's `test:all` / `bun --bun vitest` conventions. No second runner, no second reporter, no `playwright.config.ts`. Cost: hand-rolled `addInitScript`/route handling (the library exposes them; only the `webServer`/trace/HTML-report conveniences are lost).
- **A `packages/sandbox-harness` workspace** (private) owning boot/attach, fixtures (generation, facade, Dripper), accounts/fee-state shaping, the flows, and the written artifacts. Both `packages/bridge-core` (integration suite) and `apps/tools` (browser suite) depend on it. Rationale: the harness is a distinct concern with two consumers on day one, and the tools app should not import from `packages/bridge-core/scripts/` (a scripts dir is not a package boundary; the isolated linker will not resolve it cleanly).
- **Order: tools first.** Arc 1 = CI naming (same). Arc 2 = harness package + `local` target + spike + browser suite (the product the owner wants to ship). Arc 3 = bridge integration suite + CI job (the contracts already have forge/halmos/TXE coverage; the sandbox smoke exists as a manual gate meanwhile). Rationale: confidence in the frontend is the stated pain; the contract-level suite mostly re-expresses a smoke that already runs.
- **The manifest `swap` block is emitted by the harness only**; `deploy-sandbox.ts` is deleted rather than kept as a CLI (the harness exposes `sandbox up|down|smoke` as a bin).
- **Drip via the real testnet Dripper is out**; the harness deploys Dripper + two tokens (same as A).
- **CI**: identical target names. The tools workflow runs `bun --bun vitest run --config vitest.browser.config.ts --shard=i/n` — no Playwright action; Chromium comes from `playwright install chromium` in a `setup-playwright-browsers` step.

## Phases

1. CI naming (= A's phase 1).
2. `packages/sandbox-harness`: move + vendor bytecode + facade + `swap` block + Dripper (A's phases 2–4 minus the vitest suite).
3. Spike (= A's phase 6) using the harness.
4. `local` target + local build (= A's phase 7).
5. Browser suite under Vitest: shim, test wallet, page helpers, the matrix (A's 8–9 merged).
6. Tools CI (= A's phase 10).
7. Bridge integration suite under Vitest in `packages/bridge-core/test/integration/` consuming the harness (A's phase 4's suite) + CI job (A's phase 5).

## Where B is weaker (author's own view)

- Vitest is on the Bun runtime in this repo (`bun --bun vitest`); Playwright's browser automation under Bun is not a supported combination — B would have to run the browser config on Node, which reintroduces a second runtime anyway and loses the "one runner" purity.
- `@playwright/test`'s per-test traces, retries, `webServer` lifecycle and `--shard` are exactly the parts a flaky live-network suite leans on; re-implementing them is scope with no product value.
- A package boundary for two consumers is one more `package.json`, tsconfig, biome override, and CI filter entry to maintain; the three-places rule says wait.
- Tools-first defers the cheapest, highest-signal gate (the contract suite reuses a proven script) behind the riskiest one (the unproven embedded-wallet handshake).
