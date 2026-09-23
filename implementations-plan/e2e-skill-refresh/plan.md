# e2e-skill-refresh — one SW-kill helper everywhere, and a skill worth reading

- **Tier**: light (single audit — codex). `code_review: off`. `eli5_mode: artifact`.
- **Budget**: recon 3 sonnet agents (done, see `recon.md`); codex: 1 plan audit + the post-impl loop (≤3
  rounds); no reviewer subagents.
- **Worktree**: `e2e-skill-refresh` / branch `worktree-e2e-skill-refresh` off `dev@122149ad`.
- **Owner ask (2026-09-06)**: "Please do that [the three gaps]. I think the e2e skill is super old, so
  feel free to fan out sonnet subagents + improve a LOT that old skill."

## Why

PR #548 root-caused the `stopServiceWorker … still alive 15s` flake (an attached DevTools session
parks Chrome's stopped worker host; the restarted worker inherits the old target) and shipped ONE
correct helper in `fixtures/helpers.ts`. Four specs still carry the verbatim pre-fix copy, and the two
prover-ON canaries "restart" the worker with `Runtime.terminateExecution` over a session they never
detach — which the repo's own lessons proved is not a kill. The skill that is supposed to stop the
next person from writing a seventh copy still describes the pre-#548 helper as inline, blames the 15s
deadline, and carries ~10 other claims that are wrong on the current tree (`recon.md`).

## Scope

In:
1. **Code** — delete the six local SW-kill variants; every caller imports `stopServiceWorker` from
   `./fixtures/helpers` (or `../fixtures/helpers`). Canaries keep their "no live target ⇒ Chrome
   already killed it" tolerance ONLY if it is still reachable; verify against the helper's own
   `waitForTarget` (15s) before keeping a branch.
2. **Skill** — rewrite `.claude/skills/e2e-testing/SKILL.md` from a chronological lesson dump into a
   procedure-first skill: Run it / Write a test / Kill the worker / Diagnose a red run / Flake ledger /
   Editing the harness / References. Every concrete claim traceable to a file on the current tree;
   stale sections deleted, not "refreshed"; dated narrative moved to the ledger table with a plan
   link. Target ≤ 550 lines, denser than the 674 it replaces.
3. **Docs riding along** — `tests/e2e/README.md`: replace the "Known failures + triage" snapshot and
   the "45 network test files" count with the current shape. (`vitest.e2e.network.config.ts`'s
   "3 attempts" comment is CORRECT — `retry: 2` is three attempts; the audit caught the planned edit.)

Out: any timeout change; new fixtures; touching `chrome-extension-debug`, `run-isolation`, or
`COMPOSITION-TESTS.md` (the skill links them and stays inside its boundary); the vestigial
`NULO_E2E_WALLET_PROBE` in `docker-ci-like.sh`; the open flakes in the ledger (documented, not fixed).

## Assumptions (facts verified on the tree)

1. `stopServiceWorker` is exported from `fixtures/helpers.ts` and validated 3/3 × 3 rounds under
   `taskset -c 0,1` retry 0 plus 31/31 smoke in #548.
2. `onInstalled` opens the first-run tab only for `reason === "install"` (`src/wallet/index.ts:29`).
3. The four `worker.close()` copies wait on `targetdestroyed` identity with a 15s deadline — the
   exact race #548 measured (3 lost stops in 16 under two cores).
4. `Runtime.terminateExecution` leaves the worker alive (deflake-round-3 `lessons/phase-3.md`; the
   current `backup-restore-sw-restart` header restates it).
5. `frozen-account-canary` runs prover-ON on the canary lane at retry 0; `passkey-execution-canary`
   runs in the proverless pool at retry 0. Both are single-shot gates — a fake kill there is a
   vacuous stage, not just a flake source.
6. Selector discipline is convention + review (no lint/scanner) — the skill must say so rather than
   claim enforcement.
7. Smoke's global setup pkills Chromes loaded from THIS dist path at setup and teardown; a concurrent
   network run on the same worktree loses its browsers.

