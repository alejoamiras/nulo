# Phase 5 — Mechanical prep: stub-opt threading

- `SimulateTxFn` opts gained `stubAccountAddresses?: string[]` (documented as follow-up plumbing for discovery-flavored sims); `ExecutionCoordinator.simulateTxTask` destructures it OUT of the opts bag and forwards it as `IPXE.simulateTx`'s third parameter — deliberately not inside the upstream opts object, which the runtime schema-parses (an extra key would be stripped or rejected).
- No strategy passes the field; forwarding `undefined` is byte-identical to today's call shape.
- Scope note: the r2 plan's discoverer runner/extractor split was already moved to the follow-up charter at rev 3 (final-pass M1 — the "pure extractor" contract was chain-bound); this phase is the surviving mechanical piece only.

## Gate result: PASS
- `bun run --cwd apps/extension vitest run src/wallet/services/execution` → 375 passed, **zero pin changes in `strategies-structural.test.ts`** (the required no-behavior-change proof).
- `bun run lint` exit 0 · `bun run typecheck:all` 13/13 · `bun run test` 3813 passed.
