# Code review (`/code-review max --fix`) — Phases 1–5

**Scope:** `git diff dev...HEAD` code files (Phases 1–5; deploy phases 6–9 not yet implemented).
**Outcome:** clean — no defects to fix (`--fix` had nothing to commit).

The loaded `code-review` skill is the interactive human-tour protocol; in autonomous mode I ran the
substance of it instead — an adversarial self-review of the branch diff for correctness / money-path /
integrity defects, applying fixes if any.

## The load-bearing check this review added (was a genuine gap)
`build.json` only proves the **Node-scope** target. The **app-scope** switch is
`resolveFaucetTarget()` reading `import.meta.env.VITE_FAUCET_TARGET` (define). If that define did NOT
land, the app silently falls back to testnet — and a mainnet build would then run as testnet AND
PASS the integrity assertion (testnet target vs the testnet-identity placeholder manifest). A silent
wrong-network bug.

**Verified per-target, definitively** (differential bundle grep, since "raw string absent" alone is
inconclusive — Vite replaces unknown `VITE_*` with `undefined` too):
- mainnet `dist/assets/` contains `mainnet-PLACEHOLDER-not-deployed` (the placeholder manifest,
  injected via the SAME `VITE_BRIDGE_MANIFEST_JSON` define) + `4248422646` (mainnet walletChainId).
- testnet `dist/assets/` contains NEITHER.

⇒ the `define` mechanism lands per-target for both `VITE_FAUCET_TARGET` and `VITE_BRIDGE_MANIFEST_JSON`;
the app-scope switch is real, not just `build.json`. No silent-wrong-network path.

## Spot-checks that passed
- Permit2 approve fallback: approves the bridged `L1_USDC` to the correct per-leg permit2, `max`
  amount (owner's DP5 pattern), short-circuits when sufficient; runs after `addRecordVerified` so the
  record exists for `setRecordStep`.
- `verify-build-target` hashes the SAME `public/<manifestFile>` the build hashed → digest match is
  meaningful (both read source, not dist).
- schema `.refine` wraps `.strict()` → unknown keys still rejected (the unknown-field test passes).
- fail-closed `main.ts`: assertion throws → visible message + rethrow (no blank page, error in console).

## Note
The interactive `code-review` skill doesn't define a "max"/"--fix" tier — the owner's `/code-review
max --fix` convention likely maps to a separate reviewer. Recorded here as the autonomous-mode
equivalent. A fresh codex post-impl audit runs alongside (`bta2tt4kx`) for an independent pass.
