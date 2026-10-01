# P4 · The wire proof and the full gate

## The new e2e test, red then green

P1, on the unfixed code (`NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0
NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/authwit-variants.test.ts
-t "in upper case"`), exit 1:

> `× authwit-callIntent — a request listing its contract in upper case starts On: the call intent
> signs without a window` · `Error: [listed-upper:callIntent] expected ok: createAuthWit seq=2
> status=error; errorJson={"message":"\"The wallet could not process the request.\""}` ·
> `Tests  1 failed | 3 skipped (4)`

P4, the same command on the fixed code, and its Firefox twin (`NULO_E2E_BROWSER=firefox
NULO_E2E_PROVERLESS=1`), three consecutive retry-0 runs each:

| Run | Chrome | Firefox |
|---|---|---|
| 1 | exit 0, `Tests  1 passed \| 3 skipped (4)`, 15.5 s | exit 0, `Tests  1 passed \| 3 skipped (4)`, 20.9 s |
| 2 | exit 0, same counts, 16.6 s | exit 0, same counts, 23.8 s |
| 3 | exit 0, same counts, 17.8 s | exit 0, same counts, 24.4 s |

The three skips are the file's other tests, left out by the name filter. Six consecutive greens:
the flake bar holds. The test was committed after run 1 passed on both browsers.

## The scoped-grant list, checked

Checked against every network spec that requests a scoped bundle or re-requests a held one:

- A scoped bundle (`transaction-listed`, `data-scopedEvents`; the fixture's `PgBundle` type has no
  `transaction-scoped`): `authwit-variants`, `cap-window`, `cap-request-partial`. All three are
  listed.
- A re-request of a held grant: `cap-window` (`transaction-listed` again, then widened to
  `transaction`), `cap-request-repeat-noPopup` (`basic` twice), `cap-widening` (`accounts`
  again). All three are listed.
- The rest of the list reaches a changed checker under a wildcard grant or none:
  `contracts-register` and `contracts-getMetadata` (`basic`, `inAddressList` on `"*"`),
  `contracts-getClassMetadata` (`contractClasses` on `"*"`), `data-privateEvents`
  (`getPrivateEvents` under `data`, with private events on `"*"` or off), `err-scope-and-cap`
  (the scope and capability refusals) and `tx-sendTx-multicall` (`transaction` on `"*"`, through
  `handleSendTx`, whose debug calls are gone).
- Outside the list: `cap-request-rerequest` re-requests the `data` bundle after a rejection, so
  nothing is held and no held address is compared. No file is missing.

## Gate

- The eleven files, `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0
  NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent <the eleven files>`: exit 0,
  `Test Files  11 passed (11)`, `Tests  21 passed (21)`, no skip.
- The same on Firefox (`NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1`): exit 0,
  `Test Files  11 passed (11)`, `Tests  20 passed | 1 skipped (21)`. The skip is cap-window's
  "reduced motion stills the Details chevron", Chrome's alone by design (BiDi cannot emulate media
  features).
- The flake bar: six of six, above.
- Smoke, each after its e2e-stamped `build:<b>` (both builds exit 0):
  - Chrome: exit 0, `Test Files  38 passed | 3 skipped (41)`, `Tests  157 passed | 7 skipped
    (164)`. The skips: `_probe-console-capture` (3), `action-popup-layout` (1), `store-captures`
    (1), one each in `sw-resilience` and `appearance`.
  - Firefox: exit 0, `Test Files  39 passed | 2 skipped (41)`, `Tests  153 passed | 11 skipped
    (164)`. The skips: `import-dead-rpc` (4), `_probe-console-capture` (3), `sw-resilience` (2),
    `store-captures` (1), `appearance` (1).
  - Every skip is a condition in its own file, none in a file this change touches.
- `bun run lint && bun run typecheck:all && bun run test:all && bun run test:ci-gating &&
  bun run build`: exit 0. Lint 29 warnings and 3 infos (unchanged), `complexity-baseline check
  OK`; every workspace typecheck exit 0; `test:all` as in P2 and P3 (extension 7842 passed,
  4 skipped, 8 todo; wallet-bridge 478; no workspace red); `test:ci-gating` 246 tests, 244 pass,
  2 skip, 0 fail; the chrome build `✓ built`, notices emitted.
- `bun run e2e:reap`: exit 0, nothing to reap.

## The codex loop

`/codex high` (GPT-6 Astra), one session, `01a0e9f5-1e9b-7d60-ac20-912584fe70df`, over
`origin/dev...HEAD` with this plan and its ledgers, both rules and the adversarial ask in each
prompt.

- **Round 1: approve, confidence high**, "Nothing material found": every scoped comparison uses
  the guarded helper, malformed keys cannot match each other, the wildcards and the out-of-scope
  behaviour are unchanged, the table's grouping agrees with enforcement for valid addresses, and
  the three interpolating logs are gone. Codex ran five unit-test files (420 tests, all passing)
  and read the e2e without running it. Two nits:
  1. `scope-enforcement.test.ts:661`: `A_MIXED` equalled `A`, since every even position of
     `"0a1b2c3d"` is a digit, so the mixed row repeated the lower-to-upper one. Verified and
     accepted: `A_MIXED` now upper-cases the first half, and the test asserts the three spellings
     differ. Own commit; lint, `typecheck:all` and `test:all` exit 0 after it.
  2. `method-scope-checkers.ts:4`: fold the header paragraph into one sentence. Rejected: the
     paragraph predates this branch except the phrase that keeps the leaf claim true, which is
     all P2 step 3 and audit-ledger row 8 ask for; `F-005` is a live security-decision marker; a
     rewrite of the header is outside this change.
- **Round 2 (resumed): approve, confidence high**, "Nothing material": the fixture now exercises
  three distinct spellings, the full diff has no missed comparison, invalid-key match, wildcard
  widening or table-check disagreement, and codex accepts the rejection of nit 2. The loop
  converged in two rounds of three.
