# Verified findings — 2026-08-14-dedup-mid

Phase-4 verifier pass, top 5 by impact bucket (all 3 architectural + top 2 structural). Each verifier read the source independently and recorded its own conclusion BEFORE reading the consolidated claim. All five verdicts: CONFIRMED-WITH-CORRECTIONS, final confidence high.

---

# Q-01 verification — `Lock` exposes only `enter()`/`leave()`, hand-rolled at every call site

## Verdict

**CONFIRMED-WITH-CORRECTIONS.** The core claim is real and well-supported: `packages/wallet-core/src/utils/lock.ts` exposes only `enter()`/`leave()`, and every production call site hand-rolls `try { await lock.enter() } finally { lock.leave() }`. The recommended `withLock<T>()` extraction is sound and low-risk. The consolidated finding's per-file instance counts are accurate; its **headline aggregate ("71 critical sections")** is not — it overcounts by 3 against its own enumerated instance list.

## Independent assessment (pre-claim)

Formed before reading any audit file, from `lock.ts` + a `.enter()`/`.leave()` grep across `apps/extension/src/wallet/services/**` and direct reads of 8+ service files.

- `Lock` (`packages/wallet-core/src/utils/lock.ts:6-69`) is a simple FIFO mutex: `enter()` queues + dispatches, `leave()` clears a force-release safety timer and dispatches the next waiter. It has no `withLock`/`runExclusive` convenience method — callers own the acquire/release protocol entirely.
- Yes, there is a repeated hand-rolled acquire/release idiom, but it is **not uniform**: most files (network, dapp-session, fpc, auth-registry, token, contact, transaction, operation-journal, activity-protocol, account, dapp-interaction, wallet-sdk/queued-journal — 12 files) duplicate the raw `try { enter() } finally { leave() }` block at every call site with no shared wrapper. Two files (`profile/service.ts`, `incoming-transfer/service.ts`) have **already** solved this locally with a private `runExclusive`/`withServiceLock` helper that every write path in that file routes through — so those two files each have exactly **one** real `enter()`/`leave()` pair in the whole file, not N.
- Raw grep on `.enter()`/`.leave()` is noisy: it picks up doc-comment mentions (`profile/repository.ts` — a comment showing what the *caller* should do, "Lock-free by design," zero real `Lock` usage; `purge-rows.ts` — a doc comment referencing the idiom, also zero real usage) and one further false lead. After excluding comment lines, the real count across the 14 files that genuinely use `Lock` is **68 enter/leave pairs** (136 lines total).
- `token/service.ts` genuinely diverges: 2 of its 5 sites (`addToken`, `addSeededToken`) guard the release with a `holdsLock` boolean instead of the bare `finally` — because their `catch` blocks call `journal.transitionOperation(...,"failed")` and must not call `leave()` if `enter()` itself never resolved. This is a real, defensible divergence, not noise.
- `account/service.ts` has a second, *unrelated* concurrency primitive alongside its one `Lock` (`restoreLock`) — a hand-rolled promise-chain mutex (`tupleLocks: Map<string, Promise<unknown>>`). Not the same smell as Q-01 (different primitive entirely), but worth flagging as adjacent drift in the same file.
- `activity-protocol/coordinator.ts` doesn't use a single instance `Lock` — it keys a `Map<string, Lock>` (`scopeLocks`, `sourceLocks`) via a `lockFor()` lazy-creation helper, so its 2 sites are a striped-lock variant, not directly comparable to the single-instance sites elsewhere.
- A mechanical `withLock()` extraction would absorb the vast majority of sites cleanly. The two already-wrapped files (`profile/service.ts`, `incoming-transfer/service.ts`) can trivially delete their private wrapper in favor of the shared one — their internals already do exactly `enter(); try { fn() } finally { leave() }`. The `token/service.ts` `holdsLock` sites need care: converting them to `withLock()` is still safe (the `catch` stays *outside* the `withLock` call, wrapping it), since `withLock` guarantees `leave()` is never called unless `enter()` actually resolved — but it's not a pure text-substitution, the `try/catch/finally` structure has to be re-shaped, not just find/replaced.

## Corrections to the consolidated finding

1. **Headline count is wrong.** Both `consolidated.md` and `ext-services-codex.md`'s Finding-1 headline say **"71 critical sections"** / **"71 sites, 14 files."** Codex's own enumerated instance list at the bottom of `ext-services-codex.md` lists exactly **68** enter/leave pairs across 14 files — I independently counted the same 68 via grep (excluding comment lines) and it matches Codex's own list line-for-line. The "71" in the prose is an arithmetic slip that was carried into the consolidated doc without being checked against the enumeration it cites.
2. **Claude's raw file (`ext-services-claude.md`) is accurate**: its "56 sites, 9 files" claim sums correctly (14+12+7+6+5+5+4+1+1 = 56) and every per-file count I independently measured matches it exactly.
3. **Every per-file instance count in `consolidated.md`'s "Instances:" line is correct** — I independently re-derived the same numbers: network (14), dapp-session (12), operation-journal (8), fpc (7), auth-registry (6), token (5, two `holdsLock`-guarded), contact (5), transaction (4), activity-protocol (2), account (1, present in Codex's list but curiously **omitted from the consolidated "Instances:" prose list**, though it's implicitly counted in "14 production modules"), dapp-interaction (1), profile/service.ts (1, wrapper), incoming-transfer/service.ts (1, wrapper), wallet-sdk/queued-journal.ts (1).
4. **Change-frequency claim needs a scope caveat.** Consolidated says "27-32 commits ... last 90-120 days." I measured: exactly the 14 `Lock`-touching files → **26 commits** in the last 90 or 120 days (identical either window, union of unique commits). Codex's "27" is close and correctly scoped to the same file set. Claude's "32" is *not* wrong, but it's scoped more broadly than the finding's own instance list — it's the commit count for **all** `services/*/service.ts` files (32, verified), not just the 14 that use `Lock`. The "27-32" range in the consolidated doc silently blends a properly-scoped number with a loosely-scoped one.
5. **No line-number errors found.** Every specific `file:line` pair I spot-checked from Codex's enumeration (`profile/service.ts:171/174`, `token/service.ts:219/266` + `313/350` + `366/406` + `432/441` + `739/754`, `account/service.ts:352/392`, `dapp-session/service.ts:317/325`) matched the actual source exactly.

## Strengthened evidence

Definitive instance list (14 files, 68 real `enter()`/`leave()` pairs, verified by direct grep with comment-lines excluded and spot-read against source):

| File | Sites | Pattern |
|---|---:|---|
| `apps/extension/src/wallet/services/network/service.ts` | 14 | raw, no wrapper (e.g. `:213/:245`, `:740/:786`) |
| `apps/extension/src/wallet/services/dapp-session/service.ts` | 12 | raw, no wrapper; one conditional-entry site (`:317/:325`, only reached inside an `if`) |
| `apps/extension/src/wallet/services/operation-journal/service.ts` | 8 | raw, no wrapper (`transitionLock`, distinct instance name, same idiom) |
| `apps/extension/src/wallet/services/fpc/service.ts` | 7 | raw, no wrapper |
| `apps/extension/src/wallet/services/auth-registry/service.ts` | 6 | raw, no wrapper; several nested inside an outer `try/catch` (task complete/fail) |
| `apps/extension/src/wallet/services/token/service.ts` | 5 | raw; **`:219/:266` and `:313/:350` use a `holdsLock` boolean** guard instead of the bare `finally` (confirmed exact lines) |
| `apps/extension/src/wallet/services/contact/service.ts` | 5 | raw, no wrapper |
| `apps/extension/src/wallet/services/transaction/service.ts` | 4 | raw, no wrapper |
| `apps/extension/src/wallet/services/activity-protocol/coordinator.ts` | 2 | raw, but via a striped `Map<string, Lock>` (`scopeLocks`/`sourceLocks`), not a single instance — a distinct variant |
| `apps/extension/src/wallet/services/account/service.ts` | 1 | raw (`restoreLock:352/:392`); file also has an unrelated `tupleLocks` promise-chain mutex alongside it |
| `apps/extension/src/wallet/services/dapp-interaction/service.ts` | 1 | raw |
| `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts` | 1 | raw, module-level exported `Lock` (not a class field) |
| `apps/extension/src/wallet/services/profile/service.ts` | 1 | **already wrapped** — private `runExclusive<T>()` at `:169-176`, consumed by ~30 internal call sites |
| `apps/extension/src/wallet/services/incoming-transfer/service.ts` | 1 | **already wrapped** — private `withServiceLock<T>()` at `:208-215`, consumed by ~15 internal call sites |

