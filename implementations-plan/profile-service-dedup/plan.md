# profile-service-dedup — collapse the profile service's clone families, burn its 11 baseline directives

**Tier: `/blueprint light`** (single file + its test suite, bounded, behavior-preserving; wallet-critical → codex audit mandatory). Arc 1 of the complexity-budget burn-down (`implementations-plan/complexity-budgets/plan.md`).

**Status: APPROVED — codex round 2 conditional approve, all three conditions folded in below; implementation authority from the commissioning /goal (owner not at the gate; residue + F4 pin surface in the PR body for sign-off).**

## Goal

`apps/extension/src/wallet/services/profile/service.ts` carries 11 of the repo's 230 baseline complexity directives (8 cognitive, 3 length) and 13 internal jscpd clones (202 dup lines). The clones and the complexity are the same mass: every suppressed method participates in ≥1 clone family. Extract shared private helpers + phase-decompose the big orchestrations so the clones collapse and the directives become removable — behavior-preserving throughout. Ship as ONE squash-merged PR into `dev` whose body states the manifest count (230 → n).

Success = profile integration suite green with no assertion weakened, new equivalence pins green, `audit:vue` + `test:ci-gating` green, manifest strictly smaller with zero directives added anywhere, scoped jscpd re-scan shows the internal clone mass collapsed, PR merged.

## Clarifying answers (from the commissioning /goal — the owner's standing instruction)

