# account-artifact-freeze

Make account addresses a **frozen, versioned artifact of the Nulo extension major** — not a side
effect of whatever `@aztec/accounts` happens to ship. Today the full seed→address chain is pinned
by known-answer tests (loud on drift) but NOT stable across `@aztec/*` bumps: the address embeds
the class id of `SchnorrAccountContractArtifact` imported from npm, and upstream warns class ids
shift on ANY toolchain/bytecode change. Result: every bump risks "account address inconsistency"
for existing users, whose only remediation is profile deletion. Pre-production that's tolerable;
in production it is not. This plan vendors the artifact, freezes the Nulo-owned instantiation
descriptor, adds a dedicated per-bump execution-compatibility canary, formalizes address-rotation
as an append-only regime record (one regime per extension major), gives the runtime mismatch a
centralized background-owned handled state, and writes the policy down.

**Tier**: `mid`. Audit trail: codex r1 `reject` → consolidated v2 → fable r1
`conditional approve` (folded) → final fresh-context codex pass `conditional approve` (all six
conditions folded into this v3). Verdicts inline below; transcripts in `audit-codex.md` /
`audit-fable.md`.
**Baseline**: `dev` @ `cff0ba2` (aztec 5.0.1 line, v0.25.0).
**Status: APPROVED 2026-07-20** — user verdict `approve`. Ask resolutions: A1 confirmed
(cross-major semantics as stated: V5 backups restore only in V5; V6 recovery = seed import
deriving V6-regime accounts); A2 confirmed (canary failure ⇒ HOLD the `@aztec` line; cutting the
next major stays a deliberate decision); A3 confirmed (revised Outline A — the shared frozen
descriptor). `/harden security` at pre-production: recommended, user chose decide-later
(unscheduled).

## The two failure modes this plan must separate (audit-adopted framing)

1. **Address drift** (what the user experienced): a bump shifts the derived address → stored
   profile no longer matches → generic error → "delete profile?" panic. Fixed by freezing the
   address inputs Nulo owns (artifact + instantiation descriptor) and gating drift.
2. **Execution breakage** (the failure mode the freeze can CREATE): frozen 5.0.1 bytecode driven
   by a newer simulator/prover/entrypoint encoding is a combination upstream never tests. A green
   address KAT says nothing about executability — payload encoding, signature-limb encoding,
   ACIR/VK changes, or node-side checks can reject the frozen artifact while the address stays
   identical. All three audit legs converged: this is the plan's central risk and gets its own
   DEDICATED canary (Phase 4) — smoke e2e CANNOT catch it (the smoke config includes only
   `tests/e2e/*.test.ts`; prove/send lives in `tests/e2e/network/`), and the final pass verified
   the existing network tests are individually insufficient (`tx-sendTx-multicall` stops at
   proving entry; `authwit-variants` tolerates errors).

## The freeze boundary (corrected per audits)

Address inputs at `NuloAccount.new` (`packages/aztec-runtime/src/account/nulo-account.ts:56-76`)
— note `constructorArgs` is read from upstream at TWO sites: address derivation (`:62-67`) and
first-tx ctor execution (`buildWithInitialization`, `:206-210`); both must consume the single
frozen descriptor:

| Input | Source today | Disposition |
|---|---|---|
| seed → signingKey → secretKey | `@nulo/wallet-crypto` KDF v1 (frozen, 5.0.1 arc) — `deriveSecretKeyFromSigningKey` remains an upstream call inside the frozen chain, KAT-tripwired | already frozen |
| artifact bytes → class id | `@aztec/accounts` npm import | **vendored raw `SchnorrAccount.json` + digest pin + post-load class-id pin.** Honest caveat: the JSON→class-id transformation (`loadContractArtifact`, `getContractClassFromArtifact`) stays upstream — the pin is a TRIPWIRE for that path, not a freeze |
| ctor fn name + args `[pubkey.x, pubkey.y]` | upstream `SchnorrAccountContract` class code, read at both sites above | **frozen local instantiation descriptor** (revised Outline A — see ledger) |
| immutablesHash | upstream returns `undefined` → stdlib defaults `Fr.ZERO` | frozen in descriptor (explicit zero — verified trivial, nothing to copy) |
| salt | `Fr.ZERO` literal (ours) | already frozen, restated in descriptor |
| deployer | `AztecAddress.ZERO` default inside upstream | pinned in descriptor + KAT |
| publicKeys | `deriveKeys(secretKey)` (`@aztec/stdlib`) | protocol-level — KAT tripwire only |
| initializationHash / address hash | upstream `computeInitializationHash` (ctor selector from artifact ABI + args) / `getContractInstanceFromInstantiationParams` | protocol-level — KAT tripwire only |

