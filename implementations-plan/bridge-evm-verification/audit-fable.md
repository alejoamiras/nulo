# Fable audit — bridge-evm-verification

Independent hostile audit of the draft plan, run in parallel with the fresh-context codex pass. Brief:
find what the three codex rounds missed *because they were inside the plan's framing the whole time*.

**Verdict: two Critical, three High.** Both Criticals lived in places the plan never opened — a file it
did not read (`portal-artifact.ts`) and a gate its baseline never ran.

---

## Critical

### C1 — the prescribed comment edit would break a live custody contract's source pin

The draft's change map said: *"`NuloTokenPortal.sol` — header comment: drop the pointer to the deleted
file."*

The repo already documents why that is not cosmetic (`portal-artifact.ts:30-32`):

> *"solc's metadata hash covers the source, so even comment-only edits change bytecode."*

Confirmed independently: the l1-contracts `foundry.toml` sets no `bytecode_hash` override, so the default
`ipfs` metadata hash is embedded. One comment edit invalidates `FORKED_PORTAL_KECCAK`, `PORTAL_PIN`, and
the committed artifact, and leaves the live mainnet and testnet portals unverifiable until regenerated.
The draft's claim of *"no production bytecode"* was false.

**Adopted, as a reduction:** `NuloTokenPortal.sol` is now untouched. Two comment references go stale, and
the plan records why that is the cheaper cost.

### C2 — `dev`'s deploy path was already broken, so Phase 1's gate could never pass

Measured, then verified four independent ways:

```
keccak256(upstream/NuloTokenPortal.sol) = 0x5e81eaad…
NuloTokenPortal.build.json sourceKeccak = 0x5e81eaad…   ← agrees
portal-artifact.ts FORKED_PORTAL_KECCAK = 0xde14278d…   ← outlier
```

Traced to `2b1500fb` (#444), which touched `portal-artifact.ts`, its test and the generator — but neither
`NuloTokenPortal.sol` nor its artifact. A source keccak is toolchain-independent, so no rebuild explains
it: **the pins were bumped for a header edit that never landed.** A dropped hunk.

Consequences on merged `dev`: `stageForkSource` throws → `verify-l1` dead on the only branch any manifest
takes; `loadForkedPortalArtifact` throws → both deploy conductors dead. Nothing caught it because no CI
job installs Foundry and `contracts.yml` filters on `contracts/bridge/**` only.

The audit's sharpest framing: *"This is the plan's own defect class, one commit upstream: an integrity
guard that cannot fail because nothing executes it"* — while the draft cited that very pin as its live
mitigation for "our fork edited without re-pinning."

**Adopted.** Fixed in PR #481 (re-pin to what the source compiles to; regenerate the artifact, which #444
taught to emit `immutableReferences` without ever re-running; add a solc-free consistency test,
mutation-verified). This plan now declares the dependency.

---

## High

### H1 — fixture masking is reachable from outside the proof file

The construction, requiring **zero** edits to the proof and invisible in its diff: make the imported
`FakeRollup.getOutbox()` revert. Then with either guard deleted, `initialize` still reverts, the proof
lands in `catch`, and stays **green**. The draft's only defence was a one-time mutation run plus prose.

**Adopted:** a positive-control `test_` — running in the hermetic suite forever, not just at mutation
time — asserts the initializer *can* fully initialize against registry B and that bindings land on B's
sentinels. Justified against the anti-expansion mandate by the plan's own rule: *"A gate pattern never
seen to fire is not a gate."*

### H2 — the mutation matrix could not distinguish "the proofs work" from "the proofs are redundant"

Every row of the draft's matrix was satisfiable by a concrete forge test, so the matrix proved the proofs
*can* fail but never that they fail where the cheap tests do not.

**Partly adopted, and it drove a cut.** The cleanest resolution was not a discriminator but removing the
redundant proof: the deployer-only guard is already mutation-detected by `test_FA`, so that proof was cut
(the owner confirmed). The surviving matrix now also asserts what must *keep passing*, which is what
distinguishes the two guards.

### H3 — the new test file could not be written as specified

`verify-l1.ts` exports nothing, executes on import, writes `remappings.txt` at module scope, and exits via
`process.exit`. No unit-test job installs Foundry, so a spawn-based test would exit on
`"forge not found"` — passing for the wrong reason, or failing in CI.

