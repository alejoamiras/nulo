# Codex audit — bridge-evm-verification

Three adversarial rounds on one resumed session, plus a final fresh-context pass (recorded at the end).
Model `gpt-5.6-sol`, effort `xhigh`, read-only sandbox.

The brief was hostile by construction: *"The failure mode I fear most is shipping three more proofs that
pass for reasons unrelated to what they claim, adding false confidence to a codebase that just spent ten
PRs removing exactly that."* Codex was asked, per target, whether a proof was **worth writing or
vacuous by construction** — and explicitly invited to kill targets.

---

## Round 1 — the three candidates

| Target | Verdict |
|---|---|
| `_validateRoute` | Keep, narrowly; bound at 3 |
| `initialize` | **Keep; highest value** |
| `withdraw` | **Kill** |

On `withdraw`:

> "No Halmos property establishes its actual authorization boundary without assuming the answer in
> `outbox.consume`. A rejecting-outbox test could catch deletion of `consume`, but that is a small
> concrete regression test, not a worthwhile symbolic proof."

**On the separability claim** (that the grammar half of the WETH/native "resource theorem" is provable
without V4 semantics) — it holds only *reworded*:

> "Halmos can prove the syntactic lemma: *No route accepted by `_validateRoute`, within bound N,
> contains a boundary whose preceding output is native and whose next input is WETH.* That smuggles in
> no V4 semantics. […] But 'requires native→WETH wrapping' is semantic."

Recorded because it is exactly the kind of claim that reads correct and is not.

**Where halmos can lie** — the round's most valuable output, all of it since verified independently
(see `lessons/phase-0.md`):

- dynamic-array lengths default to `0,1,2`, so "a length-3 proof without explicit array settings never
  sees length 3";
- `--loop` truncation "can still report `[PASS]`; its pass/fail summary does not promote that warning to
  failure";
- a public wrapper plus `try/catch` makes every rejection a passing path, so "validator rejects
  everything" also passes — a positive accepted-route canary is needed;
- never signal a bad accepted route with `revert`;
- **fixture masking**: "an invalid registry makes B keep reverting after the caller guard is deleted";
- "Using the shim for B proves only that the shim resembles the custody contract. **That is not
  acceptable evidence.**"

That last line drove the plan's central requirement and, followed up, exposed the uncovered guard.

---

## Round 2 — harness, masking, and dropping A

**Q1 — the B harness**, specified concretely: two real portals (`fresh`, `locked`), registry mock B
pointing at a second operational rollup with distinct sentinels. The test contract as `initializer` does
not weaken the proof — "the property is relational (`caller != portal.initializer()`)". Mocks return
concrete sentinels, not symbolic addresses: "Symbolic returns would test unnecessary mock behavior, not
either guard." Seven bound values enumerated, matching an independent count.

**Q2 — masking confirmed**, with the general form: state the property as
`validator returns normally ⇒ independently reconstructed grammar holds`, and dedicated witnesses become
unnecessary *provided* the configured domain contains one, no assumption excludes it, and success is
assertion-signalled.

**Q3 — drop A.** Asked to name the concrete bug class an exhaustive bounded check would catch that the
existing fuzzer would miss, or concede:

> "What you lose is exhaustive coverage of mixed-direction/index interactions — for example, a future
> edit using `zeroForOnes[i]` instead of `zeroForOnes[i + 1]` […] But that is prospective
> defense-in-depth. […] A bounded proof that independently restates the same four guards is honest, but
> its incremental value does not justify expanding this arc. Ship B's two proofs."

Adopted. This is the plan's largest single scope reduction and it came from pressing the reviewer to
justify a lukewarm keep rather than accepting it.

**Q4 — exact truncation strings and the structured alternative.** Also: "Exit status does not reflect
these truncations." All verified independently.

---

## Round 3 — the uncovered guard, the shim, and gate scope

Codex was given the mutation results (init-once guard: 62 passed, 0 failed).

**B's shape stands** — no broader harness needed, and a sharpened acceptance criterion:

> "The decisive acceptance criterion is now explicit: deleting `AlreadyInitialized` from the real
> contract must make `check_initializedBindingsCannotChange` fail **on `caller == initializer`**."

**The shim — option (b), with trimming.** Delete `NuloTokenPortalShim.sol`, rewrite `PortalReinit.t.sol`
against the real portal, keep only the init-once regression there:

> "That is not scope expansion; it repairs a test whose stated security target and actual target differ.
> Leaving it would preserve precisely the 'green but cannot detect the production regression' pathology
> this arc exists to eliminate."

And the concrete test is not redundant with B: it runs in the hermetic suite even when halmos is
disabled, and gives a fast, readable guard-level failure.

**Truncation gate — ship, narrowly**, and with a better pattern than the one proposed:

> "Do not grep the wrapped prose. […] match Halmos's stable warning-code URL fragment [`#loop-bound`]."

Plus `--width 0 --depth 0` explicit rather than scraping those warnings, and no array-bound gate since
nothing in scope takes a dynamic array.

---

## Adopted vs rejected

| Codex position | Outcome |
|---|---|
| Kill `withdraw` | **Adopted** |
| Drop `_validateRoute` | **Adopted** — largest scope reduction |
| Ship the `initialize` proofs against the real contract | **Adopted in part** — the init-once proof ships; the deployer-only one was cut by the fresh pass (already covered by `test_FA`) |
| Registry B operational so a deleted guard permits full success | **Adopted** — anti-masking, now also enforced permanently by a positive-control `test_` |
| The counterexample must land on `caller == initializer` | **Adopted, then superseded** — the fresh pass showed a symbolic caller is what lets the proof miss; the initializer is now the only caller |
| Delete the shim, rewrite `PortalReinit` trimmed to init-once | **Adopted** |
| Loop-truncation gate on `#loop-bound`, `--width 0 --depth 0` | **Reversed** — the fresh pass and fable both cut it as prospective hardening; `--width`/`--depth` were also no-ops (already unlimited) |
| No symbolic registry addresses | **Adopted** |
| Bound `_validateRoute` at 3 (round 1) | **Superseded** by its own round-2 verdict to drop the target |
| `--json-output` + `num_bounded_loops == 0` alongside the text check | **Not adopted** — the text check already covers the in-scope case and the JSON path adds parsing surface for no additional signal here. Recorded rather than silently dropped. |

## Claims verified independently before acting

Codex was right on every checkable claim, but each was confirmed rather than trusted:

| Claim | Verification |
|---|---|
| `--default-array-lengths` is `0,1,2` | `halmos --help` |
| `--loop` truncation leaves a false property green | throwaway probe: `[PASS] … 1 passed; 0 failed`, exit 0; fails at `--loop 5` on witness `n = 0x03` |
| exit status ignores truncation | same probe |
| seven values bound by `initialize` | read `upstream/NuloTokenPortal.sol:42-49` and counted |
| the shim is not the real contract | mutation: init-once removed → 62 passed, 0 failed |

One claim was **improved on** during verification: the warning text hard-wraps mid-phrase, so the
obvious grep matches nothing (`lessons/phase-0.md`). Codex's round-3 `#loop-bound` fragment is the fix.

---

## Final fresh-context pass

> Recorded below on completion — a new session, given the consolidated plan, the full decision ledger
> including every rejected alternative, and the adversarial + assumption-attack + implementation-critique
> asks, with an explicit instruction to reopen the `_validateRoute` drop if it judged the rejection wrong.

**Verdict: `reject`** — "blocking findings: B2 excludes its decisive caller, Phase 1 invokes the wrong
test and typecheck gates, and canonical-branch compatibility is asserted rather than established."

All three blocking findings were verified against the repo and adopted:

| Finding | Verification | Resolution |
|---|---|---|
| **The proof excludes its own decisive caller.** Reusing the router's `vm.assume(caller != owner)` shape means that with init-once deleted and deployer-only intact, every admitted caller exits through `NotInitializer` — both proofs stay green while the guard is gone | logic, from the draft's own text | no symbolic caller; the initializer is the only one, invoked directly |
| Phase 1's gate invoked Bun's native runner against vitest files, and a `typecheck` scoped to `apps/extension` that never sees `verify-l1.ts` | `packages/bridge-core/package.json:14`, root `package.json:29` | package test script + package typecheck |
| The canonical branch is **not historically dead** — `5c1d4872^` is a real pre-fork manifest, and its portal was Etherscan-verified from the vendored source | `git show` | reframed as intentional retirement; recorded as a decision, not an assumption |

Further findings adopted: use `parseCandidateManifest` unconditionally rather than adding a new
side-effectful test file; import the Roundtrip fakes into the rewritten `PortalReinit`; assert proof
*names*, since exact counts do not preserve identity; add `set -o pipefail`, since `| tee` discards
halmos's exit status; rebuild the AST before every halmos run in the mutation loop; **cut B1** (the
deployer-only guard is already mutation-detected by `test_FA`, and "symbolic enumeration adds little to a
single address equality"); **cut the loop-truncation gate** as prospective hardening outside the mandate.

It also re-affirmed the earlier cuts under full knowledge of the decision trail: *"Keep `_validateRoute`
dropped… No concrete uncovered guard justifies expansion. Keep `withdraw` rejected."*

The one disagreement between rounds: r3 wanted the truncation gate shipped, the fresh pass wanted it cut.
Cut, on the anti-expansion mandate — the finding survives in `lessons/phase-0.md` for the next proof over
a loop.