Files that grep flags but have **zero real `Lock` usage** (comment-only false positives, correctly excluded from the consolidated finding's instance list): `apps/extension/src/wallet/services/profile/repository.ts` (doc comment illustrating the facade's contract; the file is explicitly "Lock-free by design"), `apps/extension/src/wallet/services/purge-rows.ts` (doc comment only).

## Refined recommendation

Adopt the consolidated finding's refactor as written — add `Lock.withLock<T>(fn: () => Promise<T>): Promise<T>` to `packages/wallet-core/src/utils/lock.ts`, then migrate call sites — with this refined sequencing by risk:

1. **Trivial, zero-risk first**: `profile/service.ts` and `incoming-transfer/service.ts` — swap their private `runExclusive`/`withServiceLock` bodies for a one-line delegation to `this.lock.withLock(fn)` (or delete the wrapper entirely and call `this.lock.withLock` at each of their ~30/~15 internal call sites, whichever the team prefers). Behaviorally a no-op; both already implement the exact `enter/try/finally/leave` shape internally.
2. **Mechanical, low-risk**: the ~55 plain `try { enter() } finally { leave() }` sites with no surrounding `catch` doing lock-sensitive work (most of `network`, `dapp-session`, `fpc`, `auth-registry`, `contact`, `transaction`, `operation-journal`, `dapp-interaction`, `wallet-sdk/queued-journal`). Straight substitution: wrap the try-body in `this.lock.withLock(async () => { ... })`.
3. **Needs non-mechanical care**: `token/service.ts`'s two `holdsLock`-guarded sites (`addToken` line 217-266, `addSeededToken` line 311-350) — the outer `try/catch` (which reports the journal failure) must stay *outside* the `withLock` call, not be swallowed into it, or a lock-acquisition failure would be misreported as an operation failure with the journal transitioned incorrectly. `dapp-session/service.ts`'s conditional-entry site (`isExpired`, `:317/:325`) needs its `return true` statement relocated relative to the `withLock` call, not a pure text substitution.
4. **Out of scope for the mechanical `withLock` extraction, handle separately**: `activity-protocol/coordinator.ts`'s striped `Map<string, Lock>` sites need a `withLock` call *through* `lockFor(map, key)`, not a bare `this.lock.withLock` — same idiom, different acquisition path, worth a one-line note in the PR so the reviewer doesn't expect an identical diff shape there. `account/service.ts`'s separate `tupleLocks` promise-chain mutex is unrelated to `Lock` entirely and out of scope for this refactor.

## Final confidence

**High.** Every specific factual claim in the consolidated finding (per-file counts, the `holdsLock` divergence, the two pre-existing local wrappers, exact line numbers spot-checked) reproduced exactly under independent re-measurement — the only defect found was the "71" headline figure, an internal inconsistency against the audit's own 68-item enumeration, and a change-frequency figure that blends two differently-scoped file sets. Neither correction changes the finding's verdict or its recommended refactor.

---

# Q-02 (verified): L1+L2 client-bootstrap block copy-pasted across `bridge-core/scripts` conductors

## Verdict

**CONFIRMED-WITH-CORRECTIONS**

The core claim holds: a 5-element bootstrap sequence (viem `defineChain`, `createPublicClient`, `createWalletClient`, `createAztecNodeClient`, `EmbeddedWallet.create`) plus a `t0`/`mins()` elapsed-timer helper is copy-pasted near-verbatim across a fixed set of `bridge-core/scripts` conductors, with no shared helper despite `deploy-manifest.ts`/`deployer-keys.ts` already establishing the precedent for exactly this kind of extraction in this directory. The `proverEnabled` drift on `deploy-sandbox.ts` is real and unflagged. But the consolidated finding's instance count, scope description, and one evidence claim about the timer helper are each off in checkable ways — corrected below.

## Independent assessment (pre-claim)

Before reading any audit file, I read `deploy-sandbox.ts`, `deploy-bridge-testnet.ts`, `deploy-bridge-mainnet.ts`, `smoke-existing-testnet.ts`, and `fee-juice-canary-testnet.ts` in full, then grepped the whole `packages/bridge-core/scripts/` directory for the five marker calls.

Independent count of files containing **all five** markers (`defineChain` + `createPublicClient` + `createWalletClient` + `createAztecNodeClient` + `EmbeddedWallet.create`): **exactly 10** —
`deploy-sandbox.ts`, `deploy-bridge-testnet.ts`, `deploy-bridge-mainnet.ts`, `deposit-testnet.ts`, `smoke-existing-testnet.ts`, `smoke-existing-mainnet.ts`, `smoke-swap-existing-testnet.ts`, `fee-juice-canary-testnet.ts`, `fpc-dust-canary-mainnet.ts`, `fuel-testnet.ts`.

Two more files (`discover-mainnet-fuel.ts`, `restore-swap.ts`) have `defineChain`+`createPublicClient` but are read-only (no `createWalletClient`, no Aztec client at all — no L2 side exists to bootstrap). Four more (`deploy-private-fpc-testnet.ts`, `deploy-private-fpc-mainnet.ts`, `drip-canary-testnet.ts`, `relay-claim-testnet.ts`) have the L2 half (`createAztecNodeClient`+`EmbeddedWallet.create`) but no L1 wallet client — they never touch L1. `deploy-manifest.ts` and `deployer-keys.ts` are genuine pre-existing shared helpers (journal/candidate persistence, deployer-key derivation) and do **not** already cover the client-bootstrap block — confirmed by reading both in full.

`proverEnabled` check: `grep -n proverEnabled *.ts` returns 14 hits — 13 say `true`, and exactly one, `deploy-sandbox.ts:148`, says `false`. No comment at or near line 148 explains *why* sandbox differs (the nearest related comment, lines 282-283, only notes the *consequence* — "far slower with proving disabled" — while explaining a wait-status choice; it never states this is an intentional sandbox-vs-live delta).

## Corrections to the consolidated finding