Protocol-level rows are NOT frozen here: if upstream changes them, the protocol moved — network-
reset / new-major territory (the "Nulo V6 is a NEW extension" policy, Phase 6). The KAT makes such
a move impossible to ship silently; the Phase 4 canary catches the execution side.

## Phases

### Phase 1 ✓ — Vendor the raw artifact, with provenance
Copy the RAW `SchnorrAccount.json` from `@aztec/accounts@5.0.1/artifacts/` (not the TS-wrapped
export) into `packages/aztec-runtime/src/account/artifacts/`, recording provenance in the PR and
in a committed `PROVENANCE.md`: package name@version, the lockfile's tarball integrity hash, the
extraction command, and the vendored file's sha256. Switch `nulo-account.ts` to load the vendored
copy (`loadContractArtifact` at module init). Pin tests: (a) vendored file digest ==
`FROZEN_ARTIFACT_SHA256`; (b) post-load class id == `FROZEN_ACCOUNT_CLASS_ID` (pins the loaded
interpretation, not just bytes). The existing full-chain KAT
(`packages/aztec-runtime/src/account/derivation-vectors.test.ts`) must pass UNCHANGED — proof the
vendoring is address-equivalent. Measure bundle impact: if the npm artifact ALSO lands in the
bundle via `SchnorrAccountContract`'s internal import, either decouple the auth-witness provider
from the artifact-bearing wrapper or record the accepted duplication size in lessons.

**Validation gate** — commands: `bun run lint && bun run typecheck:all && bun run test:all`
(NOT root `test`/`typecheck` — extension-only; the KAT and runtime packages ride `:all`;
audit-corrected twice). Pass: exit 0, KAT green with zero vector edits.
Layers: lint/typecheck(all)/unit(all workspaces).

### Phase 2 ✓ — Frozen instantiation descriptor (revised Outline A)
One small frozen descriptor module — constructor function name, args builder
`[signingPublicKey.x, signingPublicKey.y]`, `salt: Fr.ZERO`, explicit `immutablesHash: Fr.ZERO`,
`deployer: AztecAddress.ZERO`, plus a `descriptorVersion` + content digest (feeds the Phase 3
regime record) — consumed by BOTH call sites: `NuloAccount.new`'s
`getContractInstanceFromInstantiationParams` input AND `buildWithInitialization`'s ctor call,
eliminating the address/execution split-brain. No shadow account class: upstream
`SchnorrAccountContract` remains the auth-witness/signing provider; only instantiation INPUTS are
frozen (arg marshalling, no crypto copied). Descriptor-consistency test (final-pass-hardened):
both paths use the descriptor's constructor NAME and every fixed field (not just args), and the
emitted ctor `FunctionCall`'s selector + arguments correspond to the same initialization hash the
address derivation used. KAT stays green unchanged.

**Validation gate** — commands: `bun run lint && bun run typecheck:all && bun run test:all`.
Pass: KAT green, zero vector edits, consistency test green. Layers: lint/typecheck(all)/unit(all).

