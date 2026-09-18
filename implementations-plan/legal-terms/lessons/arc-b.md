# Arc B lessons — acceptance in the extension

## What bit

- **A required constructor dependency breaks every harness that builds the service by hand.** Making
  the guard a required `ExecutionCoordinator` parameter (so no caller can forget it) reddened 41
  tests across seven files in one step: the composition harness, the two prototype-built facades
  (`service.fence-entry`, `dapp-send-executor`), and the three `background.*` stub tables. Each got
  an accepting stub; the composition harness exposes it as a `vi.fn` so a test can flip it mid-prove.
- **`handleDiscovery` has a no-yield invariant the new read broke.** From the session lookup's
  resolution to the popup-promise registration there must be no `await`, or two same-key
  discoveries both miss the dedupe map. The legal read was first placed after the lookup and
  `background.discovery-race.pins.test.ts` caught it. It now runs BEFORE the lookup.
- **`executeOperations` is not only a dApp entry point.** The wallet's own views go through it, so
  gating every operation would have blanked the wallet for a person who declined. Only a batch
  holding `send_transaction` / `aztec_sendTx` is refused early; the wall at the broadcast line
  covers anything else.
- **The hash carries the query.** The guard redirects to `/onboarding/terms?next=create`, and
  `waitForHash` compares exactly, so the first S1–S3 run timed out. `waitForTermsGate(page, next)`
  waits for the full hash, which also proves the resume target.
- **Auto-imported composables do not exist under vitest.** `useToast()` resolved in the build and
  threw `useToast is not defined` in the sheet's component test. New SFCs import it explicitly, as
  the older pages already do.
- **`vi.mock` factories are hoisted above the file's own `const`s.** Shared mock state for the sheet
  test lives in `vi.hoisted`, with `require` for the two modules it needs.
- **The first-run points do not fit a 380×620 popup.** A `compact` (leads only) variant was tried and
  Codex rejected it, correctly: the sheet asks the person to acknowledge the four points, so it may
  not abridge them. The sheet now scrolls the whole text with the consent control at its end, and
  pins Not now outside the scroll so declining is always one visible tap away.
- **A new branch in `executeOperations` tipped it over the cognitive budget (18 > 15)** and the
  pre-commit hook refused the commit. The outcome logging moved into `logOperationOutcome`; no
  suppression.
- **The smoke suite needs the runner armed, not only the build**: `NULO_E2E_MIGRATION_FIXTURE=1` on
  the vitest process, or `backup-migration.test.ts`'s arming contract fails by design.
- **`e2e:agent` and `test:e2e` share `dist/chrome`.** Run them one after the other, never together.
- **Generated `src/types/*.d.ts` change when a component or composable is added**, and `vue-tsc`
  reads the committed copies. Commit them with the feature.

## Deviations from the plan, and why

- **Wall tests.** The plan asked for an admit-then-refuse-at-broadcast test for each of transfer,
  dApp send, authwit revoke and registry toggle. Transfer has one through the real service graph
  (`service.composition.test.ts`). The other three cannot reach the broadcast line in that harness,
  whose hard limits forbid simulate and prove (`tests/COMPOSITION-TESTS.md`). They are covered by
  what makes them the same case: the coordinator's own wall tests, the structural pin that
  `node.sendTx(` occurs once, an `AuthRegistryService` test that a refusal changes neither the
  authwit rows nor the registry flag, and N1 for a dApp send against a real node.
- **`openOnboarding` keeps the launch's `current` seed by default.** Several onboarding specs jump
  straight to `/presto` or `/fees`; defaulting to a real fresh install would have routed all of them
  to the gate. The gate's own specs pass `{ legal: "missing" }`.
- **Welcome's CTAs still push `/onboarding/create` and `/onboarding/import`.** The guard sends them
  to the Terms when needed, so a person who already accepted and went Back is not asked twice.
- **"Step 1 of 2" from the Gate board is not rendered.** The plan already dropped the step indicator
  from the gate, and the flow has more than two steps.
- **No em dash in the About row.** The board's "Not accepted — Review" ships as title
  "Not accepted", description "Terms v1.0. Review".
- **U8 (open-source licences row) is not shipped.** It belongs to Arc C, which stays blocked: the
  lockfile still resolves the three `@alejoamiras/presto*` packages at versions declaring
  `AGPL-3.0-only`, and `@aztec/sqlite3mc-wasm` declares no licence at all.

## Codex fix loop (high)

| Round | Verdict | Findings | Disposition |
|---|---|---|---|
| 1 | conditional-approve, no HIGH | a refusal at the broadcast line lost its code in `classifyOperationCatch` and logged at `error`; full backup not proved under declined Terms and S6 stopped before the download; `compact` truncated the approved risk copy; a privacy patch produced no About notice | all fixed; S5 now downloads and parses a full backup in all three states, S6 completes the passkey download and is no longer skipped on CI |
| 2 | conditional-approve, no HIGH | three lapse-after-admission edges: an approved request refused at execution lost its type in `windowManager.cancel`; a silent send left the record it had advanced to `pending` stranded (the ingress safety net closes only `queued`); the wallet's own Send logged the refusal at `error` and called it a failed simulation | all fixed with regressions in `dapp-interaction/service.test.ts` and `transfer-failure-copy.test.ts` |
| 3 | **approve** | none | converged |

## Gates

| Gate | Result |
|---|---|
| `bun run typecheck:all`, `bun run lint` | green |
| `bun run test` | 6,627 passed |
| `tests/e2e/legal-acceptance.test.ts` at `--retry=0` | 12 passed, twice in a row, before and again after the round-1 fixes |
| `bun run test:e2e` (whole smoke suite) | 33 files, 135 passed, 0 failed |
| `NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/legal-acceptance-wall.test.ts` | 1 passed (33s) |
