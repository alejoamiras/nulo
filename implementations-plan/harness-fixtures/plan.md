# harness-fixtures — round 3, plan 1 (BL/E; PR-b at mid rigor)

Scope row: [complexity-residue-round-3/scope.md](../complexity-residue-round-3/scope.md) §1.
Six `noExcessiveCognitiveComplexity` directives in the e2e harness, all REFACTOR on merit
(dedups and a stage split), manifest 49 → 43 over two PRs. `eli5_mode: none` (owner is AFK;
recon: 0 agents, self-read; code-review: codex per PR).

## Goal

Two squash-merged PRs into dev. PR-a removes five directives by deduplicating harness code and
exposing the scenario in three tests; PR-b turns the 400-line `setup` into a stage coordinator.
Behavior-preserving throughout: every wait, probe order, kill order, log line and `provide`
call stays; the only things that change are where the code lives and how many copies exist.

## PR-a — dedups + seams (49 → 44)

1. **`fixtures/helpers.ts` — one storage join.** New in-page reader `readStorageValuesByPrefix`
   (evaluated with `{ prefixes }`, returns the raw string values per prefix — no parsing, no
   outer references) and Node-side `parseJsonRow<T>(raw): T | null` (try/catch → null, the
   existing hostile-input discipline), `tokenIdsForContract(tokenRows, contract)`,
   `scopedBalanceRows(balanceRows, account, tokenIds)`. `captureBalanceBaseline` =
   `max(updatedAt)` over `scopedBalanceRows(...)`; `waitForFreshBalanceRow.readRows` = the same
   rows. Predicate parity: `row.account === acct && typeof row.token === "number" &&
   tokenIds.has(row.token)`; token match `typeof row.id === "number" &&
   row.contract?.toLowerCase() === contract.toLowerCase()`; `updatedAt` counted only when a number.
   The diagnostic `grab(...)` scan near 1469 switches to the same reader only if its output stays
   byte-identical; otherwise untouched.
2. **`network/account-switch-isolation.test.ts`** — the inline triple evaluate → the file's own
   `resolveActiveTriple(page)`; the held-drive loop → `driveScanUntilHeld(page, txHash)`
   (40 × refresh, 15 × 300 ms status polls, same early exits, returns `boolean`); the record poll →
   `pollIncomingRecordByHash(page, txHash, 25, 200)`. Assertions and console lines unchanged.
3. **`import-dead-rpc.test.ts`** — `planBatchReplies(body, answer)` (pure, test-local):
   `{ kind: "unparsed" } | { kind: "blackhole", methods } | { kind: "replies", methods, payload }`
   where `payload` is the batch array or the single reply exactly as today (`id: entry?.id ??
   null`, `"<no-method>"` fallback, `<unparsed:…>` 60-char slice). The `end` handler becomes:
   plan → push methods → respond or return. A browser-free `test()` in the same file covers:
   unparsed body, single request, batch, batch with one unanswerable element blackholes whole.
4. **`network/backup-restore-sw-restart.test.ts`** — `readRestoreResidue(page)` replaces the three
   inline evaluates; `probeRecoveryBackstop(ctx2, filePath, funded, setGatePage)` owns the
   torn-unlock → delete → re-import probe and returns the `recovery` string (both branches
   verbatim); `describeStuck(...)` builds the two stuck messages. The scenario body reads:
   export → arm → kill → outcome → residue assertions.
5. Regen + read the diff; expect exactly five removals and zero insertions.

Gates: `bun run audit:vue` · `bun run test:ci-gating` · e2e via `bun run e2e:agent`
(one sequential local run, proverless): account-balance-orphans · balance-row-reconciliation ·
account-switch-isolation · backup-restore-sw-restart · import-dead-rpc (smoke) ·
profile-reimport-matrix (uses the balance helpers). CI: sharded network + smoke.

## PR-b — `global-setup.ts` stage coordinator (44 → 43, mid rigor)

`setup` keeps its exact order and every message; the bodies move into stage functions that
mutate the same module-level handles/flags:

- `provideWithoutSandbox(project)` — the three `provide` calls repeated at four skip exits.
- `reconcilePriorLock(project): Promise<"reused" | "fresh">` — the lock block verbatim, including
  the reuse path's `deployContractsAndProvide` + `markBootReady`.
- `ensureAnvil(project): Promise<boolean>` / `ensureAztecNode(project): Promise<boolean>` —
  probe → spawn → wait; `false` means "setup returns now" (skip path already provided); the
  `E2E_REQUIRE_SETUP=1` throws stay inside with their exact FATAL text; node failure still kills
  node THEN anvil.
- `startDevServer({ label, cwd, url, env, weStarted })` for playground and tools (spawn
  `bun run dev`, pipe, `waitForHttp(url, 30_000)`, warn + kill on failure); tools stays opt-in.
