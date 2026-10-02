---
plan: nulo-v6
tier: mid
driver: claude-code
claude_model: opus
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
eli5_mode: artifact
harden: not scheduled (owner, Phase 0)
budget: "recon: 3 agents; code-review: off; codex at high"
branch: worktree-nulo-v6 (arc A); later arcs per Delivery
worktree: .claude/worktrees/nulo-v6
base: origin/dev at 910a4def
---

## Outcome

- **Date:** 2026-10-01, archived 2026-10-02. **Status:** closed. Arc A merged in #736 and shipped
  as 0.29.0, and the npm packages are at 0.2.0. Arc C (P8) and the store upload (P9) moved to
  follow-ups, and both then ran from there: arc C in #751, the store upload as 0.30.0.
- **Shipped:**
  - **Arc A, #736** (squash `80663b61`, P1 to P5). The wallet runs on Aztec 6.0.0-rc.1: the
    `@aztec-labs/*` and `@aztec-foundation/*` scopes, exact-pinned, with Presto's SDK, Aztec
    Standards and private-fee-juice on the same line. Accounts derive under the new `nulo-v6`
    regime, and V5 backups are refused. The V6 testnet is the one public network, beside Local
    Network, and Alpha V5 is retired with no migration. The product is named "Nulo V6", and Terms
    1.0 is edited in place (A2). The PrivateFPC (`0x0b3bc795…3c08`) and the SponsoredFPC
    (`0x06a9…924b`) are re-pinned from the reviewed rc.1 artifacts. The harness, CI and the
    network suite run on V6, and release bytes restore no Bun cache (D25). Both execution canaries
    passed prover-ON on Chrome and Firefox, and the owner signed off every changed screen (P5
    step 10).
  - **npm 0.2.0** (P6, run `36872399302`): `@alejoamiras/nulo-wallet-crypto`,
    `-wallet-sdk-schema-patch` and `-resolve-asset`, peering exactly on `@aztec-labs/*@6.0.0-rc.1`,
    with signatures and provenance verified and the published bytes equal to the dry run's. The V6
    facts went to unleashed's session, which pinned 0.2.0 and the same PrivateFPC.
  - **0.29.0** (P7): promote #737, release PR #738, tag `v0.29.0` with both zips and
    `SHASUMS256.txt` (publish run `36875297262`), sync #739. After the landing's production
    build was re-run, nulo.sh links `v0.29.0` and serves every `_headers` header, which closed
    the tools extraction's P1 follow-up.
