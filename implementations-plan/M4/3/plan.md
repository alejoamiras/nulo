# M4.3 — Registry trust + class-id validation (2-4d)

> **Audit tier**: dual (codex xhigh + Plan agent).

## Context & entry state

The wallet fetches contract artifacts from external HTTP registries (`testnet.aztec-registry.xyz`, `devnet.aztec-registry.xyz`) when a transaction touches a contract whose class id isn't in the compiled-in known-artifacts set or in the local PXE store. This is gated by the user-toggleable `contractRegistry` config flag (privacy default: off).

Today the trust contract is **partial**: ExecutionService rejects artifact/class-id mismatches at simulation time (`packages/extension/src/wallet/services/execution/service.ts:557` and `:1100`), but `ArtifactRegistry` itself accepts whatever the registry returns:

- `HttpRegistryFetcher.fetchArtifact` at `packages/aztec-runtime/src/pxe/artifact-registry.ts:65` parses the response via `ContractArtifactSchema.parseAsync(data)` (line 80) — schema validation only, no class-id recompute.
- `ArtifactRegistry.resolve` at `:177` walks the policy and returns whatever each source produced; it does NOT recompute the class id and compare to the requested one.
- The ExecutionService check at the simulation seam catches the mismatch before money moves, but downstream registry consumers (e.g. `getContractArtifact` at `:150`, future `proveTx` paths, M4.4 telemetry) trust the artifact unverified.

**Codex audit reframe**: the gap is "move trust check earlier and make it global." The fix lives in `ArtifactRegistry`, not the execution path. Tests should exercise wrong-class registry payloads + env-allowlist rejection.

**Codex audit pass-through**: also flagged that the registry URL allowlist (lines 94-101) is a hardcoded switch. Env-aware behavior should encode the allowlist at build time, not runtime config.

## Architecture invariants (preserved)

1. **`contractRegistry` config toggle** — UNCHANGED. M4.3 does not change the user-facing trust setting; it tightens the validation that runs when the toggle is on.
2. **Existing class-id checks at `execution/service.ts:557, 1100`** — UNCHANGED initially. Once M4.3 lands the upstream check, those execution-side checks become defense-in-depth (kept). Plan does NOT remove them.
3. **`ArtifactRegistry.resolve` API** — UNCHANGED. Mismatch becomes a "not found" (returns `undefined`) rather than throwing — preserves caller behavior; throws would surface in unexpected places.
4. **Registry URL set** — UNCHANGED for testnet/devnet. M4.3 just makes the allowlist explicit + env-checked.
5. **Layer hierarchy** — `ArtifactRegistry` lives in `@nulo/aztec-runtime`. The class-id recompute helper depends on `@aztec/stdlib/contract`, which is already imported in this layer. No new boundary crosses.

## Sub-step breakdown

Three commits in one PR.

### Step 1 — Class-id recompute helper

**New file**: `packages/aztec-runtime/src/pxe/artifact-class-id.ts`

```ts
import { Fr } from "@aztec/foundation/curves/bn254"
import { type ContractArtifact, getContractClassFromArtifact } from "@aztec/stdlib/contract"

/**
 * Computes the class id of `artifact` and compares to `expected`.
 * Returns the artifact when the class id matches; returns `undefined`
 * (with optional logging) on any mismatch or computation failure.
 *
 * Mismatch is treated as "not the artifact we asked for" — the caller
 * should fall through to the next source in the policy order, not
 * fail catastrophically. Catastrophic failures (untrusted source
 * served wrong artifact) get logged at WARN and counted by registry
 * telemetry once that lands.
 */
export async function verifyArtifactClassId(
  artifact: ContractArtifact,
  expected: Fr,
  log?: (level: "warn" | "debug", msg: string, ...rest: unknown[]) => void,
): Promise<ContractArtifact | undefined> {
  try {
    const computed = await getContractClassFromArtifact(artifact)
    if (!computed.id.equals(expected)) {
      log?.("warn", "Artifact class id mismatch", {
        expected: expected.toString(),
        computed: computed.id.toString(),
      })
      return undefined
    }
    return artifact
  } catch (err) {
    log?.("warn", "Artifact class id recompute failed", err)
    return undefined
  }
}
```

(Note: `getContractClassFromArtifact` is the upstream helper that produces `ContractClassPublic` with `.id: Fr`. Verify exact import path in execution; the M4.3 plan-revision step picks the right one.)

### Step 2 — Wire into `ArtifactRegistry`

**Modified**: `packages/aztec-runtime/src/pxe/artifact-registry.ts`

1. `HttpRegistryFetcher.fetchArtifact` (line 65) — after the `parseAsync(data)` step (line 80), call `verifyArtifactClassId(artifact, classId, log)`. Return `undefined` on mismatch.
2. `ArtifactRegistry.resolve` "registry" branch (line 201-205) — already covered by #1.
3. `ArtifactRegistry.resolve` "known" branch (line 195-200) — also recompute, even though "known" artifacts are compiled-in. Reason: defense in depth (a build accident or accidental edit would otherwise drift silently). Tests in Step 3 cover the happy path; the recompute is fast.
4. `ArtifactRegistry.resolve` "pxe-local" branch (line 190-194) — also recompute. PXE artifacts come from a chain-data store; they're trusted to a degree, but in M4.10's per-RPC-isolation world a mis-keyed PXE could feed a wrong artifact. Recomputing here is cheap and uniform.

### Step 3 — Build-time registry allowlist

