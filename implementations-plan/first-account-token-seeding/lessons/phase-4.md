# Phase 4 — regression sweep + docs

## `audit:vue` caught a regression my Phase 1 grep missed

`cross-profile-isolation.test.ts:147` had a third bare `svc(AccountService.name, {})`
stub feeding a **real** `TokenService`, so `init()` hit
`TypeError: Cannot read properties of undefined (reading 'add')` — 5 failures.
I had only grepped `services/token/`. Fixed; that file is 18/18. See the
corrected note in `phase-1.md` for the repo-wide search that would have found it.

After the fix: `audit:vue` → **392 test files passed, 2 skipped, exit 0**.

## Armed source smoke — PASS

Built Chrome with the migration fixture + testnet default + both token-seed
flags, asserted both literals present in the bundle, ran `test:e2e`:

```
ARMED_STAMP_OK · ARMED_KEY_OK
Test Files  31 passed | 1 skipped (32)
SMOKE_ARMED_EXIT=0
```

Inference 2 demonstrated: arming an EMPTY seed list changes nothing for the
existing smoke specs.

## Artifact smoke found a real regression — and a three-arm experiment attributed it

First unarmed artifact-mode run: **3 failed / 26 passed / 3 skipped**. All three
were profile-**reset** flows, all `waitForHash`/route timeouts at 10s:

- `passkey-backup.test.ts` — register → reset → import same credential
- `passkey-paths.test.ts` — register → reset → import via passkey discovery
- `security-reset.test.ts` — reset profile wipes state and routes to register

A coherent cluster, not flake — and reset is exactly where a newly-firing seed
pass could interfere, so it was worth attributing properly rather than re-running.

| run | `onAccountAdded` subscription | drpc block | result |
|---|---|---|---|
| A | on | `^NOTFOUND` | 2 fail (passkey ×2) |
| B | **off** | `^NOTFOUND` | 2 **pass** |
| C | on | **none** | 2 **pass** |

Neither factor alone breaks anything; only the combination does. So this is
**not a production defect** — in production the RPC resolves, which is arm C.
What broke was my own mitigation's *failure shape*: an unresolvable host makes
the node client retry with backoff, so a seed pass triggered by the new
registration was still in flight when the reset needed to route, blowing the
10s wait.

**Fix:** map the host to a closed local port
(`--host-resolver-rules=MAP lb.drpc.live 127.0.0.1:1`) instead of `^NOTFOUND`.
A refused connection fails immediately. Verified on the two regressed specs
**plus `fiat-display.test.ts`** in one run — the fix has to hold both properties
at once (fail fast so reset isn't delayed, and never succeed so no `token-fiat`
renders):

```
Test Files  3 passed (3)   REFUSED_EXIT=0
```

## Pre-existing artifact-mode instability, NOT caused by this change

After the block-shape fix, artifact-mode smoke still fails intermittently on
this machine, with one signature:

```
waitForProfilePurged: purge incomplete after 15000ms for profile <id>:
  {"profileRow":false,"tombstone":true}; sessionPresent=false
```

The profile row is deleted but its tombstone lingers past 15s. Affected specs
are the reset flows (`security-reset`, `passkey-backup`, `passkey-paths`), plus
`sw-resilience` failing separately with the known
`stopServiceWorker: target still alive 15s` CDP fingerprint.

**Attribution:** the identical tombstone signature appears in arm **B** — the
run with `this.accounts.onAccountAdded.add(...)` removed entirely. It is
therefore not caused by this change. It is also intermittent: one isolated
3-spec run (passkey-backup + passkey-paths + fiat-display) passed all three with
the fix, while a later isolated run including `security-reset` failed all three.
That load-sensitivity, on a box that had been running heavy suites back-to-back
for an hour, matches the repo's known smoke-flake profile.

**Not chased further locally, deliberately:** artifact mode is the release /
nightly path (`_smoke-e2e.yml` takes the artifact only when `artifact_name` or
`extension_path` is supplied). The PR gate `smoke-e2e-status` builds from
source, and that mode is green (31 passed). Left for CI's clean runners to
adjudicate, and surfaced to the owner rather than absorbed.

## Why the DNS block does not weaken a gate

`fiat-display.test.ts`'s own docstring already states its premise as "the smoke
sandbox chain has no price-mapped tokens, and **no network fetch succeeds
here**". Before this change nothing ever called out, so the premise held by
accident. The block makes it true by construction. Successful end-to-end seeding
is proven by the Phase 3 sandbox spec, not by artifact smoke.

## Full network suite — PASS

```
NULO_E2E_PROVERLESS=1 bun run e2e:agent
Test Files  1 failed | 71 passed | 2 skipped (74)
```

(The first attempt aborted immediately with `FATAL: this run includes
proverless-gated test file(s) but NULO_E2E_PROVERLESS is not set` — the full
suite must be run proverless locally.)

The single failure was `network/wallet-locked-mid-session.test.ts`, signature
`Expected no popup but 1 new popup target(s) appeared: …#/popup/auth`, i.e. an
auth popup during a lock-mid-flow spec — nothing seeding-related. Re-run alone
per the repo's flake policy:

```
NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/wallet-locked-mid-session.test.ts
Test Files  1 passed (1)
```

Flake, not breakage. **71 network spec files passing is the real evidence for
Inference 2**: the new trigger fires in every one of them that registers a
profile, and none of them noticed.

## Validation gate — PASS

| part | result |
|---|---|
| `bun run audit:vue` | exit 0 — 392 test files passed, 2 skipped |
| armed source smoke (build + `test:e2e`) | 31 passed, 1 skipped, exit 0 |
| unarmed artifact-mode smoke | regression found and fixed; residual failures reproduce with the change removed (see above) |
| `bun run e2e:agent` (full network) | 71 passed, 2 skipped, 1 flake green on isolated re-run |
