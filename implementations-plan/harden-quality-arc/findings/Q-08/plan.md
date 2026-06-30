# Q-08 — dedup the triplicated nulo-schema-patch · tier: **mid**

**Re-verify (STEP 1, vs `dev-quality`):** VALID. The 3 `nulo-schema-patch.ts` (apps/extension/src/wallet/services/wallet-sdk/, apps/faucet/src/lib/, apps/playground/src/lib/) are BYTE-IDENTICAL (diff-confirmed), side-effect-only, patch `WalletSchema.registerToken` with an upstream drift guard.

## Decision ledger (codex `bczid1qa2`)
- **New PRIVATE workspace package `packages/wallet-sdk-schema-patch`** (`private: true`), with:
  - `src/apply.ts` → `export function applyNuloSchemaPatch(schema)` (testable helper, the patch body + drift guard).
  - `src/register.ts` → side-effect entry: `import { WalletSchema } from "@aztec/aztec.js/wallet"; applyNuloSchemaPatch(WalletSchema)`.
  - package exports `./register` (side-effect) + `./apply` (helper). NOT a root barrel.
- **NOT bridge-core** (bridge-domain L1/L2), **NOT aztec-runtime** (wallet-bridge must not depend on it), **NOT wallet-bridge root** (repo explicitly rejected wallet-bridge as a dApp-consumed package — its barrel exports dispatcher/protocol internals). A dedicated private package keeps it Nulo-internal (no dApp leak) while giving all 3 apps ONE source.
- **CRITICAL — keep the SIDE-EFFECT import FIRST, do NOT convert to "import helper + call in body".** Static imports evaluate before the module body, so a body-call could run AFTER `@aztec/wallet-sdk` modules evaluate. The current ordering is load-bearing (patch before wallet-sdk): extension `background.ts:28`, faucet `createAztecWalletSession.ts:3`, playground `wallet.ts:15`. So each app: replace its first import with `import "@nulo/wallet-sdk-schema-patch/register"` (still side-effect, still first).

## Trust-boundary adjacency (CAREFUL — hard-limit area)
Q-08 must update test IMPORTS in the FROZEN-oracle file `method-descriptors.test.ts:212` (it imports the extension's schema-patch copy) AND `dispatcher.test.ts` (lines 849/1166/1513). **These are IMPORT-PATH changes, NOT `FROZEN_*` edits** — allowed. But:
- Edit ONLY the schema-patch import lines; leave `FROZEN_CAPABILITY_MAP`/`FROZEN_EXEMPT`/`FROZEN_SCOPE_CHECKER` + all authz assertions BYTE-IDENTICAL.
- **Operational check after editing:** `git diff` the FROZEN_* ranges + authz cases → must be empty (a non-zero diff there = hard-limit halt).
- `dispatcher.test.ts:~1175` has a **copy-identity test** (asserts the 3 copies match) — dedup makes it MOOT (one source) → remove it. Confirm it's the copy-identity drift-pin, NOT an authz test, before removing.
- The reachability assertions (registerToken ∈ WalletSchema) re-point to import `@nulo/wallet-sdk-schema-patch/register` (the shared source) — must stay green.

## Plan
1. Create `packages/wallet-sdk-schema-patch` (package.json `private:true` + exports `./register`,`./apply`; tsconfig). `src/apply.ts` (helper = the patch body verbatim) + `src/register.ts` (side-effect call).
2. Replace the 3 apps' first imports with `import "@nulo/wallet-sdk-schema-patch/register"`. Delete the 3 local copies.
3. Update `dispatcher.test.ts` (849/1166/1513 → new package; remove the copy-identity test) + `method-descriptors.test.ts:212` (→ new package import). **Verify FROZEN_* byte-identical (git diff).**
4. Update CLAUDE.md + wallet-bridge README "Custom RPC methods" contract text (3-copy → 1-source).
5. `bun install` (new workspace package); per-edit gate: lint + typecheck:all + wallet-bridge units (incl. dispatcher + method-descriptors reachability) + the touched apps' build.

## Security / adversarial
The patch adds Nulo-custom RPCs to WalletSchema — keeping it in a PRIVATE package (not the published wallet-sdk surface, not wallet-bridge's dApp-facing barrel) preserves "don't expose wallet-bridge to third-party dApps." The drift guard (throws on upstream signature change) stays. No authz/permission semantics change (the dispatcher routing of registerToken is untouched; only the schema-patch SOURCE is dedup'd).

## Gate (PR): wallet-bridge units (dispatcher + method-descriptors) + the 3 apps' build + smoke + FULL network. **Frozen-oracle git-diff check.** Per-arc tail: `/code-review max --fix` → codex post-impl.
