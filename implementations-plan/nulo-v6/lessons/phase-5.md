# Phase 5 · Harness, CI and the network suite on V6

## Steps 1–3 · The toolchain home, presto-server 1.1.3 and the cache rules (2026-10-01)

- **`AZTEC_HOME`.** `global-setup.ts` looked for the pinned toolchain under `$HOME/.aztec` only. On
  a machine other agents share, installing a new line there re-points their `current`, and
  foundryup refuses to run beside a live anvil. The setup now reads `AZTEC_HOME`, the variable the
  Aztec installer already honours, defaults to `~/.aztec`, and names the resolved directory in its
  errors. The local runs use `~/.cache/aztec-toolchains/6.0.0-rc.1`.
- **presto-server 1.1.3**, from the `presto-v1.1.3` release assets:
  - tarball sha256 `90b76733…c07c41`, equal to the release's `.sha256` sidecar, one regular member;
  - extracted binary sha256 `9e183fa9…baef21`;
  - the two log lines the canary step counts sit at `prove.rs:283` and `:475` at that tag (I5).
  1.1.2 was never checked against the rc.1 bb; 1.1.3 is the release Presto's own V6 proof ran on.
- **D25.** The setup-bun composite takes a `cache` input. `_build-extension.yml` restores the shared
  cache on pull requests only, and `auto-unstick`, `attach-assets`, `sync-main-to-dev` and
  `publish-nightly` pass `cache: "false"`. `behavior-gating.test.ts` pins the three rules; its last
  assertion requires the scan to have found at least one write-scoped job, so a renamed job cannot
  make it pass vacuously. `behavior-gating.test.ts` sits outside Biome's `files.includes`, so it
  keeps its own two-space style.

## Step 4 · e2e fixtures on rc.1

- `FrozenArtifactWallet` against V6's `EmbeddedWallet` provider shape, FeeJuice through
  `@aztec-labs/aztec.js/protocol`, the Standards Token constructor arguments, `selfpay-phase.ts` and
  `FeeJuicePortalAbi` from `@aztec-foundation/l1-artifacts` all held on rc.1 with no edit beyond P1's
  scope codemod.
- **A dead guard.** A `tsc` probe over `tests/e2e` reports 415 errors. All but one are typing noise
  the suite already carried (fixture-context properties, implicit `any`, viem's `Chain` shape, the
  logger type). The one that matters is `fixtures/aztec.ts:222` (TS2367): rc.1's `simulate()`
  answers `SimulationResult` (`{ result, … }`), so `mintPublicTokens`' `balance === 0n` can never
  fire, and its log prints an object. The file already has `unwrapSimulated` for exactly this. The
  fix was held until the Chrome run ended, because 28 network specs mint through that helper and a
  fixture must not change under a running suite.

## Step 5 · The network specs re-premised

- `networks.test.ts` lists the two defaults.
- `backup-import-stalled-network.test.ts` stalls the Testnet seed beside Local, in place of Alpha.
  The plan first asked for a user-added network, which cannot work: a backup carries no networks and
  a popup import starts from the seeds, so the seed is the only public network an import can restore
  into. The plan's step 5 records the change.
- Comments that named Alpha or the 5.0.1 bytecode describe their case without a version.
  `canary-expectations.json` is unchanged, since no title moved.

## Step 6 · Manifests against `dev`

- Both built manifests, normalised for content hashes and the `aztec-` → `aztec-labs-` chunk slugs,
  differ from `dev`'s build in `name` only. `version` is still `0.28.0` on both sides, so it shows
  no difference until release-please bumps it.

## Step 7 · The local network runs at retry 0

