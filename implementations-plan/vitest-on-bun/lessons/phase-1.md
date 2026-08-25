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

Control (Node, design, identical script): also "no rerun observed" — so the rerun detection is a weakness of the smoke (append-a-line + 15 s + dot reporter), not evidence against Bun. The **orphan on bridge-core is Bun-specific** (Node control: 0; design/faucet on Bun: 0). Ruling per plan.md (flip `test:watch` ONLY behind a passing smoke): not passing → the three `test:watch` scripts stay `vitest` (Node). Revisit in a later arc with a smoke that drives a rerun deterministically (e.g. vitest's interactive `r`) and repeats the SIGINT check ≥3×.

## Matrix commit

**`f800dc1734d3b0e72a13d885073aee952ca78be5`** — the docs commit directly on top of the last flip (`8625af47`). A first matrix attempt bound to `8625af47` was aborted after one suite when this lessons file was created untracked mid-run (a dirty tree would have failed every compare); it was committed, the partial outputs discarded, and the matrix re-run from scratch at `f800dc17` with the tree clean.

Operational lesson: a background Bash task here dies at the tool's 10-minute cap (two kills observed), so a multi-hour matrix must be launched fully detached (`setsid nohup … &`) with a Monitor tailing its log as the wake signal; the script was made resumable (a step whose output exists is skipped — the summaries carry the commit + lockfile hash, so a resume cannot mix commits).

## Clean-install attestation

`bun install --frozen-lockfile` at `f800dc17`: exit 0; `bun.lock` sha256 `e4600156928e48e1f113261508ab8f6dee59c9f358fa9e4c1ee6e2eb334952de` — carried as `meta.lockfileSha256` in all 24 summaries and enforced equal by every compare.

## Soak matrix — 12 suites × {Node reference, Bun candidate} × 30 runs, retry-0, sequential

Node reference = `--runtime node` (the script's string with `bun --bun ` stripped, explicit `pre`/`post`, Node 24.18.0 by shebang, per-run reporter record without `versions.bun`); Bun candidate = `--runtime script` (the real `test`/`test:e2e` script, Bun 1.4.0, per-run record with `versions.bun`). All 720 runs: `failedRuns: 0`, no timeouts, every run carrying its engine record.

| Suite | ids | Node median (p95) | Bun median (p95) | inventory digest | compare |
|---|---|---|---|---|---|
| apps/landing | 3 | 380 ms (387) | 317 ms (324) | `ea2591135cc0a007` | OK |
| packages/wallet-bridge | 210 | 958 ms (975) | 643 ms (662) | `5d7c07cd146c21f8` | OK |
| packages/wallet-sdk-schema-patch | 5 | 461 ms (471) | 363 ms (368) | `739f57f307d3263d` | OK |
| packages/aztec-runtime | 180 | 2546 ms (2796) | 1860 ms (2099) | `512ccc28fcf403f7` | OK |
| packages/bridge-core | 223 | 4564 ms (4629) | 3646 ms (3692) | `f2ecfd355db8104f` | OK |
| packages/wallet-core | 233 | 2315 ms (2346) | 1641 ms (1677) | `1181215a19f19f64` | OK |
| packages/wallet-crypto | 111 | 6082 ms (6272) | 4849 ms (4870) | `3bbb6c39c1eef577` | OK |
| packages/extension-messaging | 187 | 1498 ms (1526) | 1100 ms (1116) | `def3488645efbd3d` | OK |
| packages/design | 313 | 4676 ms (4723) | 3341 ms (3362) | `ef16bba897702b7b` | OK |
| apps/faucet (`test`) | 542 | 12049 ms (12170) | 8289 ms (8409) | `f9b41077963a54ce` | OK |
| apps/faucet (`test:e2e`, jsdom smoke) | 15 | 3760 ms (3792) | 2981 ms (3003) | `f5841b6868ccf221` | OK |
| apps/extension (aggregate, N=30 full) | 4642 | 76137 ms (76635) | 54948 ms (63587) | `13e16fbf17753eb7` | OK |

"ids" counts unique `<file> :: <full name>` keys: identically named tests inside one file share a key (aztec-runtime 180 ids for 189 tests, wallet-crypto 111 for 112, extension-messaging 187 for 188, extension 4642 for 4644) — the same collapse on both sides, so the digests are comparable; the per-run `collected/passed/skipped/todo` counts in the summaries carry the raw numbers.

Wall-clock is contended-free (sequential soaks on an otherwise idle host): Bun is 17–33 % faster on every suite. No performance claim beyond this host.

### Comparator output (verbatim, one block per pair; identical apart from the suite line)

Every block reads: `reference … [node] 30 runs, failedRuns=0 … digest X` / `candidate … [script] 30 runs, failedRuns=0 … digest X` / the two wall-clock lines / `resolution allowlist (pinned): isows, msgpackr, @logtape/logtape, axios` / `resolution differs (allowed): isows: {"esm":"<repo>/node_modules/isows/_esm/index.js"} vs {"esm":"<repo>/node_modules/isows/_esm/native.js"}` / `COMPARE OK`. The full text of all twelve is in the gitignored `lessons/baselines/full/compare-*.txt` on the matrix host; the committed compact summaries under `lessons/baselines/{node,bun}/` carry every digest, per-run row and resolution record.

### Resolution evidence

Out-of-process, workspace-anchored ESM resolution (`Bun.resolveSync` vs `import.meta.resolve(spec, wsURL)`) for the 11 recorded specs: identical on both engines for every workspace EXCEPT `isows`, which selects its `"bun"` export condition (`_esm/native.js`) under Bun — inside the pinned allowlist, present in all 12 pairs. `msgpackr`, `@logtape/logtape` and `axios` resolved identically (or were unresolvable on both sides where the workspace does not depend on them). Nothing outside the allowlist differed.

## `bun run test:all` ×5 under Bun (the concurrent CI shape)

Runs 1–5: exit 0 each (all 11 workspaces concurrently, each on `bun --bun vitest run`).

## Rest of the gate

| Command | Result |
|---|---|
| `bun run audit:vue` (typecheck ∥ test on Bun ∥ lint, then build chrome+firefox) | exit 0 — extension 372 files / 4635 tests on Bun; builds green |
| `bun run build:faucet` | exit 0 |
| `bun run test:e2e` (extension smoke, Node + Puppeteer — the untouched path) | unarmed: 1 red — `backup-migration.test.ts` "fixture-arming contract: unarmed runs are allowed ONLY against a release artifact" (the suite's own contract for dev builds); **armed as CI arms it** (`VITE_NULO_E2E_MIGRATION_FIXTURE=1` at `build:chrome`, `NULO_E2E_MIGRATION_FIXTURE=1` at test — `_smoke-e2e.yml:41,71,83`): 31 files / 112 tests green, 6 skipped |
| `bun run lint && bun run typecheck:all` | exit 0 (inside `audit:vue`) |
| `bun run test:ci-gating` | 37/37 |

## Real-runner dispatch bound to the matrix commit

`gh workflow run pr-quick.yml --ref worktree-vitest-on-bun` → run **32795117216**: `event: workflow_dispatch`, `headBranch: worktree-vitest-on-bun`, **`headSha: f800dc1734d3b0e72a13d885073aee952ca78be5`** (= the matrix commit), run conclusion `success`; jobs: Detect changes ✓, Lint + Typecheck ✓, **Unit tests / Vitest ✓ (the eleven `bun --bun vitest run` scripts on `ubuntu-latest`)**, Build Chrome ✓, Build Firefox ✓, Build Faucet mainnet ✓, Build Faucet testnet ✓, Commitlint skipped (no PR range on a dispatch), **`quality-status: success`**.

## Validation gate (as written in plan.md) — PASSED

Every row above satisfies its pass criterion: frozen install exit 0; 12 Node summaries `failedRuns: 0`; every Bun summary's run records show `versions.bun = 1.4.0` and every Node summary's show none (enforced by the comparator); 12 compares exit 0; `test:all` ×5 exit 0; `audit:vue`, `build:faucet`, armed smoke e2e, lint/typecheck, ci-gating exit 0; the dispatched run bound to the matrix commit has `quality-status: success`; the one resolution difference is allowed and written up. No Bun-only failure occurred, so the failure procedure was never entered; no owner STOP (A5/A7) was triggered.

## Matrix attempt 2 (`f3f09299`) — one Bun-only failure, classified (a): test assumption

`apps/extension` aggregate, Bun run 13/30: `src/wallet/services/profile/service.integration.test.ts :: … importMnemonic canonicalizes (case/whitespace) and enforces exactly 24 words` — `expected [Function] to throw error matching /Invalid checksum|Invalid mnemonic/ but got 'A profile with this recovery phrase already exists'` (line 721). Node: 60/60 across both matrices; Bun: 59/60.

Root cause is in the test, not the engine. Line 720 built the "corrupted" phrase as `[...words.slice(0, 23), words[0] === "abandon" ? "zoo" : "abandon"]` — the replacement word depends on the FIRST word, so whenever the randomly generated phrase already ends in that word, `corrupted === words`, `getEntropy` validates it, and `importPasswordProfile` raises the duplicate error (`service.ts:1467-1481` validates length → wordlist/checksum → derives → dedupes). Probability ≈ 1/2048 per run; a second latent path (a list word replacing the last word yields a VALID checksum for a different phrase — ≈ 1/256 per run — would have failed with "promise resolved") never fired in 120 runs. Both are properties of the test's randomness, reachable on either engine; Bun merely drew the losing ticket first.

Fix (test only, `fix(test)`): replace the last word with a word that is NOT on the BIP-39 list, so `getEntropy` rejects deterministically ("Invalid mnemonic") on every run and every engine. No product code touched; no runtime-conditional skip. Per the matrix commit rule the frozen install, the full matrix, the `test:all` ×5 loop and the dispatch are re-run at the new commit.

LESSONS_FILE=implementations-plan/vitest-on-bun/lessons/phase-1.md