### Phase 3 ✓ — Append-only regime record (one regime per extension major)
`packages/aztec-runtime/src/account/address-freeze.ts`: an append-only `REGIMES` record. Entry
`"nulo-v5"` = { artifactSha256, classId, descriptorVersion + descriptorDigest,
kdf: "nulo-account-kdf-v1", ack }. **No `ACTIVE_REGIME` pointer** (final-pass condition 4): each
extension major is compile-time single-regime — the current major binds to exactly one regime
constant, and MOVING a major to a different regime in place is the forbidden act. Rotation = a
new extension major (new regime entry appended as historical record + a new major that binds to
it), which is exactly the documented V5/V6 policy — mechanism and policy now agree. Stored
accounts are therefore never ambiguous: every account in a given major is its one regime; no
per-account regimeId persistence needed. Enforcement, honestly framed: the paired test
independently hardcodes EVERY historical entry (not just the newest), validates unique regime
ids, and binds each ack to its entry's digests (an ack that doesn't embed its artifactSha256 is
red); branch protection + signed commits + review make edits loud. A CODEOWNERS line is added as
an intent marker only — on a solo-owner repo it adds no enforcement (final-pass caveat,
documented as such). The ACK forces INTENT into a reviewed diff; immutable history + review are
the anti-tamper controls. Demonstrations in lessons: mutate the vendored artifact → digest test
red; edit the v5 entry → paired test red (then revert).

**Validation gate** — commands: `bun run lint && bun run typecheck:all && bun run test:all` + the
two red-demonstrations logged in lessons. Layers: lint/typecheck(all)/unit(all).

### Phase 4 ✓ — Dedicated frozen-account execution canary (REQUIRED, per-bump)
Two parts:
1. **New dedicated network e2e** (final-pass condition 1 — existing tests proven insufficient):
   fresh profile → assert the account's initialization nullifier is ABSENT on the node → first tx
   executes the FROZEN ctor via `buildWithInitialization` (multicall deploy) → simulate → REAL
   proof (accelerator-required, no WASM fallback) → node acceptance → a subsequent
   authwit-CONSUMING transaction → service-worker restart/recovery re-derives and still operates.
   Each stage asserted explicitly; `ok-or-error` tolerances banned in this file.
2. **Bind-to-procedure**: the aztec-update skill (Phase 6 docs) gains a MANDATORY step: every
   `@aztec/*` bump PR runs this canary (prover-on) via `bun run e2e:agent` before merge. CI
   coverage: the `extension-network` path filter already includes aztec-runtime source, manifests,
   and `bun.lock` (final-pass-verified), so deps-only bumps trigger the network suite; the skill
   step makes the canary's green an explicit named requirement, not an incidental. A canary
   failure BLOCKS the bump: default response is hold-the-line; shipping a new extension major is
   the deliberate alternative (Ask A2).

**Validation gate** — commands: targeted `bun run e2e:agent` run of the new canary file at
current pins. Pass: every stage assertion green against a live node with native proving.
Layers: network e2e (real prove).

### Phase 5 ✓ — Centralized mismatch state via a background integrity coordinator
Final-pass-corrected design (unlock opens the session before popup bootstrap, and
`AccountService` depends on `ProfileService` — a naive unlock-time call creates layering cycles
and a dApp execution window):
- **Background-owned integrity coordinator**: on profile session activation, BEFORE the session
  is exposed, re-derive and compare every stored account for the profile across its networks
  (deterministic, PXE-independent — pure KDF + descriptor + artifact, no node calls, so no
  transient false positives). On mismatch: withhold/close the session, persist a blocking-state
  record that survives service-worker restarts, and emit the blocking state to the UI shell.
- **Dedicated screen**: what happened (this wallet build derives a different address than the
  profile was created with), that the seed phrase still derives the accounts on a compatible
  version of Nulo (no categorical "funds are safe"), and what to do. NEVER solicits the seed, no
  external/import links, no delete CTA — deletion stays the deliberate settings flow.
- **Residual typed error**: `AccountAddressInconsistencyError` (WalletError subclass,
  RPC-boundary reconstructable like `InvalidPasswordError`) replaces the bare throw at
  `account/service.ts:199-201`; enumerated consumer paths (fee estimation, send, views, dApp
  execution) route to the blocking state; dApp-facing errors SANITIZED (generic failure, no
  internals).
- **Backup import hook**: the integrity check runs after account restoration and before
  `finalizeRestore`, so a corrupt/foreign backup can't activate a mismatched profile.
- Tests: coordinator unit (tampered stored address → session withheld + persisted state),
  SW-restart persistence unit, RPC-reconstruction test for the error class, component test for
  the screen, backup-import-path test.