- **Chrome, proverless, full suite** (`AZTEC_HOME` on the rc.1 toolchain cache,
  `NODE_OPTIONS=--dns-result-order=ipv4first`, `NULO_E2E_PROVERLESS=1`, `NULO_E2E_RETRY=0`): built
  and run at `feef31af`, 04:53Z to 06:08Z, exit 0. 108 files: 105 passed, 3 skipped; 165 tests:
  160 passed, 5 skipped, 0 failed. Every skip is gated by design and gated the same way in CI:
  two Firefox-only specs (`firefox-background-restart`, the window-refocus case of
  `window-placement`), and three opt-in flags no workflow sets (`NULO_E2E_STANDARD_CONTRACTS` for
  `tx-sendTx-delegated-authwit`, `NULO_E2E_REORG` for `stale-anchor-recovery`, the warm-up probe's
  own flag). The commits after `feef31af` touch docs, the preflight scripts, two additive runtime
  exports and the mint guard below; the Firefox run covers all of them.
- **The mint guard went live after the Chrome run** (`10aa5acc`): `mintPublicTokens` and
  `transferPublicTokens` unwrap the `SimulationResult` before reading the balance. rc.1's `send()`
  waits for the `CHECKPOINTED` receipt by default (`aztec.js` `utils/node.js`, timeout 300 s), as
  5.2.0's did, so the follow-up public read sees the mint and the guard fires only on a mint that
  really failed. The e2e type probe loses its TS2367 and gains no error.
- **Firefox, proverless, full suite**, same settings: built and run at `10aa5acc`, 06:10Z to 07:38Z,
  exit 0. 108 files: 104 passed, 4 skipped; 165 tests: 156 passed, 9 skipped, 0 failed. The skips
  are the same three opt-in flags, the two whole files on the `CHROME_ONLY` list
  (`backup-import-stalled-network`, the hanging request; `backup-restore-sw-restart`, the
  background killed under an open page) and `cap-window`'s reduced-motion case, which BiDi cannot
  emulate. The Firefox-only specs ran and passed. The live mint guard checked 77 mints, each with a
  real balance, and fired on none.