1. **Instance count is 10, not "10-12."** The consolidated title and body hedge between 10 and 12 by merging two different claims from the two raw scanners without reconciling them. Claude's raw finding (10 files) and Codex's raw finding (12 files) are answering **different questions**:
   - Claude's 10 files are exactly the full L1+L2 bootstrap set independently re-derived above.
   - Codex's 12 files are the **L1-only** chain/client-descriptor duplication (`defineChain` + `createPublicClient`/`createWalletClient`), which legitimately includes `discover-mainnet-fuel.ts` and `restore-swap.ts` — but those two are **read-only L1 scripts with no L2/Aztec bootstrap at all**. Codex's own report is careful about this (its "Wallet-client construction, where required" sublist has only 10 entries, correctly excluding those two). The consolidated finding collapsed Codex's narrower L1-only finding into the same bucket as Claude's full-stack finding and mislabeled the extra 2 files as instances of "the L1+L2 client-bootstrap block" — they are not; they are instances of half of it. The finding should either (a) stay scoped to the 10-file full-stack instance set (recommended — it's the stronger, more homogeneous case), or (b) explicitly split into two findings (L1-only descriptor duplication, 12 files; full L1+L2 bootstrap, 10 files) if both are worth tracking.

2. **Line-count figure is understated.** Both the consolidated finding and Claude's raw report say "~2,900 combined lines" for the 10-file set. Measured (`wc -l`): **3,568 lines** for the same 10 files (3,929 if the 2 Codex-only L1-read files are included). Off by ~20-35%.

3. **The `mins()`-in-"every file with a `main()`" claim is imprecise, and in one instance factually wrong.** Claude's raw report states the timer helper is "present verbatim in all 12 files that have a `main()`." Direct grep of the whole directory finds `const mins = ()` in exactly 12 files — but the set doesn't line up with either the 10-file bootstrap list or "every file with `main()`" (16 files in the directory have a `main()`/top-level `async function main`). Concretely: **`deploy-sandbox.ts` — one of the 10 canonical bootstrap-block instances, explicitly named in the finding — has NO `t0`/`mins()` timer at all** (verified by direct grep: zero matches). Conversely, `deploy-private-fpc-mainnet.ts`, `deploy-private-fpc-testnet.ts`, and `drip-canary-testnet.ts` do have the timer but are outside the 10-file bootstrap set (they belong to Q-10's separate finding or have no bootstrap block at all). So the timer duplication is real and worth folding into the same `stopwatch()` extraction, but its instance list is not identical to the bootstrap block's instance list, and the claim that it's in "every file with a `main()`" is checkably false for at least one of the 10 named files.

4. **Change-frequency claim is directionally right but per-file numbers needed a spot-check, and they held up.** `git log --oneline -- <file>` for the 10-file set reproduces Claude's exact commit counts: `deploy-bridge-testnet.ts` 9, `fuel-testnet.ts` 8, `smoke-existing-testnet.ts` 7, `deposit-testnet.ts` 7, `deploy-sandbox.ts` 7, `smoke-swap-existing-testnet.ts` 6 — all confirmed exactly. However, the other four files in the set (`fee-juice-canary-testnet.ts` 2, `fpc-dust-canary-mainnet.ts` 1, `deploy-bridge-mainnet.ts` 1, `smoke-existing-mainnet.ts` 1) are recent, low-churn additions (the mainnet tooling landed in two recent commits, `55523924` and `a444e361`) — "HIGH — the most actively edited part of the cluster" overstates the set as a whole; it's true for 6 of the 10 files and not yet demonstrated for the other 4 (they simply haven't existed long enough to accumulate churn).
   The "5.0/5.0.1 dependency upgrade touched 9 of these scripts together" claim does not reproduce cleanly against either named upgrade commit: `git show --stat f9f28cfd` touches 6 of the 10-file set (`deploy-bridge-testnet.ts`, `deploy-sandbox.ts`, `deposit-testnet.ts`, `fuel-testnet.ts`, `smoke-existing-testnet.ts`, `smoke-swap-existing-testnet.ts`); `bffb7572` touches the identical 6. Neither commit alone nor their union reaches 9 within the 10-file set (it does reach into the low-teens if `check-fpc-version.ts`, `portal-artifact.ts`, `deploy-manifest.ts`, and newly-added files like `live-intent.ts`/`fee-juice-canary-testnet.ts` are counted, but those aren't part of the bootstrap-block instance list). The qualitative point — a fleet-wide Aztec-version bump forces coordinated edits across this set — is real and reproducible (6/10 files, twice), just not "9."

5. **The `proverEnabled` drift claim is confirmed, with a nuance the finding should carry.** It is genuinely the *only* such drift (13 `true` vs. 1 `false`, no other config field diverges this way across the 10 files), and it is genuinely unflagged at the point of declaration. In isolation this delta is almost certainly intentional and low-risk — `deploy-sandbox.ts` targets a local anvil+sandbox, never touches real funds, and disabling the (slow) real prover there is the obviously correct choice for a local dev loop. The finding's real point isn't "this is a bug," it's "nothing about the code's structure would have stopped a copy-paste mistake from landing the same way, and a reviewer scanning the diff has no signal that this one flip is deliberate vs. stale." That's a legitimate Duplicate-Code argument independent of whether this particular instance is currently harmless.

## Strengthened evidence

Definitive 10-file instance list for the full L1+L2 bootstrap block (`defineChain`/client pair → `createAztecNodeClient` → `EmbeddedWallet.create`), with verified line ranges (re-read from source, not taken from either raw report):

| File | `defineChain` | L1 clients (`wallet`/`pub`) | `createAztecNodeClient` | `EmbeddedWallet.create` (+ `proverEnabled`) | `mins()` timer |
|---|---|---|---|---|---|
| `deploy-sandbox.ts` | 52-57 | 121, 122 | 147 | 148 (`false`) | **absent** |
| `deploy-bridge-testnet.ts` | 87-92 | 174, 175 | 258 | 259 (`true`) | 141 |
| `deploy-bridge-mainnet.ts` | 94-99 | 193, 194 | 337 | 278 (`true`) | 157 |
| `deposit-testnet.ts` | 52-57 | 86, 87 | 104 | 105 (`true`) | 81 |
| `smoke-existing-testnet.ts` | 58-63 | 80, 81 | 97 | 98 (`true`) | 75 |
| `smoke-existing-mainnet.ts` | ~69-74 | 89, 90 | (in flow) | 110 (`true`) | 82 |
| `smoke-swap-existing-testnet.ts` | 59-64 | 81, 82 | (in flow) | 104 (`true`) | 78 |
| `fee-juice-canary-testnet.ts` | 54-59 | 83, 84 | 129 | 130 (`true`) | 81 |
| `fpc-dust-canary-mainnet.ts` | 60-65 | 95, 96 | 82 | 99 (`true`) | 82 |
| `fuel-testnet.ts` | 63-68 | 97, 98 | (in flow) | 128 (`true`) | 83 |

10 files, 3,568 combined lines (`wc -l`). `deploy-sandbox.ts` is the sole `proverEnabled: false` outlier and the sole file in this set missing the `mins()` timer — two independent, unremarked deltas in the "same" boilerplate block, which is itself evidence of drift risk rather than of a template being followed carefully.

Separately real, smaller-radius, correctly out-of-scope-for-Q-02: `discover-mainnet-fuel.ts` + `restore-swap.ts` share only the L1-half descriptor (12-instance count if that narrower thing is what's being measured — Codex's finding, not Claude's); `deploy-private-fpc-testnet.ts` + `deploy-private-fpc-mainnet.ts` are their own separate, already-identified Q-10 finding (L2-only conductor, no L1 side); `drip-canary-testnet.ts` and `relay-claim-testnet.ts` are L2-only and untouched by either raw report's Q-02 instance list.

## Refined recommendation

Keep the recommended refactoring shape, scoped to the verified 10-file set, and make the extraction cover the two things that actually diverged silently:

```ts
// packages/bridge-core/scripts/script-bootstrap.ts
export function createBridgeScriptClients(opts: {
  chain: Chain            // pass the already-built viem chain (don't re-wrap defineChain itself —
                           // the 10 conductors use only 2 distinct chain shapes, sepolia/mainnet;
                           // keep those two as named exports, e.g. `SEPOLIA_CHAIN`/`MAINNET_CHAIN`)
  rpcUrl: string
  account?: PrivateKeyAccount   // omit for read-only callers
  nodeUrl: string
  proverEnabled: boolean        // REQUIRED, no default — forces every call site to state its choice
}): { pub: PublicClient; wallet: WalletClient | undefined; node: AztecNode; ewallet: EmbeddedWallet }

export function loadManifestFromConfigArg(argv: string[], opts?: { required?: boolean; fallbackPath?: string }): CandidateManifest
// unifies the two divergent behaviors already found in the wild: smoke-existing-testnet.ts hard-requires
// --config (throws if absent), fee-juice-canary-testnet.ts silently falls back to the LIVE manifest if
// --config is omitted. That silent-fallback shape is a footgun for a canary meant to validate a candidate
// — an explicit `required`/`fallbackPath` parameter makes each caller's choice visible in its own call,
// instead of an accidental difference nobody chose on purpose.

export function stopwatch(): () => string  // returns mins(); replaces every hand-rolled t0/mins() pair
```

Making `proverEnabled` a required (non-optional, non-defaulted) parameter is the concrete fix for the drift risk: a reviewer sees `proverEnabled: false` at every one of the 10 call sites explicitly, rather than 9 identical lines and 1 silent outlier.

**Scripts that keep genuine deltas** (do not try to fold these into the shared helper — they are legitimately per-script):
- `deploy-bridge-mainnet.ts`'s `l1-only`/journal-resume staged-broadcast logic, Circle-USDC identity assertions, and claim-in-tx account funding (mainnet has no SponsoredFPC).
- `deploy-bridge-testnet.ts`'s journal-based resume/`--from-journal` machinery, token-cutover/reuse-token flags.
- `fpc-dust-canary-mainnet.ts` and `fee-juice-canary-testnet.ts`'s fee-calibration math (each canary's actual point).
- `smoke-existing-{testnet,mainnet}.ts` and `smoke-swap-existing-testnet.ts`'s deposit→claim flows and the `--redirect-proof` security canary logic.
- `deploy-sandbox.ts`'s Permit2-bytecode-copy-from-Sepolia step and `--smoke` inline flow (sandbox-only, no equivalent elsewhere).

None of this domain logic overlaps with the bootstrap block; extracting the bootstrap doesn't touch it.

## Final confidence

**High.** The core duplication claim, the `proverEnabled` drift, and the absence of an existing shared bootstrap helper were all independently re-derived from source before reading the audit, and match. The corrections (10 vs. "10-12," the mislabeled 2 Codex-only files, the understated line count, the `mins()`-in-"every file" overclaim, and the softer change-frequency picture for 4 of the 10 files) are mechanical, checkable facts (grep counts, `wc -l`, `git log`), not judgment calls, so they carry the same high confidence as the parts being confirmed.

---

# Q-03 — `useFeeEstimation` vs `useFeeEstimationMap` duplicate state machine

## Verdict

**CONFIRMED-WITH-CORRECTIONS.** The core duplication claim is real and well-evidenced: both composables hand-roll the identical debounce/counter/inflight-completed-token/cancelRemote/handedOff/dispose machinery, once scalar and once `Map<TKey,…>`-keyed. One factual claim in the consolidated finding (and its Claude-scanner source) is wrong and is corrected below. The recommended refactoring direction is sound but understates two genuine semantic deltas a wrapper must preserve.

## Independent assessment (pre-claim)

Read both files cold, before opening any audit artifact. Mirrored elements enumerated directly from source:

| Element | `useFeeEstimation.ts` (scalar) | `useFeeEstimationMap.ts` (keyed) |
|---|---|---|
| Debounce timer | `timer` (single) | `timers: Map<TKey, Timeout>` |
| Monotonic counter | `counter` (single) | `counters: Map<TKey, number>` |
| Inflight token | `inflight: {token, started} \| null` | `inflight: Map<TKey, {token, started}>` |
| Completed token | `completedToken: string \| null` | `completed: Map<TKey, string>` |
| Handed-off set | `handedOff: Set<string>` | `handedOff: Set<string>` (shared, not per-key) |
| `clearTimer`/`clearTimerFor` | 70-75 | 73-79 |
| `cancelOwnedRemote`/`…For` | 79-86 | 82-90 |
| `cancel`/`cancel(key)` | 87-94 | 92-99 |
| `schedule`/`schedule(key,…)` | 96-129 | 106-141 |
| `handoff`/`handoffAll` | 131-135 | 143-150 |
| `dispose` + `onScopeDispose` | 137-145 | 156-166 |

Same algorithm: clear timer → remote-cancel anything owned and not handed off → bump counter to invalidate stale settles → mint token via `crypto.randomUUID()` → `setTimeout` → try/catch/finally comparing the captured counter to the live one to detect staleness. Confirmed as genuine duplication, not superficial resemblance.

Git evidence checked directly (`git log --oneline --follow` on both files): both were touched in exactly the same two feature commits, `5f115286` and `204f2bf4`, plus the mechanical `8e919f6a` restructure and the `5ee8ec13` initial import. `git show --stat` confirms the diffs land in both files in both commits (`5f115286`: +64/+67 line-touch counts; `204f2bf4`: +5/+35) — real lockstep co-change, not coincidental proximity.

Wrapping assessment: consumer check (`grep -rn "useFeeEstimation(" / "useFeeEstimationMap("`) shows exactly one consumer each — `send.vue:267` (`result`, `isEstimating`, `estimate`, `cancel`, `handoff` destructured) and `execute/index.vue:131` (`results`, `estimating`, `estimate`, `handoffAll`, `rearm`, `cancelAll` destructured). Neither consumer calls `dispose()` explicitly (both rely on `onScopeDispose`). A thin scalar-over-keyed wrapper with a sentinel key is feasible without changing either consumer-visible shape (`result`/`isEstimating` become computed reads of `results.value[SENTINEL]` / `estimating.value[SENTINEL]`), **but two things are non-trivial**:

1. **`estimate` callback arity differs.** Scalar: `(params, token) => Promise<TResult>`. Keyed: `(params, token, flowKey) => Promise<TResult>`, where `flowKey` is `` `op:${instanceId}:${key}` `` — used SW-side to scope per-op coalescing so two concurrent approval windows estimating the same op index don't collide. A wrapper must adapt this (drop the third arg), not pass it through.
2. **`handoff()` and `handoffAll()` have genuinely different semantics, not just different shape.** Scalar's `handoff()` returns `completedToken ?? inflight?.token ?? null` — it WILL hand off a still-in-flight token. Keyed's `handoffAll()` deliberately only hands off `completed` tokens; its own doc comment says in-flight ones are "deliberately left armed... handing them off would only orphan their eventual stashes." A wrapper cannot implement `useFeeEstimation`'s `handoff()` as a call to `handoffAll()` on the sentinel key — that would silently drop the in-flight-handoff case `send.vue` may depend on. It needs either a lower-level shared primitive exposing per-key inflight/completed state, or a parallel handoff implementation in the wrapper.

Neither of these blocks the refactor; they mean "thin wrapper" requires care at exactly these two seams.

## Corrections to the consolidated finding

- **"Six days apart" is factually wrong.** Consolidated line 34 and the Claude raw source (`ext-pages-composables-claude.md:31`) both claim `5f115286` and `204f2bf4` were "six days apart, each shipping one feature." Direct verification: `git show -s --format="%ai"` on both commits returns the **identical** author/committer timestamp, `2026-08-07 18:13:21 -0300` (committer `2026-08-07 21:13:21 +0000`) — same day, same second. This is a 3-PR stack (`#347`, `#348`, `#349` per the `fee-estimation-speedup` plan) merged back-to-back; there is no multi-day gap. The Codex raw source (`ext-pages-composables-codex.md:56`) has this right: "both fee-estimation files were changed together in both execution-estimation commits **on 2026-08-07**" — same day, no gap claimed. The consolidated finding inherited the wrong claim from the Claude-scanner source instead of the correct Codex one. This doesn't weaken the finding — same-day back-to-back lockstep edits across a 3-PR stack is arguably *stronger* shotgun-surgery evidence than a six-day gap would have been — but the fact as stated is wrong and should be fixed.
- **Line ranges**: verified line-by-line against the actual files. Consolidated's outer bounds (`useFeeEstimation.ts:70-148`, `useFeeEstimationMap.ts:73-169`) are correct. The Claude raw source's more granular per-function ranges are correct to the line except `cancelOwnedRemote` (claimed 78-85, actual closing brace is line 86 — trivial off-by-one). No correction needed to the consolidated finding itself, which only cites the coarse ranges.
- **Cross-reference-comment claim**: confirmed accurate. `useFeeEstimationMap.ts:128-129` reads `// See useFeeEstimation: a transport failure must not orphan the SW-side runner + its stash.` — exact quote, exact lines, exactly as both raw sources and the consolidated finding describe it.
- **Diff stats** (`+64/+67` for `5f115286`, `+5/+35` for `204f2bf4`, cited only in the Claude raw source, not surfaced in consolidated): verified exactly correct via `git show --stat`.
- **Minor, not correction-worthy**: consolidated's "dApp-approval execute windows" (plural) — there is exactly one such window (`popup/windows/execute/index.vue`) in current code. Cosmetic phrasing, doesn't affect the finding's substance.

## Strengthened evidence

Beyond what either raw scanner or the consolidated finding surfaced:

- `useFeeEstimationMap` carries three members with **no scalar analog at all**: `cancelAll()` (batch-cancel before multi-op window teardown), `rearm()` (undo a `handoffAll()` after a failed approve — clears `handedOff`), and `instanceId` (random per-instance string scoping the SW-side coalescing slot so two concurrent approval windows don't share a latest-wins admission slot). These aren't duplicated — they're keyed-only extensions — but they matter for the refactor: a shared internal engine needs to support them without forcing the scalar wrapper to expose equivalents it doesn't need.
- Default `debounceMs` differs by design (800ms scalar / 500ms keyed) and is documented as an intentional choice in each file's own TSDoc (`useFeeEstimationMap.ts:12-15`: "Send-page-style 800ms callers should prefer `useFeeEstimation`"). Any merge must keep each public API's own default, not converge them.
- The `handoff()` vs `handoffAll()` in-flight-inclusion asymmetry (above) is the single most important behavioral fact missing from all three existing write-ups. It is the one place where "the keyed version already generalizes the scalar case" (both raw sources' framing) is not quite true — the keyed version's public `handoffAll` is *narrower* than what the scalar version's `handoff` needs.

## Refined recommendation

**Wrapper feasibility: YES, confirmed feasible**, but as an extracted shared internal engine rather than a literal "scalar calls the keyed public API" wrapper:

1. Extract a private, unexported keyed engine (e.g. `createEstimationEngine<TKey, TParams, TResult>()`) holding `timers`/`counters`/`inflight`/`completed`/`handedOff` plus `scheduleFor(key, params, estimateFn)`, `cancelFor(key)`, `disposeFor(key)`, and a low-level `peek(key)` that returns `completed.get(key) ?? inflight.get(key)?.token ?? null` (the union both `handoff()` and `handoffAll()` need, at different granularities).
2. `useFeeEstimationMap` becomes a thin public wrapper: `results`/`estimating` as the live Records, `handoffAll()` iterating only `completed` (unchanged semantics), `rearm()`/`cancelAll()` unchanged, `estimate(key, params)` passing the real `flowKey`.
3. `useFeeEstimation` becomes a thin public wrapper over the same engine with one fixed sentinel key: `result`/`isEstimating` as computed unwraps, `handoff()` calling the engine's `peek(SENTINEL)` (preserving in-flight inclusion — this is the one place it must NOT delegate to a "completed-only" helper), `estimate(params)` adapting the 2-arg callback to the engine's 3-arg internal shape by supplying a fixed/ignored flowKey.

**Consumer-facing API that must not change:**
- `send.vue`: `{ result, isEstimating, estimate, cancel, handoff }` from `useFeeEstimation` — same `Ref<TResult|null>` / `Ref<boolean>` shapes, same call signatures, default `debounceMs: 800` (send.vue passes it explicitly anyway).
- `execute/index.vue`: `{ results, estimating, estimate, handoffAll, rearm, cancelAll }` from `useFeeEstimationMap<number, {...}, unknown>` — same `Ref<Record<TKey, TResult|null>>` shapes, `estimate` keeping its 3-arg `(op, feeSettings) => estimateOperationFee(op, feeSettings, token, flowKey)` call site (`execute/index.vue:137-138`), default `debounceMs: 500`.

**Behavioral deltas that must be preserved exactly, not incidentally:**
- `handoff()` (scalar) must still be able to hand off an in-flight (not-yet-settled) token; `handoffAll()` (keyed) must continue to exclude in-flight tokens. These are NOT the same operation at different granularity — collapsing them into one shared helper would be a real regression.
- `flowKey` (`` op:${instanceId}:${key} ``) must remain keyed-only; the scalar composable's `estimateTransferFee` doesn't use per-op SW-side coalescing at all, so the wrapper must supply *some* fixed value the SW ignores for that path, not thread a real flowKey through.
- Divergent defaults (800ms vs 500ms) stay per-composable, not unified.
- `cancelAll()`/`rearm()`/`instanceId` stay keyed-only; don't surface them on the scalar composable's public API just because the engine now supports them internally.

Effort estimate in the consolidated finding (0.5-1 day) is still reasonable but should land at the high end — the `handoff`/`handoffAll` seam needs a dedicated characterization test (in-flight handoff on the scalar path) before and after the extraction to prove the behavior wasn't accidentally narrowed to "completed-only."

## Final confidence

**High.** Every claim was checked against the actual file contents (line-by-line) and actual git history (`git log`, `git show --stat`, `git show -s --format=%ai`), not re-derived from the audit's prose. The one correction (same-day, not six-days-apart) is a hard factual fix backed by direct timestamp inspection, not a judgment call.

---

# Q-04 verification — async memoize-with-retry idiom hand-rolled in `pxe/`

## Verdict

**CONFIRMED-WITH-CORRECTIONS.** The 6-instance list, the exact `stubClassRegistrations` line range, and the race-guard divergence (present only in `artifact-catalog.ts`, absent from the other 5) are all independently reproduced and hold up byte-for-byte. The finding's supporting chronology is wrong in a material way: `service.ts`'s `stubClassRegistrations` does **not** predate the `578861be`/`64d85291` commits as Claude's raw pass claims — it is the newest of all 6 instances, added 2026-08-10, four days before this audit ran. Corrected below; does not change the verdict on the duplication itself.

## Independent assessment (pre-claim)

Read `artifact-catalog.ts`, `note-schemas.ts`, `public-events.ts`, `artifact-registry.ts`, and `service.ts` in full before opening any audit file, and grepped `packages/wallet-core/src/utils/` plus a repo-wide `memoiz` search for a pre-existing shared helper the instances might be ignoring.

Found the same shape at 6 sites, all "cache a promise, clear it on rejection so a retry is possible":

1. `artifact-catalog.ts:88` (`cache = new Map<CatalogKey, Promise<CatalogEntry>>()`) + `93-106` (`getCatalogEntry`) — keyed by `CatalogKey` via `Map`. Clear-on-reject: `entry.catch(() => { if (cache.get(key) === entry) cache.delete(key) })` — **has** the identity/"still current" guard.
2. `note-schemas.ts:61` (`let cachedSchemas: Promise<NoteSchemaMap> | null`) + `63-89` (`loadProductionNoteSchemas`) — singleton. Clear-on-reject: unconditional `cachedSchemas = null` in a `try/catch` around the awaited promise. **No guard.**
3. `public-events.ts:169-182` (`getTransferLogTag`, `transferTagPromise`) — singleton. `.catch(() => { transferTagPromise = undefined })`. **No guard.**
4. `public-events.ts:184-194` (`getBundledTokenClassId`, `bundledTokenClassIdPromise`) — same shape as #3, same file, back to back. **No guard.**
5. `artifact-registry.ts:52` (`initPromise: Promise<void> | null`) + `99-112` (`ensureKnown`) — singleton class field. `.catch((err) => { this.initPromise = null; throw err })`. **No guard.**
6. `service.ts:508` (`stubClassRegistrations = new WeakMap<object, Promise<Fr>>()`) + `510-524` (`ensureStubClassRegistered`) — keyed by `PXE` object identity via `WeakMap`. `pending.catch(() => this.stubClassRegistrations.delete(pxe))`. **No guard.**

Independently reached 6 instances, matching the claimed count, before reading the audit.

No shared `memoizeAsync`/`memoize`-style helper exists anywhere in the workspace — checked `packages/wallet-core/src/utils/` (has `rw-guard.ts`, `queue.ts`, `lock.ts`, none of which is this idiom) and grepped the whole repo (excluding `node_modules`) for `memoiz`; the only hits are vendored `@noble/curves` internals and the two doc comments inside `public-events.ts` itself. So this is 6 genuinely independent hand-rolls, not 5 callers ignoring a 6th canonical utility.

**Would one keyed/singleton helper genuinely absorb all 6?** Mostly, with two real caveats neither raw source develops:

- **Key-container type differs.** #1 uses a bounded-`Map` (small closed key set, fine to retain forever). #6 deliberately uses a `WeakMap` keyed by the live `PXE` object so a torn-down runtime's registration promise doesn't pin it in memory forever (the file's own comment: "a chain-runtime teardown/recreate naturally re-registers against the fresh store"). A single keyed helper needs to accept either backing store, not just default to `Map`.
- **`artifact-registry.ts` isn't a pure promise cache.** `ensureKnown()` caches `Promise<void>` but the actually-useful value is the side-effected field `this.known`, which other methods (`getKnownInstance`, `hasKnownClassId`) read **synchronously**, without going back through the promise. A drop-in `memoizeAsync<T>()` that only hands back a `Promise<T>` would lose that synchronous fast path unless the helper also exposes a `.peek()`/resolved-value accessor, or the call site keeps assigning `this.known` in a `.then()` outside the helper. Codex's raw evidence gestures at this ("implements it through separate result and initialization-promise fields") but the consolidated finding doesn't carry the nuance forward.

The other 4 instances (#2, #3, #4, #6) are clean mechanical drop-ins: call the loader, cache the promise, clear-on-reject with the guard, return it.

## Corrections to the consolidated finding

- **Chronology is backwards for `service.ts`.** Claude's raw finding (`pkg-aztec-runtime-claude.md:9`) states `stubClassRegistrations` "predates both" `578861be` (2026-07-10) and `64d85291` (2026-07-23). `git log -S "stubClassRegistrations" -- packages/aztec-runtime/src/pxe/service.ts` and `git blame -L 508,524` both show the field and method were added wholesale (100% `+` lines, no prior version) by commit `9ca9308e` ("feat(execution): fold discovery into estimation sims + admission clamp (#353)"), dated **2026-08-10** — after both cited commits, and only 4 days before this audit's own 2026-08-14 run date. It is the *newest* instance, not the oldest. The consolidated finding (`consolidated.md:46`) doesn't repeat the "predates" claim verbatim, but its parenthetical ("`578861be` touched 3 sites together; `64d85291` added 2 more independently") omits this 6th, most-recent event entirely — which is actually the strongest evidence for "this is still happening," since it landed days before the scan.
- **`578861be` "touched 3 sites together" overstates that commit's role.** Diffing `578861be` confirms it added `artifact-catalog.ts` wholesale (111 new lines, net-new file) and rewired `note-schemas.ts` (50 lines changed) to consume it — but the retry-catch **shape** inside `note-schemas.ts` (`cachedSchemas` singleton, unconditional-clear try/catch) is untouched by that diff, and `artifact-registry.ts` only gets a 4-line change unrelated to `ensureKnown`/`initPromise` at all. So `578861be` wrote **one** new copy of the idiom (`artifact-catalog.ts`, notably the one WITH the guard), not three; the `note-schemas.ts` and `artifact-registry.ts` copies already existed at the squashed `5ee8ec13` "open-source initial import" (2026-05-19) and are of unknown finer-grained origin.
- **Revised, more defensible timeline:** pattern present in `note-schemas.ts` + `artifact-registry.ts` since the 2026-05-19 initial import (origin opaque, pre-dates visible history) → `artifact-catalog.ts` added 2026-07-10 (`578861be`, with the guard) → `public-events.ts` ×2 added 2026-07-23 (`64d85291`, same commit, self-adjacent) → `service.ts` added 2026-08-10 (`9ca9308e`). That's 4 distinct hand-copy events spanning ~83 days, which supports "at least 3 separate times over ~3 months" (arguably conservative), but not via the specific commit pairing the consolidated finding cites.
- **"Codex's scope excluded" the 6th instance is not quite right.** `pkg-aztec-runtime-codex.md` has a *separate* finding (its Finding covering `service.ts:67-68,209,911-919`, the empty `onActiveProfileChanged` callback) that reads `service.ts` directly — so the file was in Codex's scope. Codex simply didn't classify `stubClassRegistrations` as an instance of the duplication pattern there; it's a miss within scope, not an excluded file. Doesn't change that Claude is the sole source for instance #6.
- **Change-frequency commit counts verified exactly**, both raw passes' framing and this correction aside: `git log --oneline --follow` gives `artifact-catalog.ts` 1 commit, `public-events.ts` 2, `note-schemas.ts` 2, `artifact-registry.ts` 2 — matching Codex's raw tally precisely.

## Strengthened evidence

Definitive instance list, all in `packages/aztec-runtime/src/pxe/`:

| # | File : lines | Cache member | Clear-on-reject | Guard? |
|---|---|---|---|---|
| 1 | `artifact-catalog.ts:88,93-106` | `cache = new Map<CatalogKey, Promise<CatalogEntry>>()` | `entry.catch(() => { if (cache.get(key) === entry) cache.delete(key) })` (line 102-104) | **Yes** — identity check |
| 2 | `note-schemas.ts:61,63-89` | `let cachedSchemas: Promise<NoteSchemaMap> \| null` | `try { return await cachedSchemas } catch (err) { cachedSchemas = null; throw err }` (line 84-88) | No |
| 3 | `public-events.ts:169-182` | `let transferTagPromise: Promise<Tag> \| undefined` | `transferTagPromise.catch(() => { transferTagPromise = undefined })` (line 177-179) | No |
| 4 | `public-events.ts:184-194` | `let bundledTokenClassIdPromise: Promise<Fr> \| undefined` | `bundledTokenClassIdPromise.catch(() => { bundledTokenClassIdPromise = undefined })` (line 189-191) | No |
| 5 | `artifact-registry.ts:52,99-112` | `private initPromise: Promise<void> \| null` | `.catch((err) => { this.initPromise = null; throw err })` (line 106-109) | No |
| 6 | `service.ts:508,510-524` | `private readonly stubClassRegistrations = new WeakMap<object, Promise<Fr>>()` | `pending.catch(() => this.stubClassRegistrations.delete(pxe))` (line 520) | No |

All 6 line ranges and the `if (cache.get(key) === entry)` guard cited by both raw passes and the consolidated finding are confirmed accurate against source.

**Practical reachability of the missing-guard race, checked and not previously assessed:** in every one of the 5 unguarded instances, the race (a stale rejection handler clearing a cache slot a newer call already repopulated) requires something to reset the cache concurrently with an in-flight call. For #2 and #3/#4, that trigger is exclusively the test-only `_resetNoteSchemasForTests`/`_resetPublicEventMemosForTests` functions — not reachable from any production code path. For #5, the trigger would be `ArtifactRegistry.clear()` — but `grep -rn "artifacts.clear" packages/aztec-runtime apps/extension` shows this method is **never called anywhere in production code**, despite its own doc comment claiming "Called during onProfileDeleted so a stale class-id set doesn't linger" — that wiring appears to not exist (or was removed), a separate doc-drift/dead-hook issue adjacent to but outside Q-04's scope. For #6, there is no reset path at all; the `WeakMap` naturally avoids the collision because a torn-down `PXE` object is never reused as a key. Net: the divergence is real and worth fixing once, but is a **latent** hygiene gap today, not a live production bug — the audit's "silent behavioral gap" framing is accurate as written (a real, not hypothetical, code difference) but slightly overstates current exploitability, which none of the raw sources address.

## Refined recommendation

Extract Function into `packages/aztec-runtime/src/pxe/async-memo.ts`, exporting two primitives (naming per the consolidated finding, contract sharpened here):

```ts
/** Singleton async memo: caches the in-flight/settled promise, clears it on
 *  rejection (identity-guarded — a newer promise set during a concurrent
 *  clear/retry is never clobbered by a stale rejection handler) so a
 *  transient failure doesn't poison the cache forever. */
export function memoizeAsync<T>(loader: () => Promise<T>): {
  get(): Promise<T>
  reset(): void
}

/** Keyed async memo. `store` defaults to `Map` (bounded/enumerable key sets,
 *  e.g. CatalogKey) but MUST accept an injected `WeakMap` for object-identity
 *  keys (e.g. a live PXE instance) so a torn-down key's promise doesn't pin
 *  it in memory — this is a real, not cosmetic, requirement: instance #6
 *  today relies on WeakMap GC behavior that a Map-only helper would break. */
export function memoizeAsyncBy<K extends object, V>(
  loader: (key: K) => Promise<V>,
  store?: WeakMap<K, Promise<V>>,
): { get(key: K): Promise<V>; reset(key?: K): void }
```

Both encode the clear-on-reject-with-identity-guard contract from instance #1 exactly once (`if (currentEntry === thisEntry) delete/clear`).

**Migrate mechanically, no extra care needed:** instances #2 (`note-schemas.ts`), #3 and #4 (`public-events.ts`), and #6 (`service.ts`, passing a `WeakMap` explicitly) — each collapses to a loader function plus a 1-3 line call; their existing `_reset*ForTests` hooks become thin wrappers around `.reset()`.

**Migrate with care:** #1 (`artifact-catalog.ts`) is keyed and already has the guard — becomes the reference implementation, verify the migrated version's `Map`-backed `memoizeAsyncBy` call preserves the exact per-key semantics (no eager all-12 load). #5 (`artifact-registry.ts`) needs the extra synchronous-read requirement resolved first: either add a `.peek()`/resolved-value accessor to `memoizeAsync` that `ensureKnown()` can use to populate `this.known` without reintroducing a second cache, or explicitly keep `this.known` as a `.then()` side effect layered on top of the helper (acceptable, but means this call site is not a pure 3-line drop-in like the other 5). Flag `ArtifactRegistry.clear()`'s dead `onProfileDeleted` wiring claim for a separate, unrelated follow-up — it's outside Q-04 but was surfaced verifying this finding.

## Final confidence

**High.** The 6-instance count, exact cache-member/clear-on-reject line citations, and the single-guard divergence are all independently re-derived and match the consolidated finding precisely; the one real defect found — the reversed `service.ts` chronology inherited from Claude's raw pass — is corrected with primary git evidence (`git blame`, `git log -S`) and does not affect the finding's core verdict or recommended refactoring.

---

# Q-05 verification — client passthrough exhaustiveness-guard duplication

## Verdict

**CONFIRMED-WITH-CORRECTIONS.** The 16-file instance list is exact — independently re-derived by directory scan and matched byte-for-byte against both raw scanner passes and the consolidated finding. The described skeleton is real, present verbatim in all 16 files, and genuinely eliminable by a single generic. One denominator error in the Claude raw source ("16 of 22") is corrected below; the consolidated finding itself does not repeat that error.

## Independent assessment (pre-claim)

Listed `apps/extension/src/wallet/services/*/client.ts` before reading any audit file: 23 files total. Read `contact`, `token`, `passkey`, `account`, `network`, `execution` in full, then grepped all 23 for `definePassthroughs|Exhaustive|validateParams|extends ServiceClient`.

16 files carry the identical 4-part skeleton: a `const X_METHODS = [...] as const satisfies readonly (keyof Methods)[]` array, a `type _XMethodsExhaustive = Exclude<keyof Methods, (typeof X_METHODS)[number]> extends never ? true : Exclude<...>` type alias, a `const _xMethodsExhaustive: _XMethodsExhaustive = true; void _xMethodsExhaustive` dummy-and-discard pair, and a `definePassthroughs<Methods>(XServiceClient.prototype, X_METHODS)` call paired with a verbatim `biome-ignore lint/suspicious/noUnsafeDeclarationMerging` comment on the `interface X extends MethodsSpec<Methods> {}` merge above it. Confirmed present, structurally identical modulo names, in: `account`, `account-state`, `auth-registry`, `contact`, `dapp-interaction`, `dapp-session`, `execution`, `fpc`, `incoming-transfer`, `log-viewer`, `note`, `passkey`, `task`, `token`, `token-balance`, `transaction`.

7 files do **not** carry it, each for a distinct, legitimate reason:
- `config`, `price`, `profile` — hand-written passthrough methods (`return this.request("x", ...)`), no `definePassthroughs` call at all; small enough method counts that the array+guard machinery was apparently judged not worth it, or predates the extraction.
- `network`, `operation-journal` — hand-written methods wrapping `validateParams`/`validateResult` (zod-based runtime validation on top of the RPC call), which `definePassthroughs`'s pure forward-only body cannot express — a genuine reason these can't use the passthrough factory as-is.
- `logger` — deliberately narrower `log()` signature than the transport `Methods` type (documented in-file: "the narrower `log` signature doesn't satisfy the wider transport spec"), so it can't `implements ServiceSpec<Methods>` or declaration-merge `MethodsSpec<Methods>` at all.
- `pxe` — a Chrome-bound subclass of `PxeServiceClientBase` (defined in `@nulo/aztec-runtime/pxe`), adds only an `onReady` offscreen-bootstrap hook; owns no local `Methods`/passthrough surface to guard.

Sketched the type-feasibility question — can one generic replace the per-file `Exclude<>`-based proof while preserving BOTH directions of the compile-time guarantee (no missing key, no typo'd/extra key)? Yes, via a curried factory:

```ts
function definePassthroughsExhaustive<M extends MethodsMap>() {
  return function <const T extends readonly (keyof M & string)[]>(
    proto: object,
    methods: Exclude<keyof M, T[number]> extends never ? T : { missingMethods: Exclude<keyof M, T[number]> },
  ): void {
    definePassthroughs<M>(proto, methods as unknown as readonly (keyof M & string)[])
  }
}
```

Currying is required, not stylistic: a single (non-curried) two-type-param generic forces callers to either supply both type arguments explicitly (defeating inference of `T` from the array literal) or supply none (losing the explicit `M` binding the call sites rely on for readability) — TypeScript rejects a partial explicit list (`TS2558: Expected 2 type arguments, but got 1`) unless the second parameter has a default, which would then have to be `readonly (keyof M & string)[]` and silently drop the completeness check for any caller who doesn't reinstate it. Currying keeps today's explicit-`<Methods>` ergonomics (`definePassthroughsExhaustive<Methods>()(proto, [...])`, or bound once to a local const) while `T` infers structurally from the array literal (`const T` type parameter, supported since TS 5.0; repo pins `typescript ^6.0.3`).

Checked this against a real client's shape (`contact/client.ts`'s `Methods` from `./spec`) and empirically verified — not just idiom-recalled — by compiling a standalone repro against the repo's own `tsc` (v6.0.3, `--strict`): the exhaustive case compiles clean; a case missing one key and a case with an extra/misspelled key both produce genuine compile errors (`@ts-expect-error`-matched, confirmed by a clean exit rather than an "unused directive" error). Both directions of the proof — completeness (no missing `Methods` key) and soundness (no typo'd/extra key) — survive the consolidation.

## Corrections to the consolidated finding

- **File list: no correction needed.** The consolidated finding's instance list (`account, account-state, auth-registry, contact, dapp-interaction, dapp-session, execution, fpc, incoming-transfer, log-viewer, note, passkey, task, token, token-balance, transaction`) is exactly the 16 files independently found here — a 3-way match across my own scan, the Claude raw pass, and the Codex raw pass (including matching per-file line numbers spot-checked against `contact/client.ts`: array `:12`, exhaustive type `:25`, interface merge `:33`, `definePassthroughs` call `:44` — codex's citations are accurate).
- **Denominator, raw source only (`ext-services-claude.md:9`): "16 of 22" should read "16 of 23".** There are 23 `client.ts` files under `apps/extension/src/wallet/services/`, not 22 — verified by direct directory listing. This error is confined to the raw Claude pass's header; the consolidated finding at `consolidated.md:55` does not restate a denominator and is unaffected.
- **Change-frequency figures: consistent, not contradictory.** Consolidated says "8-12 commits/90 days"; Claude raw says 12 (`git log --since="90 days ago" -- 'apps/extension/src/wallet/services/*/client.ts'` independently re-run here, confirmed 12); Codex raw says 8 (likely a narrower per-file tally or different window). The consolidated range correctly spans both — no correction needed.
- **Non-pattern files' reasons, not previously enumerated:** neither raw source explains *why* the other 7 client files lack the guard. Worth recording (see above) since it bounds the refactor's blast radius precisely at 16, not "all client.ts files minus a few stragglers" — `network`/`operation-journal` structurally cannot use even today's `definePassthroughs` (they need per-call zod validation), and `logger`/`pxe` don't have a local `Methods` passthrough surface to guard at all.

## Strengthened evidence

**Definitive 16-file list** (all under `apps/extension/src/wallet/services/`, all confirmed to carry the exact 4-part skeleton):
`account/client.ts`, `account-state/client.ts`, `auth-registry/client.ts`, `contact/client.ts`, `dapp-interaction/client.ts`, `dapp-session/client.ts`, `execution/client.ts`, `fpc/client.ts`, `incoming-transfer/client.ts`, `log-viewer/client.ts`, `note/client.ts`, `passkey/client.ts`, `task/client.ts`, `token/client.ts`, `token-balance/client.ts`, `transaction/client.ts`.

**Deviating files and why** (7, all correctly excluded from the finding's blast radius):
| File | Deviation |
|---|---|
| `config/client.ts` | Hand-written passthrough methods, no `definePassthroughs` usage |
| `price/client.ts` | Same — hand-written, small method count |
| `profile/client.ts` | Same — hand-written, includes non-trivial orchestration methods (`subscribeActiveProfile`) that couldn't be a pure passthrough anyway |
| `network/client.ts` | Every method wraps `validateParams`/`validateResult` (zod) around the request — incompatible with `definePassthroughs`'s pure-forward body |
| `operation-journal/client.ts` | Same zod-validation pattern, plus a hand-written `subscribeJob` orchestration method |
| `logger/client.ts` | Narrower `log()` signature than the transport `Methods` type; explicitly does not `implements ServiceSpec<Methods>` |
| `pxe/client.ts` | Subclasses `PxeServiceClientBase` from `@nulo/aztec-runtime/pxe`; no local `Methods`/passthrough surface |

## Refined recommendation

Add a curried generic to the **same file** that already owns `definePassthroughs` — `packages/extension-messaging/src/core/service-client-factory.ts` — exported alongside it from `@nulo/extension-messaging/background`. This is the correct layer: `MethodsMap` (the only type it needs beyond what's already imported) lives one layer down in `wallet-core/base`, already imported into this file; every one of the 16 client files already depends on `extension-messaging/background` for `definePassthroughs` itself, so the new export adds no new edge to the `wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension` chain.

```ts
/**
 * Curried: bind `M` once per client (`definePassthroughsExhaustive<Methods>()`),
 * then call the returned installer with the prototype and the method-name tuple.
 * The tuple's inferred literal type is checked in BOTH directions against `M`:
 * every element must be a key of `M` (today's `satisfies` check), and every key
 * of `M` must appear in the tuple (today's separate `_XMethodsExhaustive` guard).
 * A missing key surfaces as a real compile error naming the missing key(s)
 * directly in the `{ missingMethods: ... }` mismatch — no separate type alias,
 * dummy const, or `void` statement required at the call site.
 */
export function definePassthroughsExhaustive<M extends MethodsMap>() {
  return function <const T extends readonly (keyof M & string)[]>(
    proto: object,
    methods: Exclude<keyof M, T[number]> extends never ? T : { missingMethods: Exclude<keyof M, T[number]> },
  ): void {
    definePassthroughs<M>(proto, methods as unknown as readonly (keyof M & string)[])
  }
}
```

Each of the 16 `client.ts` files then collapses from ~15-20 lines of skeleton to:

```ts
definePassthroughsExhaustive<Methods>()(ContactServiceClient.prototype, [
  "getContacts",
  "getContact",
  "getContactByAddress",
  "addContact",
  "updateContact",
  "deleteContact",
  "exportContacts",
  "importContacts",
])
```

removing the `_METHODS` const (or keeping it inline — no longer needs the separate `satisfies` clause, since the generic's parameter constraint subsumes it), the `_XMethodsExhaustive` type alias, and the dummy-const-plus-`void` pair — roughly 5-8 lines × 16 files ≈ 90-130 lines net, plus retiring the need to hand-copy the "Completeness: ..." explanatory comment 16 times (one JSDoc on the shared function instead).

**What does NOT collapse, and shouldn't be attempted:** the `export interface XServiceClient extends MethodsSpec<Methods> {}` declaration-merge and its paired `biome-ignore lint/suspicious/noUnsafeDeclarationMerging` comment stay per-file. TypeScript declaration merging binds to a named class declaration; centralizing it would mean either code-generating the class (bigger blast radius, new build-step risk) or making clients factory-returned instances instead of named exported classes — the latter breaks every existing `import { XServiceClient } from ...` type-position usage across popups/pages/composables for no proportionate gain. The consolidated finding's "4-part skeleton" description folds this in as one of the four parts; the refined view is that only 2 of those 4 parts (the exhaustiveness type + the dummy-const/`void`) are what the generic actually eliminates — the array (real per-service content) and the interface-merge-plus-biome-ignore (inherent to TS declaration merging) survive by necessity, just now shorter and with no separate completeness comment.

## Final confidence

**High.** The file list is an exact 3-way match (independent scan, Claude raw, Codex raw) confirmed against real file contents, not just grep counts. The proposed generic was not just reasoned about but compiled against the repo's own TypeScript 6.0.3 in `--strict` mode with both a positive case and two negative (`@ts-expect-error`-verified) cases, confirming the compile-time proof genuinely survives consolidation in both directions.

