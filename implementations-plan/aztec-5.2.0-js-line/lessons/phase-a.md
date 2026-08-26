# Phase A — accelerator-server 2.0.0 (PR-0)

## Behavior diff (1.0.6 → 2.0.0), from release notes + headless README + source at tag

- Origin model UNCHANGED from 1.0.6's SEC-01c: deny-by-default for non-localhost browser
  origins; `ALLOWED_ORIGINS` allowlist or `ACCEL_ALLOW_ALL=1` (mutually exclusive, fails loud).
  The in-repo adjudication (unpacked-extension id unknowable → allow-all in single-tenant CI)
  carries over verbatim. Least-privilege `ALLOWED_ORIGINS` remains impossible for the same
  reason it was at 1.0.6.
- Listener: loopback-only, hardcoded `127.0.0.1:59833`, no port/bind flag; plus SEC-01a
  loopback `Host`-allowlist (DNS-rebinding guard, 403 `invalid_host`). The plan's "explicit
  bind flag" adaptation is N/A — the bind is hardcoded tighter than a flag would be; asserted
  via `/health` instead.
- HTTPS/first-run wizard are DESKTOP-app features; the headless server has neither (standalone
  binary, no Tauri/WebKit/GTK). No CI flag changes needed for them.
- `BB_BINARY_PATH` env still supported: "bypasses the auto-download". bb is otherwise fetched
  per the SDK's `x-aztec-version` request and cached in `~/.aztec-accelerator/versions/`
  (multi-version cache; shared machine-wide).
- `/health` shape at 2.0.0 adds `available_versions` + `runtime.available_parallelism`;
  `bb_available` (the CI Layer-1 gate) still present. Observed live:
  `{"api_version":1,"available_versions":["unknown","5.2.0"],...,"version":"2.0.0"}`.
- Log literals re-verified at the tag: `Received /prove request`
  (`core/src/server/prove.rs:228`), plus `Requested Aztec version` (prove.rs:73) and
  `Version not cached (or unverified), will download` (prove.rs:110) — the latter two are the
  D3 evidence lines. The workflow's enforcement grep stays valid.
- `tx-sendTx-default.test.ts:24` note ("1.0.1 only covers createChonkProof"): 2.0.0's prove
  route remains the single `/prove` (ClientIVC bundle) — no per-phase proof split; the test's
  rationale is unchanged.
- Tarball: sidecar sha256 verified (`eb91bd9d…` = computed). EXTRACTED binary sha256 =
  `443d5f7b485d5ec430a4fe0ffc277cbd4cedbb285073ffae9ca3ee83dda10a22` → pinned as
  `expected_sha256`. TOFU honesty: the sidecar is same-origin transport checking; the
  repo-pinned SHA verified every CI run is the real control. Release:
  `accelerator-v2.0.0` (published 2026-08-18), asset
  `accelerator-server-2.0.0-linux-x86_64.tar.gz`.

## Workflow edits (committed)

`_network-e2e.yml`: version 1.0.6→2.0.0 + new sha; comment refresh (bb decoupling); SEC-01c
comment extended to 2.0.0; the advisory activity step converted to ENFORCED fail-on-zero
(owner-approved Ask 5) — `disable_accelerator` still skips the step, preserving the rollback
lever. `bun run lint:actions` clean.

## Local pre-flight canary (old 5.0.1 line + release 2.0.0 binary)

- Port 59833 was held by a sibling agent session (accelerator repo, registered in
  ~/.agents/ports.md). Coordinated via SendMessage; they killed their own pgid and deregistered;
  my claim registered in ports.md; my server (release 2.0.0, `ACCEL_ALLOW_ALL=1`,
  `BB_BINARY_PATH` seeded from the 5.0.1 toolchain) came up healthy (`"version":"2.0.0"`,
  `bb_available:true`).
- D3 early evidence: the seeded binary registers in the shared version cache as the literal
  `"unknown"` (upstream alejoamiras/aztec-accelerator#352 — sentinel instead of Option::None).
  Peer intel (accelerator session): the SDK matches advertised versions EXACTLY (bb proving
  keys are version-sensitive) — so a seed registered as "unknown" cannot satisfy an
  `x-aztec-version: 5.0.1` request; expect a fresh 5.0.1 download on first prove even with the
  seed present.
- Canary run RESULT: **GREEN** — `Test Files 1 passed (1)`, `Tests 2 passed (2)`, `CANARY_RC=0`;
  server log: `prove_requests=3`, 3× `Proving succeeded`. Gate satisfied with `/prove`
  evidence on the 5.0.1 line against the release 2.0.0 binary.

## D3 — DECIDED EARLY; mechanism CORRECTED by upstream source trace

Observed with a genuine bb-5.0.1 seeded via `BB_BINARY_PATH`: `Requested Aztec version
version=5.0.1` → `Version not cached (or unverified), will download version=5.0.1` →
`Download complete ... bytes=8108654` (<1s) → 3× `Proving succeeded`; the seed registers in the
cache as the literal `"unknown"` (upstream alejoamiras/aztec-accelerator#352).

My first reading — "the seed can never serve a versioned request; the download served the
proofs" — was **INVERTED**, per the accelerator session's trace of the v2.0.0 tag: `find_bb`
step 0 returns `BB_BINARY_PATH` UNCONDITIONALLY, so the SEEDED binary served all three proofs
and the logged download was dead weight. The two were indistinguishable here only because the
seed WAS bb-5.0.1. Consequence: a version-mismatched seed (e.g. post-bump CI seeding the 5.2.0
toolchain's bb while the SDK requests 5.0.1) would SILENTLY prove with the wrong bb while the
log claims the right one was downloaded — the exact "silently-wrong seed" failure D3 exists to
prevent. **Drop stands, with a stronger rationale: the seed is a footgun, not an optimization.**
Dropped in PR-0; bump-PR Phase 5.1 is a no-op; Phase 3/4 local servers must run UNSEEDED for CI
fidelity (the Phase A local run's proofs used the seeded 5.0.1 binary — same bytes as the
download, so the canary's validity is unaffected). Evidence folded into upstream #352 by the
accelerator session (upgraded from modeling wart to interaction bug).

## Unseeded rerun (codex L1) — the post-diff CI configuration, validated

Server restarted UNSEEDED with an ISOLATED empty cache (scratch `HOME`): `/health` showed
`bb_available:true` on the cold cache (CI's Layer-1 wait is safe pre-download; the `"unknown"`
sentinel appears even seedless). Canary rerun: **2/2 green, `CANARY_RC=0`,
`proving_succeeded=3`**, with the genuine download path in the log
(`Requested Aztec version version=5.0.1` → `Version not cached … will download` →
`Download complete … bytes=8108654` → `Proving succeeded`). No seed present, so the proofs are
unambiguously served by the downloaded bb-5.0.1 — the exact merged-workflow behavior.

## Machine notes

- `~/.aztec/current` already pointed at 5.2.0 BEFORE any action of ours (5.2.0 toolchain was
  pre-installed on this machine); snapshot recorded, nothing mutated.
- Port 59833 was coordinated (peer released; our claim registered in ~/.agents/ports.md with
  a pgid file; drop the row + kill own pgid at window end).
