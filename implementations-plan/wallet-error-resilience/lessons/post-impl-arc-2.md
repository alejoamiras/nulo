# Post-implementation — arc 2 codex loop

Codex (GPT-6 Astra, `high`, read-only) over the arc-2 tools diff (`git diff 08165f16..HEAD`), the plan,
its decision log and the two arc-2 phase lessons, with the arc map, the envelope contract, the
adversarial ask and the two-products independence rule verbatim.

## Round 1 — session `01a0a855-110c-7d20-8512-01e4d9186a70`
**Verdict:** three LOW findings, nothing HIGH/MED. All three adopted.

| # | Finding | Verified? | Call |
|---|---|---|---|
| 1 | LOW — `ENVELOPE_CATEGORY` was a plain object, so a `walletErrorCode` naming an inherited property (`toString`, `constructor`, `__proto__`, `hasOwnProperty`) resolved to a bogus category via the prototype chain | yes — a hostile envelope could carry such a code | **adopted**: switched to `Map`; `normalizeError` uses `.get(code)`, so unknown/inherited names fall through to the substring rules. Cognitive score unchanged (21), `baseline:rescore` OK. Regression test in `errors.test.ts` over the four inherited names. |
| 2 | LOW — `useWalletConnection.test.ts` did not cover a `reregisterContracts` that mutates `session.wallet.value` to a replacement wallet during a successful re-registration | yes — the post-registration identity fence existed but was unexercised | **adopted**: added a case that replaces the wallet mid-reregister and asserts the original error rethrows with the op attempted exactly once. |
| 3 | LOW — `fuelClaim.test.ts` proved retry threading but did not prove the retry never submits a tx | yes | **adopted**: threading test passes a `retry` + a `simulateTx` that throws `CONTRACT_NOT_REGISTERED` once then succeeds, asserting 1 re-registration and 2 simulations. |

Fixes committed as `02f95179` (finding 1).

## Round 2 — resumed session `01a0a855-...`, over the post-`02f95179` diff
**Verdict, quoted:** "**No new material HIGH/MED findings. High confidence.**" All three original
findings "substantively resolved: the `Map` prevents inherited-key matches, the replacement-wallet
test exercises the second identity check, and the fuel test proves retry threading."

One non-material correction: the fuel threading test proved 1 registration + 2 simulations but did
not have a send spy to substantiate the "zero sends" claim. **Adopted** (commit `3597c233`): added a
`sendTx` spy to the retry-recovery case and asserted `not.toHaveBeenCalled()`. `fuelClaim.test.ts`
22/22. **Loop converged.**

## Validation gap caught at merge — the jsdom `test:e2e`
The phase-6 gate ran `test:tools` (unit) + `e2e:tools` (browser) but NOT the tools jsdom `test:e2e`
(`vitest.e2e.config.ts`), which the CI "Build Tools" job runs before the vite build. arc 2 added the
`contractsReadinessRefusal` + `retryOnUnregistered` exports to `useWalletConnection` and calls both in
the real send/exit path, and updated its OWN unit mocks — but `tests/e2e/send-smoke.test.ts` (a
dev-owned jsdom smoke that runs the real `useSend`/`useHubExit`) mocks `useWalletConnection` without
them, so it threw `No "contractsReadinessRefusal" export is defined on the mock` (9/14 failed). Fix:
stub both in that mock (`contractsReadinessRefusal: () => undefined` — the fixtures are always
connected+ready; `retryOnUnregistered` pass-through). Local `test:e2e` 29/29 + `build:mainnet` exit 0
after. Lesson: when adding an export the send/exit path imports, grep EVERY
`vi.mock("@/composables/useWalletConnection"` — including `tests/e2e/**`, not just colocated units.
