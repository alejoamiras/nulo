# bun-native-tooling — Arc D of the Bun 1.4 adoption (`/blueprint light`)

Status: **DRAFT v1 — 2026-08-25**, for codex round 1. Owner absent; every clarifying question below is resolved by the standing decision protocol (codex to convergence, explicit fresh-context approve). Reserved lines (merging, required checks, `@aztec/*`, publish/deploy, feature removal, irreversible data ops) are not touched.

## Goal

Replace the eighteen hand-rolled `node:child_process` calls in `packages/bridge-core/scripts/` with ONE argv-only runner whose contract is explicit (no shell string anywhere, throw-with-exit-code-and-stderr by default, opt-in soft failure, normalized binary resolution), delete the two duplicated `forgeBin()`s and the `cast()`/`runForge()`/`buildForkInL1Root()` variants into it, and un-pin the hardcoded `cast` path — with the runner proven by real-subprocess tests on both engines. The e2e supervisor is out of scope (Arc C left the e2e configs on Node — the dossier's precondition is unmet). `--no-orphans` is NOT enabled anywhere; the arc records the probe that would clear it.

**Done** = one runner module + its test; all six child-process files use it; zero `execSync`/shell strings remain in `packages/bridge-core/scripts/`; `bun run --cwd packages/bridge-core typecheck` and `test` green on BOTH engines; `bun run test:all`, `bun run lint` green; every script's observable behaviour preserved (exit codes, soft-fail paths, messages) except the two documented fixes (cast resolution, argv-only git); PR to `dev` open with the three required checks green at HEAD; codex loop converged.

## Why this tier (Phase 0.5 rubric)

Novelty LOW (a runner wrapper; the release scripts already shell natively), blast radius LOW–MED (operator-run deploy/verify/canary scripts — never in CI — but they move real funds on Sepolia/mainnet when an operator runs them, so a behaviour change is expensive to discover), irreversibility LOW (revert one PR), migration cost LOW, external coupling MED (forge/cast binaries from the Aztec toolchain), security MED (the current shell strings are a command-injection surface; the deployer key is in the process env). One MED-HIGH-ish dimension, single package → `light` (dossier tier confirmed).

## Clarifying questions — proposed answers (owner absent → codex rules)

| # | Question | Proposed answer (with the reasoning codex should attack) |
|---|---|---|
| Q1 | **Bun-native (`Bun.spawnSync`/`Bun.$`) or Node-API hardening (`node:child_process.spawnSync`, argv-only)?** | **Node-API hardening.** Evidence: (a) `execFileSync`/`spawnSync` with argv arrays already never touch a shell — the dossier's "`Bun.$` is a security upgrade over `execFileSync`" is wrong for those sites; the real injection surface is the three interpolated `execSync` strings, fixed by argv arrays on ANY API; (b) `Bun.$` adds the argument-injection class Bun's own docs warn about and `Bun.spawnSync` has no throw-on-failure, no `encoding`, no `.status` — a swap rewrites every error path for no functional gain; (c) `bun-types` is not a dependency — Bun-native code either adds one (lockfile churn colliding with Arc B's regen) or goes through an untyped `await import("bun")`; (d) a Bun-only runner makes the bridge-core vitest suite Bun-only, which on `dev` (Arc C unmerged: `test` is plain `vitest run` on Node) reds `test:all` unless this arc stacks on Arc C — coupling two independent PRs' merge order for nothing; (e) `node:child_process` already runs these scripts under `bun` today (Arc A) with none of its documented gaps exercised. The Bun-native premise of the dossier is declined on this evidence; the arc keeps its name (it is the dossier's Arc D slot) and states the decline in the PR. |
| Q2 | Runner contract | `run(bin, args, opts): { stdout, stderr, exitCode }` — argv only (no `shell`), `encoding: "utf8"`, `stdio` default `["ignore","pipe","pipe"]` with `inherit` opt-in, `maxBuffer` default 64 MiB, optional `cwd`/`env`/`timeoutMs`; throws `RunError { bin, args, exitCode, signal, stdout, stderr }` on non-zero exit, signal death or spawn failure (ENOENT names the binary); `{ check: false }` returns the result for the two soft-fail sites. No async variant (every call is synchronous today; `spawnSync` blocks nothing here). |
| Q3 | Preserve the deploy conductors' soft-fail on `verify-l1.ts`? | **Yes, verbatim** (`deploy-bridge-{testnet:540,mainnet:509}` log ⚠ and continue; `rebuildAndVerifyPortal` throws). Changing operator-facing semantics is not this arc's job; the plan flags it as an owner Ask. |
| Q4 | `--no-orphans` | **Not enabled.** Its only documentation is one CLI help line; scoping is unknown; the only long-lived-child consumer (the e2e supervisor) stays on Node. The arc writes the probe that would clear it (Phase 2 doc): spawn a detached grandchild under `bun --no-orphans`, kill the parent, observe whether a sibling agent's process in the SAME pgid survives — and forbids enabling it until that probe is recorded green in the run-isolation skill. |
| Q5 | Which scripts become importable? | Only `portal-artifact.ts` is import-safe today; the runner is a NEW module so the tests import IT, not the conductors. The six call-site files are edited in place with no export/guard changes (zero behaviour drift; `import.meta.main` is not introduced — under vitest on Node it is `undefined`, fine, but there is no consumer). |
| Q6 | Test strategy | Real subprocesses, no mocks: `run("git", ["--version"])`, a non-zero exit (`bun -e "process.exit(3)"`), a signal, ENOENT, `check: false`, `maxBuffer`, `inherit` — on both engines (`bun --bun vitest run` on the branch that carries Arc C; plain vitest on `dev`). `forge`/`cast` themselves are NOT invoked by tests (toolchain-dependent); their resolution helper is tested with a fake `PATH` + a temp executable. |
| Q7 | Base branch | `dev` (independent of Arcs B/C: no lockfile change, no test-runtime dependency; `packages/bridge-core/package.json` untouched). No `gh stack`. |
| Q8 | Scope of "fix in passing" | Exactly two behaviour changes: (1) `cast` resolves via `CAST_BIN` → PATH → `~/.aztec/current/internal-bin/cast` → the old `~/.aztec/versions/5.0.0/internal-bin/cast` (last, so today's installs behave identically; the unexpanded `"~"` bug goes away); (2) the three interpolated git strings become argv arrays (same commands, same outputs). Everything else is a refactor with identical observable behaviour. |

## Recon → design (see [recon.md](recon.md))

- 18 call sites, 6 files, 4 file-scoped helpers (2 duplicated), 0 tests, 0 CI invocations; the scripts are the `aztec-update` operator runbook.
- Two patterns: A — argv arrays (cast/forge/bun sub-scripts; already shell-free), B — `execSync` shell strings for git (three of them interpolate unvalidated input).
- No shared runner exists anywhere in the repo; the release scripts' Bun `$` convention is the only native precedent and it deliberately keeps the shell wrapper untested behind a DI seam — the opposite of what a deploy-script runner needs (the runner IS the risky part; it gets the tests).

## Architecture & Implementation

1. **`packages/bridge-core/scripts/run.ts`** (new, ~80 lines):
   - `export class RunError extends Error { bin; args; exitCode: number | null; signal: NodeJS.Signals | null; stdout; stderr }` — message `"<bin> <args…> failed (exit N|signal S): <stderr tail>"`.
   - `export function run(bin: string, args: readonly string[], opts?: RunOptions): RunResult` over `spawnSync(bin, args, { cwd, env, encoding: "utf8", stdio, maxBuffer, timeout })` — `shell` is never passed; `res.error` (ENOENT/timeout) and `res.status !== 0`/`res.signal` throw unless `check === false`.
   - `export function resolveBin(name, { env: envVar, fallbacks }): string` — `process.env[envVar]` → `run(name, ["--version"], { check: false })` probe on PATH → each fallback that exists (`existsSync`) → throw `RunError`-shaped "not found" with the searched locations. `forgeBin()` and the cast path become two constants calling it (`~` expanded via `os.homedir()`).
   - `export function git(args, cwd): string` — thin argv wrapper (`run("git", args, { cwd }).stdout.trim()`), the one helper with a name because eight sites call it.
2. **Call-site migration, one commit per file** (order: `portal-artifact.ts` → `verify-l1.ts` → `live-intent.ts` → `restore-swap.ts` → `deploy-bridge-testnet.ts` → `deploy-bridge-mainnet.ts`), each preserving: exit codes, the soft-fail branches (`check: false` + the existing `⚠` log), `stdio: "inherit"` where output streams to the operator, the `FOUNDRY_PROFILE`-stripped env for forge, `maxBuffer` 64 MiB, message texts. Deletions: both `forgeBin()`s, `cast()`, the raw `spawnSync`/`execSync`/`execFileSync` imports.
3. **`run.test.ts`** (colocated, vitest, real subprocesses): success/stdout, non-zero → `RunError` with exitCode + stderr, `check: false`, ENOENT → `RunError` naming the binary, `timeoutMs` → signal, `maxBuffer` overflow → error, `resolveBin` env override / PATH probe / fallback / not-found, `git` wrapper. Uses `process.execPath` (Node) or `bun` (Bun) for the scripted child via a `bun -e`/`node -e` chooser that is NOT a skip — both engines run every case.
4. **Docs**: `packages/bridge-core/README.md` (scripts table gains `verify:l1` + the runner rule: "scripts spawn ONLY through `run.ts` — argv arrays, never a shell string; `CAST_BIN`/`FORGE_BIN` overrides"), `.env.example` (`CAST_BIN`), adoption-map Arc D status + the corrected premise, `implementations-plan/index.md`, the `--no-orphans` probe note in the run-isolation lesson. No CLAUDE.md change (the rule is package-local).

## Phases

### Phase 0 — Runner + tests

Create `run.ts` + `run.test.ts`; nothing else changes. Validation gate — `bun run --cwd packages/bridge-core typecheck && bun run --cwd packages/bridge-core test && bun --bun vitest run --root packages/bridge-core scripts/run.test.ts && bun run lint`. Pass: all exit 0; the test file runs green on BOTH engines (the plain `test` script on `dev` is Node; the `bun --bun` invocation is Bun). Layers: typecheck · unit (both engines) · lint.

### Phase 1 — Call-site migration (six commits)

Validation gate — after EACH file: `bun run --cwd packages/bridge-core typecheck && bun run --cwd packages/bridge-core test && bun run lint`; after the last: `grep -rn "execSync\|execFileSync\|spawnSync\|child_process" packages/bridge-core/scripts/*.ts` returns ONLY `run.ts`; `git diff --stat` per file reviewed against the call-site table in `recon.md` (18 sites, all accounted for); a static behaviour audit per file recorded in `lessons/phase-1.md` (for every site: old API → new call, exit-code path, soft-fail preserved?). Smoke of the live scripts is NOT available without the toolchain + keys — the plan says so, and the next `aztec-update` run is the operational proof (owner Ask A2). Layers: typecheck · unit · lint · static audit.

### Phase 2 — Docs + dossier corrections

README, `.env.example`, adoption-map (Arc D status + the corrected `Bun.$`/`kill()` claims + the `--no-orphans` probe), `implementations-plan/index.md`. Validation gate — `bun run lint && bun run test:all`; `git diff --name-only <last Phase 1 commit>..HEAD` is `*.md` + `.env.example` only. Pass: exit 0, diff conforms.

## Security & Adversarial Considerations

- **Threat**: an argument that reaches `cast`/`forge`/`git` as a flag (`--upload-pack=…`, `-o…`). Mitigation: every user/network-derived value is validated before it becomes an argument (`requireAddress()` stays in front of `cast`; `fromRef` in `restore-swap.ts` is validated against `git rev-parse --verify --end-of-options <ref>` semantics — the runner passes `--end-of-options`/`--` where git supports it; `intent.source.commit` is checked against `/^[0-9a-f]{40}$/` before use). The runner itself never interprets a string as a command.
- **Secrets**: `PRIVATE_KEY` is passed to `cast` as a CLI argument today (visible in `ps`) — pre-existing, unchanged in this arc, recorded as owner Ask A3 (cast supports `--private-key` only; the alternative is `cast wallet` keystores — out of scope).
- **Supply chain**: no new dependency; no workflow change; no `bun.lock` change.
- **Blast radius**: operator scripts moving real value — behaviour preservation is the gate; one commit per file for bisectable revert.
- **Multi-agent host**: nothing here spawns long-lived children or kills by name; `--no-orphans` stays off.

## Assumptions

**Facts (verified)**: F1–F8 in `recon.md`; the 18-site table; `import.meta.main` is `true` for the entrypoint under both `bun -e` and Node 24.18 ESM (`node --input-type=module -e`) — not used by this arc; bridge-core `test` on `dev` is `vitest run` (Node — Arc C's `bun --bun` flip lives on the unmerged #459) and `typecheck` is `tsc --noEmit -p tsconfig.scripts.json` (`types: ["node"]`, excludes `deploy-sandbox.ts` + `*.local.ts`).

**Inferences (to challenge)**: I1 no operator relies on `cast` living at `~/.aztec/versions/5.0.0/…` when a newer `~/.aztec/current` exists (the new order prefers `current`); I2 `spawnSync` under Bun honours `maxBuffer`/`timeout`/`encoding` like Node for these sizes (the runner test pins it on both engines); I3 none of the six files is imported by another module in a way that a new `run.ts` import would create a cycle (`portal-artifact.ts` ← `verify-l1.ts`, `deploy-bridge-*.ts`; `run.ts` imports nothing local).

**Asks (owner)**: A1 the Bun-native decline (Q1) — accept, or direct a Bun-native runner stacked on Arc C; A2 the live scripts are proven only by the next `aztec-update` run — accept, or schedule an operator dry-run (`verify-l1.ts` dry-run mode needs forge + a manifest); A3 `PRIVATE_KEY` as a `cast` CLI argument (pre-existing) — leave or plan a keystore change; A4 the deploy conductors' soft-fail on verification (F7) — keep or make it hard-fail in a follow-up.

## Decision ledger

Filled during the codex rounds (`lessons/gate-convergence.md`).

## Post-implementation

1. `/code-review max --fix` on `git diff <base>..HEAD -- . ':!implementations-plan'` → separate `fix(review)` commit.
2. Codex audit (`/codex xhigh`, fresh): net diff + this plan + ledger + the adversarial ask + the no-over-engineering and comment-quality rules verbatim (as in Arc C).
3. Verify-then-fix loop, resumed session, until no new material findings; >3 rounds → surface.
4. Delivery.

## Delivery

One branch (`worktree-bun-native-tooling`) off `dev`, one PR via `gh pr create`, title ≤ 93 chars: `refactor(bridge-core): argv-only runner for the deploy scripts, no shell strings`. Body: the runner contract, the 18-site table digest, the two behaviour changes, the Bun-native decline with its evidence, the `--no-orphans` probe, the owner asks. `gh pr checks --watch`; assert `quality-status`, `smoke-e2e-status`, `network-e2e-status` SUCCESS at HEAD (the last two will emit pass-on-skip: the diff touches no e2e surface). Merge is the owner's.

Rollback: revert the PR (six per-file commits are individually revertible).

## Seeds

Filled at approval.
