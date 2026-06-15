# dev network-e2e regression — ROOT-CAUSED + FIXED (separate from Q1 / PR #91)

**Not the registry refactor's bug.** PR #91 (Q1) is clean and merged. This documents the dev network-e2e red that PR #91's labeled run *surfaced*, now root-caused and fixed.

## Symptom
`pr-network-e2e.yml` red on dev: shards 1/3/5 fail under proverless. All failures are **timeouts** (`waitForSendTxActiveStage` / `waitForPgResult`), zero authz/assertion errors.

## Root cause (corrected — earlier "2-account fixture hang" was a red herring)
**`waitForSendTxActiveStage` (tests/e2e/fixtures/popups.ts) raced the proverless fast-completion.** It opened the wallet popup *after* approve, then polled the rendered `tx-awaiting-card` for a transient active stage (`simulating`/`proving`/`submitting`). Under proverless, fake-proofs collapse the proving delay: the sendTx goes `pending → simulating → succeeded` in **~3s** (proven by a journal-record probe: `stage=simulating` at t=0s, `stage=succeeded` at t=3s). Meanwhile `RecentActivityView` filters terminal ops to tx history (`RecentActivityView.vue:310`), so the card is **gone** on `succeeded`. The post-approve popup-open + render misses the ~3s active window → the card-watch waits forever → "hang".

Not a wallet/authz bug — execution is correct and *fast*. A flaky **test assertion** exposed when PR #86 converted the bulk suite to proverless (#85's fixture/timing shift tipped the already-racy assertion over). 7 tests use the helper; the 6 non-barrier ones race; the barrier `concurrent-sendtx-confirm` passes because the barrier *holds* proving open.

## Fix
Rewrote `waitForSendTxActiveStage` to poll the **journal record** in `chrome.storage.local` (which persists) for stage ∈ {simulating, proving, submitting, **succeeded**} — robust to both the fast completion and the card unmount. Helper-only; the 7 tests' flow is unchanged. EXPLICIT allowlist excludes `failed`/`cancelled` (codex finding #3 preserved). Validated: `multi-account-from` (was hanging) PASSES proverless locally.

## Why CI didn't catch it (process fix — included)
`pr-network-e2e.yml` triggers only on `pull_request` + `workflow_dispatch` (no `push:`), runs only on `extension-network` path-hit OR the `e2e:network` label, and is **advisory on dev** (only `Quality / Status` required). So #85 merged with a red network e2e and it stayed invisibly red. → **Make `Network e2e / Status` a required check on dev** (after this fix lands so dev is green). Status emits pass-when-skipped, so doc/unrelated PRs aren't blocked; only network-touching PRs are gated — which would have blocked #85.

## Repro / validation
```
# was hanging, now passes:
NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/multi-account-from.test.ts
```
Note: `concurrent-sendtx-confirm` can time out LOCALLY at `waitForPgResult` (barrier-stub + 2 proving cycles on darwin) but passes on CI — a separate local-only flake, not this fix's concern.
