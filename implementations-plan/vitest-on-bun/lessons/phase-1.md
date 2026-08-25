# Phase 1 — Flip + full matrix at one commit + real-runner dispatch — lessons

## Flip commits (one per workspace, in order)

`6d7e87b1` landing · `f29ef4ca` wallet-bridge · `fbcb0563` wallet-sdk-schema-patch · `535338b7` aztec-runtime · `1774d789` wallet-core · `2d3aa181` wallet-crypto · `e4c99717` extension-messaging · `aa5a0d1b` extension (`test` + `test:components`) · `eda75588` design · `96e69a7a` bridge-core · `8625af47` faucet (`test` + `test:e2e` jsdom smoke). Every `test` script is now `bun --bun vitest run…`; extension `test:e2e`/`test:e2e:all`, root `test:e2e:*`, `agent.sh` untouched.

## `test:watch` decision — stays on Node (all three)

Smoke per package (Bun): `setsid bun --bun vitest --reporter=dot`, 20 s boot, append a line to a test file, 15 s, SIGINT the group, check for survivors.

| Package | boot + initial run | rerun observed after the edit | leader after SIGINT | orphans |
|---|---|---|---|---|
| design | ✓ 37 files | no | dead | 0 |
| faucet | ✓ | no | dead | 0 |
| bridge-core | ✓ | no | dead | **1 `bun` process survived** (killed by the smoke) |

