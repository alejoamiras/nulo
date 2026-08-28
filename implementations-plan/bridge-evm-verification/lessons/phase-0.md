# Phase 0 — environment baseline & halmos truncation probe

## Baseline (clean worktree off `origin/dev` @ `005fd30e`)

`contracts/bridge/evm/lib/` is gitignored and empty on a fresh checkout — the forge dependencies are
provisioned by a pinned `forge install` that until now only ever ran in CI:

```
forge install \
  foundry-rs/forge-std@bf647bd6046f2f7da30d0c2bf435e5c76a780c1b \
  OpenZeppelin/openzeppelin-contracts@cab19933c33c2ad1d4c7a84864a3601dddfd16f3 \
  Uniswap/v4-core@e50237c43811bd9b526eff40f26772152a42daba
```

`bun packages/bridge-core/scripts/gen-remappings.ts` must run before any forge invocation (the repo
uses bun's isolated linker; the generated `remappings.txt` is what resolves `@aztec/`).

Recorded baseline: `forge build` exit 0 · `halmos --contract FormalRouterTest` →
`Symbolic test result: 4 passed; 0 failed; time: 6.25s` · local halmos 0.3.3 matches `halmos.version`.

## Finding: halmos reports PASS on a state space it silently truncated

Codex claimed the `--loop` bound can leave a proof green while the counterexample sits outside the
explored space, and that the pass/fail summary does not promote the warning. Verified empirically with
a throwaway contract whose assertion is false only at ≥3 loop iterations (probe deleted after; the
transcript below is the artifact).

At the **default** bound:

```
[PASS] check_countNeverReachesThree(uint256) (paths: 3, time: 0.01s, bounds: [])
WARNING  check_countNeverReachesThree(uint256): paths have not been fully
         explored due to the loop unrolling bound: 2
Symbolic test result: 1 passed; 0 failed; time: 0.03s
```

Exit code 0. At `--loop 5` the same property fails on the witness `n = 0x03`:

```
[FAIL] check_countNeverReachesThree(uint256) (paths: 9, ...)
Symbolic test result: 0 passed; 1 failed
```

**A demonstrably false property passes, and the count assertion the CI gate uses cannot see it.** The
warning is printed to stdout but is reflected in neither the summary line nor the exit code.

Two truncation knobs, both silent by default, both confirmed against the local CLI:

| Flag | Default | Effect if left alone |
|---|---|---|
| `--loop` | `2` | loops unroll twice; anything reachable only on iteration 3+ is invisible |
| `--default-array-lengths` | `0,1,2` | dynamic arrays are only ever length 0, 1, or 2 — a "3-hop route" is never constructed |

The second matters as much as the first for `_validateRoute`, whose loop is bounded by `path.length`.
A proof claiming to quantify over 3-hop routes, written without `--array-lengths`, never sees one.

### Consequence for the existing gate

The four merged `FormalRouterTest` proofs emit **no** truncation warning — they contain no loops and
take no dynamic arrays, so today's `grep "4 passed; 0 failed"` gate is sound. It is sound by luck, not
by design: the trap arms itself the moment a proof over `_validateRoute` lands.

### Resulting gate design

Pin `--array-lengths` to the intended set, set `--loop` strictly above the maximum length so the loop
is fully unrolled, and **require the truncation warning to be absent** — fail on a hit, alongside the
exact count. A proof that can only be trusted when a warning is absent must have that absence enforced
mechanically, not read by a human scrolling a log.

> **Do not grep the warning's prose.** The obvious pattern — `paths have not been fully explored` —
> matches nothing, because halmos wraps mid-phrase; that is the next finding in this file, and it was
> written after this paragraph. Match the stable `#loop-bound` URL fragment instead.

## Finding: the real portal's init-once guard is covered by nothing

`PortalReinit.t.sol` exercises `NuloTokenPortalShim`, not `upstream/NuloTokenPortal.sol`. The shim's
header justifies itself by claiming the real portal's `@aztec` transitive tree
(`IRollup → FeeLib → BlobLib`) "does NOT resolve in the bridge-evm Foundry project". That is **stale**:
`BlackhatAudit.t.sol:29` and `PortalRoundtripFuzz.t.sol:7` both import and instantiate the real
contract, and `forge build` succeeds from a clean worktree. The `@aztec-blob-lib/` remapping added in
the previous arc fixed exactly that tree.

Verified by mutating the real contract and running the full hermetic suite (62 tests):

| Mutation applied to `upstream/NuloTokenPortal.sol` | Result |
|---|---|
| remove `if (msg.sender != initializer) revert NotInitializer();` | **1 failed** — `test_FA_portalInitFrontRun_reverts` (`BlackhatAudit.t.sol`, real portal) |
| remove `if (address(registry) != address(0)) revert AlreadyInitialized();` | **0 failed — 62 passed** |

So the deployer-only guard is covered by exactly one concrete test, and **the init-once guard is
covered by nothing at all**. `test_F001_initialize_is_once_only` passes with the real guard deleted,
because it asserts against a hand-written copy of the guard in the shim.

This is the arc's own defect class sitting in merged code, and it sizes the verification work: target
B's second proof closes a real hole rather than restating an existing test. It also means the shim now
costs more than it earns — it carries a name that implies coverage it does not provide.

## Note: committed `lib/` gitlinks disagree with the CI pins

`contracts/bridge/evm/lib/` is listed in `.gitignore` yet the three libraries are **tracked as
gitlinks**, with no `.gitmodules` registering them. The recorded SHAs are not the ones CI installs:

| Library | committed gitlink | CI `forge install` pin |
|---|---|---|
| forge-std | `da5b326f` | `bf647bd6` |
| openzeppelin-contracts | `0a76a615` | `cab19933` |
| v4-core | `46c68346` | `e50237c4` |

CI never checks out submodules (there are none registered) and overwrites the trees via `forge install`,
so CI is self-consistent — but a developer restoring the gitlinks builds against different libraries
than CI does. That is the same mismatch class that previously produced halmos `Unsupported cheat code`
failures.

**Out of scope for this plan** (it is not what either branch set out to do) — recorded as a follow-up.
Practical consequence while implementing: keep the working tree at the CI-pinned SHAs so local runs
match CI, and **never stage `contracts/bridge/evm/lib/`**.

## Finding: halmos wraps its warning text, so the obvious grep matches nothing

Writing the truncation gate, the first pattern tried was the warning's own sentence,
`paths have not been fully explored`. It matched **zero** lines against output that visibly contains
the warning — halmos hard-wraps to a fixed column and splits the phrase:

```
WARNING  check_countNeverReachesThree(uint256): paths have not been fully
         explored due to the loop unrolling bound: 2
```

A gate written the obvious way would therefore never fire — a fail-open guard, inside the gate built
to stop fail-open guards. Use a short fragment that cannot straddle the wrap: `unrolling bound:` for
loop truncation, `--width`/`--depth` for the `incomplete execution due to the specified limit:`
variants. Whatever pattern is chosen must itself be verified against a deliberately-truncated run
before it is trusted — the same rule the proofs are held to.

Stream note: with stderr discarded the full output still appears on stdout, so the existing
`halmos … | tee halmos.log` does capture the warning. `2>&1 | tee` is still worth using, so the gate's
correctness does not depend on which stream halmos chooses.