- **The first Chrome canary run failed on infrastructure, not execution** (07:38Z, `10aa5acc`).
  Both canaries stopped at their first real-proof transaction (`grantPublicAuthwit`: "The wallet
  could not process the request."). presto-server had no bb for rc.1 and could not fetch one:
  `Failed to download bb version=6.0.0-rc.1 error=Cannot verify bb v6.0.0-rc.1: digest fetch
  failed: GitHub API returned 403 Forbidden (anonymous GitHub API calls are capped at 60/hour per
  address — set GITHUB_TOKEN)`. The host's anonymous budget stood at 0 of 60 until 07:57:24Z;
  the address is shared, so who spent it is unknown. Two prove requests, no proof; the required-mode
  build refused the WASM fallback, as it must. CI never meets this: `_extension-network-e2e.yml`
  hands presto-server the workflow token (`PRESTO_GITHUB_API_TOKEN`) for exactly this lookup.
  - The rerun gives presto-server a private `PRESTO_HOME` on real disk (its own warning: a second
    instance must not share the default version cache) and, before any test, waits for the budget
    and sends one dummy prove carrying only `x-aztec-version`, so bb is downloaded and verified
    once. A failed warm-up exits before the suite, so an infrastructure miss cannot read as a
    canary result. No personal token was handed to the server: that would be a keyed run.
  - `presto-server --help` ignores the flag and starts serving on 59833; it was stopped at once.
  - Every run, the green ones included, logs `[aztec-node] Error: Address already in use` while
    the node still comes up; it is noise.
- **Chrome canaries, prover-ON** (rerun, `10aa5acc`, 07:47Z to 08:01Z, exit 0). The warm-up found
  60 of 60 at 07:57:38Z and fetched `barretenberg-amd64-linux.tar.gz` for v6.0.0-rc.1 (9,320,781
  bytes, digest `a03fae96…7b0e`, "Download integrity verified", "bb cached successfully"); its
  dummy body then made bb abort, as expected (HTTP 500). Both canaries passed: the frozen-account
  canary in 75 s, the passkey canary in 67 s. presto-server logged 6 real prove requests and 6
  `Proving succeeded`.
- **Firefox canaries, prover-ON** (`10aa5acc`, 08:03Z to 08:07Z, exit 0). The first attempt stopped
  at the warm-up (exit 93, before any test): its check expected "Download complete" or a cached
  message, and a cache hit logs neither. It goes straight from "Requested Aztec version" to
  "Starting bb prove", which is now the readiness check. The rerun proved from the bb the Chrome
  run cached, without touching the API budget (57 of 60). Both canaries passed: the frozen-account
  canary in 76 s, the passkey canary in 85 s, 6 real prove requests and 6 `Proving succeeded`. The
  run left no process group and no registry row.

## Step 8 · Docs and the sweeps

- The runbooks, the dependency policy and the package READMEs name both scopes. The npm READMEs
  (`scripts/publish/`) now say `@aztec-labs/*` peers, which is what `stage.ts` derives from the
  workspace pins. They ship with `0.2.0` in P6: `0.1.0` is already on npm, and `approved-digests.json`
  binds only that version, so no recorded digest moves.
- **P1's survivor sweeps without the `*.md` exclusion**: seven hits, the same six P1 classified plus
  one Markdown line:
  - `packages/aztec-runtime/src/account/artifacts/PROVENANCE.md:20`: history (the previous regime's
    bytes);
  - the versioned citations in `batched-view-simulation.ts` (two) and `pxe/service.ts`: history;
  - `address-freeze.ts:65`: intended (a line of the frozen `NULO_KDF_SPEC`, which never changes);
  - `@aztec/l1-contracts` in `third-party-notices/src/policy.ts` and `expected-minimum.txt`:
    intended (the name rc.1's nested manifest declares).
- **The V5-literal sweep** (`5\.2\.0|5\.0\.1|revision\.3|Alpha V5|nulo-v5|V5_REGIME`, outside
  archives): 1,307 hits in 261 files.
  - `implementations-plan/**` and `audit/**`: history (plans and audits record their own dates).
    `nulo-v6`'s own plan, recon and lessons: intended.
  - `CHANGELOG.md`: history.
  - `bun.lock` (35) and `reference/nulo-v6/bun.lock` (16): intended. Every hit is a third-party
    version (`ansi-styles@5.2.0`, `vue-router@5.2.0`, `eventemitter3@5.0.1`, …); no `@aztec*` name.
  - False positives: `manifest.config.ts:8` (`0.15.0-rc.1` → `0.15.0.1`) and
    `scripts/dup-trend/report.ts:14` (`JSCPD_VERSION = "5.0.16"`).
  - The regime record and its pins: `address-freeze.ts`, `address-freeze.test.ts`,
    `account-export.test.ts` (a V5 export that must be refused), `blocked-repository.test.ts`,
    `backup-migration-registry.test.ts` and `useFullBackupImport.test.ts:687` (epoch 4 refused):
    intended.
  - Versioned provenance and bug citations: `key-vectors.test.ts`, `derivation-vectors.test.ts`,
    `account-seed-vectors.test.ts`, `account-derivation{,.test}.ts`, `nulo-separators{,.test}.ts`,
    `descriptors{,-real-artifact.test}.ts`, `opfs-store{,.test}.ts`, `execution/service.ts:952`,
    `register-contract-void-conformance.test.ts`, `transfer-executor.test.ts:235`,
    `useFullBackupImport.test.ts:601,620`, `chain-ids.ts:8`, `fixtures/aztec.ts:79,162`,
    `contracts-register.test.ts:58`, `UPDATE.md`'s 5.0.1 and 5.2.0 sections, the aztec-update skill's
    worked examples, and `legal/README.md:58`: history. The separators' claim that `DomainSeparator`
    is upstream's one separator namespace still holds: `@aztec-labs/constants@6.0.0-rc.1` exports
    no other separator enum, and the non-collision test reads the installed enum.
  - Fixture strings: `"Alpha V5"` as an arbitrary network name in eight unit-test files, and
    `"5.2.0"` as a Presto status fixture in five. The tests pass the value they check, so the
    strings carry no claim about the current line: intended.
  - `price-map.ts:36` and `tests/e2e/helpers/activity-seeds.ts:11`: intended (P4's one price row is
    Alpha V5's cUSD address on purpose).
  - `BEFORE-LAUNCH.md:52`, `legal/README.md:31` and `legal/terms.md:33-34`: intended. The Terms'
    store URLs keep the `nulo-v5` AMO slug until P9 moves it; the Chrome URL resolves by item id.

## Step 9 · Terms 1.0 in place

- Three passages changed: the summary box, § 3's acceptance paragraph and § 5's opening. No version
  bump, no changes list, so no re-acceptance sheet (A2). `@nulo/legal`'s tests stay green.
- The bundled bb.js 6.0.0-rc.1 keeps `crs.aztec-cdn.foundation` as its primary CRS host and
  `crs.aztec-labs.com` as the fallback, so `legal/privacy.md` needs no edit.
- `README.md:8`, `BEFORE-LAUNCH.md` § 2, `legal/README.md:31` and `CI.md:223` follow.

## Step 10 · The decision page

- **U1 needed no call.** The header pill's square is the connection status (`Header.vue`
  `.status_dot`: `--green` when active), the same on every network, and `getChainColor` has no
  caller, so no surface draws a per-network colour. The plan's premise (Testnet's "neutral-mint"
  versus Alpha's green) came from that dead mapping. The pill changes its label only, and U1 joins
  the "sign off as built" row.
- The page carries U2, U4, U5, U6 and U7, each option shown as a capture from the arc A build or a
  mock built from the screen's own styles (U5's transaction screen, U6's About text), plus the
  as-built row. A build would have overwritten the `dist` the running suite uses, so the
  alternatives are mocks rather than captures.
- The owner's answers are quoted in the plan, under P5.

## Validation gate (2026-10-01)

The whole gate, in order, at `10aa5acc` after the step 7 runs (a partial pass on `e1f00915`, run
while the Chrome suite ran, agreed):

- `bun install --frozen-lockfile --force`, `bun run lint`, `bun run typecheck:all` and
  `bun run lint:actions`: exit 0.
- `bun run test:all`: exit 0. `@nulo/extension` 8,604 passed, 4 skipped and 7 todo;
  `@nulo/aztec-runtime` 259 passed and 2 skipped; the other ten workspaces 1,703 passed.
- `bun run test:ci-gating`: 247 pass, 2 skip.
- `bun run test:release`: three `zip-reproducible` cases fail on this host, which has no `zip`, as
  in P1. With Info-ZIP 3.0 (`zip_3.0-13ubuntu0.2`, extracted into scratch and on `PATH` for that
  one command): 162 pass, 6 skip, 0 fail, exit 0.
- `build:chrome` and `build:firefox`, each followed by its notices floor (`check-minimum.ts`): 37
  of 37 expected components. The playground and landing builds: exit 0.
- The smoke recipe at retry 0. Chrome: 40 files passed and 3 skipped, 166 tests passed and 7
  skipped, the same as P4's green run. Firefox: 41 files passed and 2 skipped, 162 tests passed
  and 11 skipped, also the same as P4's.
- The sweeps, re-run on this tree: the same files and counts as Step 8 classified, apart from 11
  new hits in this plan's own files.
- Step 7's four runs, above.

## Arc A codex loop

### Round 1 (2026-10-01, `/codex high`, read-only, at `e1f00915`)

Verdict: two preflight issues, and no wallet-runtime blocker found by static inspection.

- **Accepted (medium): the seed preflight could pass a node on another Aztec version or chain
  pair.** It printed `nodeVersion` without checking it, and it compared only the composite chain
  id, `l1ChainId XOR rollupVersion`, which survives the same bit flipped in both. The new
  `seed-preflight-node.ts` compares the node version with the extension's `@aztec-labs/pxe` pin,
  and the L1 chain id and rollup version with `TESTNET_L1_CHAIN_ID` and `TESTNET_ROLLUP_VERSION`,
  each on its own. Both preflights stop before any contract read on a mismatch (`196a29e6`). Live
  on the Testnet: `6.0.0-rc.1`, `11155111`, `2914217885`, OK, and the SponsoredFPC's class id
  matches its pin.
- **Accepted (low), and wider than reported: a failed preflight printed the keyed endpoint.** Codex
  pointed at the raw error messages, but scrubbing them was not enough. Upstream's `retry()` logs
  `Error while retrying JsonRpcClient request to <URL>` at error level on every failed attempt,
  with the full path, before the script's own catch runs. The preflights now build their node
  client on `makeFetch([], false)`, which never retries, and pass every error line through
  `scrubUrls`; the metadata script's first RPC sits inside the same guard. Against
  `http://127.0.0.1:9/FAKEKEY-not-a-secret`, both scripts exit 1 and print the key zero times.
  - The wallet is not exposed the same way. `makeFetchWithTimeout` also calls upstream's `retry()`
    with its default logger, but every line that reaches the log buffer goes through `trim`, which
    scrubs each leaf string (`LoggerStore.logWithContext`). The scripts print to stdout, outside
    that path.
- **Accepted (low): two comments** (`95a9fea9`). The PrivateFPC pin no longer says to fix a red run
  "against the deployed contract": an initializerless, private-only contract has no deployment, so
  it says to review the new artifact. The account-seed KAT header no longer cites an audit round.
- **Rejected (low): move the carve-out history out of `address-freeze.ts`'s rules comment.** Arc A
  only re-wrapped those lines (`bdb6ae0de` added the store-published clause and the V6 binding).
  The passage records the two owner-ratified uses of the carve-out the rule allows, and the rules
  text changes only in a deliberate, reviewed commit of its own, not inside a version bump.
- Nothing to change, per codex, in the build wiring, the ABI handling, the regime hashes, the
  backup-restore isolation or the delivery pins.

### Round 2 (resumed, on `95a9fea9`)

- **Accepted (low): turning retries off did not keep the key out at debug level.** Upstream's
  `defaultFetch` logs `JsonRpcClient.fetch <URL>` at debug before every request, a success
  included, and its JSON-RPC client echoes a failed request's error, whose message embeds the host,
  at the same level. The preflights now use the runtime's `makeSingleAttemptFetch` (no logging,
  60 s per request), exported from `@nulo/aztec-runtime/utils`, wrapped so its errors carry only
  the origin (`18ac5701`). With `LOG_LEVEL=debug`, a failing fake keyed URL prints no path in
  either script, and a live run prints none and passes.
- Codex confirmed the wallet-side claim: pino captures the console functions when it builds its
  logger, and the sniffer installs before any logger in the worker, offscreen and popup entries,
  so upstream's lines reach `LoggerStore` and its scrub. It noted one existing caveat outside the
  arc: the sniffer's exception fallback prints raw arguments to the console
  (`console-sniffer.ts:29`), never into the exported log.
- Codex accepted the rejection.

### Round 3 (resumed, on `18ac5701`): converged

- Codex confirmed the transport fix: the client never branches on `NoRetryError`, and successful
  replies, headers and batching pass through unchanged. "No other material Arc A issue emerged."
- **Accepted (low, conditional): the JSON-RPC client logs reply bodies itself**, a failed call's
  reply at debug and a malformed batch at warn, so a gateway that echoes its request URL would
  print the key. Codex flagged it as a static path, not evidence that dRPC does this. The fix
  reuses the wallet's silent single read: `createSafeJsonRpcClient` over the node schema with the
  single-attempt fetch and `SILENT_RPC_LOG`, now exported from `@nulo/aztec-runtime/adapters`
  (`2e6afbe6`). Checked against a local node that echoes the full request URL in a 200 error reply
  and in a malformed one, at debug: the previous client printed the fake key 2 and 3 times, both
  preflights 0. The live preflight still passes, and the metadata script reads block and storage
  through the new client.
- The loop stops here: three rounds, one medium and five low findings accepted and one low
  rejected, all in the dev preflights or comments, nothing in the wallet runtime. The last fix was
  verified locally rather than in a fourth round, per the plan's three-round cap.