- `pipeChildLogs(child, tag, { stdout, stderr })` — the per-child needle filters as data
  (`["Aztec","ready","error"]`, `["Local:","error"]`, anvil's stderr `address already in use`).
- `setup` = orphan reap → manifest guard → ports log → `reconcilePriorLock` → provisional lock →
  `markBootStarted` → anvil → node → playground → tools → deploy → `markBootReady`.

Competing outline considered: minimal-move (only `provideWithoutSandbox` + `startDevServer` +
`pipeChildLogs`, lock block and both chain stages left inline). Rejected: the coordinator would
still score ~45, so the directive stays — that is the "shape-neutral → ACCEPT" case, and a
400-line boot function is not one the owner would sign as essential complexity. Alternative
"ACCEPT with justification" stays available if the audit shows the split hides ordering.

Fable-role audit conditions (folded — see the ledger in `lessons/phase-1.md`):
- **Measure before claiming.** Every stage's Biome score is measured on the actual split; if
  `reconcilePriorLock` still exceeds 15, the pre-authorized sub-split is `priorPortsMatch(lock)` /
  `priorPackHealthy(lock)` / `reapPrior(lock)`. `noExcessiveLinesPerFunction` is off for
  `**/e2e/**` (biome.json), so a long stage never spawns a new directive — stated, not assumed.
- **Handle ownership stays strict.** `startDevServer` cannot take a `weStarted` value: the caller
  passes `onSpawned(child)` which does `handle = child; weStartedX = true; recordSpawnedPid()`
  BEFORE listeners and the 30 s wait — never return-then-assign (that would reopen the
  cancel-window orphan leak the provisional-lock comment documents).
- **No guard hoisting.** Each `ensure*` starts with its health probe; the binary / pin gates stay
  inside the "not already running" branch, after the "Starting …" log, exactly as today (a
  healthy pre-existing node with an unusable pin must keep passing).
- **`markBootStarted()` stays in the coordinator**, once, between `writeProvisionalLock()` and
  `ensureAnvil` — that placement IS the exit-86 contract (a missing-binary FATAL is retryable
  boot failure today). No stage function references it.
- **Reuse branch never touches `weOwnLock`**; `clearLock()` stays inside `if (priorLock)`.
- **Zero new `weStarted* = false` assignments** — the flags are deliberately NOT reset on kill
  paths (teardown's data-dir removal keys off them).
- **`provide` placement**: the four permissive skip causes return `"skip"` from two stages, and
  the coordinator's two `provideWithoutSandbox(project); return` sites own the exits (codex: two
  call sites covering four causes — cleaner than duplicating the call per cause); `playgroundUrl` /
  `toolsUrl` are provided by the shared `finishBoot(project)` (provide both → deploy →
  `markBootReady`) on both the reuse and the fresh path (toolsUrl even when tools is not spawned).
  **Accepted ordering difference**: `playgroundUrl` used to be provided BEFORE the optional tools
  probe/start; it is now provided after, with `toolsUrl`. Vitest workers cannot observe it (they
  start after setup returns); only an exceptional tools probe or a mocked `TestProject` could.
- **Log needles are per-child data, not defaults**: anvil has NO stdout handler and its stderr
  set is `["error","Error","address already in use"]`; the anvil-only `once("exit")` handler stays
  anvil-only; playground's `VITE_DISABLE_HMR` env is not shared; log labels are passed in both
  capitalizations.
- **Signalling**: stages return `"ok" | "skip"`, throws stay throws.

Equivalence (no pins are possible for a boot):
1. full network suite on CI (sharded);
2. local double boot back-to-back — the second run takes the different-ports → reap path;
3. **reuse path**: one direct-vitest run with pinned ports, `kill -9` the vitest parent (detached
   children survive, `teardown` never runs, the lock persists), re-run the same single spec — must
   log `reusing prior sandbox (identity check passed)` and must NOT log `Starting anvil`;
4. fail-loud path: `E2E_REQUIRE_SETUP=1` with an unreachable anvil binary on a verifiably free
   port (the FATAL is reachable only when `probeAnvil` is false) throws the anvil FATAL text
   before any spawn;
5. normalized block-diff: each stage body vs its old line range with leading whitespace and the
   wrapper lines stripped — expected empty;
6. string-literal multiset diff of the whole file before/after (console lines, FATAL texts,
   needles, argv/env keys) — every difference justified in the PR body.

Deviation surfaced to the owner (Ask): scope.md §1 asks for "a reuse-path boot (`bun run
e2e:agent` twice in a row)", which cannot exercise reuse (the runner reallocates ports every
run); item 3 above is the substitute. Docs: `tests/e2e/README.md` + `e2e-testing` skill name the
stages.

## Assumptions

Facts: the six directives and their lines (scope.md); `resolveActiveTriple` exists and is
identical to the inline copy; the join is duplicated verbatim; the residue read is evaluated 3×;
`setup` = lines 233–632; all handles/flags are module-level; Puppeteer serializes evaluated
functions. Inferences: the diagnostic `grab` scan can share the reader (verify by output);
`import-dead-rpc` runs under the smoke config (`vitest.e2e.config.ts` includes
`tests/e2e/*.test.ts`), so a browser-free `test()` there is executed by the e2e runner. The
runner (`scripts/e2e/agent.sh`) always exports `TOOLS_DEV_PORT`, so the "opt-in" tools block is
always taken under the runner; the `TOOLS_PORT === undefined` path exists only for bare vitest.
Asks surfaced: the reuse-path gate substitution (PR-b, above). The 44 → 43 count is a target,
not a fact, until the split is measured.

## Security & adversarial

Harness only; no product code. Risks: (1) a join that silently widens (another token's row
satisfying freshness) — guarded by the exact predicate parity + the existing freshness-gated
specs; (2) a stage split that reorders `recordSpawnedPid`/`weStarted*` and leaks a process
group on failure — guarded by verbatim move + kill-order review + the double boot; (3) a
fail-loud path that turns into a skip — guarded by the explicit `E2E_REQUIRE_SETUP=1` negative
run; (4) the dead-RPC planner answering a batch partially — guarded by the blackhole-whole test.

## Codex loop

ONE resumed session for the plan: blueprint audit (adversarial + assumption-attack +
implementation critique + verdict) → fold → PR-a review → PR-b review → approve. PR-b also gets
a fable-role subagent audit (mid rigor). Decision ledger + verdicts in `lessons/phase-1.md`.
