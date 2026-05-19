# M4.9 — RP ID build-time contract (1-2d)

> **Audit tier**: dual (codex xhigh + Plan agent).

## Context & entry state

WebAuthn passkeys are crypto-bound to the **Relying Party ID** (RP ID) used at credential creation. Changing the RP ID after registration is identical to losing all passkeys — the browser refuses `navigator.credentials.get()` for a credential created under a different RP ID.

Today the RP ID `"nulo.sh"` is **hardcoded at the call site** (`packages/extension/src/popup/windows/passkey/index.vue:88`). The manifest's `host_permissions: ["https://nulo.sh/"]` (`packages/extension/manifest/manifest.config.ts:14`) is set independently — there is no contract that the two values stay in sync. A future contributor renaming the host (e.g. for a fork or a domain pivot) can break passkey unlock for every existing user without any compile-time signal.

M4.9 makes the RP ID a **build-time constant** referenced from a single source, and adds a build-step gate that fails the build if the manifest's `host_permissions` does not include the chosen RP ID.

**Codex audit pass-through**: confirmed `nulo.sh` is hardcoded at one call site (passkey window's `publicKey.rpId`), and `manifest.config.ts:14` has no derivation from a shared constant. No other RP-ID strings in the source tree (verified via grep).

## Architecture invariants (preserved)

1. **RP ID value `nulo.sh`** — UNCHANGED. M4.9 doesn't rename it; it gates it.
2. **Manifest `host_permissions`** — UNCHANGED. M4.9 verifies it in build, doesn't rewrite.
3. **WebAuthn credential creation/get flows** — UNCHANGED at runtime. Only the source of the string changes.
4. **M2.6 vectors** — N/A (RP ID isn't part of the KDF chain; only `nulo:kdf:v1` + the credential rawId are).
5. **Manifest schema** — unchanged. We add a build-script gate, not a runtime check.

## Sub-step breakdown

Single PR; two atomic commits inside.

### Step 1 — Single source of truth for RP ID

**New file**: `packages/extension/src/wallet/passkey/constants.ts`

```ts
/**
 * WebAuthn Relying Party ID. Crypto-bound: changing this value invalidates
 * every existing passkey credential. Keep in sync with manifest.config.ts
 * `host_permissions`. Build-step gate (`scripts/check-rp-id.ts`) enforces the
 * sync.
 *
 * If a fork wants to repurpose this extension under a different domain,
 * change BOTH this constant and the manifest entry, and accept that ALL
 * existing passkey wallets become unrecoverable.
 */
export const RP_ID = "nulo.sh"
```

(Lives in the extension package because passkey window is extension-private. Could live in `@nulo/wallet-crypto` later if a second consumer emerges.)

**Modified**: `packages/extension/src/popup/windows/passkey/index.vue`
- Line 88: `rpId: "nulo.sh"` → `rpId: RP_ID`
- Add import: `import { RP_ID } from "@/wallet/passkey/constants"`

### Step 2 — Build-step gate

**New file**: `packages/extension/scripts/check-rp-id.ts`

A small Node script (run at the top of `bun run build`):

1. Reads the manifest output(s) from the build directory(ies) (Chrome + Firefox).
2. Imports `RP_ID` from `src/wallet/passkey/constants.ts`.
3. Asserts the manifest's `host_permissions` array contains `"https://${RP_ID}/"`.
4. Asserts no other passkey-related strings drift (greps repo for `rpId:` and warns if any string literal not matching `RP_ID` appears).
5. Exits non-zero with a structured message if any check fails.

**Modified**: `packages/extension/package.json`
- `"build"` script changes from a single `vite build` invocation to `bun run check:rp-id && cross-env NODE_OPTIONS=... vite build -c vite.chrome.config.mts`
- Same for `build:firefox`, `build:chrome`, `build:full`
- New script: `"check:rp-id": "bun run scripts/check-rp-id.ts"`

(Alternative considered: do the check INSIDE a Vite plugin. Rejected — the check is fast enough as a pre-build step, simpler, and runnable independently.)

### Step 3 — Document in SECURITY.md

**Modified**: `SECURITY.md` — add a "Passkey RP ID" subsection under "Threat model" or similar:
- The RP ID `nulo.sh` is crypto-bound; rename = loss of all passkey credentials.
- Build-step gate `check-rp-id.ts` prevents accidental drift between the constant and `host_permissions`.
- Forks must change both atomically.

## Test plan

Two tests at the unit level (build-script integration is the actual gate):

1. **`check-rp-id.ts` happy path** — manifest with matching `host_permissions` passes. Run the script with a fixture manifest in a temp dir; expect exit 0.
2. **`check-rp-id.ts` mismatch fails** — manifest with `host_permissions: ["https://wrong.example/"]` fails with structured exit code + message naming both values.

Additionally:

3. **`packages/extension/scripts/check-rp-id.test.ts`**: a happy-path + 2-3 mismatch shapes (missing entry, additional entry that includes RP_ID, completely different domain). Run via `bun run --filter '@nulo/extension' test`.

**NOT TESTED:**
- Runtime behavior (RP_ID is a constant; if it's wrong at build time, we never reach runtime).
- Vue component re-render with the new constant (the import-time substitution is a no-op for the renderer).
- Manual passkey QA (defer to e2e — M4.9 is a build-time gate, not a flow change).

**Existing tests**: nothing to delete or tighten.

## Verification commands

```bash
bun run --filter '@nulo/extension' test    # check-rp-id tests pass
bun run typecheck                          # constant import resolves
bun run build                              # check:rp-id runs as pre-step, gate clean on master state
bun run lint                               # no boundary violations
```

Manual smoke (5 min): open the built extension, register + unlock a passkey profile. Confirm no functional change.

**Adversarial test** during execution: edit `manifest.config.ts:14` to `host_permissions: ["https://wrong.example/"]`, run `bun run build`. Expect: build fails with the structured mismatch message. Revert.

## Risks tracked

1. **Firefox manifest divergence** — `vite.firefox.config.mts` may produce a different manifest shape. The build-step gate must check BOTH built manifests (Chrome + Firefox), not just one.
2. **Future RP ID rotation** — if we ever need to change `nulo.sh`, this gate explicitly does NOT migrate users; their passkeys are lost. Document in `constants.ts` + `SECURITY.md` so the contributor can't miss it.
3. **The build-step gate runs only on `bun run build`** — `bun run dev` skips it. Rationale: dev iteration shouldn't be blocked on manifest gymnastics. Document in the script's header comment.
4. **String-grep false positives** — Step 2 #4 greps `rpId:` to catch drift. JSDoc references could match. Use a comment-stripping regex or scope the grep to `.ts` / `.vue` non-comment regions.

## Rollback

`git revert <m4.9-commit-sha>` rolls back. The constant + import substitution + build script all live in one commit; reverting restores the hardcoded literal.

## Open questions / decision flags

None. Build-time gate is unambiguous; the only choice was Vite-plugin vs pre-step (chose pre-step for simplicity).