- **Quality bar**: production wallet code. Behavior-preserving only; surprising pre-existing behavior gets a `(BUG PIN)` test, not a fix.
- **Validation layers**: lint/typecheck + unit/integration locally every phase; `audit:vue` + `test:ci-gating` before PR; smoke/network e2e via the PR's CI gates (per memory: prefer CI over exhaustive local runs).
- **Scope out**: no public API changes, no RPC surface changes, no widening of `runExclusive` to expose `isCurrent` (noted follow-up), no cross-file helper package, no fixing of pinned bugs.
- **Residue policy**: target = all 11 directives removed. If a method resists a NATURAL decomposition, the commissioning goal explicitly authorizes justified residue over a contorted refactor ("never refactor a function into worse shape just to hit zero") — any survivor carries a one-line justification in the PR body for owner sign-off. (Codex round 1 pushed for zero-as-hard-condition; held: the owner's instruction outranks, and the fallback is expected to go unused.)
- **Decisions delegated**: helper placement, family-by-family extract-vs-leave calls — resolved with codex dual-position (round 1: codex independently reached the same three ledger calls). Escalate only scope changes / irreversible choices.

## Architecture & Implementation (compact — light tier)

**Where code lives**: everything stays inside `service.ts` as private methods on `ProfileService`, per the sibling `…HoldingLock` convention (`token/service.ts:548-554`, `token-balance/service.ts:60`) — the clone bodies reach into `this.repo` / `this.deletionState` / `this.sessionManager`, so free functions or a new module would need 4-way dependency injection for zero testability gain (the integration suite drives the real service). No new files except test additions.

**The helper set** (v2 — post codex round 1):

| Helper | Replaces | Contract notes |
|---|---|---|
| `private sealedTriple(p)` → `{guard, secret, entropy}` as `asBase64Ciphertext` triple | the 8 literal recurrences (462, 901, 1062, 1582, 1645, 1741, 1802, 2484) | Pure projection, no I/O, no throw. The ONLY shared piece of F7/F8 (codex round 1: null-check, thrown error, pairing order, revalidation, and zeroize all stay per-site — the dropped `unsealForExport` idea was unsound: `exportImportedKeysDek` has no pairing check, `exportMnemonic` derives words first, and a throw-after-unseal would orphan buffers the caller's `finally` must wipe). |
| `private async getProfileOrThrowHoldingLock(id)` — `repo.get` + null-throw `"Invalid profile id"` | F4 openers (871–875, 892–895) + the fetch core inside F6/F2 helpers | NO `isReserved` check — preserving F4's omission verbatim (codex round 1: two methods, not a boolean). |
| `private async captureRowFence(id)` → `{profile, capturedEpoch}` (includes its own `runExclusive`) | F6 (1041–1054, 1495–1505, 1631–1640, 1729–1735, 1787–1797 — all five wrap identically) | fetch + null-throw + reserved-throw + `deletionState.capture`. `confirmProfileOperation` renames its local (`snapshot` → destructure alias). |
| `private async profileFenceBroken(id, epoch): Promise<boolean>` — refetch + the ORIGINAL negative expression `!row \|\| isReserved \|\| !isCurrent`, verbatim | F5 condition (5 sites) | Negative polarity kept so the 5-site condition moves byte-identically (codex round 2 condition: no polarity inversion). Wrapping preserved per site: 1092 + 1821 keep their surrounding `runExclusive` at the call site; 1596, 1656, 1751 call it lock-free. Throw (`"Invalid profile id"`) stays at call sites. |
| `private async snapshotForUnlock(id, expect: "password" \| "passkey")` (includes its own `runExclusive`) | F2 phase-1 blocks (441–457, 641–658) | Branch bodies verbatim: password-arm rejects `type === "passkey"` with `"Profile requires passkey"`; passkey-arm rejects `type === "password"` with `"Profile requires password"` then `!credentialId` with `"Missing credentialId"`. (A hypothetical third type passes both today — preserved.) `getPasskeyCredentialId` (626–636, `!==` form) is NOT converted — different predicate shape, no directive, no clone flag. |
| `private async persistNewProfileHoldingLock(profile)` — `repo.set` + emit `onProfileAdded` | F1 tail at create/import sites (413–415, 605–607, 2009–2010, 2066–2067) | Order set→emit is uniform at all four (recon §deviations #4). `openSessionVerified` stays at call sites. NOT used in restore (codex round 1: restore's compensation catch wraps only `repo.set`, emit comes after the bracket). |
| `private async writeMarkerThenRowHoldingLock(id, profile)` — marker write → try `repo.set` catch compensate-delete-marker + rethrow | F9 bracket in both restore branches (2225–2233, 2352–2358) | NO emit inside (see above). Byte-identical today across the two branches. |
| `private async unsealTrustedDekHoldingLock(id, row, secret, passhash, logContext)` → `ImportedKeysDek \| null` — DEK unseal + envelope-MAC verify + zeroize-on-MAC-fail + degrade log | the password degrade blocks in `unlockProfile` (512–534) and `finalizeRestore` (2506–2531) | Returns the dek (or null) so the CALLER's existing `finally` keeps ownership — zeroize placement unmoved (the outer-finally timing in `unlockProfile` is load-bearing, recon deviation #3). **Pre-return ownership rule (codex round 2 condition)**: on ANY throw after a successful unseal (e.g. `verifyEnvelopeMacV3` rejecting during MAC-key derivation, outside its internal catch), the helper zeroizes its local dek before rethrowing unchanged — today the caller's outer `finally` covers that window; the helper must not reopen it. The same rule governs every extracted helper that allocates secret material: allocate in the caller before fallible work, or catch-zeroize-rethrow. Log message parameterized (`"at unlock"` / `"at finalizeRestore"` verbatim). |
| Phase decomposition (per-method private helpers, not cross-method sharing) | the remaining directive mass | `unlockProfile`/`unlockPasskeyProfile` phase-3 bodies → per-method `…HoldingLock` helpers preserving staleness mechanism (ciphertext-compare vs fingerprint-recompute), log-message shapes, and zeroize placement verbatim; `changeProfilePassword` → prologue-unseal / DEK-re-key / commit / re-open helpers (all inside the existing single lock; the outer `finally`'s zeroize set unmoved); `deleteProfile` → tornGuard-assert + tombstone-write-B-12 + pending-state-drop helpers; `resumePendingDeletions` → per-tombstone resume body + torn-sweep purge-decision helpers; `restore` → `restorePasswordBranch` / `restorePasskeyBranch` carrying each branch's catch placement verbatim (password: `toRestoreError` INSIDE the locked callback; passkey: catch OUTSIDE the lock — recon §deviations #5); `finalizeRestore` → password-finalize + passkey-finalize `…HoldingLock` helpers. |

**Explicitly NOT unified** (recon deviations): unlock phase-3 staleness checks, degraded-session log message shapes, `zeroize(dek)` placement (outer-finally vs in-lock), export error identities, restore catch placement, F4's missing tombstone check (now a `(BUG PIN)`).

**Critical flow preserved**: every extraction keeps the phase-1 (snapshot under lock) → phase-2 (slow crypto/WebAuthn outside lock) → phase-3 (re-enter lock, revalidate) shape byte-compatible: same lock acquisition count, same await points relative to the lock, same error identities, same event order. Helpers either contain a whole `runExclusive` verbatim or carry the `…HoldingLock` suffix + caller-holds-lock doc.

**Simpler alternative considered**: suppress-and-leave (dedup only the byte-identical F5/F6). Rejected: the commissioning goal requires the directives burned where natural, and the heavy methods split at their existing `// Phase N` comment seams.

## Security & Adversarial Considerations

- **Threat model**: this file guards DEK unsealing, session opening, profile deletion, and backup export — the wallet's crown jewels. The attack surface of THIS change is regression, not new surface: no new inputs, no new trust boundaries, no dependency changes.
- **Error-oracle stability**: the observable error contract is pinned BEFORE any extraction (Phase 1): `exportPlain` flattens to plain `Error` with `InvalidPasswordError`'s message (suite :387 already pins); `exportBackupMaterial` + `exportImportedKeysDek` expose typed `InvalidPasswordError` (new pins); `exportMnemonic` + `changeProfilePassword` throw plain `Error("Invalid profile old password")` — string-matched by `change-password.vue:79` (new exact-string pins). No shared throw helper exists to drift them.
- **Secret hygiene**: zeroize placement preserved per site; extracted helpers RETURN secrets to the owning caller's existing `try/finally` rather than owning cleanup (the `unsealTrustedDekHoldingLock` contract). No secret gains a wider lifetime; no new logging.
- **TOCTOU/concurrency**: the phase-1/2/3 lock dance and fence epochs are the mitigation for unlock-vs-delete races; extractions never move code across a lock boundary (each helper is whole-lock or holding-lock, verified per call site in review). New deterministic interleaving pins use the PasskeyService stub's unresolved-ceremony promise as a phase-2 barrier (the seam already exists in the suite) — password-path PBKDF2 has no seam; its existing race tests stand (building a barrier harness for it would be new infra — rejected as over-engineering, logged in the ledger).
- **Supply chain / crypto**: zero dependency changes; no crypto code rewritten — bodies move, they don't change.
- **Least privilege**: no CI/workflow/token changes.

## Assumptions

**Facts** (verified in recon + codex round 1 corrections applied — `recon.md`):
1. The 11 directives sit at the recon inventory lines; `manifest.json` records exactly 8 cognitive + 3 length for this file.
2. F6 is byte-identical at all 5 sites INCLUDING the `runExclusive` wrapper; F5's condition is byte-identical but its wrapping splits 2 locked / 3 lock-free (`service.ts:1092,1821` vs `1596,1656,1751`).
3. The unseal-failure error matrix is: typed at `exportBackupMaterial`/`exportImportedKeysDek`, flattened-to-plain at `exportPlain` (:1614–1617), plain exact-string at `exportMnemonic`/`changeProfilePassword` (:1810, :906) consumed by `change-password.vue:79`.
4. `zeroize(dek)` timing differs between the two unlock methods (`:549` outer-finally vs `:725-733` in-lock).
5. `service.integration.test.ts` (2647 lines) is the only real-`ProfileService` suite; its race tests accept either outcome (they pin absence-of-deadlock and per-winner behavior, NOT forced interleavings) — deterministic passkey-path pins are addable through the existing PasskeyService stub seam.
6. `#490` added the directives with zero logic change (`git show 3f6a0528`) — no prior extraction exists.
7. The `…HoldingLock` convention exists at `token/service.ts:548-554` and `token-balance/service.ts:60,310,462`.
8. Removing a directive without regenerating the manifest reds `bun run lint` — regen lands in the same PR (`bun run baseline:complexity`; refuses growth without `--adopt`).
9. Creation/import event order is uniformly `repo.set` → `onProfileAdded` → open; restore branches emit with no open (late activation).

**Inferences** (attackable):
1. Decomposition at the existing phase seams brings all 8 cognitive scores ≤15 and the 3 length overruns ≤80 without contortion (residue fallback documented above; expected unused).
2. The three stale worktrees touching `service.ts` are abandoned (each pre-dates a landed equivalent; none a live tip). Non-blocking either way.
3. New private methods don't disturb the RPC surface (`rpcMethods` is an explicit allow-list; nothing added).
4. The F4 tombstoned-row mutation gap (rename/change-password succeed on a row whose id is reserved mid-delete-crash) is reachable only in the crash window; preserved verbatim + `(BUG PIN)` test; any fix is a separate reviewed PR.

**Asks**: none open. Residue policy and F4 handling were the two codex-round-1 asks; both are resolved above by the commissioning goal's own text (residue = justify + owner sign-off at wrap-up; F4 = pin, don't fix). They surface to the owner in the PR body, not as pre-implementation blockers.

## Phases

### Phase 1 — Equivalence pins (no refactor yet)

Add: `exportBackupMaterial` + `exportImportedKeysDek` wrong-password → `toBeInstanceOf(InvalidPasswordError)`; `exportMnemonic` + `changeProfilePassword` wrong-password → exact message `"Invalid profile old password"` and NOT instanceof `InvalidPasswordError`; `(BUG PIN)` tombstoned-row mutation (seed row + tombstone via `FakeBrowserApi`, `changeProfileName` succeeds); event-order pin (`onProfileAdded` fires before the session opens on `createProfile`/import); deterministic passkey stale-rejection pin — MANDATORY (codex round 2 condition): override the suite's `FakePasskeyService.getKey` with a held promise (the phase-2 barrier), delete the profile while held, resolve, assert the unlock rejects `"Invalid profile id"`.

**Validation gate**: `bun run --cwd apps/extension test src/wallet/services/profile/` green (new pins pass against UNCHANGED code); `bun run lint`; `bun run typecheck:all`. Layers: lint/typecheck + integration.

### Phase 2 — Mechanical families (F4, F5, F6, triple)

Extract `sealedTriple`, `getProfileOrThrowHoldingLock`, `captureRowFence`, `fenceStillCurrent`; rewrite their ~20 call sites preserving wrappings. `exportPlain` may drop under 15 → remove directive + `bun run baseline:complexity`.

**Validation gate**: profile-dir suite + `bun run lint` (post-regen) + `bun run typecheck:all`. Layers: lint/typecheck + integration.

### Phase 3 — Unlock pair (F2 shared phase-1; F3 + degrade blocks decomposed)

`snapshotForUnlock` (2 sites); `unsealTrustedDekHoldingLock` (unlock password-degrade block); per-method phase-3 helpers. Kills cognitive 19 + 21; regen baseline.

**Validation gate**: same commands; the suite's `"Change 2 — unlockProfile phase-1/2/3"` / `"Change 1 — unlockPasskeyProfile phase-1/2/3"` blocks green. Layers: lint/typecheck + integration.

### Phase 4 — changeProfilePassword (33), deleteProfile (28), resumePendingDeletions (16)

Three SEPARATELY GATED sub-steps (codex round 1) — decompose one method, run the profile-dir suite, commit, next. `persistNewProfileHoldingLock` lands here with the import-twins' call sites. Regen baseline per sub-step that removes a directive.

**Validation gate** (after each sub-step and at phase end): profile-dir suite (deletion blocks `(B-12 PIN)`, `F-B24` green) + lint + typecheck. Layers: lint/typecheck + integration.

### Phase 5 — restore (36 / 171 lines) + finalizeRestore (46 / 94+92 lines) + F9

Branch-split `restore` (catch placement verbatim per branch) over `writeMarkerThenRowHoldingLock`; decompose `finalizeRestore` (password arm reuses `unsealTrustedDekHoldingLock`). Riskiest phase — smallest steps, suite between steps. Regen baseline: target zero directives in this file.

**Validation gate**: full profile-dir suite + `bun run lint` + `bun run typecheck:all` + scoped jscpd re-scan (same pinned jscpd 5.0.16 / min-tokens 50 invocation as `scripts/dup-trend`) showing the internal clone count collapsed (13 → ≤3, artifact-pair excluded) + the pre-PR battery: `bun run audit:vue` + `bun run test:ci-gating`. Layers: lint/typecheck + unit + integration + build.

## Post-implementation (self-contained — the implementing session executes THIS, not the skill)

1. **`/code-review low --fix`** on the whole implementation diff (single-arc; contained single-file refactor → `low`). Skim applied fixes; commit them separately from implementation commits.
2. **Codex audit** (`/codex xhigh`, RESUME session `01a05a08-0c5d-7db3-9514-486f34925f77` — it holds the plan context): send the net diff, a summary of code-review commits, this plan.md + recon.md, the adversarial/security ask (error oracles, zeroize placement, lock-boundary moves, event order, fence semantics), and both rules verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
3. **Iterative fix loop**: verify codex's factual claims against the repo, apply accepted fixes, commit, log round + verdict in `lessons/`, RESUME the same codex session with the fix diff; repeat until a round yields no new material findings (hard stop + surface at 3 rounds).
4. **Delivery**: only now open the PR. `gh pr checks --watch`; on the known flake fingerprints (smoke `stopServiceWorker` still-alive; network single-shard timing) rerun failed once — a second identical failure is real: stop and triage. Squash-merge once all required checks are green (merge authority granted by the commissioning /goal). Then update `implementations-plan/index.md`, `agent-worktree status`, and the complexity-budgets plan's progress note; surface the stale-worktree FYI + any residue table to the owner in the wrap-up.

## Delivery

Single arc → single PR, plain `gh pr create`, base `dev`, squash-merge. Title (Conventional Commit, ≤93 chars): `refactor(profile): collapse service clone families, burn 11 complexity directives`. Body states manifest count 230 → n, the residue table if any directive survives, the equivalence-pin inventory, and the scoped jscpd before/after. `/code-review` level: **low**. No stack ceremony.

## ELI5

`eli5_mode: artifact` — published at <https://claude.ai/code/artifact/802d94cb-00fd-43da-83df-b90cc9972a96> (source: `implementations-plan/profile-service-dedup/eli5.html`; redeploy the same file to update).

## Seeds

Implementation runs in THIS session under the commissioning /goal (arc 1 of 5); no separate seed needed. For a fresh session: `agent-worktree resume profile-service-dedup`, then work plan.md phases 1→5 with each gate, then the Post-implementation section verbatim.

## Audit log

- **Codex round 2** (resumed, same session): verdict **conditional approve** — conditions, all adopted: (1) pre-return secret/DEK cleanup in every extracted helper (catch-zeroize-rethrow after successful unseal); (2) explicit fence-helper polarity → `profileFenceBroken` carries the original negative expression verbatim; (3) the deterministic passkey barrier pin is mandatory. Both held positions (residue policy; no password-path barrier harness) accepted as adjudicated. Full text in `audit-codex.md`.
- **Codex round 1** (xhigh, session `01a05a08-0c5d-7db3-9514-486f34925f77`, transcript `audit-codex.md`): verdict **reject** — blockers: `unsealForExport` unsound (adopted: dropped, `sealedTriple` only), error matrix misstated (adopted: corrected + pinned first), restore catch-placement deviation (adopted: branch split carries catch verbatim), F1-tail emit inside restore bracket (adopted: two helpers), F5/F7 recon facts (adopted: recon corrected), F4 flag param (adopted: two methods + BUG PIN), phase splitting + scoped dup verification (adopted). Held against codex: zero-residue as hard condition (owner's commissioning goal authorizes justified residue); full deterministic-barrier harness (adopted only the existing passkey-stub seam; password-path barrier = new infra, over-engineering). Codex independently reconfirmed all three ledger calls (placement / phase-3 decompose / zeroize preserve).

## Decision ledger

| Decision | Choice | Rejected | Why |
|---|---|---|---|
| Helper placement | Private methods on `ProfileService`, `…HoldingLock` where lock-assumed | New sibling module / free functions | Bodies reach 4+ private fields; sibling precedent; suite drives the real service. Codex round 1 concurred independently |
| Unlock phase-3 | Decompose per-method, preserve mechanisms | Unify behind parameters | Comparison vs re-derivation differ in kind. Codex concurred independently |
| zeroize timing | Preserve per-site verbatim | Unify to in-lock | Behavior change → out of scope. Codex concurred independently |
| Export unseal helper | `sealedTriple` projection only; null-check/error/pairing/zeroize per-site | `unsealForExport` with error factory | Codex round 1 blocker: sites diverge (no pairing in `exportImportedKeysDek`, words-before-assert in `exportMnemonic`) and throw-after-unseal orphans buffer ownership |
| F4 `isReserved` omission | Preserve + `(BUG PIN)`; separate `getProfileOrThrowHoldingLock` (no reserved check) | `checkReserved` boolean param | Codex round 1: an optional-security boolean invites misuse; pin the real behavior |
| F1 tail in restore | `writeMarkerThenRowHoldingLock` without emit; emit stays after the bracket | One shared set+emit helper everywhere | Restore's compensation catch wraps only `repo.set` (codex round 1) |
| Residue | Target zero; justified residue permitted as fallback with owner sign-off | Zero as hard blocker (codex ask) | The commissioning /goal's explicit NIST limit-or-justify clause outranks |
| Concurrency pins | Passkey-stub barrier pins + existing race tests | Full deterministic barrier harness incl. password path (codex ask) | Password phase-2 has no seam; a barrier harness is new test infra — over-engineering for a refactor arc |
| `runExclusive` isCurrent gap | Leave as-is, follow-up note | Widen signature now | Scope creep into #489's territory |
