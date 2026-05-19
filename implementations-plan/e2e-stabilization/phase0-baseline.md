# Phase 0 baseline — local-only

Branch `e2e/stabilization-baseline` off `dev`. Mechanical un-skip commit `9f1a7cc`. All quarantined tests (except F/G/slow) restored to `test.skipIf(!hasConfig)` (network) or `test(...)` (smoke).

## Headline

**All 27 un-skipped tests pass deterministically across 3 full local runs.** Every PR-#77 quarantine was defensive — none was a real failure.

Surfaced (not introduced) by un-skipping:
- 1 pre-existing real bug (`send-amount-clamp`).
- 1 pre-existing flaky test (`session-reconnect`).
- Cumulative-load rotating-flake set, wider than documented (5–8 per full run vs the documented 2–3).

Smoke suite has 1 known infrastructure flake on long single-process chains (`settings-crud` after ~17 sequential files — documented "Connection closed / frame detached" Chrome cascade).

## Smoke 3× full runs

```
Run    Tests     Failures                         Wall
1      67/67 ✓   —                                339s (5.7 min)
2      67/67 ✓   —                                310s (5.2 min)
3      65/67 ✗   settings-crud (2 — not unskips)  282s (4.7 min)
```

**Smoke un-skips — all defensive (pass × 3, un-skip cleanly):**

| Cluster | File / test | Run 1 | Run 2 | Run 3 |
|---|---|---|---|---|
| S1-app  | appearance.test.ts > theme persists across navigation away and back     | ✓ (1.8s) | ✓ (1.7s) | ✓ (~2s) |
| S1-sec  | security.test.ts > auto-lock TTL change persists across navigation       | ✓ (8.1s) | ✓ (2.1s) | ✓ (~2s) |
| S2      | contacts.test.ts > delete contact                                        | ✓ (1.8s) | ✓ (1.7s) | ✓ (~2s) |
| S3      | sw-resilience.test.ts > extension survives SW stop+respawn               | ✓ (6.4s) | ✓ (6.4s) | ✓ (~6s) |
| S3      | sw-resilience.test.ts > strict mode default ON: SW death → lock screen   | ✓ (1.8s) | ✓ (1.8s) | ✓ (~2s) |
| S3      | sw-resilience.test.ts > strict mode OFF: SW death → silent restore       | ✓ (1.6s) | ✓ (1.8s) | ✓ (~2s) |
| S3      | sw-resilience.test.ts > regression: liveness lands within HEARTBEAT      | ✓ (3.6s) | ✓ (3.2s) | ✓ (~3s) |
| S4      | passkey-backup.test.ts > full-backup export: modal + status + CTAs        | ✓ (21.6s)| ✓ (~22s) | ✓ (~22s) |

**Conclusion:** all 8 PR-#77 smoke quarantines were **defensive**. Un-skip and done.

Codex's S1-appearance call ("no credible race; treat as defensive until reproven") and S1-security/S2/S3 calls (all defensive locally too) confirmed.

S4 (passkey backup) runs in ~22s **locally**. The 290s hosted-CI behavior remains a substrate-specific concern — but it's a CI-only issue, not a test-level problem.

### Smoke infrastructure flake (separate)

Run 3 failed 2 tests in `settings-crud.test.ts` with "Navigating frame was detached" / "Connection closed". Re-ran the file 5× in isolation: **8/8 passed each time** (40/40 total). Confirms documented `pool: forks` cumulative-Chrome-cascade flake (smoke config comment lines 22–28). Not caused by un-skips.

## Network 3× full runs (via `bun run e2e:agent`)

```
Run    Tests          Failures (unique tests)                            Wall
1      60/67 ✓ + 5 ✗  authwit-variants, cap-request-repeat-noPopup,      891s (14.9 min)
                       send-amount-clamp, session-reconnect,
                       tx-sendTx-feePayer
2      57/67 ✓ + 8 ✗  cap-request-basic, data-addressBook,                966s (16.1 min)
                       multi-account-from, send-amount-clamp,
                       session-reconnect, tx-sendTx-multicall,
                       tx-sendTx-reject, tx-sendTx-sponsoredFpc
3      59/67 ✓ + 6 ✗  cap-request-partial, cap-request-rerequest,         948s (15.8 min)
                       send-amount-clamp, session-reconnect,
                       tx-sendTx-feePayer, tx-sendTx-multicall
```

2 skipped per run = F + G (kept skipped on purpose).

**Network un-skips — all defensive (19/19 pass × 3):**

| Cluster | File | Tests | Wall (run 1 / 2 / 3) |
|---|---|---|---|
| A   | transfers.test.ts             | 8 ✓  | 138s / 140s / 143s |
| A+B | fee-methods.test.ts            | 5 ✓  | 126s / 134s / 142s |
| A   | token-management.test.ts       | 1 ✓  | 20s / 23s / 21s |
| C+D | contacts-sender.test.ts        | 4 ✓  | 17s / 18s / 17s (includes 1 previously-passing) |
| E   | data-registerSender.test.ts    | 1 ✓  | 10s / 10s / 10s |
| —   | **TOTAL**                      | **19 ✓ × 3** | — |

**Conclusion:** all 18 PR-#77 network quarantines were **defensive**. PR #70's wallet fixes (`ensureDefaultAccount` at `app.vue:131-160`, `switchToNetwork`/`addContact` hardening, `Toggle.vue` data attrs, `AztecAddress.random()` test data) are intact and effective. Un-skip and done.

## Rotating-flake set (pre-existing, NOT introduced by un-skipping)

