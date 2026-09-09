# Morning — tools-self-testing

The stack is three PRs, lowest first. Everything below was decided without you, per plan § Autonomy;
each decision points at the consult that settled it.

## Merge sequence

1. **Arc 1 — `worktree-tools-self-testing` (CI names say the app).** Merge it FIRST and, right
   before you do, repoint the branch protection — the renamed aggregators block every merge until the
   protection names them:
   ```bash
   scripts/ci-cd/required-checks.sh print --branch dev --json > /tmp/dev-checks.json   # review it
   scripts/ci-cd/required-checks.sh --apply --branch dev --expect /tmp/dev-checks.json
   ```
   The snapshot this branch was written against is committed as
   `implementations-plan/tools-self-testing/required-checks.dev.snapshot.json`. `main` gets the same
   two steps at its next promote.
2. **Arc 2 — `tools-self-testing/bridge-integration`.** `gh stack sync` after arc 1 lands, then merge.
   Adds `bridge-contracts-status`'s `integration` job (the sandbox suite) — advisory until you promote it.
3. **Arc 3 — `tools-self-testing/tools-browser-e2e`.** `gh stack sync`, then merge. Adds
   `tools-e2e-status` (4 shards) — advisory until you promote it.

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

## What to promote, and when

`bridge-contracts-status` and `tools-e2e-status` are produced on every relevant PR but required by
neither branch. Promote each by adding it to the protection with `required-checks.sh` once you have
watched it green on a few PRs at retry 0.
