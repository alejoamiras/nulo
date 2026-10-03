# Arc 10, fee-strategies: lessons log

## Plan

- **Three of the first draft's extractions failed their audit, and were dropped.** See the batch plan's Deferred and Plan audit.
  - A shared estimate-task wrapper would await before `completeTask`, and completion broadcasts synchronously (`task/service.ts:135`, `core/base-service.ts:129`, `background/service.ts:85`), so task events would move.
  - `committedMaxFees` was deferred because malformed min-fee replies reach `.mul`, whose extraction changes exposed engine-generated error text.
  - Folding the probe into one helper would have added suspensions inside the fold.
- **Plan audit:** Codex REVISE (three blockers), Opus APPROVE with conditions. Every finding was adopted.

## Build

- **Phase 1 passed on the unchanged code:** 62 new tests in `fee/strategies-lifecycle.test.ts` and 28 in the card's identity matrix.
  - The card's watcher tracks `[props.profile, props.network, props.account]` as objects, so a per-field guard is only reachable by mutating a field in place on reactive props; the matrix does that.
  - The `runSeq` fence shadows parts of P2 (see the survivors below), which no prop sequence can separate.
- **Between the Phase 1 commit and the head**, `git diff -- '*.test.ts'` lists only `fee-helpers.test.ts`, with 45 additions and no deletion. The `.vue` diff stays inside `<script setup>`.
- **Mutation checks**, in scratch with files restored from copies (never with git):

  | Mutation | Result |
  |---|---|
  | `validatedSimOpts` returns the stub shape | killed, 26 |
  | V5 reads the first build's account | killed, 3 |
  | V6 reads the first build's account | killed, 8 |
  | `return await` at the fast-path hand-off | killed, 1 |
  | fold abort check deleted: fj / fast path / two-pass | killed, 3 / 3 / 2 |
  | two-pass composition moved below the checkpoint | killed, 1 |
  | `isLiveFeeScope` drops profile / network / chain / account | killed, 4 each |
  | `==` for `===` on chain id | survived at first; killed (1) after a strict-equality row in `fee-helpers.test.ts` |
  | another separator at K3 only | killed, 11 |
  | `.join("\|")` for the template literal | killed, 1 |
  | `embeddedHidden()` dropped from P2 | **survived**: the `[isCustomMethod, useOwnMethod]` watcher bumps `runSeq` on every embedded flip, so the fence discards the run first. The line is unchanged by the arc. |
  | P3's presence line dropped | survived here, and wrongly called equivalent: killed in round 1 (see below) |
  | eager `liveFeeScope(props)` in P1 | survived here, and wrongly called equivalent: killed in round 1 (see below) |

  On the base code, P1, P2 and P3 field drops were all killed too, so the matrix measures the guards and not the extraction.
- **Local gates at the head:** `lint`, `typecheck:all`, `test:all`, `test:ci-gating`, `audit:vue` and `build` all exit 0, and `git status` is clean after the build (generated declarations unchanged).

## Screenshots

- **Every host was staged; nothing is proxy evidence.** The surface file drives the real build:
  - A wrap of `chrome.runtime.connect` makes the `execution`, `fpc`, `price` and `token-balance` ports proxies over the real ones: a method named in `sessionStorage["hd-fee"]` gets the spec's reply, or is held unanswered; a muted port's events are dropped; everything else is forwarded. With no spec the proxy is the real wire.
  - The store's clients open their ports on first use and keep them for the document, so the wrap must exist before the store does. Only Home's gas card and the fee card create the store, and every fresh document boots through the auth route to Home; the wrap is installed on a fresh document (a page-initiated load) while its hash is still short of Home, and a late install is refused.
  - A preload on a new document (`evaluateOnNewDocument`) works on Chrome but never ran in Firefox's moz-extension pages, after the driver's reload or a page-initiated load alike, so both browsers use the boot-time install. Each surface's served-read check proves the store's client is on a proxy.
  - Held requests are answered when the surface leaves. An open raw flight would otherwise be joined by every later non-forced fetch until its 20 s timeout.
  - The FPC list is the real service's answer, read once and replayed; one seeded token row gives Send an origin toggle and an amount field; authwits are seeded as visual-shells-a does.
  - Each surface asserts the card's state (method, notices, skeletons, origin, verdict) and that the proxy served the stubbed read, before the shot and again after it.