**Validation gate** — commands: `bun run lint && bun run typecheck:all && bun run test:all &&
bun run test`. Layers: lint/typecheck(all)/unit(all)/component.

### Phase 6 ✓ — Policy docs + skill routing + provenance-drift fixes
- CLAUDE.md: "Account-address freeze (production invariant)" section — the regime record,
  one-regime-per-major + append-only rotation, the per-bump canary requirement, and the
  extension-major strategy: a protocol break ships as a NEW extension ("Nulo V6": separate
  extension ID + store listing, coexisting with V5; V5 backups restore under V5 derivation in V5;
  V6 recovers via seed import deriving V6 accounts — per Ask A1).
- aztec-update skill: vendored account artifact is NOT bumped with the line; KAT + freeze tests
  stay green with zero vector regeneration; the Phase 4 canary is a mandatory named bump gate;
  conscious rotation = new major, mirroring the FPC re-pin flow's spirit.
- UPDATE.md: coupling entries (vendored artifact, descriptor, freeze module); fix the stale
  "Current line: 5.0.0" header.
- Provenance-drift fixes: regime-b reference project description + KAT comments say "published
  5.0.0 packages" while its pins/digests are 5.0.1 — correct the prose.
- `implementations-plan/index.md` entry.

**Validation gate** — commands: `bun run lint && bun run typecheck:all` + docs read at PR review.
Layers: lint/typecheck + human review.