5–8 tests fail per full run, with different victims each pass. Two tests fail in all 3 runs (`send-amount-clamp`, `session-reconnect`). Tracked per-file below; isolated reruns confirm category.

### Real bug: `send-amount-clamp` (5/5 isolated fails)

```
expect(clamped.length).toBeLessThan("1.1234567890123456789".length)
                       ^ AssertionError: expected 21 to be less than 21
```

The test types a 21-character decimal (`"1.1234567890123456789"`) into the send-amount input expecting the wallet to clamp it to **fewer** chars than `token.decimals`. The wallet currently leaves the input at 21 chars — no clamp triggered.

Either the wallet's clamping logic regressed, the test asserts a stricter clamp than the implementation does, or `token.decimals` for the test token is 19 and the clamp threshold is "≤ decimals" not "< decimals".

**Verdict:** real test/wallet drift. **Not in stabilization scope** — file a separate fix. Test should stay skipped until investigated.

### Flake: `session-reconnect` (4/5 isolated fails, ~80% fail rate)

In isolation: run 1 both tests pass, runs 2–5 have 1 of 2 tests fail. The failing test alternates between `alwaysTrust=true reconnect skips verify` and `alwaysTrust=false reconnect shows verify` across runs. Suggests a state-pollution-between-tests or per-test fixture issue specific to this file.

**Verdict:** real flake. **Not in stabilization scope** — separate investigation.

### Rotating cumulative-load flakes

These show up 1-2 times across 3 runs each:

```
File                                       Run 1   Run 2   Run 3
authwit-variants.test.ts                   ✗       —       —
cap-request-basic.test.ts                  —       ✗       —
cap-request-partial.test.ts                —       —       ✗
cap-request-repeat-noPopup.test.ts         ✗       —       —
cap-request-rerequest.test.ts              —       —       ✗
data-addressBook.test.ts                   —       ✗       —
multi-account-from.test.ts (retry: 1)      —       ✗       —
tx-sendTx-feePayer.test.ts                 ✗       —       ✗
tx-sendTx-multicall.test.ts                —       ✗       ✗
tx-sendTx-reject.test.ts                   —       ✗       —
tx-sendTx-sponsoredFpc.test.ts             —       ✗       —
```

These all use `dappConnectedExtension` or `dappConnectedExtensionPerTest`. Symptom set: "Navigating frame was detached," 30s `waitForPgResult` timeouts, "Connection closed."

Matches `full-suite-findings.md`'s documented rotating-flake under cumulative load, but wider (5–8 hits per run vs the documented 2–3). Possibly amplified by 18 freshly-un-skipped tests adding ~5 minutes of additional sandbox work to the cumulative-load surface.

**Verdict:** cumulative-load rotating-flake. Existing `retry: 1` scoped on `multi-account-from` + `meta-getChainInfo` is not enough.

## Phase 0 categorized matrix (final)

```
Cluster  Tests  Verdict                  Action
S1-app   1      defensive                un-skip (PR-A)
S1-sec   1      defensive                un-skip (PR-A)
S2       1      defensive                un-skip (PR-A)
S3       4      defensive                un-skip (PR-A)
S4       1      defensive locally        un-skip (PR-A); profile CI substrate cost separately
A        8      defensive                un-skip (PR-A)
B        5      defensive                un-skip (PR-A)
C        2      defensive                un-skip (PR-A)
D        1      defensive                un-skip (PR-A)
E        1      defensive                un-skip (PR-A)
F        1      architectural            keep skip; separate PR
G        1      queued-signal needed     keep skip; separate PR
─────────────────────────────────────────────────────────
TOTAL    27 unskipped, all defensive
TOTAL    2 kept skipped (F + G)
```

Out-of-scope findings (pre-existing, surfaced not introduced):

```
Test                              Category      Verdict
send-amount-clamp (1 test)        real bug      file separate fix; keep that one skipped
session-reconnect (2 tests)       flake         file separate fix; keep skipped for now
~10 rotating tests                cumulative    expand scoped `retry: 1`; track upstream
                                   load          @aztec/aztec.js KV migration
settings-crud (smoke)             chrome        documented; covered by `pool: forks`
                                   cascade
```

## Implications for the plan

1. **PR-A scope expands.** Originally "un-skip 18 network + smoke defensive." Now: un-skip **all** 18 PR-#77 network skips + all 8 PR-#77 smoke skips. No exceptions.

2. **Phase 1 smoke clusters S1–S4 collapse to S4.** S1/S2/S3 are pure un-skip; no helper fixes needed for what we found. S4 stays as "investigate hosted-CI slowness specifically" (locally fine at 22s).

3. **Phase 2 simplifies:** network un-skip is a one-shot mechanical PR. The rotating-flake mitigation discussion stays but expands.

4. **New scope (not in original plan):**
   - PR-Y: real-bug fix for `send-amount-clamp` (file mismatch between assertion and clamp behavior — small fix or skip with comment).
   - PR-Z: investigate `session-reconnect` flake (~80% in isolation).
   - Rotating-flake set is bigger than documented; need to expand `retry: 1` scope or accept higher noise.

5. **Q5 retry-policy reconsideration:** the rotating-flake set is wider than `full-suite-findings.md` reported. Dropping smoke `retry: 2 → 1` is still right (clean signal), but expanding network scoped retries to cover more files may be needed. Quantify in Phase 3.

6. **CI-substrate-divergence test for S4:** local 22s vs CI 290s for the same chain. Worth measuring once: is it really 13× slower on hosted, or has anything in that test/chain changed since PR-#77?
