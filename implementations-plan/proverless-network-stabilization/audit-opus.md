# Opus (fable-substitute) audit transcript — proverless-network-stabilization

`claude-fable-5` was inaccessible as a subagent, so the architect/auditor subagent ran on **opus**
(independent context — what the deep tier requires). Two touchpoints. Paths repo-relative.

## Round 1 — independent plan draft (Plan C)

Opus drafted a full independent plan and **caught the brief's load-bearing `protocolTimeout` error**
(verified `300_000` at `tests/e2e/fixtures/extension.ts:52`), plus:

- The **journal-records concurrency pattern already exists + is sound** (`concurrent-sendtx.test.ts:109-132`) — Mode 1's fix is to apply the proven sibling pattern, not invent.
- **Modes 3/4 must be triage-first** (read the captured `errorJson`/sandbox tail before any fix) — a gas-multiplier bump could mask a real serialization bug.
- The **proof-gate is already a typed injected collaborator**; the only inline-hack debt is the test-side read.
- New **Phase: pin the proverless-can't-ship guards as unit tests first** — a green proverless required-suite could otherwise mask a weakening of that guard.
- Argued for a **fail-closed filter inversion** over a broaden-allowlist; zero-flake needs a soak budget + zero-retry acceptance.

## Round 2 — fresh hostile audit of the consolidated plan (new opus context, no anchoring)

**Verdict: `conditional approve`** — 6 conditions:
1. **Phase 3's gate can pass without fixing Class B** — "container 10× OR soak" lets container-green (which may never repro the freeze) rubber-stamp it. Require a real-runner soak; delete the OR-container alternative.
2. **The watchdog contradicts the freeze model** — a CDP liveness ping hangs when the CDP channel is dead; specify an out-of-band mechanism + bound false-red risk vs the 300s cold-boot.
3. **Ship the fail-closed filter by default** (run on all `packages/extension/src/**`), not an enumerated allowlist routed to a user decision.
4. **SHA-pin `checkout@v6` + `paths-filter@v4`** — they run in the trusted pre-gate jobs.
5. **Drop the already-done `docker-ci-like.sh` file-arg task** (`:127` already branches on `*.test.ts`); re-scope the helper migration to the real call sites.
6. **Assume run-27570686950 expired; front-load a fresh failing run.**

Also flagged: Phase 5 soak re-invents inputs `_network-e2e.yml` already exposes (`test_files`/`disable_accelerator`/`proverless`); the `disable_accelerator` repo-var can silently neuter the canary once required; the journal read runs inside `page.evaluate` so a frozen channel breaks it too (journal-truth is immune to *timing* races, not freeze/settle).

**Verification of opus's claims (main agent, against source):**
- Docker file-arg ALREADY EXISTS (`docker-ci-like.sh:127`) — **confirmed**; Phase-0 task dropped (D5).
- Migration scope: opus said "15+ sites across 10 files incl `aztec.ts`" — **overcounted**. Actual = **6 real call sites**; `aztec.ts`/`concurrent-sendtx-confirm`/the unit test only *mention* the helper in comments. Scoped to 6.
- Float-pinned actions — **confirmed**.

**Disposition (all 6 conditions addressed):** D14 (real-runner gate), D3 (Node-side wall-clock watchdog, bounded above 300s), D7 (fail-closed default), D13 (SHA-pin), D5 (drop dead work + 6-caller scope), Phase 2 (fresh failing run). Phase 5 re-scoped to a loop-wrapper over existing inputs; canary-var + frozen-channel caveats folded into Security + the narrowed journal-truth claim.

## Round 3 (final) — n/a

The final gating pass is a fresh-context codex session (see `audit-codex.md` Round 3).
