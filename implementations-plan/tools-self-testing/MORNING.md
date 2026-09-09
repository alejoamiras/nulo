# Morning — tools-self-testing

The stack is three PRs (GitHub stack #578), lowest first, opened ready for review once every codex
loop and the cross-arc pass had converged. Everything below was decided without you, per plan
§ Autonomy; each decision points at the consult that settled it.

## Merge sequence — executed 2026-09-09, on your say-so

1. **Arc 1 — PR #575 (CI names say the app).** The protection on `dev` was repointed right before the
   merge with the runbook — `required-checks.sh labels` (the three `e2e:*` labels were already
   present), `print --branch dev --json` (equal to the committed
   `required-checks.dev.snapshot.json`), `--apply --branch dev --expect <it>` — and the PR landed as
   `96f01c1e` through `gh stack merge --squash`. The rollback file `--apply` wrote is named in that
   session's transcript. **`main` still gets the same `print` + `--apply` at its next promote.**
2. **Arc 2 — PR #576.** `gh stack sync` rebased it onto the new `dev`; merged the same way once its
   rebased head was green. Adds `bridge-contracts-status`'s `integration` job — advisory until you
   promote it.
3. **Arc 3 — PR #577.** Synced onto the merged arc 2 and merged the same way. Adds `tools-e2e-status`
   (6 shards) — advisory until you promote it.

`git log dev --first-parent` carries the three squash commits.

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
- **A deterministic FPC equality gate in the integration suite** (`lessons/phase-9.md` § Delivery,
  cell 1): the browser suite now proves the books against the wallet's own submissions (fees move
  between a fixture's pricing and a send), so no browser cell funds a credit to exactly the ceiling
  any more. Codex asked for the boundary — credit equal to the ceiling lands, one unit short is
  refused — to live where prices are fixed: the in-process integration suite, which supplies its own
  cap. A short flow there; your call whether before or after the clean week.
- **A review stood down by the confirm's own preflight** (`lessons/phase-9.md` § Delivery, cells 2
  and 12): on a slow runner a watched input moves under the confirm's re-reads and the generic
  stand-down fires before the preflight's named verdict (cell 12 saw "Something changed" where it
  expects "could not be read just now"; cell 2 was stood down twice). The wizard's log now names
  the input (`changed:`); the next CI log that shows it decides the fix — most likely that the
  confirm's own re-read outputs (`tokenOnlyBlocked`, the intent auto-move, `gasShare.txTarget`)
  should defer to the preflight's verdict while it is reading, as the account and chain do not.
- **Promotion** of the two advisory aggregators — below.

## What to promote, and when

`bridge-contracts-status` and `tools-e2e-status` are produced on every relevant PR but required by
neither branch. Promote each after a clean week — 7 days of retry-0 green on every PR that tripped
its filter (plan § Phase 10) — with the runbook's `--add`:

```bash
scripts/ci-cd/required-checks.sh print --branch dev --json > /tmp/dev-checks.json
scripts/ci-cd/required-checks.sh --add bridge-contracts-status,tools-e2e-status --branch dev --expect /tmp/dev-checks.json
```