### Phase 7 — Full gates
`bun run audit:vue` (noting it does NOT cover the KAT — `test:all` is the KAT carrier) +
`bun run test:all` + `bun run test:e2e` (smoke) + `bun run build:firefox` (final-pass gate fix —
Chrome rides audit:vue's build, Firefox needs the explicit command) + record final bundle-size
delta.

**Validation gate** — commands: `bun run audit:vue && bun run test:all && bun run test:e2e &&
bun run build:firefox`. Pass: all exit 0. Layers: all fast + both builds + smoke.

## Security & Adversarial Considerations

- **Consensus-critical committed data**: the vendored artifact + descriptor now ARE the account
  identity. Tampering must move digest + class id + descriptor digest + KAT vectors + the paired
  hardcoded per-entry test coherently, under branch protection, signed commits, and review. The
  ACK forces intent into the diff; review + history immutability — not the ACK — are the
  anti-tamper controls. CODEOWNERS on a solo-owner repo is an intent marker, not enforcement
  (stated honestly per final pass).
- **Supply chain (corrected claim)**: after this plan the npm package no longer feeds the
  ARTIFACT or the INSTANTIATION DESCRIPTOR; it still executes protocol-level primitives
  (`deriveKeys`, `deriveSecretKeyFromSigningKey`, hashing, `loadContractArtifact`) — those
  remain KAT-tripwired, not eliminated. Vendor-time provenance is recorded (Phase 1).
- **The freeze's own hazard**: execution breakage against frozen bytecode — mitigated by the
  dedicated Phase 4 canary as a mandatory named bump gate; explicitly NOT mitigated by smoke.
- **Mismatch UI as phishing surface**: the blocking screen never asks for the seed, links nowhere
  external, offers no one-click destruction; dApp-facing errors sanitized; blocking state is
  background-owned and session-withholding, so a dApp can't race the window before the UI shows.
- **Crypto**: nothing reimplemented; the descriptor is arg marshalling only.
- **Least privilege / CI**: no new tokens or workflow permissions; gates ride `quality-status` +
  the existing network-e2e workflow.

## Assumptions

**Facts** (verified in-tree @ `cff0ba2`; audit-corrected where noted):
1. `nulo-account.ts:22,37,67-73` — npm artifact; salt `Fr.ZERO`; ctor args from upstream class
   code at TWO sites (`:62-67` address; `:206-210` first-tx execution).
2. Upstream construction verified in installed dist: ctor args `[pubkey.x, pubkey.y]` via
   `Schnorr().computePublicKey`; `getImmutablesHash()` → `undefined` → stdlib `Fr.ZERO`;
   `deployer` defaults `AztecAddress.ZERO`. The frozen descriptor copies VALUES, not algorithms.
3. `derivation-vectors.test.ts` — reference-generated KAT, regeneration from the implementation
   forbidden; runs under `test:all`, NOT under root `test`/`typecheck` or `audit:vue`
   (audit-verified; all gates use the `:all` variants).
4. Raw `SchnorrAccount.json` ships at `@aztec/accounts/artifacts/` (vendoring source).
5. `account/service.ts:188-203` — the untested `"account address inconsistency"` throw;
   `AccountService` depends on `ProfileService`; unlock opens the session before popup bootstrap
   (final-pass layering fact driving the coordinator design).
6. `InvalidPasswordError` RPC-boundary reconstruction precedent (`auth.vue` catch).
7. Committed-artifact precedent: bridge JSONs in-repo; app artifacts via vite aliases
   (`vite.shared.ts:46-47`).
8. Smoke e2e config includes only `tests/e2e/*.test.ts`; among the network suite, only
   `transfers`/`tx-sendTx-default` exercise real proof submission today, and none asserts the
   full frozen-ctor arc (final-pass-verified — drives the dedicated canary).
9. The CI `extension-network` path filter includes aztec-runtime source, manifests, and
   `bun.lock` (final-pass-verified) — deps-only bumps trigger the network suite.
10. Regime-b reference project pins 5.0.1 while its prose says 5.0.0 (drift, fixed in Phase 6).
11. `typecheck:all` and `build:firefox` exist as root scripts (gate commands verified).

**Inferences** (attackable):
- I1 (restated per audits): the real assumption is "frozen 5.0.1 bytecode remains
  simulatable/provable/acceptable by newer client tooling against an unchanged network" — NOT
  guaranteed upstream; the Phase 4 canary converts each bump's instance of this inference into
  evidence, and a red canary blocks the bump.
- I2: the frozen descriptor's inputs are stable facts of the vendored artifact's ABI — they
  cannot drift without the artifact drifting (digest-pinned). Residual: protocol-level
  selector/hash computation, KAT-tripwired.
- I3: bundle impact is bounded and measurable; if the npm artifact double-bundles via
  `SchnorrAccountContract`, decoupling the witness provider is feasible without copying crypto.
  Measured in Phase 1 either way.

**Asks** (surfaced at the approval gate, none silent):
- A1: Confirm the cross-major account semantics to DOCUMENT (not build now): Nulo V6 = separate
  extension ID + store listing, coexisting with V5; V5 backups restore under V5 derivation in V5
  only; V6 recovery = seed import deriving V6-regime accounts (V5 backups are NOT imported into
  V6 as V5-derived accounts). Confirm or adjust.
- A2: Mandatory response when a bump fails the Phase 4 canary: default HOLD the `@aztec` line
  (recommended), with "cut the next extension major" as the deliberate alternative. Confirm.
- A3: Outline choice: revised A (frozen descriptor feeding both call sites) — codex's pick,
  resolves fable's split-brain objection; fable preferred B (vendor-only + tripwires). The plan
  adopts revised A; confirm or override to B.

## Decision ledger

- **Revised Outline A adopted** (frozen instantiation descriptor consumed by both derivation and
  first-tx execution). codex r1: "choose revised A", B "not acceptable for the stated production
  guarantee"; fable r1: preferred B, but its A objections (shadow class, split-brain) are exactly
  what the revision removes. DISPUTED-then-resolved; surfaced as Ask A3. Final pass accepted the
  dual-site descriptor as "resolved properly".
- **One regime per extension major; no in-place pointer** — final-pass condition 4, replacing
  v2's `ACTIVE_REGIME` pointer (which made stored accounts ambiguous on rotation). Aligns the
  mechanism with the V5/V6 policy and removes any need for per-account regime persistence.
- **Append-only regime record with every historical entry independently pinned + ack-to-digest
  binding** — codex r1 (rotation self-contradiction) + final-pass condition 3 (descriptor
  identity in the record; hardcode all entries, not just the newest).
- **Dedicated frozen-account canary** — converged (fable Critical 1, codex r1 §4), then
  final-pass condition 1 proved "reuse existing suite subset" was resolved-in-name-only
  (multicall test stops at proving; authwit test tolerates errors) → a dedicated test with
  explicit per-stage assertions.
- **Background-owned integrity coordinator** — codex r1 §4 (centralized state) + final-pass
  condition 2 (session-before-bootstrap layering, SW-restart persistence, backup-import hook,
  PXE-independence noted as the no-false-positive argument).
- **Gate commands `test:all`/`typecheck:all`/`build:firefox`** — codex r1 + final pass, verified.
- **Rejected: pin-only posture** (no vendoring) — fails the stated goal; all legs concur.
- **Rejected: original Outline A** (single-site frozen marshalling) — fable proved split-brain.
- **Rejected: original Outline B** (vendor-only) — codex: tripwire-only residue insufficient for
  a production guarantee; descriptor is cheap.
- **Rejected: per-account persisted regimeId** — unnecessary under one-regime-per-major (simpler,
  same guarantee); would only matter if a single major ever hosted two regimes, which the policy
  forbids.
- **Unresolved disputes**: none blocking; A3 records the A/B model disagreement for the user.

## Audit verdicts (inline, mid tier requirement)

- **codex r1** (fresh, adversarial + assumption-attack, on v1): `reject` — rotation model
  self-contradictory; old-artifact compatibility unproved; mismatch state underspecified. All
  three drove structural changes (append-only record; Phase 4; Phase 5). Transcript:
  `audit-codex.md`.
- **fable r1** (independent Plan-agent, on v1): `conditional approve` — per-bump execution gate;
  supply-chain claim fix; dual-site ctor-args freeze; freeze-table corrections. All adopted.
  Transcript: `audit-fable.md`.
- **codex final fresh-context pass** (on consolidated v2 + ledger): `conditional approve
  (with conditions: add a dedicated execution canary, define atomic integrity-state ownership and
  regime persistence, harden append-only enforcement, and correct the gates)` — all six
  conditions folded into this v3 (Phases 2–5, 7 + regime redesign). Transcript: `audit-codex.md`.

## Post-implementation hardening

This plan touches account-identity invariants — a `/harden security` pass at the pre-production
release checkpoint with the freeze module, vendored artifact, and integrity coordinator in scope
was recommended at the gate; the user chose **decide later** (recommended-but-unscheduled).

## Seeds

_FINAL (post-approval, 2026-07-20; approved scope unchanged from the gate draft)._

```
/goal All phases marked ✓ in plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate (as defined in plan.md) reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/account-artifact-freeze/lessons/phase-N.md` in the transcript; the Phase 4 dedicated frozen-account canary reported green via e2e:agent with native proving; `/code-review max --fix` complete with findings applied and committed; codex post-impl audit complete with high/critical findings addressed; `bun run audit:vue`, `bun run test:all`, `bun run test:e2e`, and `bun run build:firefox` all report exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/account-artifact-freeze forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/account-artifact-freeze/plan.md and lessons/ (authoritative state — not the chat); run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json statusCheckRollup` (no --watch).
2. Waiting on CI is fine — confirm it's progressing (`gh run watch <run-id>` up to 10 minutes). Use the wait productively; don't start conflicting work.
3. No task in hand? Pick the next pending step from plan.md and start it. After each meaningful edit run `bun run lint && bun run typecheck:all && bun run test:all`. Then commit → push.
4. Stuck, or facing a decision you'd normally bring to me? Call /codex xhigh with full context, reach a defensible decision, act on it, log the consult in lessons/phase-N.md. Hard limits stay hard: never merge to dev/main, never publish, never regenerate reference vectors from the implementation, never expand scope beyond plan.md.
5. Same step failed 5 times? Stop retrying; reassess with codex, then continue down the agreed path.
6. Phase green? "Green" = the phase's validation gate as written in plan.md. Run it, paste the result, mark ✓ in plan.md, file lessons, print LESSONS_FILE=..., advance.
7. All phases ✓? Post-impl sequence: /code-review max --fix → commit separately → codex post-impl audit (net diff + code-review summary + adversarial ask) → address high/critical → wrap-up report. Surface and stop.
```