Asks (owner decisions, none blocking): none. Codex is asked to attack A3–A5 specifically.

## Phases

### Phase 1 — consolidate the kill (code)

- Replace the inline helper in `imported-account-lifecycle.test.ts`, `network/connect-locked-queue-
  sw-restart.test.ts`, `network/backup-restore-sw-restart.test.ts`, `network/cold-wake-discovery.
  test.ts` with the import. Drop now-unused `Target`/`ExtensionContext` imports.
- Replace the terminateExecution stubs in `network/frozen-account-canary.test.ts` and
  `network/passkey-execution-canary.test.ts` with the import. The canaries KEEP an absence-only path:
  Chrome's idle reaper can stop the worker during a long prover-ON stage, and nothing in the helper
  wakes one, so a synchronous `findServiceWorkerTarget(ctx)` (exported from the helper module, the
  same predicate the helper uses) decides — absent → proceed to recovery with a warning; present →
  the real kill, whose failures propagate. The passkey canary's anchor popup stays open (its
  FrameTreeNode owns the virtual authenticator).
- `cold-wake-discovery` is the one caller whose premise is "no worker alive at click time", which
  the helper's `restarted` witness cannot establish. Its own `expect(swAlive).toBe(false)` after the
  call stays as the guard: a replacement that woke early fails the test, as it should. Nothing warms
  the worker to satisfy it.
- Header comments that say "kept file-local by design" / "mirrors X" are rewritten to point at the
  helper; no plan or PR references in code.
- Validation (quiet host; smoke's config hardcodes `retry: 2`, so retry 0 there is the CLI flag
  `--retry=0`, not the env var):
  - smoke: `taskset -c 0,1` × 3 rounds of `imported-account-lifecycle sw-resilience
    sw-restart-network` with `--retry=0`; then full smoke once (`NULO_E2E_MIGRATION_FIXTURE=1`).
  - network proverless (`NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent …` under
    `taskset -c 0,1`): `connect-locked-queue-sw-restart`, `backup-restore-sw-restart`,
    `cold-wake-discovery` — 2 rounds.
  - canaries prover-ON (`NULO_E2E_RETRY=0 bun run e2e:agent …`): `frozen-account-canary` × 2 rounds
    under `taskset -c 0,1` (its recovery already documents starvation failures, so the amplifier
    applies), `passkey-execution-canary` × 1 prover-ON (CI's canary lane excludes it; the shard pool
    runs it proverless). CI's canary lane is the further proof for frozen.
- Gate: `bun run lint` + `bun run --cwd apps/extension typecheck`.

### Phase 2 — rewrite the skill (docs)

Structure (each section states rules and points at code; dated stories live in the ledger):

1. **Scope** — what this skill owns vs `chrome-extension-debug` (live DevTools MCP debugging),
   `run-isolation`/`my-stack` (the generic parallel pattern), `COMPOSITION-TESTS.md` (the tier below).
2. **Run it** — the three configs and their commands; the `cd` rule; never smoke + network on one
   worktree; run heavy suites alone; shard for wall-clock; `e2e:agent` (ports, armed build, stamps,
   exit 2/86, `E2E_REQUIRE_SETUP`); build-armed tests and how to tell an unarmed dist; env var
   catalogue; retry policy by class; CI topology (shards, heavy, canary, accelerator, `PROBE` grep,
   nightly, soak).
3. **Write a test** — testid-only + the toast exception (convention, not lint); the fixture ladder
   (`extension` → `registeredExtension` → `dappConnected…` → `tokenReady…`); helper contracts and the
   never-bypass list; assertion rules (post-action state, positive counts poll, state attributes not
   visibility, freshness-gated balance, approvable ≠ rendered, Button: check `disabled` AND
   `pointer-events`); structure rules (browser-per-file, route preconditions, rows by badge not name,
   destructive ⇒ retry 0, popups closed through the UI, storage key + shape); product couplings
   (liveness heartbeat, SW evaluate ≠ extension context, console sniffer, `runtime.reload` relaunch,
   passkey FTN scope, the first-run tab, a mid-restore kill is two deliberately gated scenarios each
   enforcing its own contract).