**Modified**: `packages/aztec-runtime/src/pxe/artifact-registry.ts:94-101` (`HttpRegistryFetcher.getRegistryUrl`)

Today the function hardcodes two URLs. After M4.3:

- The full allowlist lives in a build-time-defined object, e.g. via Vite's `define` or a constants file imported at runtime but enforced at build.
- The function checks the registry URL against the allowlist; any unknown URL (e.g. injected via a future config field, or a misconfigured `chainId`) returns `undefined`.
- Build-step gate (similar to M4.9's `check-rp-id.ts` pattern): if the constants file is edited, the build-step verifies the allowlist matches expectations (e.g. URL shape, https-only, no localhost in production builds).

For a simple first pass, **inline the allowlist as `const REGISTRY_ALLOWLIST: ReadonlyArray<{ chainId: number; url: string }>`** at the top of the file. Function lookups go against the array. Tests in Step 4 verify rejection.

If env-aware enforcement is needed (e.g. dev builds allow `http://localhost`), use the existing `__VERSION__` define pattern in `vite.config.ts` to pass a `__BUILD_ENV__` flag and key the allowlist on it. Keep this OUT of M4.3's first cut unless the codex audit specifically asks.

### Step 4 — Tests (new file)

**New file**: `packages/aztec-runtime/src/pxe/artifact-registry.test.ts`

Tests, ordered by risk:

1. **Wrong-class registry payload rejected** — fetcher returns artifact whose recomputed class id differs from requested. `resolve(...)` falls through to next source (or returns undefined if last).
2. **Tampered "known" artifact rejected** — inject a known-loader fixture that returns a class-id-mismatch artifact. `resolve(...)` skips it.
3. **PXE-local mismatch rejected** — `pxeLookup` callback returns mismatched artifact. `resolve(...)` skips it.
4. **Allowlist non-matching URL** — set `HttpRegistryFetcher` to look up a `chainId` not in the allowlist. `getRegistryUrl` returns undefined; no fetch attempted.
5. **Happy path: matching class id passes through** — golden-path test asserting registry artifact returns when class ids match.
6. **`ContractArtifactSchema` schema-invalid payload** — already covered by upstream `parseAsync`; smoke-test that `fetchArtifact` returns undefined on schema rejection (existing behavior; no new code, but pin it).

5-6 tests total. Each tests a distinct invariant. No per-callsite white-box tests.

**NOT TESTED:**
- The execution-service-side mismatch checks (`execution/service.ts:557, 1100`) — already exist; M4.3 doesn't touch them. They become defense-in-depth post-M4.3.
- E2E (defer — M4.3 is a security fail-closed; functional behavior unchanged for the happy path).
- Network smoke of registry fetches (covered by existing manual QA when registry toggle is enabled).

**Existing tests to consider**: search for any `artifact-registry.test.ts` or registry-mock tests in `packages/extension/`. None expected (M3.4 extracted artifact-registry without dedicated tests). If found, evaluate for redundancy with the new file's coverage.

## Verification commands

```bash
bun run --filter '@nulo/aztec-runtime' test      # new artifact-registry.test.ts
bun run typecheck:all                            # class-id helper signatures resolve
bun run test:all                                 # M2.6 unaffected
bun run check:imports                            # boundary clean
bun run build                                    # registry allowlist build-time substitution clean
```

Manual QA (10 min): turn on `contractRegistry` config; trigger a registry-fetched artifact path (network e2e or manual). Verify a known-good registry artifact still resolves; no UX regression.

**Adversarial test** during execution: temporarily edit `verifyArtifactClassId` to swap the class-id check (return mismatch as success). Re-run `artifact-registry.test.ts`; expect the wrong-class tests to fail. Revert.

## Risks tracked

1. **Class-id recompute performance** — `getContractClassFromArtifact` involves Poseidon hashing; ~10-50ms per artifact. Mitigated by caching: once an artifact passes verification, cache `(classId.toString(), artifact)` in `ArtifactRegistry` so subsequent resolves don't recompute. **OR**: skip the cache entirely on the assumption that the artifact set is small (<100). Decide at execution time based on benchmark numbers.
2. **`getContractClassFromArtifact` upstream API drift** — pinned via `@aztec/stdlib` workspace. If the upstream signature changes during a nightly bump, M4.3 needs to follow.
3. **"Known" artifact recompute false positives** — a build-time class-id baked into known-artifacts could drift if `@aztec/protocol-contracts` updates without us re-computing. Mitigate by adding an M2.6-style fixture: per-known-artifact `(name, expected_class_id)` table; CI rejects mismatches at build.
4. **User experience on rejection** — when registry returns mismatched artifact, the resolve falls through to "not found." User sees "could not load contract" instead of "registry served wrong artifact." Acceptable; logged for forensics. If we want a user-facing error later, surface from ExecutionService where the failed `getContractArtifact` already gets caught.
5. **Allowlist drift with Aztec network changes** — testnet/devnet chainIds are pinned in `getRegistryUrl`; if Aztec rotates them we manually update. Document in the allowlist comment.

## Rollback

`git revert <m4.3-commit-sha>` rolls back. Verification helper + wire-ups + allowlist refactor all in one commit-sequence; revert restores the trust-the-server pattern. Tests rolled back too.

## Open questions / decision flags

1. **Inline allowlist vs build-time `define`** — Step 3 ships inline-array first; if codex audit insists on env-aware build-time substitution, plan-revision absorbs.
2. **Cache verified artifacts?** — Step 3 perf risk; decide post-benchmark.
