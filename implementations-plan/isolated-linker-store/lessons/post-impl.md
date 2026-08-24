# Post-implementation review loop — Arc B

## /code-review max --fix (run while the keep/abort codex gate deliberated)

Full code-bearing diff read (24 files, +554/−165; plan docs + lock excluded). Findings, all in NEW code:

- `gen-remappings.ts` `assertEffectiveRemapping`: a `forge --version` spawn failure would surface as a TypeError on `null.split` instead of the real cause → both spawns now guarded (`error` / non-zero status) with the real message. FIXED.
- `resolve-asset` `assertPackageIdentity`: `mustContain.file` was joined without the containment guard `resolvePackageAsset` has → a `../` marker file could read outside the package. FIXED (same lexical containment rule).
- `useOptionalChain` nit in gen-remappings → folded.
- Considered and left alone: `resolvePackageAsset`'s guard compares LEXICAL paths (correct — it detects a caller writing `..`, not symlink targets); `fuel-testnet.ts` keeps `dirname`/`join`/`fileURLToPath` because `here` still builds two other paths.

Verification: resolver 14/14 + tsc · both files lint-clean · `assertEffectiveRemapping("forge")` end-to-end OK — and under the isolated layout the effective remap now points at `packages/bridge-core/node_modules/@aztec/l1-artifacts/...` (the declaring workspace), exactly as designed. Committed separately from implementation commits (ff827403 + the nit follow-up), per protocol.

## Cloudflare Pages previews — B2-specific, non-required, a MERGE PRECONDITION for the owner

An earlier draft of this entry read a testnet-only failure off an intermediate state and blamed the testnet project; the final A/B over the check-runs API (`repos/…/commits/<sha>/check-runs`, Cloudflare entries) says otherwise:

| head | linker / lockfile | `nulo` | `nulo-tools-mainnet` | `nulo-tools-testnet` | completed (UTC) |
|---|---|---|---|---|---|
| dev `27935013` (Arc A) | hoisted / v1 | ✅ | ✅ | ✅ | 17:22–17:24 |
| B1 `af85db95` (#454) | hoisted / v1 (+edges) | ✅ | ✅ | ✅ | 20:55–20:57 |
| B2 `b947951e` (pre-rebase) | isolated / v2 | ❌ | ❌ | ❌ | 20:52–20:53 |
| B2 `14f99733` · `ae9af9a6` · `10ebd262` | isolated / v2 | ❌ | ❌ | ❌ | 21:01–21:06 |

B1 passes and B2 fails all three projects within the same minutes → not a Cloudflare outage or quota, and not project-specific. It is not the code either: GitHub's clean-room runner builds the faucet (mainnet + testnet) green on the same heads, and the landing builds locally under the isolated linker in 51 ms (no phantom there). What differs is Cloudflare's build environment: the Pages **v3 build image ships Bun 1.2.15 by default (v2: 1.1.33); only the `BUN_VERSION` env var overrides it — no version file is honored and `packageManager` is ignored** (developers.cloudflare.com/pages/configuration/build-image). Bun ≤ 1.3 reads the v1 text lockfile fine and cannot read the `lockfileVersion: 2` B2 commits — which reproduces the table exactly. Pages env vars are scoped per environment (Production vs Preview), so "BUN_VERSION is set" on Production does not cover PR previews. `started_at == completed_at` on these check-runs is NOT evidence of an instant failure — the passing runs show the same equality (Cloudflare stamps both at completion).

The build log itself is dashboard-only. Ruling: NOT a required check, but merging B2 without fixing it would break the next stable release's `refresh-landing` + `deploy-faucet` Cloudflare deploys (a deploy surface — reserved for the owner). Ask: set `BUN_VERSION=1.4.0` on `nulo`, `nulo-tools-mainnet`, `nulo-tools-testnet` for BOTH Preview and Production, retry the #455 preview, confirm green; if still red, the dashboard log is the next evidence. Documented as the third Bun pin site (CLAUDE.md dependency policy + `apps/faucet/README.md` hosting).

## CI round 1 on the stack — the isolated linker found what it exists to find

B2's first CI run failed chrome/firefox/faucet builds + lint/typecheck + e2e with `Rolldown failed to resolve import "@aztec/constants" from packages/aztec-runtime/src/pxe/public-events.ts`. Root cause: **source-level phantom dependencies** the recon inventory (which swept TOOLING, not every workspace's src imports) never covered. A repo-wide import-vs-manifest sweep (scratch `phantom-sweep.ts`; alias/generated/stories false positives filtered) found FOUR real ones, all already-locked `5.0.1` records (manifest edits, not version-line changes): `@aztec/constants` + `@aztec/kv-store` (aztec-runtime, the latter in 4 files) and `@aztec/standard-contracts` (aztec-runtime, extension, faucet — the faucet builds failed on it too). Locally they resolved through the `node_modules/.bun/node_modules` hoist-fallback; on CI's fresh runner the same fallback existed but evidently populated differently — the declarations are correct regardless, and CI is the oracle. Post-fix local: chrome + faucet mainnet/testnet builds, typecheck:all, storybook all green. Also closed codex r2: README cwd fixed; storybook now strips the app's inherited unplugin-vue-components instance so `components.d.ts` survives a storybook build (verified: empty diff, 9 entries intact).

