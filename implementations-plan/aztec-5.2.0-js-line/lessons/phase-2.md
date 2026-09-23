# Phase 2 — API churn, typecheck, unit suites (the freeze invariant)

## The churn surface: ONE cast

`bun run typecheck:all` on the bumped line produced EXACTLY ONE error in the entire workspace:
`chain-runtime.ts:248`, `AcceleratorProver` → `proverOrOptions`, failing solely on the nominal
`_branding` private property of `AztecAddress` across the two stdlib generations (inside
`generateInitOutput`'s parameter chain). The `:229` constructor site (WASMSimulator into the
SDK) did NOT error. Zero API churn anywhere else — the 5.0.1→5.2.0 JS surface we consume is
fully source-compatible, matching the dossier (additive `stdlib/abi` changes only; 5.3 breaks
staged, inert).

**D2 precondition executed before the cast** — byte-level diffs across generations:
- `stdlib/dest/interfaces/private_kernel_prover.d.ts`: IDENTICAL
- `stdlib/dest/kernel/private_kernel_prover_output.{d.ts,js}` (PrivateExecutionStep home):
  IDENTICAL (declarations AND runtime)
The single error is TS's cross-declaration private-brand rule, not a shape difference. Cast
applied: `prover as unknown as PrivateKernelProver` (typed via the workspace's own import),
with the invariant comment at the site. Scope stayed within the chain-runtime.ts seam (D2).

## Three-boundary verification

- Accelerator (nested-dual): byte-diff + cast above; behavior gated by Phase 3/4.
- private-fee-juice (peers → workspace 5.2.0, runtime-verified in Phase 1):
  `private-fuel.test.ts` green (address/salt/selector pins hold with its wrappers running on
  5.2.0 modules).
- standards (undeclared imports → 5.2.0): `descriptors-real-artifact.test.ts` green (the
  5.2.0 `loadContractArtifact` path reproduces all nine token-fn resolutions on the held
  artifact).

## The freeze invariant — HOLDS

`bun run test:all`: every workspace green — extension 4835 passed (2 skipped, 7 todo), faucet
542, bridge-core 238 (+4 env-skipped), aztec-runtime 192, wallet-crypto 112, wallet-bridge
212, design 313, extension-messaging 188. Zero pin/vector edits anywhere: derivation-vectors
KAT, artifact-freeze (class id recomputed by the 5.2.0 hasher over frozen bytes = pinned
value), address-freeze, instantiation-descriptor, account-seed-vectors, account-export,
private-fuel, claim-secret, content-hash, noir-artifact-classids, schema-patch apply +
dispatcher reachability — all green untouched.

Gate: `typecheck:all` 0 ∥ `test:all` 0 ∥ `lint` no errors (31 warnings = pre-existing
baseline) ∥ `git diff 1727a42f...HEAD -- packages/aztec-runtime/src/account/ contracts/`
EMPTY ∥ clean tree on those paths ∥ `bun scripts/aztec-hold-residue-check.ts` PASSED.

Re-diff of copied logic: deferred to Phase 4 step 1 by design (D8).