- **Owner calls during delivery:** the hands-on run on both browsers was waived ("I trust the vast
  amount of tests we have"); the driver dispatched the npm real run, compared its digests and
  merged #737, #738 and #739 on the owner's word, and the owner approved `npm-publish`. Each is
  quoted in `lessons/phase-6.md` and `lessons/phase-7.md`.
- **Codex, at the 2026-10-01 close-out:** arc A converged after three fix rounds and a fourth
  verification round on `12cf1fac` ("No material findings"), logged in `lessons/phase-5.md`. No
  later arc had run, so there was no cross-arc pass then.
- **Moved to follow-ups at the 2026-10-01 close-out:** P8, because unleashed's testnet manifest
  then still named the V5 generation (`walletChainId 1816023401`); P9, because the owner had not
  called the store upload. Each keeps
  its steps here as the spec, in `follow-ups.md` § Aztec V6, with the plan's other follow-ups.
  The e2e mint guard among them was fixed in arc A (`10aa5acc`). The V5 dRPC key's retirement
  (P7 step 6) was not confirmed by close-out, and the owner dropped it from the follow-ups:
  "Remove the retiring v5 drpc key as follow-up please" (2026-10-01).
- **Arc C (P8), run from follow-ups on 2026-10-01** once unleashed's V6 manifest landed (its #23):
  steps 1 to 3 and 5 are done in arc C's PR. The manifest's PrivateFPC matches; the four Testnet
  seeds (Test USDC, USDT, EURC and GBPC) carry live class, symbol and decimals pins; Test USDC,
  USDT and EURC are priced as USDC, USDT and EURC, and Test GBPC is unpriced (the owner's option
  B); the gas link opens `https://testnet.app.unleashed.systems` on the owner's word; artifact
  smoke on dRPC is accepted. The seeds' ongoing cost, measured for the owner (about 66 calls a
  minute per unlocked wallet at four seeds, from the incoming-transfer pollers' 30 s timer), went
  to `follow-ups.md` § Incoming transfers. Codex converged in three rounds, and a fourth after the
  rebase onto #750 found nothing. The owner signed off the rows, their cost and the pricing on
  2026-10-02 (step 5). Step 4, the owner's hands-on run, passed on both browsers on 2026-10-02
  ("Yes, it worked perfectly") and found one bug in Home's token rows, fixed in #754
  (`lessons/phase-8.md`). That pass rests on the owner's word, so P8's gate is not met as written:
  it asked for the run's transaction hashes, and none were recorded. Step 2's pins leave the name
  out: it stays an uncompared label, as `lessons/phase-8.md` records.
- **The store upload (P9), run from follow-ups on 2026-10-02**, on the owner's call
  (`lessons/phase-9.md`):
  - The listing, the art, the remote-code notes and the Terms' store links shipped in #749 and the
    reviewer notes' faucet in #753, signed off by the owner on 2026-10-01; § 1 links AMO by add-on
    id, not by slug, on the owner's call.
  - Release 0.30.0: promote #755, release PR #756, tag `v0.30.0` with both zips and
    `SHASUMS256.txt` (publish run `37055688605`), sync #757; nulo.sh links `v0.30.0` and serves
    every `_headers` header. Beside the store copy it ships arc C (#751), its hands-on fix
    (#754), and #752, the notice for a chain the wallet does not serve, from the owner's report
    on 0.29.0.
  - The in-place update from 0.28.0 (step 4) found that a V5 profile cannot be deleted after a
    failed unlock. Step 4 offered a fix before the upload or a release note; the owner shipped
    with a follow-up instead: "Ship now, add as a follow-up.", then "Ship now regardless".
  - Two follow-ups opened (`follow-ups.md` § Aztec V6): that lock-out, and Privacy § 5, which
    never names the get-gas link's site. The privacy edit waits because a legal document change
    is the owner's call.
  - Live checks and `store-check` (run `37059450225`) green; the owner's Mac session edited both
    listings, and AMO's became "Nulo V6" at `nulo-v6`.
  - The store run `37062096394` submitted 0.30.0 to the Chrome Web Store, where it is in review as
    a staged publish. Its Firefox job failed: #753 had taken the reviewer notes past AMO's
    3,000-character cap, which nothing checked. The Mac session then submitted the same zip to AMO
    by hand, with the faucet paragraph cut on the owner's call, and AMO approved 0.30.0.0 the same
    day. #758 makes the publish refuse over-cap notes before the upload.
- **Cross-arc pass:** Post-implementation asked for one before #749 or #751 opened, and it did not
  run then. It ran at the archive on 2026-10-02 (`lessons/phase-9.md`): round 1 found the V5
  lock-out and Privacy § 5's gap (both now follow-ups) and P8's unrecorded hashes (corrected
  above), and three findings were rejected with reasons; round 2 corrected this close-out's
  records; round 3, the last, found nothing material, corrected one line of that log and the
  runbook's advice on re-running after a 400, and raised two low points in #758's code, which
  #758 fixed before it merged, on the owner's call.
- **Lessons:** the two `lessons.md` entries tagged 5.2.0 (the node client's retries, the fee-juice
  import's weight) hold on 6.0.0-rc.1 and are re-dated, and the `bun test` entry's scope is
  renamed after reproducing it on `@aztec-labs/foundation` 6.0.0-rc.1. The new gotchas went to
  the `aztec-update` skill (§ Gotchas), since `lessons.md` is at its budget (`lessons/phase-10.md`).
  P9 adds none there: an in-page click reaching a control an overlay covers is already the
  `e2e-testing` skill's `pointerClick` rule, and its two store gotchas (an AMO 400 that created no
  version; a Chrome dashboard locked by an approved, staged submission) went to CLAUDE.md's release
  runbook.
- **Seeds retired:** the `/goal` and `/loop` seeds below are spent; nothing to resume.

## Phase 0 (answered by the owner, 2026-09-30)

The ask: "Can we blueprint updating the wallet to Aztec V6?", with a V6 RPC, Aztec Standards at
`6.0.0-rc.1`, Presto's SDK at `6.0.0-rc.1`, and `alejoamiras/private-fee-juice` `6.0.0-rc.1` "in
the process of being released … let's work until we need that to be released, and check if it has
been released at that moment. It won't have any breaking changes."

| Question | Owner's answer |
|---|---|
| Abandon Alpha V5? | "Yes, we are abandoning the previous Nulo Alpha V5 application, moving into the new Alpha V6 era." |
| Migrations for V5 users? | "No, there are no users using Alpha V5, so don't worry about migrations for them." |
| Stores | Re-upload to both stores "with your help". Then: "Reuse both, V5-free, but dont change the rule. In this case in partiuclar is because V5 was never used, but we will want that rule looking forward." |
| Networks | "There isn't currently an "Alpha V6" "main net" … Can we very easily just hide Alpha V5 and have Nulo Alpha V6 have Testnet as the main network for now?" |
| Product name | Nulo V6 |
| AMO slug | `nulo-v6` |
| Young first-party packages (npm 7-day gate) | Temporary excludes |
| Scope | Through the store upload. Revised 2026-10-01: "Let's put the store upload as optional. right now I just want 0.29 / a compatible v6 version to play around with." |
| Validation layers | All four: lint, types, unit and component tests; smoke e2e on Chrome and Firefox; network e2e plus the prover-ON canaries on both browsers; live V6 testnet checks |
| Extra reviews | None: no `/code-review`, no `/harden` |
| Licence (side note during the audits) | "should we also update our license or something since now packages have moved to aztec-labs?" Answered under Security § Licences: Nulo's own licence does not change; the third-party notices move their source (P1). |

### Phase 0.5 · Tier

The rubric scores three dimensions HIGH: blast radius (every screen and every derived address),
external coupling (npm release candidates, Presto, unleashed's bridge, two stores, a dRPC key) and
security sensitivity (account addresses, Fee Juice routing, supply chain). That would mean `deep`.
The owner caps blueprint at `mid` in this repo, so this is a `mid` plan split into arcs that each
ship behind their own gate, codex loop and PR: arc A before 0.29.0, then arc C and an optional store
arc. Novelty is low: the `aztec-update` skill already
covers the bump and the reset.

## Outcome & Quality Bar

**For whom.** First, the owner, and anyone who installs 0.29.0 from its GitHub release (nulo.sh
links the latest one) and sets up a wallet on the V6 testnet. Second, any dApp built on
`@aztec-labs/wallet-sdk` 6.0.0-rc.1 that connects to it. Third, the maintainer who runs the next
Aztec bump from the runbook. Fourth, the store reviewers, if the optional store upload runs.

**What excellent looks like.**
- A fresh install of 0.29.0 opens on the V6 testnet. Nothing on any screen, in the browser's
  extension list or in any page title names V5, the Alpha V5 network or mainnet. The About page's
  "Alpha Testing" stage label is the owner's call (U6).
- The first account deploys and sends on V6 with no setup. Nulo's sponsor pays by default, at an
  address the wallet derives and the live chain serves. Native proving works: the wallet's Aztec
  version string equals the version Presto serves, and a build without that string refuses to
  start.
- The Private Fee Juice option uses the canonical PrivateFPC derived from the reviewed rc.1
  artifact. It is initializerless and private-only, so it needs no deployment (Fact 27). Its address
  is pinned (P3) and handed to unleashed, whose V6 bridge is what funds it (P6).
- V5 data never half-loads. A V5 full backup or account file is refused with the existing messages,
  proven by literal V5 fixtures.
- The next maintainer finds the runbook, `CLAUDE.md`, `UPDATE.md` and the regime record true of the
  tree: the new npm scopes and the repos they are built from, the V6 binding, the one-time
  store-reuse exception, and that the PrivateFPC needs no deployment.

**Good enough (where the bar stops).** No V5 recovery path inside V6: V5 accounts stay recoverable
only with the `v0.28.0` release zip. The store upload is optional (P9), and so is the in-place V5
update check, which only store installs need. 0.29.0 has no default token until unleashed's V6 Test
USDC exists (arc C), and its "get fee juice" link opens unleashed's testnet app, which serves the V5
generation until unleashed moves it. No automated live-transaction suite: the live layer is
read-only preflights plus the owner's hands-on run. No V6 mainnet. No visual change beyond the
removed Alpha rows, the renamed brand and the signed-off copy (U4, U6, U7).

## UI impact

Every surface below changes what a user sees, so each needs the owner's recorded sign-off
(CLAUDE.md § UI changes).

| Surface | Before | After | Arc |
|---|---|---|---|
| Extension name (browser extension list, toolbar tooltip, window and page titles) | Nulo V5 | Nulo V6 | A |
| Networks page and network picker on a fresh install | Alpha V5 (active, green), Testnet, Local Network | Testnet (active), Local Network | A |
| Header network pill on a fresh install | "Alpha V5", green | "Testnet", green: the square is the connection status on every network (U1) | A |
| Home on a fresh install on Testnet | the V5 "Test USDC" row (V5 testnet) | no default token row until arc C | A |
| Fee card on Testnet | Nulo's sponsor default | unchanged; the Alpha-only Private Fee Juice default disappears with Alpha | A |
| Settings → About | Aztec 5.2.0; "Alpha Testing" | Aztec 6.0.0-rc.1; "Testnet" (U6) | A |
| Onboarding "Fees on Aztec", card 01 | "The only way to get fee juice today is to burn $AZTEC on L1…" | unchanged: the owner kept the Alpha wording (U7) | A |
| Explorer links on Testnet | testnet.aztecscan.xyz | unchanged, though it 404s V6 transactions until Aztecscan indexes V6 (U5) | A |
| Store tile, 7 screenshots, listing text (Chrome and AMO) | NULO V5 wordmark, "ALPHA V5" pill, "opens on mainnet" notes | NULO V6, Testnet, testnet reviewer notes | store (optional) |
| Terms (draft) | 1.0: "connects to Aztec mainnet by default", real-value wording | 1.0 edited in place (A2): testnet default, testnet-value wording; no version bump, no re-acceptance sheet. Its store URLs change only with the optional store upload | A |
| Home on Testnet | none | the V6 "Test USDC" row (unleashed's V6 token), priced at $1 | C |
| Fee card's "get fee juice" link | unleashed's testnet app (V5 generation) | unleashed's V6 app; a new URL, if any, is shown to the owner | C |

### UI asks for the owner (at most five per page, each option shown as it will look)

Arc A's page: U1, U2, U4, U6, U7, and U5, since the explorer check failed in P4. U1 settled without
a call in P5, so the page as built carries U2, U4, U5, U6 and U7. The optional store arc's page: U3.

- **U1 (arc A).** The default network's pill stays Testnet's neutral-mint (recommended, confidence
  moderate: it is what Testnet looks like today and it signals "not real value"), or takes Alpha's
  green. **Settled in P5 without a call:** the pill's square is the connection status
  (`Header.vue` `.status_dot`, `--green` when active), the same on every network, and
  `getChainColor` has no caller, so no surface draws a per-network colour. Only the label changes.
  U1 moves into the "sign off as built" row.
- **U2 (arc A).** A fresh V6 wallet shows no default token until unleashed's V6 Test USDC exists
  (recommended: showing a V5 token is wrong, and a placeholder is worse).
- **U3 (store, optional).** The regenerated tile and screenshots with the NULO V6 wordmark.
- **U4 (arc A).** The exact Terms diff, edited in place (A2).
- **U5 (arc A or C).** Explorer links on Testnet, only if Aztecscan does not index V6 and the links
  would be hidden.
- **U6 (arc A).** The About row's "Alpha Testing" stage label: keep it (recommended, confidence low:
  it names the product's stage, not the V5 network, and the owner calls this "the new Alpha V6
  era"), or replace it with "Testnet".
- **U7 (arc A).** Onboarding card 01 says fee juice comes only from burning $AZTEC on L1, which is
  mainnet's path. The replacement is drafted in P4 from facts checked on the V6 testnet then, with no
  clause-joining em dash.

Everything else ships under one "sign off as built" row per arc: the name, the removed Alpha rows,
the About version and the unchanged fee card.

## Architecture & Implementation

### Proposed architecture

Nothing new is added. This moves the whole dependency line and the chain identity, with four
seams:

1. **The line.** Every `@aztec/*` import and pin moves to `@aztec-labs/*`, built from
   `aztec-labs-eng/aztec-node`. The exceptions are `bb.js`, `noir-acvm_js`, `noir-noirc_abi` and
   `l1-artifacts`, which move to `@aztec-foundation/*`, built from `AztecProtocol/aztec-packages`.
   `@aztec/viem` keeps its name and goes to `2.38.3`, the version `@aztec-labs/ethereum` depends on.
   Presto moves to `6.0.0-rc.1` with `presto-core` `1.2.1`, and Aztec Standards and
   private-fee-juice move to `6.0.0-rc.1`. This ends the V5 split line: nothing stays held.
2. **The account regime.** Following the append-only record's own rules, `REGIMES["nulo-v5"]` is
   frozen to literals first, then `REGIMES["nulo-v6"]` is appended. It carries the V6 SchnorrAccount
   artifact vendored byte-exact from `@aztec-labs/accounts@6.0.0-rc.1`, and the major rebinds to it
   (`V6_REGIME`). The V6 extension reuses V5's extension ID and store items as a recorded one-time
   exception to the "protocol break = new extension" rule. The rule itself stays.
3. **The chain identity.** The V6 testnet (`rollupVersion 2914217885`, wallet chainId `2904119610`)
   becomes the one public seeded network, marked primary. Alpha V5, its chain id, its tokens,
   prices, explorer entry and Alpha-only fee policy are deleted, not re-keyed. `ChainKind` keeps
   `"mainnet"`, and `MAINNET_L1_CHAIN_ID` stays: it is Ethereum's L1 id and still the key-derivation
   input for any network of that kind.
4. **The product identity.** `displayName` becomes "Nulo V6", which covers the manifest name,
   titles and the Chrome listing title. The Terms follow in arc A (P5), and the store art and listing
   text in the optional store arc (P9).

### Key interfaces and contracts

- `AddressRegime` (`packages/aztec-runtime/src/account/address-freeze.ts`) is unchanged. A new entry
  is added and the binding is renamed. `address-freeze.test.ts` independently hardcodes both entries
  and asserts the binding is `nulo-v6`.
- The dApp wire shape `EncodedCallPayload` (`packages/wallet-bridge/src/call-shapes.ts:26`) moves
  `returnTypes?` to V6's single `returnType?`. It is a TypeScript type, not a validator, and chain
  identity is not wire validation. The ABI stays authoritative for return types and function flags
  (`authwit-discoverer.ts:190-221`, `tx-request-builder.ts:586`). The approval card's tests feed a
  V6 wire-shaped payload and a hostile one (P1). No dual-shape acceptance is added.
- Published packages `@alejoamiras/nulo-{wallet-crypto,resolve-asset,wallet-sdk-schema-patch}@0.2.0`.
  Their exact peers become `@aztec-labs/*@6.0.0-rc.1`, derived from the workspace pins by
  `scripts/publish/stage.ts`.
- `__AZTEC_VERSION__` reads `@aztec-labs/pxe`. Presto compares it with the prover's version by exact
  string equality, so the config throws when the key is missing, in place of today's `"unknown"`
  fallback (`apps/extension/vite.shared.ts:30`).

### Data and control flow

Runtime flows keep their shape, and two defaults change. A fresh profile seeds Testnet (V6) as
active. A send on Testnet defaults to Nulo's sponsor, the canonical SponsoredFPC `0x06a9fa02…924b`.
It is deployed and funded on the V6 testnet, and pinned as the wallet's derived address (P3). The
PrivateFPC keeps its canonical derivation (salt 1, deployer zero) from the reviewed rc.1 artifact.
Its address moves and is re-pinned consciously (P3). It is initializerless and private-only, so it
needs no deployment (Fact 27).

The chain purge cascade and every storage shape stay. Pre-production means no migrations
(CLAUDE.md), so the backup compat epoch goes 4 → 5 to refuse V5 backups, and the export regime
digests follow the rebind. An existing profile's network rows are never re-seeded
(`network/service.ts:246-247`), so a V5 install updated in place keeps its V5 rows. The optional
store arc records what that looks like (P9).

### File-level change map

| Area | Files | Phase |
|---|---|---|
| Pins and lock | 6 workspace manifests (60 lines), root `package.json` `patchedDependencies`, `bun.lock`, `bunfig.toml` (excludes added, then removed after each install that needs them), `patches/` (4 files → 2, or 0 if rc.1 fixed its exports) | P1, P3 |
| Scope rename | 216 files of static imports, 26 of dynamic imports, 25 `vi.mock` sites, 3 `.vue` files: rewritten by the one-shot codemod `implementations-plan/nulo-v6/tools/scope-codemod.ts` (new; its skeleton is adapted from the tools-extraction codemod) | P1 |
| Name-keyed sites (by hand) | `vite.shared.ts:30` (now throws on a missing key), `vite.shared.ts:38-46,60-63`, `vite.config.ts:82,104,227-249,312-318`, `scripts/vendor-chunks.ts:9,15` + test, `.github/actions/setup-aztec/action.yml:18`, `scripts/e2e/docker-ci-like.sh:88`, `tests/e2e/global-setup.ts:45-87`, `tests/e2e/fixtures/presto.ts`, `scripts/publish/{stage.ts,packages.ts}` + `stage.test.ts`, `scripts/publish/verify-provenance.sh` (an optional ref argument, default unchanged), `renovate.json:72-81`, `scripts/ci-cd/test-soak/lib.ts`, `scripts/lockfile-exception-diff.ts`, `scripts/aztec-hold-residue-check.ts`, `store-listing.test.ts:103-136`, `presto-core-deps.test.ts:22`, `layout-identity.test.ts`, `resolve-asset/src/index.test.ts` | P1 |
| Third-party notices | `packages/third-party-notices/src/policy.ts` (the `@aztec-labs` record cites `aztec-labs-eng/aztec-node`; the `bb.js` and noir records stay on `aztec-packages`), `texts/` (only from tagged sources), `expected-minimum.txt`, `tests/e2e/legal-acceptance.test.ts:399` | P1 |
| API churn | `returnTypes` sites (recon §1), `call-decoder.ts` (`decodeEachFromAbi`, the arity shim deleted), `public-events.ts:368`, `wallet/utils/fee-juice.ts` (dead FeeJuice export deleted), MultiCall and Handshake address sources, playground sections, `wallet-sdk-schema-patch/src/apply.ts`, `opfs-store.ts:42` (only if the drift test moves), the approval-card tests in `apps/extension/src/popup/windows/execute/` | P1 |
| Account regime | `address-freeze.ts` (+ test; the `nulo-v5` literal freeze is P1's first commit), `frozen-artifact.ts`, `artifacts/SchnorrAccount.json` + `PROVENANCE.md`, `instantiation-descriptor.ts` (only if the V6 ctor ABI differs), consumers (`account/service.ts`, `account-integrity/coordinator.ts`, `account-export.ts`, `artifact-freeze.test.ts`), the two address KATs (address-level fields only), new `reference/nulo-v6/` (generator, `package.json`, `bun.lock`, `vectors.json`), `backup-migration-registry.ts:74`, `useFullBackupImport.test.ts`, `account-export.test.ts` | P1 (freeze), P2 |
| Protocol FPCs | `fpc/protocol-fpcs.test.ts` (PrivateFPC re-pin, new SponsoredFPC pin) | P3 |
| Chain identity | `utils/chain-ids.ts` (+ test), `network/service.ts` seeds, `components/ui/utils.ts`, `FeeSettingsCard.vue`, `fee-helpers.ts`, `wallet/constants/explorers.ts`, `token/default-tokens.ts` + `default-tokens.test.ts` (per-seed check), `price/price-map.ts`, `useProfileBootstrap.ts` comment, `scripts/seed-preflight*.ts` (exit code, expected class), `onboarding/pages/fees.vue` (U7), `popup/pages/settings/about.vue` (U6, if changed), auto-import typings (regenerated by a build), about 30 test files, the smoke specs `endpoints.test.ts` and `backup-roundtrip.test.ts`, the `VITE_NULO_E2E_DEFAULT_NET` flag sites (`agent.sh`, `_extension-smoke-e2e.yml`, `pr-extension-smoke-e2e.yml`, e2e-testing skill, `FIREFOX.md`) | P4 |
| Harness and CI | `global-setup.ts` (honours `AZTEC_HOME`), `_extension-network-e2e.yml` + `setup-presto-server` (1.1.3 and both SHA pins), `.github/actions/setup-bun/action.yml` + `_build-extension.yml` + `scripts/ci-cd/behavior-gating.test.ts` (release bytes restore no cache, D25), `tests/e2e/fixtures/{aztec.ts,selfpay-phase.ts,aztec-private-fpc-bridge.ts}`, the network specs `networks.test.ts` and `backup-import-stalled-network.test.ts`, `frozen-account-canary.test.ts:4` (comment), `scripts/ci-cd/canary-expectations.json` (only if a title changes) | P5 |
| Arc A docs | `CLAUDE.md`, `.claude/skills/aztec-update/SKILL.md` (the compare step on `aztec-node`, the PrivateFPC precondition's new place, the pin surface), `UPDATE.md`, `SECURITY.md`, `CI.md`, `ARCHITECTURE.md`, `README.md` (technical lines), `.github/README.md`, `.claude/skills/e2e-testing/SKILL.md`, package READMEs (including the stale `5.0.0-rc.2` lines), `scripts/publish/README.md` + `readme/`, `packages/third-party-notices/README.md`, `store/SOURCE-BUILD.md` (patch statement), `legal/README.md:58`, `store/listing.md` titles (pinned to `displayName` by `store-listing.test.ts:59`), `legal/terms.md` (1.0 edited in place, A2), `legal/privacy.md` (only if the bb.js CRS hosts moved), `legal/README.md:31`, `README.md:8`, `BEFORE-LAUNCH.md`, `CI.md:223` | P5 (titles in P1) |
| Arc C (when unleashed's V6 generation lands) | `default-tokens.ts` (+ the set-equality test restored) and `price-map.ts` (+ tests); `fee-helpers.ts:302-303` (only if unleashed's V6 app moved, with the owner's sign-off); `lessons/phase-8.md` (the hands-on results) | P8 |
| Store (optional, D27) | `store/listing.md` (the rest), `store/templates/{tile,frame}.html`, the 7 PNGs, `store/remote-code.md`, `legal/terms.md` (its store URLs, in place); `lessons/phase-9.md` (the in-place results); any fix the in-place check needs | P9 |

### Algorithms and non-obvious mechanics

- **The codemod.** It uses an explicit table: each package name maps to its new scope, with full
  names (`aztec.js`, never `aztec`), over `git ls-files` minus `implementations-plan/`, `audit/`,
  `wallets-architecture-research/`, `architecture/`, `CHANGELOG.md`, `bun.lock` and the vendored
  artifact. It rewrites:
  - quoted specifiers in static, dynamic and `vi.mock` forms;
  - `resolve-asset` and `require.resolve` string arguments;
  - `package.json` dependency keys;
  - `@aztec+<pkg>@` store-path fixtures.

  It never rewrites `@aztec/viem`, and never `@aztec/<pkg>@<5.x>` (a negative lookahead on `@\d`),
  because historical citations name packages that never existed under the new scope. Its
  must-survive list also holds `NULO_KDF_SPEC`'s "upstream @aztec/accounts 5.0.1" line
  (`address-freeze.ts:65`): it has no `@` before its version, and it is the KDF digest's preimage.
  The codemod has no Azguard-marker exemption and ends with a survivors report that exits 1 on any
  unexpected leftover. Formatting runs only on the touched files, with `biome format --write`, never
  `biome check --write`.
- **The min-age choreography** (bunfig's comment and SECURITY.md, applied as the owner chose):
  1. Add `minimumReleaseAgeExcludes` for the still-young names among exactly four:
     `@alejoamiras/presto`, `@alejoamiras/presto-core`, `@aztec-foundation/aztec-standards` and
     `@alejoamiras/private-fee-juice`.
  2. `bun install`.
  3. Disposition every entry of the scope-normalised `lockfile-exception-diff.ts`.
  4. Delete the excludes.
  5. Prove it with `bun install --frozen-lockfile --force`.

  Every install that re-resolves before 2026-10-07 23:13Z, when private-fee-juice rc.1 clears the
  gate last, runs this. With rc.1 published, that is P1's install alone. Arc C and the store arc
  edit no dependency manifest. Provenance follows the supply-chain bar (Security).
- **The regime sequence** keeps the V5 record correct at every commit:
  1. Freeze `REGIMES["nulo-v5"]` to literals equal to `EXPECTED_REGIMES["nulo-v5"]`, as arc A's first
     commit, while the V5 line is still installed. Its test imports `frozen-artifact.ts`, which
     loads the artifact at module load, and V6 rejects the V5 artifact (Fact 7).
  2. Swap the vendored artifact and the frozen pins.
  3. Append `nulo-v6`.
  4. Rebind and update the rules text.
  5. Regenerate the address-level vectors from an independent generator.

  From P1's install until step 2, every test that imports `frozen-artifact.ts` is dark. P1's gate
  diffs `address-freeze.ts` and the artifacts against the freeze commit in their place.
- **The KDF checkpoint.** `NULO_KDF_SPEC` (the digest preimage) is never edited. Its "5.0.1"
  citation names the semantics V6 is held to. The key-level KATs keep reading key-model-v2's
  vectors, which were generated from the published 5.0.1 packages, so on the V6 line they compare
  V6's code with 5.0.1's values. The key-level fields are every field except `address`,
  `completeAddress.address` and `completeAddress.partialAddress`, plus the passkey-master vectors
  that `apps/extension/src/wallet/crypto/key-vectors.test.ts` reads.
  - Green on the V6 line: `nulo-v6` reuses `nulo-account-kdf-v2` and its digest.
  - Red: upstream moved a key-derivation input. Stop, consult codex, and re-gate with the owner. A
    new KDF id is a crypto decision, and it changes the published `nulo-wallet-crypto`.

### Trade-offs and alternatives not taken

See the Decision ledger (D1–D27). The competing outline, "release first, two tracks", was rejected
in the audits: it shipped a PrivateFPC pinned where nothing was deployed. The owner's answers
(2026-10-01) removed that objection, since the PrivateFPC needs no deployment (Fact 27), and the
plan now has its shape: 0.29.0 releases after arc A, and unleashed's generation follows in arc C
(D18, D26). The risk it carried stays: an rc.2 testnet reset would strand 0.29.0's chain identity,
which A9 covers.

## Security & Adversarial Considerations

- **Threat model.**
  - Attackers who would target a wallet during a line move:
    - a supply-chain publisher of look-alike or compromised packages in the two new scopes or the
      four young first-party packages;
    - a hostile dApp sending V6-shaped payloads the approval card might mis-render;
    - a hostile backup or account file (attacker-controlled, per CLAUDE.md);
    - anyone who extracts the embedded dRPC key.
  - Assets: the seed and derived keys, account addresses, Fee Juice routed through FPCs, the store
    accounts, and the CI release credentials.
- **Supply chain.** The scope migration is the moment dependency confusion pays. The bar depends on
  what each scope publishes (D24):

  | Names | Expected identity | Check |
  |---|---|---|
  | `@aztec-foundation/*` (bb.js, the noir pair, l1-artifacts, and any other the lockfile resolves) | `AztecProtocol/aztec-packages`, `.github/workflows/ci3.yml`, `refs/tags/v6.0.0-rc.1`, commit `d521f0d9` | SLSA provenance through `scripts/publish/verify-provenance.sh <tgz> <repo> <workflow> <ref>` |
  | `@aztec-foundation/aztec-standards` | `AztecProtocol/aztec-standards`, `.github/workflows/release.yml`, `refs/tags/v6.0.0-rc.1`, commit `cdfba943` | the same |
  | `@alejoamiras/presto`, `@alejoamiras/presto-core` | `alejoamiras/presto` on `main`, both signed by the reusable `.github/workflows/_publish-npm.yml` (called from `release-sdk.yml`) at `bc3eeee0` | the same, with the signer's path |
  | `@alejoamiras/private-fee-juice` | `alejoamiras/ecosystem-tooling`, `.github/workflows/release.yml`, `main` (5.0.1 at `c678a948`, rc.1 at `76199c59`) | the same |
  | `@aztec-labs/*`, `@aztec/viem` | no attestation and no repository field; `@aztec-labs/*` published by `charlielye` (maintainers `nchamo`, `charlielye`), `@aztec/viem@2.38.3` by `spalladino` | registry signatures (`npm audit signatures`), plus the publisher and maintainer set recorded per locked name; any other set is a HOLD (A8) |

  - Scratch installs name the exact lockfile versions, because both scopes' `latest` tags point at
    nightlies.
  - The four excludes are opened only for the installs that need them and removed each time, proven
    by a frozen `--force` install. Renovate's disabled Aztec-line rule gains the two new scopes.
  - `phantom-sweep.ts` only reports (it always exits 0). Its output must carry no line for the three
    scopes. A wrong scope assignment fails at resolution.
  - The checks above bind the shipped zips only if the release build installs from the registry.
    Today every extension build restores `~/.bun/install/cache` by prefix
    (`.github/actions/setup-bun/action.yml:19-25`), and Bun never re-checks a cached file against
    the lockfile's sha512 (`lessons.md`, the "Bun trusts a warm cache" line). The same install runs
    the lifecycle scripts of Bun's default-trusted packages, so a poisoned cache is also code
    execution. From P5 on (D25), release, nightly and source-rebuild builds restore no cache, as the
    npm `pack` job already does, and neither do the four release and nightly jobs that hold
    `contents: write` (one also holds the release App's key).
- **Silent fail-opens the rename could create.**
  - A missed `__AZTEC_VERSION__` key would skip native proving silently. The config now throws.
  - A missed `bb-fetch-code-shim` substring would let MV3 block the WASM dynamic import. Its
    `@aztec/bb.js/dest/browser/` literal fails P1's survivors sweep, and every simulation in the
    network suite loads bb.js WASM.
  - A missed `NEVER_GROUPED` rename would group wallet-sdk into a chunk named
    `aztec-labs-wallet-sdk`, changing what any web page can load. P1 fails on any chunk of that name,
    and `vendor-chunks.test.ts` runs its never-regroups case on the new path.
- **Fee Juice.**
  - The PrivateFPC is initializerless and private-only (Fact 27). Its address follows from the
    reviewed rc.1 artifact, salt 1 and deployer zero, and nothing has to be deployed there, so no
    window exists in which the wallet pins it but it is missing. The wallet registers it without an
    on-chain check (`fpc/service.ts:205-214`), which is correct for such a contract.
  - What can still misroute Fee Juice is a disagreement about that address. The Fee Juice portal
    takes deposits to any L2 address (`tests/e2e/fixtures/aztec-private-fpc-bridge.ts:93-95`), so
    Fee Juice that unleashed's bridge sends to another address cannot pay through Nulo. The wallet's
    pin (P3), the address handed to unleashed (P6) and unleashed's manifest (P8 step 1) must agree,
    and a moved artifact (an rc.2, A9) moves all three together.
  - The V6 address is the canonical derivation of the reviewed rc.1 artifact. The review diffs its
    ABI and its source against 5.0.1 (P3).
  - The sponsor default's derived address is pinned to the live SponsoredFPC (P3). Anyone can drain
    a public sponsor (I11), so its balance is checked against a floor before the release (P7), and
    again before a store upload (P9).
- **Keys and addresses.**
  - The regime record is the tripwire: independently hardcoded entries, a digest-bound KDF, a
    loaded-class-id pin. Its tests are dark only between P1's install and P2's artifact swap, with a
    diff check standing in.
  - V5 backups are refused by compat epoch 5, and V5 account files by the export regime digests.
    Literal V5 fixtures prove both refusals (P2). The integrity coordinator's handled screen covers a
    stored V5 address.
  - Battle-tested crypto only: every derivation stays upstream (`@aztec-labs/accounts`,
    `@aztec-labs/foundation` at `6.0.0-rc.1`, exact pins) or in the existing `@nulo/wallet-crypto`,
    and the key-level KATs hold V6's code to 5.0.1's values. Nothing is hand-rolled.
- **Input validation at trust boundaries.** The dApp wire shape changes (`returnType`). The approval
  card's tests feed a V6 wire-shaped payload and a hostile one: a stale `returnTypes`, a lying
  `returnType` and a lying `isStatic`. The rows must follow the ABI. The dispatcher parity tests
  still run, and the schema patch still throws when `WalletSchema`'s shape moves.
- **The embedded dRPC key** is public by construction and not origin-restricted (probed), so anyone
  can spend its quota: the risk is a denial of service to wallet users, not theft. This is the same
  exposure the V5 key had, and the V5 key stays public inside v0.28.0. Mitigation is dRPC's own rate
  limits, the owner's call. Privacy § 5.1 stays true only if the key sits on the owner's dRPC account
  (A5).
- **Least privilege in delivery.**
  - No new secrets.
  - The owner dispatches every publishing run (npm, stores) and approves its protected environment.
    The loop never does.
  - npm publishing stays trusted-publisher with provenance. The real run's tarball digests must
    equal the dry run's before the owner approves `npm-publish` (P6).
  - Chrome publishing is keyless OIDC in `chrome-web-store`, and AMO's JWT stays in
    `firefox-add-ons`.
  - CI's presto-server moves to `1.1.3` with both SHA-256 pins (tarball and extracted binary), per
    SECURITY.md "Binary dependencies". The pins bind bytes, not the build's provenance.
  - The Aztec installer stays `curl | bash`, unpinned. `install.aztec.network` now answers 301 to
    `install.aztec-labs.com`, so its trust widens to a second origin, and its npm resolution bypasses
    this repo's age gate. Recorded as a follow-up.
- **Browser-extension risks.** No CSP, permission or `web_accessible_resources` change is intended.
  P5 diffs both built manifests against `dev`'s after normalising content hashes and chunk slugs
  (`aztec-` → `aztec-labs-`). Any other difference is a finding.
- **Licences.** Nulo's own `LICENSE` (Apache-2.0) and `NOTICE` do not change: a dependency's npm
  scope is not a licence event.
  - The dependencies' licences are unchanged in kind. `@aztec-labs/*` ships with no licence field
    and no licence file, as `@aztec/*` did. `bb.js` declares MIT, the noir pair MIT and
    `MIT OR Apache-2.0`, and Standards MIT with its own file.
  - Neither `aztec-node` nor `aztec-packages` has a NOTICE file at its tag, so Apache-2.0 § 4(d)
    adds nothing.
  - What moves is the notices' source for `@aztec-labs/*`: `aztec-labs-eng/aztec-node`'s `LICENSE`
    at `v6.0.0-rc.1`, in place of `aztec-packages` (P1).
  - A licence change in any bundled package fails the notices gate. It is the owner's call, never an
    `ALLOWED` edit.

## Assumptions

### Facts (verified 2026-09-30; sources in `recon.md` or named)

1. The V6 testnet node on the owner's dRPC endpoint reports `nodeVersion 6.0.0-rc.1`,
   `l1ChainId 11155111`, `rollupVersion 2914217885` and `realProofs true` (re-probed 23:10Z). The
   wallet chainId is `(11155111 ^ 2914217885) >>> 0 = 2904119610`.
2. The V6 dRPC key answers requests from `chrome-extension://`, `moz-extension://`, a web origin and
   no origin.
3. Every `@aztec/*` package the repo uses exists at `6.0.0-rc.1` under `@aztec-labs/*`, except
   `bb.js`, `noir-acvm_js`, `noir-noirc_abi` and `l1-artifacts` (`@aztec-foundation/*`). These are
   all past the 7-day gate as of 2026-09-30 20:10Z, as is `@aztec/viem@2.38.3`. Both scopes' `latest`
   dist-tag points at a nightly.
4. `@aztec-foundation/*@6.0.0-rc.1` carry SLSA provenance from `AztecProtocol/aztec-packages`
   (`ci3.yml`, `refs/tags/v6.0.0-rc.1`, `d521f0d9`). `@aztec-labs/*@6.0.0-rc.1` and
   `@aztec/viem@2.38.3` carry none (the attestations endpoint answers 404) and no repository field.
   `@aztec-labs/*` was published by `charlielye`, as the unattested `@aztec/pxe@5.2.0` was. The
   `@aztec-labs` TypeScript source is `aztec-labs-eng/aztec-node` at `v6.0.0-rc.1` (public,
   Apache-2.0). `aztec-packages` has no `yarn-project/` at that tag.
5. `@aztec-foundation/bb.js` and `l1-artifacts` published `6.0.0-rc.2` on 2026-09-29 between 22:11Z
   and 22:14Z (dist-tag `prerelease`). `@aztec-labs/*` has no rc.2, and the node runs rc.1. V5's
   rc.2 bump came with a testnet contract redeploy (`implementations-plan/aztec-5.0-rc2/plan.md:1-7`).
6. `presto@6.0.0-rc.1` is gated until 2026-10-06 03:17Z, `presto-core@1.2.1` until 03:09Z, and
   `aztec-standards@6.0.0-rc.1` until 21:23Z. `private-fee-juice@6.0.0-rc.1` was published
   2026-09-30 23:13Z (dist-tag `rc`) by GitHub Actions trusted publishing, with SLSA provenance from
   `alejoamiras/ecosystem-tooling` `release.yml` on `main` at `76199c59`, the commit its canary
   `0.0.0-canary.g76199c5` came from. It peers `@aztec-labs/{aztec.js,protocol-contracts,stdlib}`
   at `6.0.0-rc.1` and is gated until 2026-10-07 23:13Z, the last of the four (re-probed
   2026-10-01 00:01Z, when the node still reported rc.1 and `@aztec-labs/*` had no rc.2).
7. V6 ships `SchnorrAccount.json` in `@aztec-labs/accounts/artifacts/` (sha256 `4b4933a1…7f94`, class
   `0x010cc089…1842`), byte-identical to `noir-contracts.js`'s copy. The vendored V5 artifact
   (`aztec_version 5.0.1`, unnamed `outputs.globals`) is rejected when V6 loads it, and
   `frozen-artifact.ts:25` loads it at module load. So every test that imports it throws under V6
   until the artifact is swapped.
8. The canonical SponsoredFPC `0x06a9fa0208c78509921b0487a6b5cd5c2e93baf17de1a18d310f65a3cc1d924b` is
   deployed on the V6 testnet and was funded with 1,000 FJ. The wallet derives it with salt zero
   (`protocol-fpcs.ts:12`), and no test pins that derivation.
9. `REGIMES["nulo-v5"]` is built from live constants (`address-freeze.ts:70-86`). The rules text
   (`:9-25`) allows redefining a never-shipped major's entry until its first shipped build, and does
   not define "shipped" further. `NULO_KDF_SPEC` is the digest preimage (`:58-65`). Its last line
   cites "upstream @aztec/accounts 5.0.1".
10. `DEFAULT_SEEDS` holds Alpha V5 (primary unless `VITE_NULO_E2E_DEFAULT_NET=testnet`), Testnet and
    Local Network (`network/service.ts:92-128`). `SEED_L1_BY_KIND.mainnet` is the trust root for
    seeded rows' L1 identity (`:59-63`). `getOrInitNetworks` returns a profile's existing rows
    unchanged (`:246-247`).
11. The fee policy has two Alpha-only rules. `FeeSettingsCard.vue:127` hides the sponsor on
    `CHAIN_IDS.MAINNET`, and `:496-498` defaults to Private Fee Juice there. `buildFeeMethods`'s
    `allowSponsored` defaults to true (`fee-helpers.ts:188-207`).
12. `displayName` (`apps/extension/package.json:4`) is the manifest name, and
    `store-listing.test.ts:59` pins the Chrome title to it. The Chrome listing name is the manifest
    name. The Chrome item `jlmiaokmjoicmclelpiiocdhncddkdmc` has 0.28.0 pending review, submitted by
    hand, and the publish preflight refuses while a review is pending.
13. AMO `wallet@nulo.sh` is "Nulo V5", slug `nulo-v5`, `0.28.0.0` public with 1 daily user. The name
    and slug are Developer Hub edits. AMO never frees a version number.
14. `publish-packages.yml` publishes X.Y.Z only, on `latest`, from `dev` or `main`. A dispatch is a
    dry run unless `-f dry_run=false`. Its `pack` job outputs the tarball digests before the
    `npm-publish` approval, and `approved-digests.json` binds only `0.1.0`. The three
    `@alejoamiras/nulo-*` packages are at `0.1.0` on npm.
15. Presto release `presto-v1.1.3` ships `presto-server-1.1.3-linux-x86_64.tar.gz` and its `.sha256`.
    CI pins 1.1.2.
16. `global-setup.ts` hard-codes `$HOME/.aztec` and requires `versions/<pin>/{node_modules/.bin/aztec,
    bin/aztec-anvil, internal-bin/forge, internal-bin/anvil}`. This machine's `~/.aztec/versions/
    6.0.0-rc.1` is partial. A complete toolchain sits at `~/.cache/aztec-toolchains/6.0.0-rc.1/`.
17. release-please runs with `bump-minor-pre-major`, so a `feat` makes the next version `0.29.0`.
    `AUTO_UNSTICK_ENABLED` is `on`. `main` already requires the `extension-*` checks (cut over
    2026-09-23, confirmed with `gh api`), so no repoint is needed.
18. `nightly.yml` publishes a GitHub prerelease from `dev` at 03:23 UTC daily, and has a `dry_run`
    dispatch input (`nightly.yml:40-51,503-515`).
19. The smoke suite loads `dist/<browser>` and never builds (`global-setup-smoke.ts:15-17`). CI builds
    it with the migration fixture and an empty token-seed source (`_extension-smoke-e2e.yml:87-108`).
    `vitest.e2e.config.ts` retries twice by default. `fixtures/presto.ts:14-15` serves Aztec `5.2.0`.
20. `https://install.aztec.network/6.0.0-rc.1/install` answers 301 to `install.aztec-labs.com`.
21. The Terms wall shipped in v0.28.0. Acceptance records the current version even while `effective`
    is unset (`packages/legal/src/status.ts:150-160`). `legal/README.md:124-127` bumps the version on
    every change, and the minor digit on a material one.
22. `implementations-plan/lessons.md` is 8,131 bytes, against a budget of about 8 KiB.
23. Every PR build uploads both extensions with a `pr.N` version suffix (`pr-quick.yml:223-236`),
    kept 7 days (`_build-extension.yml:172,184`), and a sticky PR comment links them (since #625,
    2026-09-18).
24. V5's carve-out precedent: `REGIMES` was frozen on 2026-07-22 (#303) with no carve-out. v0.26.0
    (07-24) and v0.27.0 (07-29) then published both zips on GitHub Releases. On 2026-08-21, #418
    added the carve-out for "a major that has never shipped a build, backup, or exported artifact"
    and used it on V5, with the owner ratifying that nothing made under KDF v1 had to keep working
    (`key-model-v2/plan.md:200`); #426 used it again the same day. V5's first store build was 0.28.0.
25. Every extension build, the release's included, runs the `setup-bun` composite, which restores
    `~/.bun/install/cache` by key prefix (`_build-extension.yml:58`,
    `.github/actions/setup-bun/action.yml:19-25`). So do four jobs that hold `contents: write`:
    `release.yml`'s `auto-unstick`, `attach-assets` and `sync-main-to-dev` (which also holds the
    release App's key) and `nightly.yml`'s `publish-nightly`. The npm `pack` job skips the composite.
26. The integrity coordinator's boot check skips re-derivation when the stored stamp's
    `walletVersion` equals the build's and the account set is unchanged
    (`account-integrity/coordinator.ts:98-102`). `__VERSION__` is `apps/extension/package.json`'s
    version (`vite.shared.ts:29`), which release-please bumps only at the release.
27. The rc.1 PrivateFPC needs no deployment. Its source (`private_contract/src/main.nr` in the
    artifact's file map) has no `#[initializer]` and no public function: line 6 reads "Fully private
    FPC (no public functions, no owner, no off-chain agent)", and the artifact's one public entry is
    the macro-generated `public_dispatch`, a 32-character stub. Its canonical address
    `0x0b3bc795b5c077b57920d590ecc163af18705554abf7164cb0f8c52850943c08` (class `0x1144244e…51bd`)
    answers NOT FOUND on the node, as expected (checked 2026-10-01). The owner confirms: "It doesnt
    need to. The private fee contract is an initializerless smart contract". The `aztec-update`
    skill's PrivateFPC precondition (`SKILL.md:141`, NOT FOUND read as "deploy has not landed") is
    therefore wrong for it, and P5 corrects it.

### Inferences (unverified; each is checked in the phase named)

- **I1.** `private-fee-juice@6.0.0-rc.1` keeps 5.0.1's API and behaviour ("no breaking changes"), so
  only its compiled bytes and its canonical PrivateFPC address move. P3 diffs the ABI and the source.
- **I2.** Key-level derivation is unchanged at rc.1, so V6 reuses `nulo-account-kdf-v2`. The standing
  key-level KATs decide (P1 for `key-vectors.test.ts`, P2 for the account KATs).
- **I3.** The V6 SchnorrAccount constructor ABI (`constructor`, two Field args) is unchanged, so
  descriptor v1 carries over.
- **I4.** The `6.0.0-rc.1` installer provisions `bin/aztec-anvil` and `internal-bin/{forge,anvil}` on
  CI runners. `setup-aztec` asserts this on the first run.
- **I5.** presto-server 1.1.3 lists `6.0.0-rc.1` among its available versions and keeps the log
  lines `Received /prove request` and `Proving succeeded`.
- **I6.** The noir wasm pair still ships `"module"`-only manifests at rc.1, so the two `exports`
  patches are still needed.
- **I7.** testnet.aztecscan.xyz indexes the V6 testnet (P4 checks it with a real V6 tx hash).
- **I8.** An in-place 0.28 → 0.29 update keeps the V5 network rows and the V5 accounts. The one AMO
  daily user is the owner (A2). If the store upload runs, P9 records the screen and whether a reset
  recovers.
- **I9.** "Cancel review" on the Chrome item returns it to a state where the pipeline's preflight
  passes and the next upload replaces 0.28.0. P9's `store-check` run decides.
- **I10.** unleashed's V6 bridge targets the canonical PrivateFPC this wallet derives, and its V6
  Test USDC comes from Aztec Standards `6.0.0-rc.1`. P8 compares the address in unleashed's manifest
  with the wallet's pin, and `default-tokens.test.ts` compares the token's live class with the
  bundled one.
- **I11.** 1,000 FJ in the sponsor covers testnet traffic until the owner tops it up. A public
  sponsor can be drained by anyone, so P7 checks a floor before the release, and P9 again before an
  upload.
- **I12.** The V5 and V6 dRPC keys share an account (their first 22 characters match). Confirmed by
  the owner (A5).
- **I13.** The V6 testnet stays on rc.1 through the release. A9 covers the other case.

### Asks (answered by the owner, 2026-10-01)

Each ask as it was put, reduced to its question, then the answer and what it changed.

- **A1 · Nightlies, PR previews, and what "shipped" means.** Answered "sounds good" to the
  recommendations: pause nightly, keep previews, and read "shipped" as V5's precedent does.
  - *Nightly* stays on after all. The pause had one reason, an installable build pinning an
    undeployed PrivateFPC, and there is nothing to deploy (Fact 27). 0.29.0 is now itself the public
    V6 build (D23).
  - *PR previews* stay on.
  - *"Shipped"* means published to a store (Fact 24). `nulo-v6` stays redefinable until its first
    store upload, so an rc.2 that moves the account artifact (A9) costs a re-vendor the owner
    ratifies, not a V7. P2's rules-text edit states this in one clause.
- **A2 · Terms version.** Edit 1.0 in place: the one AMO user is the owner. No version bump and no
  re-acceptance sheet (D20).
- **A3 · Version.** `0.29.0`, by release-please.
- **A4 · npm.** Yes: the three `@alejoamiras/nulo-*` packages as `0.2.0` on `latest`, with exact
  `6.0.0-rc.1` peers, the real run's digests equal to the dry run's (P6).
- **A5 · dRPC.** Yes to both: the V6 key is on the owner's dRPC account, so Privacy § 5.1 stays
  true, and the owner retires the V5 key after the release (P7 step 6).
- **A6 · The V5 exposure.** Yes: the owner cancels the Chrome review of 0.28.0 and makes the AMO
  listing invisible now. `nulo.sh` keeps linking v0.28.0 until 0.29.0's release.
- **A7 · What the release waits for.** Arc A merged and P7's checks, nothing else. The PrivateFPC
  needs no deployment (Fact 27), and unleashed's generation is not a prerequisite: its Test USDC
  seed and any moved bridge link come in arc C (P8). The store upload is optional (D27).
- **A8 · Trust bar for `@aztec-labs/*` and `@aztec/viem`.** Yes: registry signatures plus publisher
  continuity, recorded per locked name, with a HOLD on any other publisher or maintainer set. The
  release's builds and its write-scoped jobs stop restoring Bun's cache (P5, D25).
- **A9 · rc.1 or rc.2.** rc.1, the version the V6 testnet runs. Every live check asserts
  `nodeVersion 6.0.0-rc.1` and the pinned `rollupVersion`, and a change HOLDs the plan for a re-gate
  with the owner. A version-only move re-checks the pins, the artifact and the FPC pins, and
  re-vendors while the regime window is open (A1). A reset also moves the chain identity.

**The owner's words (2026-10-01).** "A6: ok. A1: sounds good. A2: edit in-place, its me. A3: ok. A4:
yes. A5: yes to both. A7: private fee contract is already published. what's deliverables B and C?
A8: ok. A9: yes. D19: I mean, Let's put the store upload as optional. right now I just want 0.29 / a
compatible v6 version to play around with."
- A2 in place departs from `legal/README.md` § Changing these documents ("Every change bumps the
  version"). It stands because 1.0 is still a draft (`effective` unset) and its one acceptor is the
  owner. No test pins the text, so no gate moves.
- A7: the npm package is published, and nothing is deployed on V6 at the canonical PrivateFPC: rc.1
  and its canary share one artifact (sha256 `68f0c043…3974`), which derives
  `0x0b3bc795b5c077b57920d590ecc163af18705554abf7164cb0f8c52850943c08` (class
  `0x1144244e…51bd`), and the node answers NOT FOUND for both (2026-10-01, `nodeVersion 6.0.0-rc.1`).
  Asked whether 0.29.0 should wait for a deployment, the owner answered: "It doesnt need to. The
  private fee contract is an initializerless smart contract" (Fact 27).
- "Deliverables B and C" were the old arcs B (store, legal and docs) and C (live checks and
  unleashed's token). Arc B is gone: its Terms and docs moved into arc A (P5), and its store work into
  the optional store arc (P9). Arc C is P8.

### Plan audit ledger

**Codex (GPT-6 Astra, `high`).** Verdict: `reject (with blocking findings: 1, 2, 3, 4, 5)`.

**The Anthropic-family leg (Opus 5.5).** Verdict: `conditional approve`, on 12 conditions: F1–F11
and F13 below.

**Final fresh-context codex pass on this consolidated plan.** Verdict: `reject (with blocking
findings: 1, 2, 3)`. It found X2, X3, F2–F8, F10, F11 and F13 resolved, and X1, X4, X5 and F9 open
only through its own findings Y1, Y2, Y4 and Y5. It upheld every rejection below. Its findings are
rows Y1–Y8, each checked against the tree.

**Re-review of those fixes (same session).** Verdict: `conditional approve (with conditions: fix
findings 1 and 2)`. Y2 and Y4–Y8 resolved. Y1 and Y3 partial, through its two new findings Z1 and Z2,
both adopted below, so its conditions are met in the plan text. It found the preview residual
acceptable once the owner ratifies A1, and checked the cache condition against every caller, the
Firefox reload and a docs-only arc C.

| # | Finding | Verdict | Where |
|---|---|---|---|
| X1 | Nightlies can ship before the PrivateFPC exists, and "no V6 bridge" is no barrier: the portal takes deposits directly. | Adopted | A1, A7, D7, D23, Security |
| X2 | An unchanged ABI does not prove unchanged behaviour. | Adopted: a source diff from `c678a948` to rc.1's attested commit | P3 step 2 |
| X3 | The V5 freeze cannot pass after the V6 install. | Adopted | P1 step 1, D3 |
| X4 | The V5 upgrade behaviour is untested. | Adopted in part: literal V5 backup and account-file refusals (P2), and one manual in-place check (P8), made unconditional and stamped 0.29.0 by Y2 and Y4. Rejected: an automated locked and restored-session suite. The realistic population is one AMO install, migrations are out by the owner's decision, and `account-integrity/coordinator.test.ts` already covers the mismatch handling. | P2, P8 |
| X5 | The validation matrix misses Firefox's full suite, `NULO_E2E_PROVERLESS` and retry 0. | Adopted | P4, P5 |
| X6 | P3's permitted failures depend on npm timing. | Adopted: private-fee-juice now comes before the cutover, there are no permitted failures, and gates go green strictly in order. | P3, P4 |
| X7 | Fork-class copied logic is not re-diffed. | Adopted | P1 step 8 |
| X8 | Chain identity is not wire-version validation. | Adopted: the hostile-metadata fixture | P1 step 8, Key interfaces |
| X9 | One exclude re-gates presto and Standards. | Adopted | P3 step 1, Algorithms |
| X10 | Gates that cannot fail: the preflight, the phantom sweep, grep exit codes. | Adopted | P1, P3, P4 |
| X11 | Chrome listing content is never applied. | Adopted | P9 step 6 |
| X12 | The npm dry run is not bound to the real run. | Adopted: digest comparison before approval | P6 |
| X-F | Fact 15 wrong (`main` already cut over); A2's premise unsupported; "Alpha Testing" missed. | Adopted | Facts 17 and 21, A2, U6 |
| X-I | Compare the live PrivateFPC class with the wallet's derivation; recheck sponsor funding. | Adopted | P8, P9 |
| X-A1 | Archive the plan at close regardless. | Rejected: repo CLAUDE.md § Implementation plans says that until the archive split the move waits and the index line reads "closed, awaiting archive". | P10 |
| X-A2 | Use a 3-failure threshold in the loop. | Rejected: the owner's blueprint policy sets 5 for autonomous loops and 3 for human-driven work. | Seeds |
| X-O | Keep three waves; graft the explicit release decision and coordinated UI review; no date bypass. | Adopted | A7, UI asks |
| F1 | The supply-chain bar cannot be met: `@aztec-labs/*` has no attestation and is built from `aztec-node`. | Adopted: a per-scope bar (D24, A8); `verify-provenance.sh` takes an optional ref (default unchanged); exact-version scratch installs; notices and the runbook cite `aztec-node`; `PROVENANCE.md` keeps its integrity line | Security, P1, P2, P5 |
| F2 | Key-level vectors lose their tie to the reused KDF. | Adopted | D16, D17, P2, I2 |
| F3 | rc.2 is in flight. | Adopted | A9, A1, every live check |
| F4 | P2 step 1 cannot be green after P1. | Adopted (with X3) | P1 step 1 |
| F5 | P3's gate cannot pass: the default-tokens set, smoke's stale `dist`, the Presto fixture. | Adopted | P1 step 9, P4, every smoke run |
| F6 | The wallet-sdk chunk check is inverted, and the manifest diff cannot hold. | Adopted in part: inverted check, normalised diff. Rejected: equal module lists for the content script's chunks, which a dependency upgrade changes by design; P1's check guards the grouping rule that decides them. | P1, P5 |
| F7 | P4's single exclude re-gates. | Adopted (with X9) | P3 |
| F8 | The A7 fallback drops the PrivateFPC precondition. | Adopted (with X1) | A7, P8 |
| F9 | The in-place update is untested, and updated profiles keep V5 networks. | Adopted | P8 step 7, Fact 10, I8 |
| F10 | No Firefox network run in P5. | Adopted (with X5) | P5 |
| F11 | Fact 15 false; two steps moot. | Adopted | Fact 17; the repoint steps deleted |
| F12 | A2's premise unverified. | Adopted (with X-F) | A2 |
| F13 | Gate hygiene: phantom output, a named exempt command, `*.md` in the P1 sweep, `0.0.0-canary`, P7's grep. | Adopted | P1, P3, P7 |
| F14 | The KDF spec line is unprotected during the rename. | Adopted | Algorithms, P1 gate |
| F15 | Two build settings fail open. | Adopted in part: the version key throws. Rejected: a separate dist check for the bb shim, because P1's sweep and the network suite already catch a miss. | P1, Security |
| F16 | Fee routing: the SponsoredFPC derivation, the sponsor balance, the bridge link. | Adopted | P3, P9, P8 |
| F17 | Make the hostile-dApp fixture adversarial. | Adopted (with X8) | P1 |
| F18 | The About page and onboarding fee copy are missing from UI impact. | Adopted | U6, U7 |
| F19 | The installer now redirects. | Adopted | Security, Follow-ups |
| F20 | Seeds and delivery: who dispatches publishing, D19, Renovate, the V5 key, arc C's base. | Adopted: the owner dispatches, D19 goes to the owner, Renovate gains only the scopes, A5. Rejected: stacking arc C on `dev`. The release needs B and C either way (C is unconditional since Y2), and stacking avoids `plan.md` and lessons conflicts between parallel PRs. | Seeds, D19, D11, A5, Delivery |
| Y1 | PR preview builds are installable V6 builds, so pausing nightly neither keeps V6 unreleased nor keeps the regime window open; disabling "at merge" races the schedule, and a temporary enable can publish. | Adopted in part: nightly is disabled before the merge with no run in progress, and the temporary enable is gone; the Outcome and Security claims now say "released" and name previews as the residual. Rejected: suppressing previews by default. V5's precedent reads "shipped" as a store build (Fact 24), and the PrivateFPC exposure needs a hand-made testnet portal deposit (Security § Fee Juice). Both are the owner's call in A1, with suppression as the alternative. | A1, D23, Outcome, Security, P6 |
| Y2 | Deferring the token also deferred the live checklists, the in-place check, a moved bridge link and the final cross-arc pass. | Adopted: arc C always ships before the release; only the seed may be deferred, and the checklists skip its two token steps. | P8, A7, D26, P9, Delivery, `/goal` |
| Y3 | Release builds restore Bun's cache by prefix, and Bun never re-checks cached bytes, so the verified registry bytes need not be the shipped ones. | Adopted: release, nightly and source-rebuild builds restore no cache, pinned by `behavior-gating.test.ts`. Surfaced to the owner under A8 as a CI change outside V6 proper. | P5, D25, A8, Security |
| Y4 | The in-place check built at 0.28.0 lets the coordinator skip re-derivation. | Adopted: the candidate is stamped 0.29.0 locally, and the check runs from an unlocked session, then after a lock. | P8 step 7, Fact 26 |
| Y5 | The full network runs keep the default two retries. | Adopted: `NULO_E2E_RETRY=0`; only an infra-boot exit 86 may be re-run. | P5 step 7 |
| Y6 | `stage.test.ts:351` accepts only stable peers, so `test:release` fails on rc.1. | Adopted | P1 step 6 |
| Y7 | The approval-card fixture cannot prove execution ignores lying metadata. | Adopted: the builder's and the authwit discoverer's tests get the same lying fields. | P1 step 8 |
| Y8 | `seed-preflight-metadata.ts` exits 0 after "no slot" and "read failed". | Adopted | P4 step 4 |
| Z1 | The packaging jobs (`release.yml:309`, `nightly.yml:443`) still run the cached composite with `contents: write`, and its install runs Puppeteer's trusted postinstall. | Adopted, widened to every write-scoped job running the composite: `auto-unstick` and `sync-main-to-dev` too (verified: no `trustedDependencies`, `bun pm untrusted` reports none blocked). | P5 step 3, D25, Fact 25, Security |
| Z2 | The drain check misses disabled workflows (`gh run list -w` needs `--all`) and queued runs. | Adopted: `--all`, every non-completed run cancelled, re-listed until empty; a failing lookup stops the merge. | P6 step 1, A1 |

**Superseded by the owner's answers (2026-10-01).** The rows above record the audits of the plan as
it stood. Two answers changed what several of them guard: the PrivateFPC needs no deployment
(Fact 27), and 0.29.0 releases after arc A with the store upload optional (D26, D27).
- Moot, because nothing waits on a PrivateFPC deployment: X1, F8, Y1's nightly part, Z2, and X-I's
  PrivateFPC half. Nightly stays on (D23). What survives is the address agreement with unleashed
  (P8 step 1, Security § Fee Juice).
- Moved to P7, before the release: X-I's sponsor recheck and F16's sponsor balance, as the floor
  check; Y2's live checklists, as the owner's hands-on run.
- Moved to the optional store arc (P9): X4, F9 and Y4's in-place check, because an in-place update
  reaches a V5 install only through a store; X11's listing content.
- Y2's "arc C always ships before the release" and F20's stacking: arc C now follows the release
  when unleashed is ready, off `dev`, with no stack (D18, Delivery).

### Decision ledger

| # | Decision | Alternatives rejected and why |
|---|---|---|
| D1 | Reuse the Chrome item and AMO add-on, renamed "Nulo V6" (AMO slug `nulo-v6`). Keep the "protocol break = new extension" rule and record V6 as a one-time exception, because V5 never had users. | A new extension ID and listings: the owner declined it. It would spend the second Chrome publisher slot and a fresh review for zero users. |
| D2 | No V5 migration or recovery inside V6. The backup compat epoch goes 4 → 5, and export digests follow the rebind. | Migrating V5 rows: the owner ruled it out, and no users exist. Leaving epoch 4: a V5 backup would restore V5-regime slices into V6. |
| D3 | Freeze `nulo-v5` to literals as arc A's first commit, before the dependency change, then append `nulo-v6` and rebind in P2. | Editing `nulo-v5` in place: V5 shipped, so its entry is append-only history. Freezing after the install: its test cannot load the V5 artifact under V6. |
| D4 | The V6 artifact replaces the V5 one at the same path. V5's bytes stay reachable through `git show 910a4def:<path>`, cited in `PROVENANCE.md`. | Per-regime artifact directories: nothing loads V5's bytes any more, and git history already keeps them. |
| D5 | Delete the Alpha-only branches: the Alpha seed, `CHAIN_IDS.MAINNET`, its tokens, prices and explorer entry, and the fee policy (`allowSponsored` end to end if no caller still sets it). Keep `ChainKind "mainnet"` and `MAINNET_L1_CHAIN_ID`. | Re-keying the policy on `kind === "mainnet"`: no seed carries that kind, so it would be dead code. A V6 mainnet will come back as its own seed with its own policy. |
| D6 | Remove `VITE_NULO_E2E_DEFAULT_NET` and its six sites. | Keeping it: Testnet is primary unconditionally, so the flag selects nothing. |
| D7 | Re-pin the PrivateFPC literals in arc A (P3) from the reviewed rc.1 artifact. It is initializerless and private-only, so it needs no deployment (Fact 27, the owner on 2026-10-01), and the runbook's "deployed plus a live re-canary" precondition does not apply to it; P5 corrects the runbook. P6 hands the address to unleashed, and P8 checks that unleashed's manifest names the same one. | HOLD (the runbook default): impossible, because the 5.0.1 artifact cannot load on V6. Gating the release on a deployment: there is nothing to deploy. |
| D8 | Superseded on 2026-10-01: rc.1 was published before P1 (Fact 6), so P1 pins it and no canary stand-in is used. The rule stays for the record: no canary string may reach a PR. | Waiting to start: idles for an unknown time. Holding 5.0.1: its peers pull a second, V5-line generation and its artifact cannot load. |
| D9 | Temporary excludes for exactly four names (owner's choice), opened only for the installs that re-resolve before 2026-10-07 23:13Z and removed after each. | Waiting until 2026-10-08: the owner chose excludes. |
| D10 | `@aztec/viem` → `2.38.3` to match `@aztec-labs/ethereum`. | Keeping 2.38.2: two viem copies in the e2e tree. |
| D11 | `presto-banners` stays at 1.1.0. Renovate's disabled rule gains only the two scopes. | Bumping to 1.2.0, or disabling `presto-banners` and `presto-core` in Renovate: no V6 coupling. |
| D12 | `global-setup.ts` honours `AZTEC_HOME` (default `~/.aztec`), and local runs point it at `~/.cache/aztec-toolchains/6.0.0-rc.1`. | Running the installer into the shared `~/.aztec`: foundryup refuses beside other agents' live anvils, and the install would mutate a directory other agents read. |
| D13 | presto-server 1.1.3 in CI, with both SHA pins in one commit. | Keeping 1.1.2: unverified against the rc.1 bb. Presto's own V6 proof used 1.1.3. |
| D14 | Keep `scripts/aztec-hold-residue-check.ts`, retargeted to the new scopes with an empty hold set, as the single-generation check. | Retiring it: loses the two-physical-copies check the isolated linker needs. |
| D15 | The codemod is committed under the plan's `tools/`, as tools-extraction did, and never run by CI. | A scratch-only script: the rename would not be reproducible for review. |
| D16 | Address-level vectors (`address`, `completeAddress.address`, `partialAddress`) come from `reference/nulo-v6/`, from a copied independent generator with its own lockfile. Key-level assertions stay on key-model-v2's vectors, a standing cross-version KAT. | Repointing whole KATs at the V6 vectors: the key level would then compare V6's code with itself. Generating with the wallet's own code: circular. |
| D17 | Reuse `nulo-account-kdf-v2` only while every key-level KAT stays green on the V6 line, and the new generator's key-level fields equal key-model-v2's. Otherwise stop and re-gate with the owner. | Silently appending a KDF v3: a crypto decision that changes a published package. |
| D18 | Waves: arc A merges; then the npm publish (P6) and the 0.29.0 release (P7), in either order; then arc C when unleashed's V6 generation exists (P8); then the store upload when the owner calls it (P9). | One PR for everything: deadlocks with unleashed, which needs arc A's packages published from `dev` before it can build its generation. Waiting for unleashed before releasing (the audited plan): the owner wants a V6 build now, and nothing in 0.29.0 depends on unleashed (A7). |
| D19 | The close-out is a docs-only PR off `dev`, opened after 0.29.0's sync, and after P8 and P9 if they have run by then; otherwise they move to follow-ups with their steps as the spec. This is an exception to CLAUDE.md § Implementation plans ("closing ships with the delivery"), approved with the plan: the delivery ends at a release, after the last merge. | Close-out on top of arc A: it would merge before the release it describes. Waiting for arc C and the store: both depend on events with no date. |
| D20 | Terms 1.0 edited in place (A2): the default network and the value wording in arc A (P5), the store URLs with the optional store upload (P9). No version bump and no re-acceptance sheet. Privacy changes only if bb.js's CRS hosts moved, and then in place by the same reasoning, shown on arc A's decision page. | 1.0 → 1.1 as a material change: it would re-ask the one acceptor, the owner, about a draft that is not yet effective. |
| D21 | Live layer: agent-run read-only checks (node info with the version, preflights, explorer, sponsor balance) in P4, P7 and P9; the owner's hands-on run per browser before the release (P7), and again with the token and Private Fee Juice in arc C (P8); one in-place update check with the store upload (P9). | Building an automated live-transaction suite: not in the repo, and a new layer this plan would have to build and maintain. Offered as a follow-up. |
| D22 | One `mid` plan, under the owner's tier cap: arc A, then arc C and an optional store arc. | Two plans (line; release): double audits for one shared identity and ledger. |
| D23 | Nightly and PR previews stay on. A1's nightly pause guarded only a build pinning an undeployed PrivateFPC, and there is nothing to deploy (Fact 27). "Shipped" for the regime window reads as V5's precedent does, a store-published build (Fact 24), as the owner confirmed (A1), and P2's rules-text edit says so in one clause. | Disabling nightly until the store submissions: its reason fell away, and 0.29.0 is now the public V6 build. Suppressing previews: removes the owner's review installs. Counting any public build as shipped: contradicts V5's precedent and freezes `nulo-v6` at arc A's first preview, before rc.2's shape is known. |
| D24 | The supply-chain bar is per scope: SLSA provenance where upstream publishes it, verified with the repo's own `verify-provenance.sh` (plus an optional ref argument for tag publishes); registry signatures plus publisher continuity where it does not (A8). | One provenance bar for all: `@aztec-labs/*` cannot meet it, so it would either block the bump or be waived silently. Reading attestation statements without the certificate check: trusts the statement's own claims, which the script exists to avoid. |
| D25 | Builds that produce release bytes, and every release or nightly job that holds `contents: write`, restore no Bun cache: `setup-bun` takes a `cache` input (default on), `_build-extension.yml` passes `github.event_name == 'pull_request'`, and the four write-scoped jobs pass `"false"` (P5 step 3). | Keeping the warm cache: the registry checks would not bind the shipped zips. A separate uncached setup step: a sixth Bun version literal to keep in sync (CLAUDE.md § Dependency policy). Leaving it to a later plan: this release is the first to ship two unattested scopes. |
| D26 | 0.29.0 releases after arc A, gated by P7's live checks and the owner's hands-on run on both browsers. Arc C follows when unleashed's V6 generation exists, and the store upload when the owner calls it. | Holding the release for arc C (the audited plan): the owner wants a V6 build now, and arc C's token and bridge link wait on unleashed's timeline, not on anything in 0.29.0. |
| D27 | The store upload is optional (the owner, 2026-10-01). P9 runs only when the owner calls it; otherwise it moves to follow-ups with its steps as the spec. The in-place V5 update check goes with it, because an in-place update reaches a V5 install only through a store. A6's dashboard steps stand either way. | Uploading with 0.29.0 (the audited plan): the owner wants 0.29.0 to use first. |

### Follow-ups (opened at close-out, not before)

- A V6 mainnet seed and its fee policy, when a V6 mainnet exists.
- The stores' review outcomes, if still pending at close-out.
- The unpinned Aztec installer in `setup-aztec`, now served from `install.aztec-labs.com` after a
  redirect, with npm resolution outside the age gate.
- An automated live-transaction smoke, if wanted (D21).
- `presto-banners` 1.2.0.
- The V5 dRPC key's retirement, if not done by close-out (P7 step 6).
- Arc C (P8) and the store upload (P9), if they have not run by close-out, each with its steps here
  as the spec.
- Three findings that predate the bump (lessons/phase-1.md): the e2e `mintPublicTokens` guard
  compares `simulate()`'s result object with `0n` and never fires; `call-decoder.test.ts`'s "a
  selector is the truth" passes vacuously under jsdom; the standard Token's `_nonce` keeps
  `transfer_private_to_private` on decoded rows instead of the transfer row (an owner UI call).

## Approval

Approved by the owner on 2026-10-01: "Finish updating everything, but on my side it has been
approved. You are allowed to start working on it once you finish this process". The approval
covers the plan as reshaped by the answers above:
- the scope and the exclusions in "Good enough", with the store upload optional (D27);
- the `mid` tier: arc A, then arc C and the optional store arc;
- the validation plan: every phase's gate below, with the live layer as in D21;
- the delivery topology (Delivery), including D19's exception;
- the one CI change outside V6 proper: release bytes restore no Bun cache (D25);
- the answers to A1–A9.

The UI asks come at their arcs' decision pages. `/harden` is not scheduled (Phase 0).

## Phases

Arc A is P1 to P5. After it merges, P6 publishes the npm packages and P7 releases 0.29.0. Arc C is
P8, when unleashed's V6 generation lands, and P9 is the optional store upload, on the owner's call.
P10 closes the plan. Steps of a later phase may proceed while a gate blocks, but phase gates go
green strictly in order, and no gate carries a permitted failure; only P8 and P9, which wait on
outside events, may instead move to follow-ups at P10. Local e2e runs claim ports through
`~/.agents/ports.md` and reap what they own (AGENTS.md § Run isolation). Every live check asserts
`nodeVersion 6.0.0-rc.1` and `rollupVersion 2914217885`, and any other value is a HOLD (A9).

The smoke recipe used below, per browser (`<b>` is `chrome` or `firefox`):
1. Build: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:<b>`.
2. Run: `NULO_E2E_MIGRATION_FIXTURE=1 NULO_E2E_BROWSER=<b> bun run --cwd apps/extension test:e2e --retry=0`.

### P1 · The V6 line compiles ✓

1. **Freeze `nulo-v5` first (D3).** Before any dependency change, rewrite `REGIMES["nulo-v5"]` as
   literals equal to `EXPECTED_REGIMES["nulo-v5"]`, in its own commit. `bun run --cwd
   packages/aztec-runtime test` must be green on the V5 line. Record the commit's SHA in
   `lessons/phase-1.md`: it is this phase's freeze base.
2. Pin `@alejoamiras/private-fee-juice@6.0.0-rc.1`, published 2026-09-30 (Fact 6). The canary
   stand-in (D8) is no longer needed.
3. Write `implementations-plan/nulo-v6/tools/scope-codemod.ts` (Algorithms: the codemod) and run it.
   Review the survivors report and `git diff --stat`, then format only the touched files.
4. Set every pin (recon §7 and D9–D11), and `displayName` → "Nulo V6" with the two `listing.md`
   titles. Run the min-age choreography, then the supply-chain checks (Security table):
   - an exact-version scratch project, `npm install --ignore-scripts`, then `npm audit signatures`;
   - `npm pack` of each attested name, then `verify-provenance.sh` against its row;
   - the publisher and maintainer set of every `@aztec-labs/*` name and `@aztec/viem`.

   Record every result in lessons.
5. Patches: read the rc.1 manifests of the noir wasm pair. If they are still `"module"`-only,
   regenerate `patches/@aztec-foundation%2Fnoir-{acvm_js,noirc_abi}@6.0.0-rc.1.patch` with
   `bun patch`, and replace the four `patchedDependencies` keys with two. Delete the four old files.
6. Edit the name-keyed sites by hand (recon §7):
   - the four version readers, with `vite.shared.ts` throwing when the `@aztec-labs/pxe` key is
     missing;
   - the shim substring;
   - `HEAVY_SCOPES` + `NEVER_GROUPED` together, with `vendor-chunks.test.ts`'s never-regroups case on
     an `@aztec-labs/wallet-sdk` path;
   - the nine prefixes;
   - `stage.ts` (`external` and `isBundledExternal` together), and `stage.test.ts`: the literal peer
     maps (`:357-358`) move to `@aztec-labs/*@6.0.0-rc.1`, and the stable-only `/^\d+\.\d+\.\d+$/`
     (`:351`) becomes `stage.ts`'s exact-pin shape (`EXACT_PIN_RE`, `:35`), so an exact prerelease
     peer passes and a range still fails;
   - `renovate.json`: the disabled Aztec-line rule gains `/^@aztec-labs\//` and
     `/^@aztec-foundation\//`, and stays the last rule;
   - soak `RESOLVE_SPECS`, the exception-diff normalisation and the residue check (D14);
   - `scripts/publish/verify-provenance.sh`: an optional fourth argument, the ref pattern, defaulting
     to today's `refs/heads/(dev|main)`. The certificate identity stays anchored to the repo and
     workflow, the digest check stays, and each run's reported commit must equal the Security
     table's.
7. Third-party notices, per `packages/third-party-notices/README.md` § When a build is refused:
   - the `@aztec-labs` override cites `aztec-labs-eng/aztec-node`'s `LICENSE` at `v6.0.0-rc.1`, and
     its note names that repo;
   - the `bb.js` record keeps `aztec-packages` (`barretenberg/LICENSE` at `v6.0.0-rc.1`);
   - re-derive `NOIR_COMMIT` (`gh api 'repos/AztecProtocol/aztec-packages/contents/noir/noir-repo?ref=v6.0.0-rc.1'`)
     and the sqlite3mc pin at the rc.1 sources;
   - refresh `texts/` only from those tagged sources;
   - rename the records, bump `reviewedVersion`, and update `expected-minimum.txt`;
   - review any newly bundled package the build lists without loosening `ALLOWED`. A changed licence
     stops for the owner.
8. API churn (recon §1):
   - the renames: `returnTypes` → `returnType` (including the wire type), `decodeEachFromAbi`, the
     FeeJuice import, the MultiCall and Handshake sources, the playground, the schema patch's
     pinned-version comment, and the PXE data-schema pin if its drift test moves;
   - the runbook's fork-class re-diff (`aztec-update` SKILL.md, API churn):
     `packages/aztec-runtime/src/account/fee-options.ts` and the gas logic against rc.1's upstream,
     and `batched-view-simulation.ts`'s private-return nesting against rc.1;
   - existing tests exercise scalar, tuple and empty returns on the utility, public and private
     paths; a path with no such test gets one;
   - in `apps/extension/src/popup/windows/execute/`, a component test feeds the approval card a V6
     wire-shaped `aztec_sendTx` payload (`0x` + 64 hex fields), plus a hostile variant with a stale
     `returnTypes`, a lying `returnType` and a lying `isStatic`. The rows must follow the ABI;
   - the card only renders decoded calls, so execution is proven where it happens:
     `tx-request-builder.pins.test.ts` and `authwit-discoverer.test.ts` feed the same lying fields and
     assert the built call carries the ABI's function type, `isStatic` and return type
     (`tx-request-builder.ts:587-599`, `authwit-discoverer.ts:207-209`).
9. `tests/e2e/fixtures/presto.ts`: `aztec_version` and `available_versions` read from the pin, so
   the smoke suites see Presto "available".
10. Run `bun implementations-plan/isolated-linker-store/tools/phantom-sweep.ts`, then the survivor
    sweeps.

**Validation gate.**
- Commands, all run from the repo root:
  - `bun install --frozen-lockfile --force` with no `minimumReleaseAgeExcludes` line.
  - `bun run typecheck:all`, `bun run lint`, `bun run test:release`, `bun run test:ci-gating`.
  - `bun run build:chrome` and `bun run build:firefox`, then
    `bun packages/third-party-notices/bin/check-minimum.ts chrome apps/extension/dist` after the
    Chrome build and the same with `firefox` after the Firefox build.
  - `bun run --cwd apps/playground build` and `bun run --cwd apps/landing build`.
  - `bun run --cwd packages/wallet-bridge test`, and the same for `wallet-sdk-schema-patch`,
    `resolve-asset`, `third-party-notices` and `wallet-crypto`.
  - `bun run --cwd apps/extension test scripts/ src/presto/ src/wallet/crypto/ src/popup/windows/execute/`.
  - `git diff --exit-code <freeze base> -- packages/aztec-runtime/src/account/address-freeze.ts packages/aztec-runtime/src/account/artifacts/`.
  - The phantom sweep.
  - `git grep -n '@aztec/' -- . ':!*.md' ':!implementations-plan' ':!audit' ':!wallets-architecture-research'
    ':!architecture' ':!bun.lock' ':!CHANGELOG.md'`, and the same for `@aztec+` and `@aztec%2F`.
- Pass:
  - Every command exits 0, except the three sweeps, whose hits are the result.
  - `wallet-crypto` and `key-vectors.test.ts` are green. A red key-level vector means stop (D17).
  - The phantom sweep prints no line for `@aztec-labs/`, `@aztec-foundation/` or `@aztec/`.
  - The sweeps return only `@aztec/viem` and reviewed historical citations, each classified in
    lessons.
  - No emitted chunk is named `aztec-labs-wallet-sdk*`.
  - The built bundle's `__AZTEC_VERSION__` is `6.0.0-rc.1`: grep the dist for the literal next to
    the About page's version.
  - Every provenance and publisher record matches the Security table.
- Dark until P2's artifact swap (Fact 7): every test that imports `frozen-artifact.ts`. The freeze
  diff stands in for the KDF digest tripwire meanwhile.
- Layers: lint, types, unit, builds, supply chain.

### P2 · The V6 account regime ✓

1. Vendor `@aztec-labs/accounts@6.0.0-rc.1/artifacts/SchnorrAccount.json` byte-exact to
   `packages/aztec-runtime/src/account/artifacts/SchnorrAccount.json`. Rewrite `PROVENANCE.md` with:
   - the package, version, path, sha256 `4b4933a1…` and class id;
   - the identical `noir-contracts.js` copy;
   - the tarball's sha512 integrity from `bun.lock`;
   - the trust basis: registry signature and publisher (A8);
   - V5's bytes at `910a4def`.

   Update `frozen-artifact.ts`'s pins.
2. Compare the V6 constructor ABI with descriptor v1 (I3). If it differs, append descriptor v2 and
   record why.
3. Copy `implementations-plan/key-model-v2/reference/{derive-vectors.ts,package.json}` to
   `reference/nulo-v6/`.
   - Pin its dependencies to `@aztec-labs/*@6.0.0-rc.1`.
   - Commit its own `bun.lock`, installed under the age gate with no excludes.
   - Make it load SchnorrAccount from its own installed `@aztec-labs/accounts` and assert sha256
     `4b4933a1…`.

   Generate `reference/nulo-v6/vectors.json` for key-model-v2's seeds.
4. The KDF checkpoint (D17): every key-level field of the new vectors equals key-model-v2's. Record
   the outcome in lessons. Any difference means stop, consult codex, and re-gate with the owner.
5. Append `REGIMES["nulo-v6"]` with its `ack`, bind `V6_REGIME`, and rebind the consumers. The rules
   text gets the binding name, one sentence on the one-time store-reuse exception (D1), and one
   clause saying a major's first store-published build closes its window (A1). `address-freeze.test.ts` hardcodes the new entry.
6. Tests:
   - `derivation-vectors.test.ts` and `account-seed-vectors.test.ts` keep every key-level assertion
     on key-model-v2's vectors, and read `address`, `completeAddress.address` and `partialAddress`
     from `reference/nulo-v6/vectors.json`.
   - `CURRENT_COMPAT_EPOCH` → 5. The epoch-rejection test in `useFullBackupImport.test.ts` names 4
     (V5) by literal.
   - `account-export.test.ts` gains a literal `nulo-v5` envelope, refused with "Account export is for
     a different Nulo regime".
   - Fix the tests that recompute class ids or addresses (recon §2).

**Validation gate.**
- Commands:
  - `bun run --cwd packages/aztec-runtime test`
  - `bun run --cwd packages/wallet-crypto test`
  - `bun run --cwd apps/extension test src/wallet/services/account src/wallet/services/account-integrity src/wallet/services/backup src/wallet/crypto src/composables/useFullBackupImport`
  - `bun run typecheck:all`
  - `bun run lint`
  - the step 3 generator, run twice.
- Pass: all exit 0; the regenerated `vectors.json` is byte-identical to the committed one on both
  runs; the KDF checkpoint's outcome is written in lessons.
- Layers: lint, types, unit.

### P3 · private-fee-juice 6.0.0-rc.1 and the protocol FPC pins ✓

private-fee-juice rc.1 is published (Fact 6), so P1 pins it and runs its provenance check, and this
phase installs nothing.

1. Confirm the lockfile resolves `@alejoamiras/private-fee-juice@6.0.0-rc.1` in the three manifests
   (`apps/extension`, `packages/aztec-runtime`, `apps/playground`), and that P1's lessons record its
   provenance at `76199c59`.
2. Review the rc.1 PrivateFPC before any re-pin (I1):
   - the ABI against 5.0.1's: function names, parameters, return types, and the flags `isStatic`,
     `isInitializer`, private and public;
   - the source in `alejoamiras/ecosystem-tooling`, from `c678a948` (5.0.1's attested commit) to
     `76199c59` (rc.1's), covering the contract and its dependency pins.

   Record both SHAs and the verdict in lessons: behaviour unchanged, or each change explained. Any
   behavioural change means stop, consult codex, and bring it to the owner.
3. Consciously re-pin `protocol-fpcs.test.ts`: address, salt 1, deployer zero, and the reviewed
   sha256. The runtime-copy equality stays. Add a SponsoredFPC pin: `deriveSponsoredFpc()`'s address
   equals the live-verified `0x06a9fa02…924b`. A red pin is a HOLD, because the default sponsor
   would not exist. Record the new canonical PrivateFPC address in lessons for unleashed.
4. Run the retargeted `bun scripts/aztec-hold-residue-check.ts` to show a single generation with no
   old-line residue.

**Validation gate.**
- Commands: `bun install --frozen-lockfile --force` (no exclude line),
  `bun run --cwd apps/extension test src/wallet/services/fpc`, `bun run typecheck:all`,
  `bun run lint`, `bun scripts/aztec-hold-residue-check.ts`,
  `git grep -n '0.0.0-canary' -- '*package.json' bun.lock`, `bun run build:chrome`,
  `bun run build:firefox`.
- Pass: every command exits 0, except the canary grep, which finds nothing (exit 1). The review
  verdict is in lessons.
- Layers: lint, types, unit, builds, supply chain.

### P4 · Chain identity and the network cutover ✓

1. `chain-ids.ts`:
   - TESTNET pair → `11155111 / 2914217885`, with the live-verified date and node version in the
     comment;
   - delete `MAINNET_ROLLUP_VERSION` and `CHAIN_IDS.MAINNET`;
   - keep `MAINNET_L1_CHAIN_ID` (D5).
2. `DEFAULT_SEEDS` = Testnet (V6 URL
   `https://lb.drpc.live/aztec-testnet/Ak_eT5HA2kbyqamqGTF702daoH37vEsR8YYxjmVXwXgc`, primary,
   endpoint label dRPC) and Local Network. Delete the flag (D6) at every site.
3. Delete the Alpha branches (D5): `components/ui/utils.ts`, `FeeSettingsCard.vue`, `fee-helpers.ts`,
   `explorers.ts`, the three seeds in `default-tokens.ts` (both Alpha seeds and the V5 Test USDC),
   the matching `price-map.ts` rows, and the `useProfileBootstrap.ts` comment.
   - Let the compiler list every `CHAIN_IDS.MAINNET` site.
   - Classify each hit of `rg -n '4248422646|1816023401|4248422647|1821665230|Alpha V5'` outside
     archives. Fixtures that only need "some chain" may keep a literal, and tests of Alpha behaviour
     go with the behaviour.
   - `default-tokens.test.ts:17` checks each seed against the bundled class, keeping the
     `getBundledTokenClassId` check. P8 restores the non-empty set equality.
4. `scripts/seed-preflight.ts` and `seed-preflight-metadata.ts`:
   - the V6 URL and ids, no Alpha;
   - exit 1 on any `MISMATCH`, `NOT FOUND` or `ERROR`, and, in the metadata script, on a required
     field with no layout slot, a failed read or a value that does not decode (today it prints
     `no slot` or `read failed` and exits 0, `seed-preflight-metadata.ts:40-56`);
   - an optional second argument, the expected class id, where a different live
     `currentContractClassId` fails.
5. Fix the smoke specs `endpoints.test.ts:199-202` and `backup-roundtrip.test.ts:24-32` for two
   defaults.
6. Draft U7's replacement copy for `onboarding/pages/fees.vue` card 01 from facts checked on the V6
   testnet now, and U6's label if the owner picks a change. Both are final only after the sign-off
   in P5.
7. Run a Vite build before committing, so the tracked auto-import typings drop `MAINNET_*`
   (`lessons.md`).
8. Live, read-only:
   - `node_getNodeInfo` on the seed URL: `nodeVersion 6.0.0-rc.1` and `rollupVersion` equal to the
     pin;
   - from `apps/extension`, `bun run scripts/seed-preflight.ts 0x06a9fa0208c78509921b0487a6b5cd5c2e93baf17de1a18d310f65a3cc1d924b <the class deriveSponsoredFpc gives>`
     exits 0;
   - take one tx hash from a recent V6 block through the node, and open
     `https://testnet.aztecscan.xyz/tx-effects/<hash>`. If it does not resolve, drop the TESTNET
     explorer mapping, which is U5.
9. Capture the arc A screenshots: fresh-install Networks page, header, Home, About, the onboarding
   fees page, and the extension list.

**Validation gate.**
- Commands: `bun run typecheck:all`, `bun run lint`, `bun run test:all`, `bun run test:ci-gating`,
  the smoke recipe on Chrome and on Firefox, and the live checks in step 8.
- Pass: every command exits 0, with the smoke suites at retry 0. The node reports `6.0.0-rc.1` and
  `2914217885`, and the preflight exits 0.
- Layers: lint, types, unit, component, smoke e2e on both browsers, live read-only.

### P5 · Harness, CI and the network suite on V6 (arc A's gate) ✓

1. `global-setup.ts` honours `AZTEC_HOME` (D12). `docker-ci-like.sh` and `setup-aztec` read the new
   key.
2. presto-server 1.1.3, per SECURITY.md "Binary dependencies":
   - download the tarball and check it against the release's `.sha256`;
   - hash the extracted binary;
   - pin version, tarball and binary hashes in one commit;
   - check that the two log literals exist in `presto-v1.1.3`'s source (I5).
3. Release bytes and write-scoped jobs restore no cache (D25, `lessons.md`):
   - `.github/actions/setup-bun/action.yml` takes a `cache` input, default `"true"`, and its
     `actions/cache` step runs only when it is `"true"`;
   - `_build-extension.yml` passes `cache: ${{ github.event_name == 'pull_request' }}`, so release,
     nightly and source-rebuild builds install from the registry against `bun.lock`, and PR builds
     keep the cache;
   - every job in `release.yml` and `nightly.yml` that holds `contents: write` and runs the composite
     passes `cache: "false"`: `auto-unstick` (`release.yml:124`), `attach-assets` (`:309`),
     `sync-main-to-dev` (`:466`) and `publish-nightly` (`nightly.yml:443`). Their install runs the
     lifecycle scripts of Bun's default-trusted packages, Puppeteer's postinstall among them, so a
     poisoned cache would execute inside a job holding a write token or the release App's key;
   - `scripts/ci-cd/behavior-gating.test.ts` pins all three rules.
4. e2e fixtures:
   - `fixtures/aztec.ts`: `FrozenArtifactWallet` against V6's `EmbeddedWallet` provider shape;
     FeeJuice through `@aztec-labs/aztec.js/protocol`; the Standards Token constructor arguments;
   - `selfpay-phase.ts`;
   - `aztec-private-fpc-bridge.ts`: `FeeJuicePortalAbi` from `@aztec-foundation/l1-artifacts`.
5. Re-premise the network specs with the smallest change each:
   - `networks.test.ts`: two defaults;
   - `backup-import-stalled-network.test.ts`: a stalled Testnet beside Local, in place of Alpha. A
     backup carries no networks and a popup import starts from the seeds, so the Testnet seed is the
     only public network an import can restore into; a user-added one cannot exist yet;
   - the canary file comment that names "frozen 5.0.1 account bytecode". Touch
     `canary-expectations.json` only if a title changes.
6. Diff both built manifests against `dev`'s build after normalising content hashes and chunk slugs
   (`aztec-` → `aztec-labs-`). Only the `name` and `version` sources may differ.
7. Local runs with `AZTEC_HOME=~/.cache/aztec-toolchains/6.0.0-rc.1` and
   `NODE_OPTIONS=--dns-result-order=ipv4first`, every one at retry 0 (the network config defaults to
   two retries, `vitest.e2e.network.config.ts:46`). An infra-boot failure (exit 86,
   `scripts/e2e/classify-exit.ts`) may be re-run; a test failure may not.
   - the full network suite, proverless, on both browsers:
     `NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent`, then the same with
     `NULO_E2E_BROWSER=firefox`;
   - both canaries prover-ON on both browsers, with `NULO_E2E_PROVERLESS` unset. Claim the port, and
     start `PRESTO_ALLOW_ALL=1 presto-server` (1.1.3) on `127.0.0.1:59833`. Run
     `NULO_E2E_RETRY=0 VITE_NULO_PRESTO_REQUIRED=1 bun run e2e:agent tests/e2e/network/frozen-account-canary.test.ts tests/e2e/network/passkey-execution-canary.test.ts`,
     then the same with `NULO_E2E_BROWSER=firefox`.
8. Arc A's docs (File-level change map), including `CLAUDE.md`:
   - the scope names;
   - `V6_REGIME`;
   - one sentence recording the one-time exception under § Account-address freeze;
   - the bump rules naming `@aztec-labs/*` and `@aztec-foundation/*`.

   The `aztec-update` skill gets four changes:
   - its compare step moves to `aztec-labs-eng/aztec-node` for `@aztec-labs/*`, and stays on
     `aztec-packages` for `@aztec-foundation/*`;
   - Branch B's PrivateFPC step (`SKILL.md:141`) is corrected: the canonical PrivateFPC is
     initializerless and private-only, so NOT FOUND is its normal state and nothing is redeployed;
     what a release checks is that unleashed's manifest names the address the wallet pins (D7);
   - the pin-surface list gains the four key readers and the recon §7 sites;
   - the hold text goes.
9. Terms 1.0, edited in place (A2, D20): `legal/terms.md`'s default network and its value wording,
   with no manifest bump and no changes list. Its store URLs wait for P9. Check the CRS hosts in the
   bundled bb.js 6; if they moved, `legal/privacy.md` is edited in place too, and the decision page
   shows it. Then `README.md:8`, `BEFORE-LAUNCH.md`, `legal/README.md:31` and `CI.md:223`.
10. Build arc A's decision page: U1, U2, U4, U6, U7, and U5 if the explorer check failed. Every
    option is shown as it will look. Quote the owner's sign-off here.

    **Owner sign-off, 2026-10-01**, picked on the decision page between 09:37Z and 09:39Z and
    confirmed in chat ("ive answered everything on the page"):
    - U2: "Ship it with no default token". As built.
    - U4: "Approve the three passages as written". As built.
    - U5: "Keep linking to Aztecscan". The testnet mapping returns (`c712d5c2`).
    - U6: "Say "Testnet" instead". About reads "Wallet version - X - Testnet" (`d5311f31`).
    - U7: "Use other wording", with the note "Keep the copies as we'd be on Alpha." Card 01 keeps
      dev's text (`222870b3`).
    - As built: "Sign off all of it as built".

**Validation gate (arc A).**
- Commands:
  - `bun install --frozen-lockfile --force`
  - `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`,
    `bun run test:release`, `bun run lint:actions`
  - both extension builds with their notices floor checks, and the playground and landing builds
  - the smoke recipe on Chrome and on Firefox
  - the step 7 runs
  - P1's sweeps without the `*.md` exclusion, plus
    `rg -n '5\.2\.0|5\.0\.1|revision\.3|Alpha V5|nulo-v5|V5_REGIME'` outside archives
- Pass:
  - Every command exits 0, except the sweeps, whose hits are each classified in lessons as history
    or intended.
  - Smoke passes at retry 0 on both browsers.
  - The full proverless network suite is green on both browsers at retry 0.
  - Each canary passes on each browser, and each run's presto log shows at least one
    `Proving succeeded`.
  - The owner's sign-off for arc A is quoted in this plan.
- Layers: all but live.

### P6 · Publish the V6-line packages (after arc A merges) ✓

1. Dispatch the dry run: `gh workflow run publish-packages.yml --ref dev -f version=0.2.0` (a dry run
   by default). Record its head SHA and its `pack` job's digests, and review the staged manifests'
   peers.
2. The owner dispatches the real run (`-f dry_run=false`). Before approving `npm-publish`, the owner
   checks that its `pack` digests equal the dry run's. Any difference means stop and re-review.
   **Done 2026-10-01:** the driver dispatched it on the owner's word ("Regarding the npm run, also:
   can't you do it yourself? Im explicitly authorizing you") and found the digests equal, and the
   owner approved `npm-publish` (`lessons/phase-6.md`).
3. Give the owner the V6 facts for unleashed:
   - the node URL, chainId `2904119610` and rollupVersion;
   - the canonical PrivateFPC (`0x0b3bc795…3c08`, initializerless, so its V6 bridge targets it with
     no deployment, Fact 27) and the SponsoredFPC address;
   - the key's origin policy;
   - the package versions.

   If an unleashed session is listed by `ListAgents`, send them to it with `SendMessage`.

**Validation gate.**
- Commands: `npm view @alejoamiras/nulo-wallet-crypto@0.2.0 peerDependencies`, and the same for the
  other two packages; a scratch `npm install --ignore-scripts` of all three at `0.2.0`, then
  `npm audit signatures`; `scripts/publish/verify-provenance.sh` on each tarball, with its defaults.
- Pass: every peer is an exact `@aztec-labs/*@6.0.0-rc.1`; signatures and provenance verify; the
  published digests equal the dry run's.
- Layers: supply chain.

### P7 · Release 0.29.0 (after arc A merges) ✓

P6 and P7 may run in either order. Neither waits for unleashed (Fact 27, A7).

1. Live, read-only:
   - `node_getNodeInfo`: `nodeVersion 6.0.0-rc.1`, `rollupVersion 2914217885`. Otherwise HOLD (A9).
   - From `apps/extension`, `bun run scripts/seed-preflight.ts 0x06a9fa0208c78509921b0487a6b5cd5c2e93baf17de1a18d310f65a3cc1d924b <the class deriveSponsoredFpc gives>`
     exits 0.
   - The sponsor's public Fee Juice balance, read through the node, is at least 100 FJ. Below that,
     the owner tops it up.
2. The owner's hands-on run (D21), once per browser, on Chrome and Firefox zips built from `dev` (or
   the first nightly prerelease after arc A's merge), on the live V6 testnet:
   - fresh install;
   - create an account;
   - deploy it through Nulo's sponsor;
   - connect the playground (`bun run --cwd apps/playground dev`) and approve one request it makes.

   The token send and the Private Fee Juice payment come with arc C (P8). Record each step and the
   tx hashes in lessons. **Waived by the owner, 2026-10-01:** "regarding (1) I trust the vast amount
   of tests we have." What stands in for it is in `lessons/phase-7.md`.
3. Read `BEFORE-LAUNCH.md` and complete what is due "on every later promote".
4. Open `release: promote dev → main (aztec v6: nulo v6 on the v6 testnet)`; the owner merges it as a
   merge commit. release-please then opens `chore(main): release 0.29.0`. Review its CHANGELOG; the
   owner merges it. Auto-unstick tags `v0.29.0` and the publish chain runs, with no store flags.
   **Done 2026-10-01:** the driver merged #737, #738 and the sync #739 on the owner's word, quoted
   in `lessons/phase-7.md`.
5. After the release:
   - confirm the three assets;
   - the owner merge-commits `chore: sync main → dev`;
   - after `attach-assets`, the owner re-runs the `nulo-landing` production build in the Cloudflare
     dashboard;
   - `curl -s https://nulo.sh` links `releases/tag/v0.29.0`, and `curl -sI https://nulo.sh` returns
     every header in `apps/landing/public/_headers`. This closes follow-up P1.
6. The owner retires the V5 dRPC key (A5).
   **Not tracked, 2026-10-01:** unconfirmed at close-out, and the owner dropped it from the
   follow-ups, quoted in `lessons/phase-7.md`.

**Validation gate.**
- Commands: step 1's checks, `gh release view v0.29.0 --json assets -q '[.assets[].name]'`,
  `gh run view <id>` for the publish run, and the landing checks.
- Pass: the node, the sponsor preflight and the floor are as stated; each browser's hands-on run has
  every step passing, with the tx hashes in lessons (waived by the owner, step 2); both zips and
  `SHASUMS256.txt` are attached;
  the publish run is green; nulo.sh links `v0.29.0`.
- Layers: live, release.

### P8 · Arc C: unleashed's V6 generation (when it lands), moved to follow-ups

Entry: unleashed's testnet manifest names its V6 generation (`walletChainId 2904119610`). This is not
a 0.29.0 prerequisite. If it has not landed by P10, this phase moves to follow-ups with these steps
as its spec.

1. The manifest's PrivateFPC address equals the one `protocol-fpcs.test.ts` pins. A different address
   goes to the owner before anything else: Fee Juice bridged to one address cannot pay through the
   other.
2. The Test USDC seed. Add the Testnet seed to `default-tokens.ts` and `price-map.ts`. Its pins come
   from `seed-preflight.ts` and `seed-preflight-metadata.ts` against the live node: class, symbol,
   name, decimals. `default-tokens.test.ts` returns to the non-empty set equality: the bundled
   Standards rc.1 Token class equals the seed's live class. If it is red: HOLD, owner (I10).
   - If the price map's placeholder Testnet row goes, `tests/e2e/helpers/activity-seeds.ts` moves
     to the seed's contract in the same commit: the smoke rows price through that row.
   - Artifact-mode smoke has no dRPC block (P4 lessons), so with a shipped seed each of its profiles
     calls dRPC. Decide whether that is acceptable before the release smoke runs it.
     **Decided 2026-10-01: accepted** (`lessons/phase-8.md` § Step 2). It is the one run of the
     shipped list against the live chain before a release, at about 2,000 more requests a run on
     the owner's public key. Home's rows spec waits for the token list to settle.
3. `FEE_JUICE_BRIDGE_URL` (`fee-helpers.ts:302-303`) opens unleashed's V6 app. If unleashed's V6 app
   lives elsewhere, the new URL is a UI change the owner signs off in step 5.
4. The owner's hands-on run, once per browser, on zips built from the arc C tip: get Test USDC from
   unleashed and send it; bridge Fee Juice through unleashed's V6 app and pay once with Private Fee
   Juice. Record each step and the tx hashes in lessons.
5. The owner signs off U2's resolution (the token row), U5 if it is still open, and the bridge URL
   if it moved.
   **Signed off 2026-10-02.** The owner in chat: "Signed-off details." Their sign-off page records
   call 3, token prices: "b", and the tokens sign-off: approved, with no note. That covers the
   four seeded rows on Home and Holdings as pictured, in the order shown; their ongoing cost as the
   page stated it (about 66 calls a minute per unlocked wallet with four seeds, against about 19
   with Test USDC alone), with all four seeds kept; and option B: Test USDT priced as `tether` and
   Test EURC as `euro-coin`, both in the 0.20 to 5 band, Test GBPC unpriced, Test USDC as
   `usd-coin`. The bridge URL was signed off on 2026-10-01. U5 was answered in arc A ("Keep linking
   to Aztecscan").

**Validation gate.**
- Commands: `bun run test:all`, `bun run lint`, `bun run typecheck:all`, the smoke recipe on Chrome
  and on Firefox, step 1's comparison, and the hands-on results in lessons.
- Pass: every command exits 0; the addresses match; each browser's hands-on run has every step
  passing, with the tx hashes recorded; the owner's sign-off is quoted here.
- Layers: unit, smoke e2e, live.

### P9 · Store upload (optional, on the owner's call), moved to follow-ups

Ran from follow-ups on 2026-10-02; the record is `lessons/phase-9.md`.

Entry: the owner calls it, after 0.29.0 or a later release (D27). If it is not called by P10, this
phase moves to follow-ups with these steps as its spec. A6's dashboard steps stand either way.

1. Store art: the tile wordmark "NULO V6" and the frame title. Regenerate the PNGs as the e2e README
   says: `bun run build:chrome`, then
   `STORE_CAPTURES=1 NULO_E2E_ARTIFACT_RUN=1 EXTENSION_PATH=<worktree>/apps/extension/dist/chrome bun run --cwd apps/extension test:e2e -- tests/e2e/store-captures.test.ts`,
   then `bun apps/extension/scripts/store-art.ts`.
2. `store/listing.md`:
   - reviewer notes: testnet by default; how to get test funds;
   - the patch and alias claims, re-checked against the released build.

   `store/remote-code.md`: re-read all 8 citations against the 6.0.0-rc.1 sources, not just their
   line counts.
3. The Terms' store URLs, edited in place (A2): Chrome
   `https://chromewebstore.google.com/detail/jlmiaokmjoicmclelpiiocdhncddkdmc`; AMO the `nulo-v6`
   slug.
4. The in-place update check, once, in Firefox (the browser the one V5 install is on), with zips
   built from the release tag with its version in `apps/extension/package.json`. A build stamped
   0.28.0 would let the coordinator skip re-derivation (Fact 26), so it would not show what an update
   does.
   - Load the unpacked v0.28.0 release zip as a temporary add-on in a scratch profile. Create a
     profile and an account, and leave it unlocked.
   - Replace its files with the new Firefox build and reload. Record whether the session came back
     unlocked or locked, the screen shown and the active network row.
   - Lock, unlock, and record the screen again.
   - Record whether Settings' reset leads to a fresh V6 profile.

   A crash loop or an unreachable reset goes to the owner: a fix before the upload, or a release note
   telling V5 installs to reset.
5. Build the store decision page (U3) with every picture on it, and quote the owner's sign-off here.
   After its codex loop, open `docs(store): nulo v6 listing and art for the v6 testnet` off `dev`.
6. Just before the upload, re-run P7 step 1's checks, then
   `gh workflow run store-check.yml --ref main -f store=both` → green.
7. The owner, in the dashboards:
   - Chrome: the listing's description, tile and screenshots;
   - AMO: the add-on renamed "Nulo V6", the slug set to `nulo-v6`, the listing text and screenshots
     pasted, and the listing made visible again.
8. The owner dispatches
   `gh workflow run release.yml --ref main -f tag=v<release> -f dry_run=false -f publish_chrome=true -f publish_firefox=true`
   and approves both environments. If `publish-firefox-amo` fails after `version ok`, never rerun it;
   follow the runbook.

**Validation gate.**
- Commands: `bun run lint`, `bun run test:all`, `bun run test:ci-gating`,
  `bun run --cwd apps/landing build`, the capture run in step 1, the smoke recipe on Chrome and on
  Firefox, `git grep -n -i -E 'nulo v5|nulo-v5|alpha v5'` outside archives and `CHANGELOG.md`,
  `store-check`, and `gh run view <id>` for the publish run.
- Pass:
  - Every command exits 0, except the grep, whose hits are each classified. The V5 regime record,
    `EXPECTED_REGIMES` and the V5 refusal tests keep their `nulo-v5`.
  - The in-place result is recorded for both session states.
  - Both publish jobs are green, and the owner confirms both dashboards show the release submitted.
  - The owner's sign-off is quoted here.
- Layers: lint, unit, smoke e2e on both browsers (captures included), landing build, live, release.

### P10 · Close-out ✓

A docs-only PR off `dev`, after 0.29.0's sync, and after P8 and P9 if they ran (D19):
1. The `## Outcome` block, after the front matter.
2. Promote lessons into `lessons.md` within its budget. Retire or re-verify the two entries tagged
   5.2.0 (node-client retry semantics, the fee-juice import weight).
3. Move the Follow-ups into `follow-ups.md`, with P8 and P9 among them if they did not run, each
   pointing at its steps here. Delete its P1 entry if P7's landing checks passed. Rewrite "The gas
   link and USDC on mainnet": the mainnet USDC seed is gone with Alpha.
4. The index line reads "closed, awaiting archive". If the archive split has landed
   (`implementations-plan/archive/index.md` exists), `git mv` this folder there in its own commit,
   repair the links, and move the line to `archive/index.md`.

**Validation gate.**
- Commands: `bun run test:ci-gating` (the plan-tree gate), `bun run lint`.
- Pass: both exit 0, and `lessons.md` is at most 8,192 bytes.
- Layers: docs.

## Post-implementation (read by the implementing session)

`code_review` is `off`: `/code-review` is not run at any point.

**Per-arc codex loop.** At each arc boundary (after P5's gate, and after P8's and P9's if they run),
before that arc's PR opens:
1. Send `/codex high` the arc's diff, this plan and its Decision ledger, and the arc map: "A is the
   line, regime, cutover and Terms; C is unleashed's V6 token and bridge link; the store arc is the
   listing, the art and the in-place check". Add the adversarial ask: what could go wrong, what an
   attacker would target, what we trust that we shouldn't, and where the supply-chain, crypto and
   least-privilege weaknesses are. Add these two rules verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
     extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
     problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or spends
     a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. Triage the findings. Verify codex's factual claims against the tree first, since it can misread
   code. Apply the accepted fixes and commit them.
3. Log the round in `lessons/phase-N.md`, then resume the same codex session with the fix diff.
4. Repeat until a round yields nothing material. If findings are still material after 3 rounds,
   stop and surface it.

**Final cross-arc pass.** Only if arc C or the store arc runs: after the later one's loop and before
its PR, a fresh codex session over `910a4def..<that arc's tip>` asks for seams between arcs,
duplication across arcs and drift from this plan, with the same two rules and the same loop.

**Delivery.** Follow the Delivery section. A PR opens only after its arc's loop has converged. Add
labels after opening, never with `gh pr create --label`.

**Closing.** P10 is the close-out, written out above. The Outcome carries:
- the date and final status;
- what shipped, with PR numbers, the release, and the store submissions if P9 ran;
- what was dropped or moved to follow-ups, and why;
- one line retiring this plan's `/goal` and `/loop` seeds.

Merging is always the owner's call. The loop never merges, never dispatches a publishing run,
never enables or disables a workflow, and never touches a store dashboard or branch protection.

## Delivery

| Arc | Phases | Branch | Base | code_review | PR |
|---|---|---|---|---|---|
| A · line, regime, cutover and Terms | P1–P5 | `worktree-nulo-v6` | `dev` | off | `feat(aztec): move the wallet to aztec 6.0.0-rc.1 and the v6 testnet as nulo v6`, labelled `e2e:extension-network` and `e2e:extension-smoke` after opening; carries U1, U2, U4, U6, U7 (and U5 if open) with screenshots and the owner's quoted sign-off |
| publish | P6 | — | arc A merged | — | none (the owner dispatches the real run) |
| release 0.29.0 | P7 | — | arc A merged | — | the promote and release PRs of the runbook |
| C · unleashed's V6 token | P8 | `nulo-v6-token` | `dev`, once unleashed's V6 manifest exists | off | `feat(tokens): seed the v6 test usdc on testnet`; U2's resolution, and the bridge URL if it moved |
| store (optional) | P9 | `nulo-v6-store` | `dev`, on the owner's call | off | `docs(store): nulo v6 listing and art for the v6 testnet`; U3 |
| close-out | P10 | `nulo-v6-close-out` | `dev` after 0.29.0's sync | — | `docs(plans): close nulo-v6` (D19) |

Each PR title fits the 93-character budget. There is no stack: every later arc branches off `dev`
after arc A merges. Arc C and the store arc both edit this plan and its lessons, so if they overlap,
the second rebases on the first once it merges.

## Seeds

Recommended: `/loop`, because completion waits on events a turn cannot observe: the owner's merges,
dispatches and dashboard steps, npm, unleashed, and the stores.

```
/loop 15m Drive implementations-plan/nulo-v6 forward from inside .claude/worktrees/nulo-v6. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/nulo-v6/plan.md (phase headers, Outcome & Quality Bar, Decision ledger, the Asks with my recorded answers) and lessons/ — they are authoritative, not the chat. Read them from the branch of the arc in progress; after arc A merges, that is a branch off `dev`, or `dev` itself between arcs. If plan.md carries an ## Outcome, finish or babysit the close-out per its Post-implementation section and stop when it is merged. Otherwise rebuild the task list from plan.md if empty; run `git status` and `git log --oneline -5`; for open PRs, `gh pr view --json statusCheckRollup` (no --watch).
2. External gates are normal here: my merge of each PR, my dispatch of the npm real run (P6), my steps in the release (P7), unleashed's V6 generation (P8), my call on the store upload and my dashboard steps (P9). Re-check the gate each firing (`gh pr view`); while it blocks, take the next step plan.md allows. Steps of later phases may proceed, but phase gates go green strictly in order, with no permitted failures; only P8 and P9 may instead move to follow-ups at P10.
3. Every live check asserts nodeVersion 6.0.0-rc.1 and rollupVersion 2914217885. Any other value is a HOLD: stop and surface it with the probe output (A9).
4. No task in hand? Take the next pending step in plan.md. After each meaningful edit run the fast layers for what you touched (`bun run lint`, `bun run typecheck:all`, `bun run --cwd <package> test`), commit signed, push the arc branch.
5. Stuck, or facing a decision you would bring to me? Consult `/codex high` with full context, agree a defensible path, log it in lessons/phase-N.md, act. Hard limits: never merge; never dispatch a publishing run (the npm real run, the store run); never enable or disable a workflow; never touch a store dashboard or branch protection; never add a min-age exclude beyond the four in plan.md; never edit NULO_KDF_SPEC, and never edit a regime entry outside P1 step 1 and P2; never re-pin a PrivateFPC, SponsoredFPC or seed literal outside the phase that owns it; UI calls are mine, never codex's. If a step needs one of these, surface it and hold.
6. Same step failed 5 times? Stop and reassess with codex.
7. Phase green means its Validation gate in plan.md passes as written: paste the result, mark ✓ in plan.md, write lessons, print LESSONS_FILE=implementations-plan/nulo-v6/lessons/phase-N.md, run `agent-worktree status nulo-v6 "phase N green: <next>"`. At an arc boundary (P5; P8 and P9 if they run) run the arc's codex loop from Post-implementation until a round yields nothing material, then open that arc's PR per Delivery, then continue.
8. After P7, do P8 if unleashed's V6 generation exists and P9 if I called it; otherwise go to P10, which moves them to follow-ups. After P10, report: what shipped, each contentious call codex and I settled with its context, open items. Stop there: merging is mine.
```

Alternative: `/goal`. Use exactly one per session; they do not compose.

```
/goal Every phase header P1–P7 and P10 in implementations-plan/nulo-v6/plan.md is marked ✓, and P8 and P9 are each marked ✓ or listed in implementations-plan/follow-ups.md with their steps as the spec; each ✓ is backed by its Validation gate reported passing in the transcript and a printed LESSONS_FILE=implementations-plan/nulo-v6/lessons/phase-N.md; code_review is off, so /code-review was not run; the codex loop converged for arc A, for arc C and the store arc if they ran, and for the final cross-arc pass if either ran, each shown by a resumed codex pass reporting no new material findings quoted in the transcript; every PR in plan.md's Delivery section for an arc that ran exists and was opened only after its loop converged (`gh pr view` output in the transcript); `gh release view v0.29.0` lists both zips and SHASUMS256.txt (output in the transcript); the close-out PR carries the Outcome and the index line; `bun run test:all` and `bun run lint` exit 0 in the transcript.
```

ELI5 Artifact: https://claude.ai/artifact/KCGp7wdDUT7wJf3ziwU7fm, published from
`implementations-plan/nulo-v6/eli5.html` (gitignored). Republishing that file keeps the URL.