4. **Kill or restart the worker** — one helper, the mechanism in six lines, what not to do, the
   strictly-newer liveness gate, the stage-gate fixtures (armed ≠ reached, clear in `finally`).
5. **Diagnose a red run** — flake vs breakage and the non-negotiable rule; the discriminators; the
   local amplifier recipe (`retry 0`, `taskset -c 0,1`, N rounds, freeze the tree, host alone);
   evidence channels (`pageerror`, `readSwLogTrail`, storage probes to a JSONL, `RetryErrorReporter`,
   `.e2e-state/*.log`, MutationObserver stage trace); samplers heal the race; stack-capture attribution;
   probe-first over hypothesis trees; CI log forensics (`gh api`, source echo, attempt level); mass
   failure triage; blocked-PR evidence capture; certification rules.
6. **Flake ledger** — one table: fingerprint → mechanism → fix → status → plan link. Open items
   listed separately with the sanctioned response.
7. **Editing the harness** — global-setup coordinator rules (kept verbatim, verified); reporters
   single owner; teardown from the default export; lock ownership; no bash traps; adding a build-armed
   feature; adding a stage gate (presence-only key, safety timeout, static import for DCE).
8. **References** — plans, README, CI.md.

Rules for the text: no full local paths; no milestone tags outside the ledger's plan links; every
timing constant quoted from code; no claim the audit marked "wrong" survives in any form.

- Validation: a claim spot-check script (`grep` every backticked path/symbol in the new skill
  against the tree; zero misses) — necessary, not sufficient: a symbol that still exists can carry a
  stale explanation. So every mechanism SENTENCE in §2–§3 is read against the executable behaviour
  it describes before the post-impl codex round, and codex is asked to falsify sentences, not names.
  Universal claims about third-party behaviour (mtime ordering, `networkidle0`, swallowed stdout) are
  dropped; only their actionable precautions stay.

### Phase 3 — README + config comment (docs)

- `tests/e2e/README.md`: replace the two stale snapshots; keep everything the map verified.
- `vitest.e2e.network.config.ts` comment → "2 attempts".

## Security & adversarial considerations

- The kill helper touches only test fixtures; no product code changes. The canaries are release
  gates (frozen-address execution, passkey execution): making their restart stage REAL strengthens
  them; the risk is a genuine red on the canary lane that the fake kill was hiding — that is a finding,
  not a regression, and it blocks nothing until triaged.
- No secrets, no CI permission changes, no workflow edits. The `PROBE` grep guard is documented, not
  touched.
- Skill text is read by future agents: a wrong "rule" propagates. Hence the spot-check script and
  the codex audit's explicit ask to falsify claims against the tree.

## Post-implementation

Codex fix loop on the diff (adversarial: does any consolidated caller lose a guarantee it relied
on? does any skill sentence contradict the tree?), ≤3 rounds, then PR `test(e2e): one service-worker
kill everywhere; rewrite the e2e-testing skill` → babysit to green (quality, smoke, network incl. the
prover-ON canary). Merge on the owner's word.

## Delivery

Single PR, squash. Commits: (1) consolidate the six kill sites, (2) skill rewrite, (3) README +
config comment, (4) lessons.

## Audit outcome (codex, 2026-09-06 — `audit-codex.md`)

`plan needs changes`; all adopted above: (M) cold-wake keeps its own absence assertion as the
caller-specific guard; (M) canaries keep an absence-only path via a shared `findServiceWorkerTarget`;
(M) smoke retry-0 is `--retry=0`, prover-ON frozen ×2 under two cores + passkey ×1 prover-ON added;
(M) the "3 attempts" comment edit dropped (it is right), "two designed outcomes" reworded; (L)
universal third-party claims dropped from the skill, precautions kept. Codex confirmed A4 from
`deflake-round-3/lessons/phase-3.md` and that the other four callers need "old instance gone", which
the helper guarantees.
