# Morning — tools-self-testing

The stack is three PRs (GitHub stack #578), lowest first, opened ready for review once every codex
loop and the cross-arc pass had converged. Everything below was decided without you, per plan
§ Autonomy; each decision points at the consult that settled it.

## Merge sequence

1. **Arc 1 — `worktree-tools-self-testing`, PR #575 (CI names say the app).** Merge it FIRST and, right
   before you do, repoint the branch protection — the renamed aggregators block every merge until the
   protection names them:
   ```bash
   scripts/ci-cd/required-checks.sh labels                                              # the e2e:* force-run labels, idempotent
   scripts/ci-cd/required-checks.sh print --branch dev --json > /tmp/dev-checks.json   # review it
   scripts/ci-cd/required-checks.sh --apply --branch dev --expect /tmp/dev-checks.json
   ```
   `labels` creates `e2e:extension-smoke`, `e2e:extension-network` and `e2e:tools` — the labels the
   three filtered gates honor as "run anyway"; without it a PR cannot carry them.
   The snapshot this branch was written against is committed as
   `implementations-plan/tools-self-testing/required-checks.dev.snapshot.json`. `main` gets the same
   two steps at its next promote.
2. **Arc 2 — `tools-self-testing/bridge-integration`, PR #576.** `gh stack sync` after arc 1 lands, then merge.
   Adds `bridge-contracts-status`'s `integration` job (the sandbox suite) — advisory until you promote it.
3. **Arc 3 — `tools-self-testing/tools-browser-e2e`, PR #577.** `gh stack sync`, then merge. Adds
   `tools-e2e-status` (6 shards) — advisory until you promote it.

`gh stack merge` lands the named PR and everything below it; the three are ordered for that.

## Decisions you should know about (all logged in `lessons/`)

- **The PrivateFPC ceiling is priced by the wallet now** (`apps/tools/src/lib/wallet-fee-budget.ts`;
  `lessons/phase-8.md`). The wallet-sdk transport drops a dApp's `maxFeesPerGas` (schema spelling
  mismatch), so every stock wallet keeps 1.5× what tools used to show and gate on — cell 1 stranded
  a deposit. Codex (two rounds) recommended fail-closed behind a wallet feature flag; that flag would
  have to be advertised by the extension, which this plan may not touch, so tools prices from the
  wallet's own simulation and fails closed only when the wallet cannot say. The probe PROPOSES the
  app's cap (the node's worst prediction, both spellings), so a wallet that honors caps — Nulo —
  keeps its users at 1× and a stock wallet is priced at what it will really submit under
  (`lessons/phase-9.md`, arc-3 round 1). **Follow-up for you**: a `dapp-fee-cap` feature the
  extension advertises (its embedded FPC strategy already honors an explicit cap at 1×), at which
  point tools can prefer the bound budget over the probe.
- **A refused Ethereum signature no longer strands a send on the stepper** (`settleFailedSend`,
  `apps/tools/src/composables/useSend.ts`; `lessons/phase-9.md`): a public deposit's row is named
  before the witness signature, and a refusal used to leave it — and the stepper — up with no way
  back. The row is discarded on a refusal (the Permit2 allowance stands, as for any Permit2 user)
  and kept + flagged on any other failure before the deposit has a hash.
- **The node's admin API key stays ON behind a hash no key matches** (`lessons/phase-5.md`, rounds
  2–4): a minted key is printed into the log the harness keeps and CI uploads; disabling the key
  would leave the admin listener open on every interface. The child never inherits a shell's
  `AZTEC_DISABLE_ADMIN_API_KEY`.
- **The harness signs from anvil's last funded index, never index 0** (`lessons/phase-5.md`, the
  delivery fix): the local network's block publisher and validator both sign from index 0, and
  sharing it lost a nonce on one CI shard of the first run — the same race can end a generation at
  boot. Codex (one consult) chose the key move over a retry wrapper; actors stay 1..n below it.
