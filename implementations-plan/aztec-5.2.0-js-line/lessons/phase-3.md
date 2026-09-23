# Phase 3 ✓ — fail-fast canary: RED → root-caused → resolved at the source → GREEN

## RESOLUTION (2026-08-26, after the owner cut SDK 5.2.0)

`@alejoamiras/aztec-accelerator@5.2.0` (published 17:41Z, all five `@aztec` deps at 5.2.0)
collapsed the bundle to a single generation. Consequences, all verified:
- **The cast is gone.** `typecheck:all` passes with ZERO casts — the bump now touches no runtime
  source at all. (D2 superseded by D9.)
- Residue gate extended and PASSING: the whole prover path — `stdlib`, `bb-prover`, AND
  `noir-protocol-circuits-types` (the VK-tree module, the actual bug locus) — resolves to 5.2.0
  from both consumers. The only remaining 5.0.1 copies belong to private-fee-juice's declared
  closure, whose peers rebind to 5.2.0 at runtime.
- **Canary GREEN**: `Test Files 1 passed (1)`, `Tests 2 passed (2)`, `CANARY_RC=0`, with the
  full native chain in the server log:
  `Received /prove request` → `Requested Aztec version version=5.2.0` →
  `Download complete version=5.2.0` → `Proving succeeded` ×3.
  The frozen 5.0.1 account bytecode therefore deploys, proves natively **under bb-5.2.0**,
  consumes an authwit, and survives an SW-restart re-derive on the bumped stack.
- Min-age: the fresh publish tripped the gate; ONE dated exclude added (D10), removable
  on/after 2026-09-02, justified on verified first-party SLSA provenance.

Everything below is the original red-run triage, kept because it is the durable lesson.

---

# Phase 3 (original) — RED, triaged to root cause, PAUSED on owner action

## Runs

1. First attempt: failed at 22.5s, zero accelerator requests. Mechanical: STALE VITE OPTIMIZER
   CACHES after the dep swap (`.vite/deps/*.js does not exist` — the dev-served dApp page
   couldn't load) + a transient `aztec-node: Address already in use` (no orphan found
   listening; the 8545 anvil belongs to another agent and was untouched). Durable lesson:
   **clear `<app>/node_modules/.vite` in every dev-served app after any dependency-line swap,
   before the first e2e run.**
2. Retry after cache clear: ran the full arc to the first proving tx and failed there —
   `grantPublicAuthwit` (the frozen-ctor deploy) errored:
   `"VK index for [object Object] not found in VK tree"`. Still ZERO `/prove` requests — the
   failure precedes any server call (kernel witness-generation stage).

## Root cause (located to the line)

Upstream `noir-protocol-circuits-types` `src/artifacts/vks/tree.ts` `getVKIndex(vk)` branches
on `vk instanceof VerificationKeyData` / `instanceof VerificationKeyAsFields`, else treats the
argument AS the hash. The 5.2.0 PXE constructs the VK objects; the accelerator SDK's NESTED
5.0.1 copy of that module performs the lookup. `instanceof` fails across the two byte-identical
copies → falls through → whole object used as hash → `getIndex` misses → the error (the
`[object Object]` is the tell: `hash.toString()` on a non-Fr). The module is byte-identical
across generations (diffed) — the bug is dual-copy class identity, not code drift.

This is the Architecture table's nested-dual hazard materializing at runtime, in UPSTREAM code
reached via `BBLazyPrivateKernelProver`'s generate* path — outside the accelerator SDK's own
code, so not fixable by an SDK patch of its logic; only by making the two generations one.

## Verdict state of the compatibility hypothesis

"Previous SDK should be compatible" survived: interface (byte-identical declarations), wire
(msgpack), circuits/VKs (byte-identical upstream — never even reached). It failed in exactly
one place: nominal `instanceof` in the VK-index path under bundle dual-copy conditions.

## Options weighed at pause time

1. Vite `resolve.dedupe` extension (stdlib + noir-protocol-circuits-types + bb-prover +
   foundation) → single-generation bundle; SDK JS rebinds onto 5.2.0 like private-fee-juice
   does. Cheap, reversible, untested at pause.
2. HOLD the line (Ask 4 default).
3. **CHOSEN (owner, 2026-08-26): cut `@alejoamiras/aztec-accelerator` SDK 5.2.0** — the owner
   owns the package; bumping its exact `@aztec/*` deps to 5.2.0 dissolves the dual-generation
   problem at the source (single world end-to-end; `x-aztec-version` then advertises 5.2.0 and
   the server fetches bb-5.2.0).

## Resume checklist (when the 5.2.0 SDK is on npm)

1. Bump `@alejoamiras/aztec-accelerator` to the new version in `apps/extension/package.json` +
   `packages/aztec-runtime/package.json`; `bun install`.
2. **Remove the Phase-2 nominal-brand cast** in `packages/aztec-runtime/src/pxe/chain-runtime.ts`
   (single-generation stdlib ⇒ the cast becomes unnecessary; keep it only if typecheck still
   demands it, with the comment updated).
3. Update `scripts/aztec-hold-residue-check.ts` expectations: the accelerator rows flip from
   `HELD_LINE` to `WORKSPACE_LINE` (or drop from HELD_ROOTS if its deps fully match), and the
   lock's held-closure set shrinks accordingly. private-fee-juice/standards rows unchanged.
4. Re-run the Phase 1 gate commands (install, layout-identity, lock diff vs `1727a42f`,
   residue script, frozen-lockfile, provenance per-name for the new SDK version) — then
   Phase 2 gate (typecheck/test:all/lint/freeze diff) — then Phase 3 canary (UNSEEDED server;
   expect `Requested Aztec version version=5.2.0` + a bb-5.2.0 download in the log).
5. Continue Phases 4–6 per plan; PR-1 quality loops; PR-1.
6. Server/port at pause: my accelerator-server pgid killed and the ports.md row removed —
   restart via the scratchpad scripts (`start-accel-unseeded.sh` pattern) and re-register when
   resuming.

Note for the SDK cut: the SERVER binary needs nothing — release 2.0.0 is already proven green
in CI on this repo (PR-0 #470); only the npm SDK's dep line moves.