Control (Node, design, identical script): also "no rerun observed" — the rerun detection is a weakness of the smoke (append-a-line + 15 s + dot reporter), not evidence against Bun. The **orphan on bridge-core is Bun-specific** (Node control: 0; design/faucet on Bun: 0). Ruling per plan.md (flip `test:watch` ONLY behind a passing smoke): not passing → the three `test:watch` scripts stay `vitest` (Node). Revisit in a later arc with a smoke that drives a rerun deterministically (vitest's interactive `r`) and repeats the SIGINT check ≥ 3×.

## Matrix history — three attempts, one final commit

| Attempt | Commit | Outcome | What changed afterwards |
|---|---|---|---|
| 1 | `f800dc17` (flips + docs) | 12/12 `COMPARE OK`; `test:all` ×5; dispatch `32795117216` `quality-status: success` | invalidated by the post-implementation loop: `f5caac58` (NUL separator → escape text), `0d4dbac8` + `a7260587` (codex rounds 1–2: fail-closed comparator, occurrence-suffixed ids, exact status counts, bounded hooks, confirmed group kill, `no-json` fixture, resolver base) |
| 2 | `f3f09299` (converged code `a7260587` + docs) | 11/12 OK; extension on Bun `failedRuns=1` (run 13) | the red was the test's own randomness (below) → `985ab08f fix(test)` |
| 3 | **`e10cc91e`** (`985ab08f` + its analysis commit) | **12/12 `COMPARE OK`; `test:all` ×5; dispatch `32813986423` `quality-status: success`** | nothing executable — only this file, the compact baselines, plan/index status |

A first launch of attempt 1 was aborted after one suite when this lessons file was created untracked mid-run (a dirty tree fails every compare) — committed, outputs discarded, re-run from scratch. Operational lesson: a background Bash task here dies at the tool's 10-minute cap (three kills observed, incl. two codex runs), so multi-minute work is launched fully detached (`setsid nohup … &`) with a Monitor tailing its log; the matrix script is resumable (a step whose output exists at the same commit is skipped — the summaries carry commit + lockfile hash, so a resume cannot mix commits).

### Attempt 2 — the one Bun-only red was the test's own randomness (failure class (a))

`apps/extension` aggregate, Bun run 13/30: `src/wallet/services/profile/service.integration.test.ts :: … importMnemonic canonicalizes (case/whitespace) and enforces exactly 24 words` — `expected [Function] to throw error matching /Invalid checksum|Invalid mnemonic/ but got 'A profile with this recovery phrase already exists'` (line 721). Node: 60/60 across attempts 1–2; Bun: 59/60. `importMnemonic` (`service.ts:1467-1481`) validates length → wordlist/checksum (`getEntropy`) → derives → dedupes, so a duplicate error means the "corrupted" phrase PARSED as valid and derived the same master: the test built it as `[...words.slice(0, 23), words[0] === "abandon" ? "zoo" : "abandon"]` — the replacement depends on the FIRST word, so whenever the randomly generated phrase already ended in that word, `corrupted === words`. Probability ≈ 1/2048 per run; a second latent path (a list word forming a VALID checksum for a different phrase, ≈ 1/256 per run, would fail as "promise resolved") never fired in 120 runs. Engine-independent; Bun merely drew the losing ticket first. Fix `985ab08f` (test only): the last word becomes one that is NOT on the BIP-39 list, so `getEntropy` rejects deterministically ("Invalid mnemonic") on every run and engine. No product code touched; no runtime-conditional skip.

### Attempt 3 — a contended Node reference, stopped and resumed on an idle host

At 04:04 UTC the faucet unit Node reference reported `failedRuns=3` (runs 23, 25, 28): each time `src/composables/useL1FeeAsset.test.ts :: useL1FeeAsset balance is null while disconnected and fetches the fee asset once an address appears` with vitest's timeout marker (`Error: STACK_TRACE_ERROR` at `chunk-artifact.js` collect) and a run wall-clock of 22–25 s against the suite's usual 8–12 s. The host was at load average **25.6** on 12 cores: another agent's worktree (`dapp-profile-binding`) was running `vite build` with an anvil + Chrome network e2e alive, on top of this soak's own `bb` proving children. That violates the matrix's own premise (sequential soaks on an otherwise idle host) and is not a Node-vs-Bun property nor evidence about the test (attempts 1–2: 30/30 on both engines). Handling followed the owner's standing rule for concurrent host load (solo + clean re-run before triage): the matrix was stopped (soak group killed), the contaminated faucet outputs discarded, and an idle-watcher resumed the matrix at the SAME commit once the 1-minute load stayed under 4 for three minutes — the nine suites already compared OK were kept (same commit + lockfile hash), faucet/faucet-smoke/extension and the `test:all` loop ran fresh. Faucet on the idle host: 30/30 Node, 30/30 Bun. A second non-zero Node reference on an idle host would have been the A5 STOP for the owner; it did not happen.

## Matrix commit

**`e10cc91e96e00c6a8fa8cd1010892efc928f1a52`** — HEAD after `985ab08f fix(test)` and its analysis commit; tree clean at every soak (the tool's `gitDirty` excludes only `lessons/baselines/**`). All evidence below is bound to it.

## Clean-install attestation

`bun install --frozen-lockfile` at `e10cc91e`: exit 0; `bun.lock` sha256 `e4600156928e48e1f113261508ab8f6dee59c9f358fa9e4c1ee6e2eb334952de` — carried as `meta.lockfileSha256` in all 24 summaries and enforced equal by every compare.

## Soak matrix — 12 suites × {Node reference, Bun candidate} × 30 runs, retry-0, sequential

Node reference = `--runtime node` (the script's string with `bun --bun ` stripped, explicit `pre`/`post`, Node 24.18.0 by shebang, per-run reporter record without `versions.bun`); Bun candidate = `--runtime script` (the real `test`/`test:e2e` script, Bun 1.4.0, per-run record with `versions.bun`). All 720 runs at this commit: `failedRuns: 0` (re-derived from the rows by the comparator), no timeouts, every run carrying its engine record.

| Suite | ids | Node median (p95) | Bun median (p95) | inventory digest | compare |
|---|---|---|---|---|---|
| apps/landing | 3 | 379 ms (391) | 318 ms (324) | `ea2591135cc0a007` | OK |
| packages/wallet-bridge | 210 | 962 ms (1968) | 1401 ms (1546) | `5d7c07cd146c21f8` | OK |
| packages/wallet-sdk-schema-patch | 5 | 870 ms (913) | 378 ms (681) | `739f57f307d3263d` | OK |
| packages/aztec-runtime | 189 | 2546 ms (2990) | 1824 ms (2087) | `fb7eb26163b5d446` | OK |
| packages/bridge-core | 227 | 4884 ms (5189) | 3978 ms (4173) | `7c6e4bf99cd9113b` | OK |
| packages/wallet-core | 233 | 2680 ms (2837) | 1878 ms (1993) | `1181215a19f19f64` | OK |
| packages/wallet-crypto | 112 | 6179 ms (6868) | 5041 ms (7837) | `1e608600417fa60e` | OK |
| packages/extension-messaging | 188 | 1650 ms (1786) | 1106 ms (1351) | `a4209eb406cd9e5a` | OK |
| packages/design | 313 | 5128 ms (5697) | 3786 ms (4275) | `c4554c4755edebaa` | OK |
| apps/faucet (`test`) | 542 | 13918 ms (14553) | 8955 ms (9962) | `f9b41077963a54ce` | OK |
| apps/faucet (`test:e2e`, jsdom smoke) | 15 | 3803 ms (4139) | 3141 ms (3330) | `f5841b6868ccf221` | OK |
| apps/extension (aggregate, N=30 full) | 4644 | 83579 ms (86612) | 55107 ms (56107) | `bf8cd0b522e222f0` | OK |

"ids" are the raw test counts: identically named tests in one file carry deterministic occurrence suffixes (`… #2`), so nothing collapses (aztec-runtime 189, wallet-crypto 112, extension-messaging 188, extension 4644 — attempt 1's tool had collapsed 9, 1, 1 and 2 of these; codex post-impl round 1). Wall-clock: much of this attempt ran while another agent loaded the host (load 10–17 during the small-package soaks, which is where wallet-bridge's inverted medians come from; the first, idle-host attempt at `f800dc17` measured Bun 17–33 % faster on every suite) — the only performance claim is "no suite is slower on Bun on an idle host".

### Comparator output (all twelve pairs)

Every block reads: `reference … [node] 30 runs, failedRuns=0 … digest X` / `candidate … [script] 30 runs, failedRuns=0 … digest X` / the two wall-clock lines / `resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios` / `resolution differs (allowed): isows: {"esm":"<repo>/node_modules/isows/_esm/index.js"} vs {"esm":"<repo>/node_modules/isows/_esm/native.js"}` / `COMPARE OK`. The committed compact summaries under `lessons/baselines/{node,bun}/` carry every digest, per-run row (with its engine record) and resolution record; the full files with the per-test inventory stay in the gitignored `lessons/baselines/full/` on the matrix host.

### Resolution evidence

Out-of-process, workspace-anchored ESM resolution (`Bun.resolveSync` vs `import.meta.resolve(spec, wsURL)`) for the 11 recorded specs: identical on both engines for every workspace EXCEPT `isows`, which selects its `"bun"` export condition (`_esm/native.js`) under Bun — inside the pinned allowlist, present in all 12 pairs. `msgpackr`, `@logtape/logtape` and `axios` resolved identically (or were unresolvable on both sides where the workspace does not depend on them). Nothing outside the allowlist differed.

## `bun run test:all` ×5 under Bun (the concurrent CI shape)

Runs 1–5 at `e10cc91e`: exit 0 each (all 11 workspaces concurrently, each on `bun --bun vitest run`).

## Rest of the gate at `e10cc91e`

| Command | Result |
|---|---|
| `bun run audit:vue` (typecheck ∥ test on Bun ∥ lint, then build chrome+firefox) | exit 0 — extension 372 files / 4635 tests on Bun; builds green |
| `bun run build:faucet` | exit 0 |
| `bun run test:e2e` armed as CI arms it (`VITE_NULO_E2E_MIGRATION_FIXTURE=1` at `build:chrome`, `NULO_E2E_MIGRATION_FIXTURE=1` at test — `_smoke-e2e.yml:41,71,83`; Node + Puppeteer, the untouched path) | exit 0 — 31 files / 112 tests green, 6 skipped (unarmed, a dev build reds only on the suite's own "fixture-arming contract" test, by design) |
| `bun run lint && bun run typecheck:all` | exit 0 (inside `audit:vue`) |
| `bun run test:ci-gating` | 42/42 (behavior-gating 7 + soak tool 35, both engines) |

## Real-runner dispatch bound to the matrix commit

`gh workflow run pr-quick.yml --ref worktree-vitest-on-bun` → run **32813986423**: `event: workflow_dispatch`, `headBranch: worktree-vitest-on-bun`, **`headSha: e10cc91e96e00c6a8fa8cd1010892efc928f1a52`** (= the matrix commit), run conclusion `success`; jobs: Detect changes ✓, Lint + Typecheck ✓, **Unit tests / Vitest ✓ in 4m49s (the eleven `bun --bun vitest run` scripts on `ubuntu-latest`)**, Build Chrome ✓, Build Firefox ✓, Build Faucet mainnet ✓, Build Faucet testnet ✓, Commitlint skipped (no PR range on a dispatch), **`quality-status: success`**.

## Validation gate (as written in plan.md) — PASSED at `e10cc91e`

Every row satisfies its pass criterion: frozen install exit 0; 12 Node summaries `failedRuns: 0`; every Bun summary's run records show `versions.bun = 1.4.0` and every Node summary's show none (enforced by the comparator); 12 compares exit 0; `test:all` ×5 exit 0; `audit:vue`, `build:faucet`, armed smoke e2e, lint/typecheck, ci-gating exit 0; the dispatched run bound to the matrix commit has `quality-status: success`; the one resolution difference is allowed and written up. The single Bun-only failure across all three attempts (attempt 2) was classified (a) with a test-only fix and the matrix re-run at the new commit, per the plan's failure procedure; no owner STOP (A5/A7) was triggered.

LESSONS_FILE=implementations-plan/vitest-on-bun/lessons/phase-1.md