- **Each test-wallet profile has its own origin** (`lessons/phase-9.md` § Delivery): the SDK's
  discovery probe tells wallet frames apart by origin alone, so same-origin profiles answer each
  other's probe and the slowest frame is never listed — a race only a slow runner loses. Four ports
  per run now; the reload-recovery driver never presses Connect while a connection is verifying.
- **Both suites claim their ports in `~/.agents/ports.md`** under their run id (created, with its
  header, on a host that has none), check-and-write under one lock, and release on teardown; the
  allocators pick around registered ports (`lessons/phase-9.md`, arc-3 rounds 1–4).
- **Every browser spec file must name itself** — `test.use({ family: "<file>", cells, l1Index })` —
  or its pool refuses to run; that is what keeps two files off one worker's actors.
- **Cell 32 is positive-only** (`lessons/phase-5.md`): the automine local network proves at proposal,
  so "the Outbox refuses an unproven consume" is not observable there; the round trip is asserted.
- **No signer mutex; no viem nonce manager** (`lessons/phase-5.md`): the harness sends in sequence
  per key and the one concurrent shape uses two keys; the nonce manager counted past an intended
  revert and was reverted.
- **The test wallet registers the SponsoredFPC and the sandbox publishes the PrivateFPC**
  (`lessons/phase-7.md`): both are what a real wallet / network already hold.
- **Recovery cells 24a (dropped branch) and 24b (consumed branch) are not staged** (`lessons/phase-9.md`):
  neither failure can be produced deterministically from outside the wallet; the pending branch
  (reload after the Ethereum leg, the claim's arrival gate held) is. Cell 25's "grant for a left
  selection discarded" half is not staged either — the test wallet answers prompts synchronously;
  its declined half is. The plan's matrix rows say so.

## What shipped, what is open

Shipped, all ten phases green at retry 0 (`plan.md`, `lessons/`): the per-product check names + the
protection runbook (arc 1); `@nulo/bridge-core/sandbox` + the 35-test integration suite in
`bridge-contracts-status` (arc 2); the `local` ToolsTarget, the 51-cell Playwright suite (embedded
wallet-sdk test wallet, injected Ethereum wallet, egress fence) and `tools-e2e-status` in six shards
(arc 3), plus the two product fixes the suite found (the wallet-priced FPC ceiling, the refused
signature that stranded a send). Local gates at delivery: `bun run test:all`, `bun run lint &&
bun run lint:actions`, both exit 0.

Open:

- **The CI proof on the PRs** — the first runs of `integration`/`txe` (PR #576) and of the six
  tools shards (PR #577) on GitHub runners. A red there is fixed on its arc branch and re-pushed
  (plan § Delivery); a run that is merely slow is the 30-minute cap's business, not a failure.
- **The `dapp-fee-cap` follow-up** (above) — yours, in the extension.
- **A review stood down by the confirm's own preflight** (`lessons/phase-9.md` § Delivery, cell 2):
  on a slow runner a watched input moved twice under one confirm's re-reads and stood the review
  down twice. The wizard's log now names the input; when the next CI log shows which one, decide
  whether the confirm's own re-read outputs (`tokenOnlyBlocked`, `gasShare.txTarget`) should stand a
  review down through the watcher at all, or only through the preflight's tolerant verdict.
- **Promotion** of the two advisory aggregators — below.

## What to promote, and when

`bridge-contracts-status` and `tools-e2e-status` are produced on every relevant PR but required by
neither branch. Promote each after a clean week — 7 days of retry-0 green on every PR that tripped
its filter (plan § Phase 10) — with the runbook's `--add`:

```bash
scripts/ci-cd/required-checks.sh print --branch dev --json > /tmp/dev-checks.json
scripts/ci-cd/required-checks.sh --add bridge-contracts-status,tools-e2e-status --branch dev --expect /tmp/dev-checks.json
```
