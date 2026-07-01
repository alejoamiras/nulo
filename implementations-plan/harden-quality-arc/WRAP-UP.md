# Harden-Quality Arc — WRAP-UP / promote `dev-quality` → `dev` (rounds 1 + 2)

Lands the quality-hardening arc from `audit/quality/2026-06-29-ext-ultra` (22 findings Q-01–Q-22) **plus round 2**, which finished every deferral round 1 documented. Each finding was re-verified vs HEAD → tier-blueprinted (codex + Explore/opus + decision ledger) → implemented behavior-preserving (except the owner-authorized changes, each behind failing-first tests) → **squash-merged into `dev-quality` only after its own units + smoke + FULL network gate went green**. Every commit is on `dev-quality`; this is the single promote for the owner to merge.

> **Round-2 code HEAD `f636f6c`** (round-1's was `dc2a03e`). The round-2 integrated sweep + both round-2 confidence passes ran on `f636f6c`; WRAP-UP/eli5 refreshes are docs-only commits on top.

## ROUND 2 — the deferrals, finished (PRs #227–#244, `round-2/plan.md`)

Round 2 resolved **every** owner-follow-on from the round-1 list below: Q-13 (owner-authorized), P16b, P18b, the Q-01 durable-store seams, and Q-02's arg typing (owner-authorized oracle edit). Plus a real product-race fix (Q-15) and a real backup privacy leak fix.

| Phase | PRs | What landed |
|---|---|---|
| R0 | #227 | `UPDATE.md` @aztec-bump checklist (the coupling convention later phases append to) |
| R1 Q-13 | #229–#236 | cross-profile isolation standing gate (11 assertions, zero `test.fails` left); shared `restore-rows`/`id-allocators`/`require-owned-row` helpers adopted by contact/fpc/network/token; **by-id ownership guards closed fail-closed** (deleteToken split: public RPC guarded / private cascade); **token-balance `backup()` plaintext cross-profile leak FIXED export-only** (filter via `tokenService.getTokensRaw(profile.id)` — restore tolerance untouched per decision #4); `revokeAuthwits` account check |
| R2 Q-15 | #237 | the round-1-surfaced lock/bootstrap race FIXED in product: `useProfileBootstrap` re-reads the active profile before flipping `isLogined` (serialized behind the lock via the profile-service `runExclusive`) — the lock wins |
| R3 P16b | #238 #240 | 37-pin frozen-oracle characterization of the 3 dApp approval windows, then the `useDappApprovalWindow` shell extraction graded against it byte-unchanged (divergences preserved verbatim: capabilities' missing `!requestId` guard, execute's lazy execution transport, dismiss-routes-through-beforeunload) |
| R4 P18b | #241 | PXE `descriptors.ts` flags table (explicit `rpc`/`ipxe`/`requiresNetwork`; SW-only trio compile-time-excluded from `IPXE`/proxy); `PXEProxy`'s 18 curries generated; `rpcMethods` dispatch allowlist stays hand-written; UPDATE.md §Types-coupled populated |
| R5 Q-01 | #242 #243 | zod row codecs injected into 11 durable stores (validation-fail = kept + read-undefined, NEVER deleted); strictness per seam direction; **the real-proving canary caught a first-cut bug** (numeric `@aztec` enums vs object checks) — fixed, corpus rebuilt from write sites |
| R6 Q-02 | #244 | `argSchema` predicate guards on the dApp dispatch path (11 guarded / 8 deliberately omitted); **the ONE authorized frozen-oracle edit — mechanically ADD-only (zero deletions), diff surfaced in #244's PR body for your review** |
| CI fix | #239 | `fetch-depth: 0` on the three paths-filter changes jobs (the shallow-deepen git race went structural at ~100 commits from `dev`; detection-only, no gating change) |

### Round-2 confidence passes (on code HEAD `f636f6c`)
- **Integrated full-network sweep:** <PENDING — filled at R7 close>
- **codex (xhigh, read-only, adversarial):** <PENDING — filled at R7 close>
- **fresh Fable subagent (adversarial, read-only, fresh context):** <PENDING — filled at R7 close>

### Round-2 invariants (mechanically verified on the `dc2a03e..f636f6c` span)
- `scope-enforcement.test.ts` — **byte-identical**. `key-vectors.test.ts` — **byte-identical**.
- `method-descriptors.test.ts` — **ZERO deletion lines** (the authorized ADD-only edit; FROZEN_* tables + reference-identity assertions untouched; a new strip-and-rederive test proves the derived authz maps ignore the new field).
- Enforcement runtime (`capability-map.ts` / `scope-enforcement.ts` / `capabilities.ts`) — **absent from the diff**.
- Every behavior change is fail-CLOSED and owner-authorized; backup restore tolerance untouched.

### Round-2 deferrals (surfaced owner rulings — NOT silently dropped)
- **RPC method-decode + dApp discriminated decoder** (Q-01 tail): fail-open→fail-closed on the dApp seam — needs an explicit authorization like leak#1 got. Rationale in `round-2/plan.md` §R5.
- **profile / session / config store codecs**: profile = a false-reject hides the vault (your backup/migration domain); session/config are `ValueStorage` where a codec would *activate* throw-on-drift in unlock/boot.
- **Q-02 typed-tuple layer** (plan point 4): deliberately not declared — precise TS tuples would claim what the tolerance-exact runtime doesn't enforce. Follow-on if you want it.

### Round-2 owner action items
1. **#220 is RED on Commitlint** — one 138-char body line in `c8c80ae` (the only violation in the whole 100+-commit range). Options: (a) authorize a body-only reword + force-push of `dev-quality` (re-SHAs descendants), or (b) `--admin` the promote — legitimate here because dev-quality→dev is a **squash** (the final `dev` commit uses #220's own clean message; the overage never lands on `dev`).
2. **1Password agent went down mid-round-2** (commit signing + SSH). Per your AFK rules: a handful of later dev-quality commits are unsigned (config untouched; pushes went via `gh` HTTPS). Unlock 1Password; optionally backfill signatures pre-merge (same note as round 1 — the squash is web-flow-signed regardless).
3. **Review the R6 oracle diff** in #244's PR body (the `<details>` block) during #220 QA.
4. The **Q-15 surfaced race is now FIXED** (R2/#237) — the round-1 "owner action item" below is superseded.

## Landed (21/22 findings)
| Finding | Phase | PR | What |
|---|---|---|---|
| Q-09 | P1 | #188 | shared hex/base64 encoders → `@nulo/wallet-core/utils` |
| Q-17 | P2 | #190 | 19 lock blocks → `runExclusive` |
| Q-18 | P3 | #191 | one aztec-runtime artifact catalog (kill double class-id hashing) |
| Q-19 | P4 | #193 | `ProductionPxeFactoryOptions` discriminated union + `ChainCoordinates` codec |
| Q-20 | P5 | #194 | config store → zod schema |
| Q-21 | P6 | #195 | `general.js`→`.ts` + typed `lastError` |
| Q-22 | P7 | #196 | doc-drift sweep (Aztec 5.0.0-rc.1, PBKDF2 600k) |
| Q-07 | P8 | #197 | error-taxonomy dedup + de-stringly-type |
| Q-16 | P9 | #198 | honest `Client \| null` `AppServices` + require/get accessors |
| Q-11 | P10a | #199 | shared `SeverityTone` + typed Badge/Banner/Toast tone props |
| Q-10 | P10b | #200–#205 | 15 `@nulo/design` primitives' `type:String` props fully typed |
| Q-08 | P11 | #204 | 3 byte-identical schema-patch copies → private `@nulo/wallet-sdk-schema-patch` |
| Q-12 | P13 | #206–#208 | `TokenFnDescriptor` registry (−1705 LOC, 9 modules gone) |
| Q-06 | P14 | #209/#210 | branded crypto/secret types + `RestoreSecret` union |
| Q-04+Q-05 | P15 | #211/#212 | typed OperationPolicy + capability-coverage strategy |
| Q-14 | P16 | #213/#214 | `usePopupEntity` composable + 5 popups (P16b window shell deferred) |
| Q-15 | P17 | #215 | `runInSlot` execution-slot dedup (concurrency-critical) |
| Q-03 | P18 | #216 | `definePassthroughs` client factory, 16 clients (P18b PXE deferred) |
| Q-01 | P19 | #217/#218 | storage boundary codec + operation-journal 1st consumer (durable-store/RPC/dApp/backup deferred) |
| Q-02 | P20 | #219 | typed dispatch-entry choke point (arg-tuple typing deferred — HALT) |

## NOT landed — owner-gated (1 finding)
- **Q-13 (P12) — backup cross-profile leak.** BLUEPRINTED, NOT implemented: its fix touches the **backup persisted shape** (a wipe-vs-tolerate decision) — a HARD LIMIT that requires an owner call, not an autonomous change. See `findings/Q-13/plan.md`. Not a regression: the defense-in-depth gap it surfaced (sequential-id-enumerable by-id getters) already exists on `dev` and is **not dApp-reachable** (only the scope-gated `isTokenRegistered` is). **Owner action item.**

## Deferred sub-parts (owner follow-ons, documented — NOT silently dropped)
- **P16b** — Q-14 dApp-window shell (load-bearing connect/beforeunload/disconnect ordering; characterize first).
- **P18b** — Q-03 PXE descriptor table (shape-only; SW-only methods must stay absent from `IPXE`).
- **Q-01 seams** — durable-store codec migrations (token/account/network/… — each fail-closed-on-drift + a round-trip corpus), RPC method-decode, dApp discriminated decoder, backup import.
- **Q-02 arg-tuple typing** + `popupGated`/`batchAllowed` descriptor fields — **HALT-blocked**: needs new `MethodDescriptor` fields = editing the frozen authz oracle → an owner decision.

## Confidence pass (both legs, on the arc code HEAD `dc2a03e`)
- **codex (xhigh, read-only): `SAFE TO PROMOTE`.** No security blocker; all concerns non-blocking (frozen-oracle wording, pre-existing capability re-prompt drift, the Q-15 product race, deferred codecs, Q-02 casts).
- **fresh-opus (adversarial, read-only): `PROMOTE-WITH-FIXES`** — hand-checked all 7 capability branches + every fail-open landmine (`getOperationAccessLevel` default `None`, `register_token` anti-phishing case, batch-forbidden `{sendTx,registerToken}`) intact; found **no code regression and no trust-boundary slip**. Its one "blocking" fix (**run the integrated full-network sweep on the finished branch**) **is done and green** (below) — opus is read-only and couldn't observe CI. Its G2 (21/22, Q-13 owner-gated) is the owner decision this PR frames.

## Invariants held across the whole arc (full-arc `git diff` vs `dev` merge-base, not just per-phase)
- **Frozen-oracle assertions are byte-identical.** The 3 formally-frozen authz/crypto oracles:
  - `packages/wallet-bridge/src/scope-enforcement.test.ts` (authz) — **byte-identical** (`git diff --exit-code` clean).
  - `apps/extension/src/wallet/crypto/key-vectors.test.ts` (crypto vectors) — **byte-identical**.
  - `packages/wallet-bridge/src/method-descriptors.test.ts` (authz) — the `FROZEN_CAPABILITY_MAP`/`FROZEN_EXEMPT`/`FROZEN_SCOPE_CHECKER` tables + every assertion are byte-identical; the file carries **exactly ONE** changed line — the load-bearing reachability *import* repointed to `@nulo/wallet-sdk-schema-patch/register`, mechanical fallout of the Q-08 dedup (P11/#204), **not** a trust-boundary phase. It is fail-closed: if `register` failed to add the 3 Nulo-custom methods, the exhaustiveness reverse-check goes RED, not vacuously green.
- **Crypto canary intact.** `password-secret-box.test.ts` (a canary-bearing crypto test, *not* on the formal frozen list) was legitimately updated by Q-06 (P14) with compile-time-identity branded wrappers (`asMasterSecretBytes`/`asBase64Ciphertext`/`asPasshash`) + one stale-comment rename; its `PLAINTEXT_HEX` vector, the `ENCRYPTION_GUARD` canary bytes `[6,11,20,20,22,4,20,22]`, and all expected outputs are byte-identical.
- *(Honesty note: an earlier plan/draft said "frozen oracles byte-UNEDITED **files**." The exact truth is byte-identical **assertions** with the single mechanical import delta above — surfaced by both confidence passes, re-verified by full-arc diff.)*
- **No fail-open / permission-semantics change** — every boundary change is fail-CLOSED (storage codec keeps-not-deletes on validation-fail; dispatch guard behavior-identical; capability/scope *enforcement runtime* — `capability-map.ts`/`scope-enforcement.ts`/`capabilities.ts`/`dapp-interaction/spec.ts` — absent from the diff entirely).
- Every finding PR gated on **units + smoke + FULL network**; plain squash-merges (no `--admin`). **Integrated full-network sweep on the code HEAD `dc2a03e`: Quality + Smoke + Network e2e all green** (runs 28515048233 / 28515049686 / 28515051319) — opus's G1 "real settle."
- The registry cluster (P15/P18/P19/P20) re-ran the adversarial-bypass suite + frozen oracle after each phase.

## Signatures / merge note
Every finding's **code** originally landed via GitHub-signed squash-merges (PRs #188–#219). During P21 the branch was history-rewritten once to fix a latent commitlint violation in a squash subject (see `lessons/P21-relint.md`), which re-created every commit **unsigned** — so all `dev-quality` commits are now `N`. This does **not** block the promote: `dev`'s ruleset is **squash-only**, so merging collapses the arc into one GitHub-web-flow-signed squash, satisfying `required_signatures` (a self-authored squash is signed by GitHub). (Optional: `git rebase --exec 'git commit --amend --no-edit -S' <base>` on `dev-quality` first if you want its own history signed; requires force-push, so only before merge.)

## Pre-existing behavior confirmed (flagged by codex, NOT introduced here — owner-aware)
- **Capability re-prompt drift (pinned, not a regression):** `dataRequestCovered` treats any existing data grant as covering `addressBook:true` (`dispatcher.ts:223`), and `contractClasses` coverage is type-only (`dispatcher.ts:293`). Pinned by `dispatcher.test.ts:536`. **Enforcement still denies over-broad use** at `method-scope-checkers.ts:336` (fail-closed) — this is a re-prompt-UX gap, not an authz hole. Untouched by the arc; documented so it isn't mistaken for arc fallout. (This is the out-of-arc `wallet-sdk-capability-field-diff` finding; flip the two `(DRIFT PIN)` tests to `popupCalls === 1` when it lands.)

## Surfaced product bug (owner action item)
- **Q-15 lock/bootstrap race:** locking immediately after a password change can leave the popup on the general page instead of `/popup/auth` (a stale post-change `bootstrapActiveProfile` re-sets `isLogined=true` after lock). The session IS cleared (low security impact, narrow window); fixed TEST-side, product race documented in `lessons/Q-15.md`.

---
Full detail: `plan.md` (P0–P21 with SHAs + run-ids), `lessons/`, `findings/`. **Owner merges** (the arc never merges `dev-quality → dev` autonomously).
