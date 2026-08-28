# Phase 1 — devendor

## What changed

Deleted `contracts/bridge/evm/upstream/TokenPortal.sol` and, in `verify-l1.ts`, the code that existed
only to serve it: `placePortalSource()`, `requireLegacyForgeInputs()`, the `obj()` helper they shared,
and the `PORTAL_SOURCE_REL` / `VENDORED_PORTAL` constants. `L1_ARTIFACTS_ROOT` stays — the surviving
branch uses it at both call sites.

The two-way branch collapsed. Every manifest now goes through `parseCandidateManifest`, whose schema
already declares `portalSource: z.literal("forked-v1")`, so the rejection needed no new guard code —
the branch was what let a legacy manifest bypass the strict schema in the first place.

`biome check --write --unsafe` removed the imports that fell out (`copyFileSync`, `mkdirSync`,
`keccak256`, `evmAddress`); `tsc` alone did not flag them.

## Gate result

| Check | Result |
|---|---|
| `bun --bun vitest run` (bridge-core) | 267 passed, 1 skipped — was 265, +2 new |
| `bun run --filter @nulo/bridge-core typecheck` | exit 0 |
| `bun run lint` | exit 0 |
| `verify-l1 --config …/testnet-bridge.json --dry-run` | all four contracts build their standard-json |
| residual references | none, except one deliberate (below) |

## Mutation verification of the new tests

The plan's rule is that a guard nothing exercises is worth nothing, so the two schema tests were
checked the same way the proofs will be. Weakening the schema —

```
- portalSource: z.literal("forked-v1"),
+ portalSource: z.string().optional(),
```

— turns **exactly** the two new tests red and leaves the other 14 in that file green:

```
× rejects a manifest whose portalSource is not the fork
× rejects a pre-fork manifest that omits portalSource entirely
Tests  2 failed | 14 passed (16)
```

Restored, all green again. They fail for their own reason, not a neighbouring one.

## The comment left deliberately stale

`upstream/NuloTokenPortal.sol:2` still points at the file this phase deleted, and its header still
mentions the shim that Phase 2 removes. Both are wrong, and both stay.

solc folds a hash of the source — comments included — into the deployed bytecode. Editing either line
would move `FORKED_PORTAL_KECCAK`, `PORTAL_PIN` and the committed artifact, and leave the live mainnet
and testnet portals unverifiable until every pin was regenerated and re-reviewed. Two stale comment
lines are the cheaper cost, and the reason is recorded here rather than in the file, precisely because
writing it in the file would trigger the thing it warns about.

## Note

The plan called for a `verify-l1.test.ts`. It was dropped during review: `verify-l1.ts` exports nothing,
runs on import, writes `remappings.txt` at module scope and exits via `process.exit`, and no unit-test
job installs Foundry — so a spawn-based test would pass on `"forge not found"` rather than on the
behaviour it names. The assertion belongs in `candidate-schema.test.ts`, where the rejection actually
lives.