**Adopted:** ~6 lines in `candidate-schema.test.ts` (which has no `portalSource` coverage today) instead of
a new file. Also caught the draft's wrong test runner — `bun test packages/bridge-core` invokes Bun's
native runner against vitest files.

---

## Assumption attack — corrections adopted

| # | Finding |
|---|---|
| Fact 2 | Three manifests carry `forked-v1`, not two — the mainnet candidate too. And the deleted branch handles `portalSource` being **absent**, i.e. every pre-fork manifest in history. |
| Fact 5 | `L1_ARTIFACTS_ROOT` is used by the surviving branch at `:190` as well as `:215` — the draft cited only `:215`, understating the coupling C2 breaks. |
| Fact 7 | The draft stated `verify-l1.ts` has no test and drew no conclusion. That absence is *why* C2 survived merge. |
| Fact 8 | The baseline never ran `verify-l1 --dry-run` — the single gate Arc 1 rests on. Had it, C2 would have surfaced in Phase 0. |
| Fact 9 | **Already violated**: `.gitmodules` and three `lib/` gitlinks were staged, contradicting the plan's own rule. Unstaged; a cleanup line added to Phase 0. |
| Fact 12 | `--width`/`--depth` already default to `0`; the draft's flags were no-ops documenting a protection that did not exist. |
| Fact 13 | The `#loop-bound` fragment is real (`logs.py:71-88`) — but the draft cited a lessons finding about *wrapping* as its authority, which says something else. Provenance corrected. |
| Inference 3 | **Verified true and promoted to Fact**: halmos 0.3.3 reads the prank sender without `int_of()`, so a symbolic sender propagates rather than concretizing. |

## Implementation critique — adopted

- **The reuse claim and the harness spec were mutually unsatisfiable.** `FakeRollup.getVersion()` is `pure`
  returning `4242`, so two instances cannot have distinct version sentinels. Left unaddressed,
  `rollupVersion` — one of the seven asserted values — would be structurally incapable of changing: *"a
  vacuous assertion inside the anti-vacuity proof."* The version-sentinel requirement was dropped.
- **The per-invocation CI design rested on a false premise.** halmos prints per contract with no grand
  total, so a single invocation with name-bound counts is both simpler and strictly stronger. Adopted.
- **Phase 2's command order stripped the AST halmos requires**, and the mutation loop specified no rebuild
  at all — a stale-artifact run reads exactly like "the mutation was not caught" and could get a good proof
  deleted. Rebuild steps added around every apply and restore.
- **Phase 3 could not run as sequenced** — `contracts.yml` has no `push` trigger and §7 forbids an early PR.
  Changed to `workflow_dispatch`.
- **`grep … && { …; exit 1; }` as a step's last statement fails the step on the clean path** under `bash -e`.
  Moot after the truncation gate was cut, but the `if grep` form is used where a grep remains, and
  `set -o pipefail` was added since `| tee` discards halmos's exit code.
- **Scope of the claim**: the in-project build (`solc 0.8.28`, `via_ir`) is not the deployed build
  (`solc 0.8.30`). Recorded as Fact 21 — the proof establishes a property of the source, not of the
  deployed bytes.

## Cut list — adopted

1. The loop-truncation gate and its verification ritual. Both final reviewers agreed; nothing in scope
   loops or takes a dynamic array. The finding stays in `lessons/phase-0.md`.
2. `verify-l1.test.ts` as a new file → the schema test.
3. The deployer-only proof (offered as a third cut; taken, with the owner's confirmation).

## Tried and could not break

Recorded because a hostile audit that only reports hits is not calibrated:

- Symbolic `vm.prank` (verified sound at the source level).
- Deleting the canonical `verify-l1` branch — safe for every live path; the operator runbook, the package
  README and both conductors all pass candidate or live manifests, all carrying `forked-v1`.
- Removing `NuloTokenPortalShim` — loses no coverage; `PortalReinit`'s front-run test is fully subsumed by
  `BlackhatAudit.t.sol:304-328`.
- Phase 3's "moving a proof file aside must fail, not skip" — halmos returns a non-zero result when
  `total_found == 0`, and the count assertion catches it independently.
