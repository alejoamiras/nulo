# Post-implementation codex loop (2026-09-06)

## Round 1 — `not converged` (0 High, 9 Medium, 7 Low) — response (verbatim)

Confidence: **high**. Findings concern documentation; no High finding.

- **Medium — [Skill:245](.claude/skills/e2e-testing/SKILL.md:245):** `readSwLogTrail` requires `developerMode`, disabled in E2E fixtures (`fixtures/journal.ts:223`). Document enabling retention before reproduction; waiting longer cannot recover unretained logs.
- **Medium — [Skill:103](.claude/skills/e2e-testing/SKILL.md:103):** The smoke build recipe omits `VITE_NULO_E2E_TOKEN_SEEDS=1` and `_CONFIRM=1`. Add both; `_smoke-e2e.yml:76` explains the otherwise-live RPC dependency.
- **Medium — [Skill:107](.claude/skills/e2e-testing/SKILL.md:107):** Build-armed does not imply proverless. Restrict that marker to proverless dependencies; §6’s arbitrary `@requires-*` markers have no scanner. Also qualify line 68: `agent.sh:27` scans literal paths, not Vitest filename filters.
- **Low — [Skill:78](.claude/skills/e2e-testing/SKILL.md:78):** “Every stamp” is false—price-map lacks an assertion. Line 95’s universal timeout claim also contradicts existing `beforeAll` stamp failures. Enumerate checked flags and distinguish guarded tests.
- **Medium — [Skill:86](.claude/skills/e2e-testing/SKILL.md:86):** Repeated ordinary runs cannot demonstrate reuse: `global-setup.ts:843` tears down processes and clears ownership. Correct this and §6’s reuse/reap drill to require a surviving prior pack.
- **Medium — [Skill:175](.claude/skills/e2e-testing/SKILL.md:175):** The fixture ladder invents inheritance. Capability fixtures are per-test (`extension.ts:587`); local/token fixtures independently launch browsers. Describe branches and scopes.
- **Medium — [Skill:199](.claude/skills/e2e-testing/SKILL.md:199):** Instant zero can precede the action’s effects. Require completion evidence or a bounded observation before asserting absence.
- **Medium — [Skill:237](.claude/skills/e2e-testing/SKILL.md:237):** The old worker can heartbeat between snapshot and kill (`runtime.ts:254`). “Strictly newer” alone does not establish replacement readiness. Use a post-stop timestamp threshold; correct the frozen-canary comment too.
- **Medium — [Skill:266](.claude/skills/e2e-testing/SKILL.md:266):** Persisted-record survival is passkey-specific: password restoration silently deletes bearerless records (`session-manager.ts:533`). Scope the explanation and mandatory workaround.
- **Medium — [Skill:309](.claude/skills/e2e-testing/SKILL.md:309):** Restore/incoming gates require matching payloads; token seeds have independent arming. Safety timeouts warn and resolve, rather than fail tests. Document each protocol and require assertions detecting unintended release.
- **Low — [Skill:54](.claude/skills/e2e-testing/SKILL.md:54):** Network teardown also pkills Chrome (`global-setup.ts:868`). Remove the persistent-shell-cwd claim at line 60; root `test:e2e` explicitly delegates.
- **Low — [Skill:145](.claude/skills/e2e-testing/SKILL.md:145):** Smoke filtering applies across base branches. Document accelerator-disable and probe-mode exceptions to lines 154–156.
- **Low — [Skill:223](.claude/skills/e2e-testing/SKILL.md:223):** Scope name avoidance to imported accounts. `open()` updates reactive state; an unchanged open boolean prevents remounting, not permanent file-wide death.
- **Low — [Skill:240](.claude/skills/e2e-testing/SKILL.md:240):** Worker evaluation uses its main context. Retain page-based probes as a lifecycle precaution. Scope console interception to sniffed extension methods; original-console calls remain observable.
- **Low — [Skill:274](.claude/skills/e2e-testing/SKILL.md:274):** Both canaries explicitly await mining. Describe `sendTx` result semantics without claiming transfers is unique.
- **Low — [Lessons:63](implementations-plan/e2e-skill-refresh/lessons/phase-1.md:63):** An open port alone provides no keepalive. Cite actual heartbeat/RPC traffic; remove the unsupported crash/update restriction. [Chrome lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

The consolidation preserves caller checks. The passkey lock sequence is sound (`route-guard.ts:30`, `app.vue:214`); its event-loss diagnosis is correct. README replacements are acceptable.

not converged

## Round 1 — triage

Code, the passkey diagnosis, and the README were confirmed; every finding is a skill or lessons
sentence, which is exactly the falsification the round was asked for. All adopted:

- M `readSwLogTrail` needs Developer Mode — stated, with "empty = not retained".
- M smoke build recipe — the token-seed pair added, with the reason.
- M/L `@requires-proverless` is the only scanned marker; `agent.sh` scans literal paths; the stamp
  assertions are enumerated (price map has none); guarded tests fail fast, unguarded ones time out.
- M reuse requires a SURVIVING pack (teardown clears ownership) — §1 and the §6 drill corrected.
- M fixture ladder → a sibling table with real scopes (capability fixtures are per-test).
- M zero-count reads need completion evidence first.
- M liveness threshold — the rule now names the post-stop read; the pre-kill snapshots in the callers
  are called out as the weaker pattern and logged as a follow-up (phase-1.md).
- M popup-outlives-restart — record survival scoped to passkey profiles.
- M stage gates — per-gate protocols, acks, and "safety timeouts release, they do not fail".
- L both setups pkill at teardown; the shell-cwd line dropped; gating nuances (`main` target, label,
  dispatch; `disable_accelerator`; the `probe` exception); name rule scoped to imported accounts;
  popup force-clear consequence stated precisely; worker-target evaluate reframed as the
  host-parking hazard; console interception scoped to sniffed methods; both canaries await mining.
- L lessons: an open port is not a keepalive — traffic is.

## Round 2 — `not converged` (3 Medium, 5 Low) — response (verbatim)

Confidence: **high**.

- **Medium — [Skill:343](.claude/skills/e2e-testing/SKILL.md:343):** Incoming polling neither takes a phase selector nor writes `held`. It matches `{profileId, networkId, accountAddress, contract, txHash}` and writes `{phase:"discovery-held", txHash}` to a separate status key (`chrome-storage-incoming-poll-gate.ts:15,50,77`). Describe the two protocols separately.

- **Medium — [Skill:262](.claude/skills/e2e-testing/SKILL.md:262):** A post-stop storage read can already contain the replacement’s heartbeat; it is not necessarily the old worker’s final value. Waiting for another tick is unsuitable as a mechanical replacement in the first-heartbeat timing test (`sw-resilience.test.ts:211`). Correct this and the lessons’ claim that later waits always absorb the weakness.

- **Medium — [Skill:348](.claude/skills/e2e-testing/SKILL.md:348):** Journal stage `proving` is written before entering the gate (`execution-coordinator.ts:195,147`) and remains during actual proving. Require evidence excluding timeout release; the journal stage alone does not prove parking.

- **Low — [Skill:184](.claude/skills/e2e-testing/SKILL.md:184):** `dappConnectedExtension` consumes and mutates `registeredExtension` (`extension.ts:560,572`). Document this shared-browser exception.

- **Low — [Skill:249](.claude/skills/e2e-testing/SKILL.md:249):** “Changes nothing reactive” remains false (`popup.store.ts:18`). Say the open boolean stays true despite reactive payload/order updates.

- **Low — [Skill:98](.claude/skills/e2e-testing/SKILL.md:98):** Delete unconditional “does not error.” At line 116, change “guard themselves” to “need their own guards”; `default-token-seeding.test.ts:27` lacks one.

- **Low — [Skill:163](.claude/skills/e2e-testing/SKILL.md:163):** `probe` is a reusable-workflow input, not an exposed dispatch option. Name `_network-e2e.yml`’s `probe == "1"` condition.

- **Low — [Skill:265](.claude/skills/e2e-testing/SKILL.md:265):** Zero also means missing data or another read failure (`sw-resilience.test.ts:224`). Say “invalid/unavailable baseline.”

Deferring caller changes is reasonable. The follow-up must preserve cold-wake’s prohibition on opening an extension page before the discovery click. The frozen-canary comment is accurate.

not converged

## Round 2 — triage

All adopted: the two ack protocols described separately (restore gate acks `held` on its record;
the incoming-poll gate matches five fields and publishes phases on a status key); the journal's
`proving` stage no longer offered as proof of a park; the post-stop read described honestly (it may
be the replacement's first write — fine for recovery gates, wrong for `sw-resilience`'s
first-heartbeat timing) and the lessons' "later waits absorb it" softened; "does not error" made
unconditional-free and "guard themselves" → "need their own guard" with `default-token-seeding` as
the unguarded example; `probe` named as the reusable workflow's input; `dappConnectedExtension`'s
shared-browser exception documented; the popup-store sentence made precise; a 0 baseline read as
invalid/unavailable. Codex confirmed deferring the eight-caller threshold change and noted the
constraint for that follow-up: cold-wake must not open an extension page before the discovery click.