- **What the first runs taught:**
  - The card shows a skeleton only on a Fee Juice row, so a loading card with no saved pick has no busy indicator; the loading states that show one use a saved Fee Juice pick, persisted as `persistSelection` writes it.
  - The execute window estimates as soon as the card emits settings. An unstubbed `estimateOperationFee` reaches the real service, which holds no stored request, and the error toast blocks the settle; every execute state stubs it.
- **Result:** 28 surfaces (Send 11, execute window 9, revoke popup 4, registry popup 4) × dark and light × Chrome 152 and Firefox: 112 shots, base `7450928c` against head `53e9dfce` all identical, and `--stability` (base against itself) all identical, 112 of 112.

## Codex loop

### Round 1: NOT CONVERGED (three should-fixes, two nits; all adopted)

Codex confirmed its three plan blockers resolved, and re-verified 112/112 base-against-head and 112/112 stability shots as byte-identical. The shots mask the network-status dot, so they say nothing about arc 9's status changes.

- **V2 and V3 had moved their account reads.** Before, both took `account` from the build before `suggestGasLimits`, and embedded before the cap's await too; `validatedSimOpts(built)` read `built.account` inside the call, after both, and Bun's text for a malformed build changed from `account.address` to `built.account.address`.
  - Fix: `validatedSimOpts` takes the address. V2 and V3 keep their original destructure and pass `account.address`; the other sites pass `built.account.address`; `probedFirstSimOpts` keeps its first-line read.
  - Pin: an ordered log of getters on `built.account` and `account.address`, the `gasSettings` setter, `getCurrentMinFees` and the simulation, for fjwc and embedded. Red on the `72a4b8a7` shape (both paths), green on the fix.
- **P3's presence line is not equivalent.** Releasing the card's subscription cannot cancel a `recommit()` already waiting on storage, and while another subscriber keeps the key's entry, that late commit lands.
  - The first version of the pin passed with the guard deleted: with no other subscriber, the release fenced the profile and dropped the entry, so the unguarded commit found nothing to copy. The pin now holds a second subscription, as a second operation card would.
  - Pin: a held recovery recommit, a switch to an embedded payment, then the storage read resolves. Nothing is emitted over the embedded settings, and opting out of the embedded payment still reads afresh (that read fails, and the notice shows). Killed (1).
- **Eager P1 is not equivalent.** With the profile mismatched, the lazy guard never reads the network, so in-place network changes leave `sendSelection` cached; an eager snapshot re-runs it and hands out a new pending object.
  - Pin: Send settled, profile id changed in place, then network id and chain id changed in place; the pending result keeps its identity. Killed (1).
- **Nits:** `validatedSimOpts`'s doc now says it verifies witnesses and transaction validity while skipping fee enforcement; the `committedMaxFees` bullet above was corrected.
- **Mutants:** the V2 and V3 `72a4b8a7` shapes, P3's presence line and eager P1 are each killed by exactly one test.
- **Test files touched:** `strategies-lifecycle.test.ts` gains the access-order pin; `FeeSettingsCard.test.ts` gains the two card pins, and its `recommitAcross` helper now also hands its callback the wrapper, awaited.


### Round 2: one should-fix in test code (adopted)

Codex confirmed every round-1 finding resolved: V2 and V3 match the base's access expressions and timing, the second subscription is realistic, the native click reaches the handler, and the eager-P1 pin is sound.

- **The P3 pin leaked a live retry timer.** `recommitAcross` restores real timers before it returns; the override click then resubscribes the card, and the failed read arms a real 5 s retry that only the card's own retry-capable subscription can stop. Releasing `holder` alone left it running into later tests' shared mocks.
  - Fix: the test runs its post-recommit section under fake timers, asserts a timer is armed, unmounts the card and releases the holder, then asserts `vi.getTimerCount()` is 0. A `finally` unmounts and releases on any failure, including one inside the helper after the card is mounted.
  - Verified: P3's presence-line mutant still killed (1); the file passes 140/140 under three shuffled seeds; lint clean.
