# Gate convergence — bun-native-tooling (Arc D)

Owner absent; the standing decision protocol applies: every clarifying question and the approval gate resolve by iterating with codex (xhigh, resumed for pushback) until both sides are satisfied; the arc proceeds only on an explicit fresh-context `approve`. Convergence failing after 3 rounds, or any reserved line (merging, required checks, `@aztec/*`, publish/deploy, feature removal, irreversible data ops) → STOP and surface.

Pre-flight: `codex login status` → "Logged in using ChatGPT" (2026-08-25).

## Round 1 — fresh session `01a03791-59b8-78b3-aee5-efb9b29ac26a` (gpt-5.6-sol, xhigh, read-only): plan v1 + recon + the eight clarifying questions

Verbatim verdict: "conditional approve — conditions: make errors secret-safe; close target-program injection; correct `cast` precedence; preserve all domain/soft-fail semantics; and tighten the no-orphans and dual-runtime gates."

| # | Finding | Verified | Disposition (plan v2) |
|---|---|---|---|
| High | `RunError.message` with raw argv would persist `PRIVATE_KEY` (`live-intent.ts:211,339` pass it to `cast`) | ✓ (`cast(["wallet", "address", "--private-key", pk])` at both lines) | adopted — no argv on the error object; sentinel-secret test (Q2, D-2) |
| High | Argv stops shell injection, not hostile flags: `verify-l1.ts:99` parses untyped JSON and passes manifest fields to forge; `live-intent` passes `intent.signer` + key material; git needs `--end-of-options` / `--` / `--literal-pathspecs` per site | ✓ (`config = JSON.parse(...)` at :99 → forge args :141-200; `intent.signer` at :406,416; git 2.53 accepts the flags) | adopted — per-site git forms; `parseCandidateManifest` in verify-l1 (the schema's own contract; strict + `.strict()`); `requireAddress` on `intent.signer`, key shape check (Q8, D-3). Consequence surfaced as D-10: the legacy TokenPortal branch becomes unreachable — both live manifests are `forked-v1` |
| High | `runForge()` interprets non-zero output ("already verified", dry-run JSON); conductors soft-fail; keep the domain helpers | ✓ (`verify-l1.ts:74-97`, `deploy-bridge-*`) | adopted — `check: false` there; `runForge`/`buildForkInL1Root` stay (Q3, D-4) |
| High | Cast order `CAST_BIN → PATH → current → legacy` is not behaviour-preserving (today: always legacy) | ✓ | adopted — `CAST_BIN → current → legacy → PATH` (D-5) |
| Med | `check: false` returns the full result; per-call options only; drop `timeoutMs` | ✓ | adopted (D-6) |
| Med | `--no-orphans` probe must use controlled PIDs, never a real sibling; Bun docs now specify the semantics | ✓ (bunfig docs fetched: `PR_SET_PDEATHSIG` + `/proc` descendant walk on Linux; kqueue/libproc on macOS; Job Object on Windows — codex's "Linux/macOS only" is slightly stale, Windows is documented too) | adopted — controlled fixture design in Q4; recon corrected (D-7) |
| Med | Dual-engine claim vs the gate (full suite on Node, `run.test.ts` on Bun); run the key-free `verify-l1 --dry-run` | ✓ (forge on PATH here; baseline captured: 4 ✓ lines) | adopted — honest criterion in Phase 0; before/after dry-run in Phase 1 (D-8) |
| Low | `live-intent.ts` already guarded (Q5 premise); I3 is a design guarantee; F3 is 1.3.14-declaration evidence | ✓ | adopted (D-9) |

Rulings Q1–Q8: Node API approved; contract corrected; preserve warnings + non-zero interpretation; `--no-orphans` off with the controlled probe; tests import only the primitive; real subprocesses both engines, no skips, no timeout coverage; base `dev`, no stack; the two fixes accepted with corrected precedence + secret-safe diagnostics as the third.

Rejected: nothing. Open for round 2: D-10 (delete the dead legacy branch under strict validation, or keep a validated legacy path).

## Round 2 — resumed, plan v2

Pending.