## CI round 2 — a BUILD-INJECTED phantom the source sweep cannot see

Extension chrome/firefox went green on CI after the four declarations; both FAUCET builds still failed: `Rolldown failed to resolve import "vite-plugin-node-polyfills/shims/buffer" from packages/wallet-crypto/src/mnemonic-master.ts`. That file contains NO such import — `nodePolyfills({ globals: { Buffer: true } })` INJECTS it into every transformed module, and rolldown resolves the injected specifier from the module's own location; wallet-crypto doesn't declare the plugin, so under the isolated linker it's unreachable (the hoisted root copy had masked it). The extension config already carried the exact countermeasure — an alias pinning the shim specifier to the app's own copy, with a comment naming this failure mode (recon listed it as a self-healing consumer; it was ALSO a latent bug in every OTHER app using the plugin). Fix: the same alias in `apps/faucet/vite.config.ts` via `@nulo/resolve-asset` (+ the workspace edge). Blind spot recorded in `tools/phantom-sweep.ts`: it reads SOURCE imports; build-time plugin injections must be found by clean-room builds — the CI runner is that clean room.

The faucet alias (14f99733) builds locally; a from-scratch clean-room checkout (`git archive` + frozen install, `--ignore-scripts`) could NOT be made to install at all — bun 1.4 refuses `@nulo/wallet-sdk-schema-patch@workspace:*` in a non-git export of the same tree (all 9 packages present; likely a Bun workspace-resolution quirk outside git — not this arc's problem, time-boxed). CI's fresh runner is the clean room of record; the fix is validated there.

## Codex post-impl round 3 — conditional approve → all closed

- Faucet shim alias: was uncommitted at read time; committed 14f99733 (+ edge). ADOPTED.
- `puppeteer-core` type-only phantom in `profile-reimport-matrix.test.ts` → `import type { Page } from "puppeteer"`. ADOPTED (vue-tsc clean).
- Sweep hardening: multiline imports, `require.resolve`, `vi.mock`/`jest.mock`/`mock.module`, `.cjs`. ADOPTED; re-run finds zero real phantoms. Codex's own AST cross-check found none beyond these either.
- `hoist = false`: RULED to stay a follow-up — pulling it in now would change resolution semantics again, invalidate the completed compatibility evidence, and start from an incomplete detector; land + soak isolated first, then a flip-first gate of its own. ADOPTED (decisions.md #12 stands).

## Codex post-impl round 4 — **APPROVE, no new material findings. LOOP CONVERGED** (4 rounds: r1 conditional → r2 conditional → r3 conditional (CI-found phantoms folded in) → r4 approve).

Verbatim: "The faucet alias resolves to the app's declared polyfill copy, its @nulo/resolve-asset edge is installed, the Puppeteer type import now uses the declared package, and the hardened sweep reports only the documented false positives. The source-only limitation is accurately documented, with clean-room CI retained as the authoritative check."
