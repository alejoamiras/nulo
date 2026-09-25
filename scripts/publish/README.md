# scripts/publish

Stages three workspace packages as public npm packages and binds their first publication to rehearsed bytes. The workspaces themselves stay `private` and keep their `@nulo/*` names, a scope someone else owns on npm; only the staged copies, named `@alejoamiras/nulo-*`, reach a registry.

| Workspace | npm package | Published surface |
|---|---|---|
| `packages/wallet-crypto` | `@alejoamiras/nulo-wallet-crypto` | `.` → `src/public.ts`: `deriveNuloAccountKeys`, `deriveSigningKeyFromSeed`, `EncryptionKey`, `type Passhash` |
| `packages/resolve-asset` | `@alejoamiras/nulo-resolve-asset` | `.` → `src/index.ts` (Node/Bun only) |
| `packages/wallet-sdk-schema-patch` | `@alejoamiras/nulo-wallet-sdk-schema-patch` | `./apply` → `src/apply.ts`, `./register` → `src/register.ts` (side effect) |

## Files

| Path | Purpose |
|---|---|
| `packages.ts` | The table above: names, entries, targets, which entries are side effects. |
| `stage.ts` | `bun scripts/publish/stage.ts <dir>...\|--all --version X.Y.Z [--out <root>]` → `dist-publish/<dir>/`: a Bun ESM bundle per entry (`@aztec/*` and `zod` kept as bare imports; only `packages/*/src` code may be inlined, each file into one bundle, so `wallet-core` code is and nothing third-party is), declarations from each package's `tsconfig.publish.json` with `.js` specifiers and unreferenced files pruned, a generated `package.json` (exact `@aztec/*` peers from the workspace pins, `zod` a dependency, `sideEffects` from `packages.ts`), README, LICENSE and NOTICE, all at mode 644. Must run from the repo root. It replaces only a directory holding its `.nulo-staged` marker, and inside the repository only under `dist-publish/`. |
| `readme/<dir>.md` | The README each npm package ships. |
| `check-digests.ts` | `bun scripts/publish/check-digests.ts <version> <tgz-dir>`: the version must be canonical `X.Y.Z`; a version listed in `approved-digests.json` must pack exactly those tarballs; `0.1.0` must be listed. |
| `approved-digests.json` | `{ "<version>": { "<tarball>": "<sha256>" } }`, recorded by the rehearsal before the first publication. |
| `stage.test.ts` | The tarball contract (run by `test:release`). Details below. |
| `verify-provenance.sh` | `scripts/publish/verify-provenance.sh <tarball> [<owner/repo> <workflow path>]`: fetches the registry's SLSA bundle for the tarball's name@version and has `gh attestation verify` check it was signed by that workflow on `dev` or `main` (the Sigstore certificate identity) and names the tarball's sha512. Prints the attested commit. |
| `verify-provenance.test.ts` | Runs the script against a real attested package (`@sigstore/core@3.0.0`): accepted for its own workflow, refused for another workflow and for altered bytes. Opt-in, since it needs the network and an authenticated `gh`: `NULO_PROVENANCE_PROBE=1 bun test scripts/publish/verify-provenance.test.ts`. |

## What the tests prove

`stage.test.ts` stages and packs all three packages and checks each tarball:

- **File list:** it equals an allowlist.
- **Bundles:** each keeps exactly its pinned imports, as bare specifiers, under a size ceiling. No `node:` import appears outside `resolve-asset`.
- **No private names:** nothing names a private `@nulo/*` package.
- **Dependencies:** each manifest declares exactly the packages its shipped code and declarations import, and the peers equal the workspace pins.
- **Attribution:** the Azguard notice heads the bundle and declaration derived from `encryption-key.ts`.
- **Reproducible:** a second staging under a stricter umask packs byte-identical tarballs.
- **Safe output:** staging refuses to replace a directory it did not create, or anything in the repository outside `dist-publish/`, even through a symlink.
- **Docs:** the schema-patch README lists every method the patch adds.

It then unpacks the tarballs into a consumer outside the workspace, linking only the peers and dependencies the manifests declare, and checks that the consumer:

- imports every export under Bun and under Node 24 ESM;
- reproduces the key-derivation vectors and gets exactly the patch's methods on `WalletSchema`;
- type-checks under NodeNext and Bundler resolution, and with the lib check on reports nothing inside the published declarations.

Finally it checks that `EncryptionKey` ciphertexts are interchangeable between the bundle and the wallet's source, and that both reject a wrong AAD or a tampered byte.

Nothing that loads `@aztec/*` runs inside the test process. Under `bun test`, every module sees a bare `expect`, and `@aztec/foundation` calls `expect.addEqualityTesters` at load when it sees one, which Bun's `expect` lacks. A transpile cached by an earlier non-test run hides the crash, so the checks that need `@aztec/*` run in `bun`/`node` child processes, and `test:release` disables the transpiler cache (`BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`) so every run sees what a fresh runner sees.

Ordinary comment-only edits (`//` and `/** */`) to a published source file leave the staged bytes unchanged: Bun drops them and the declarations are emitted without them. Legal comments (`/*! … */`, kept by the bundler), `@__PURE__` / `#__NO_SIDE_EFFECTS__` annotations (they change what the bundle keeps), code, an Azguard header line and a file's path all change them.

## Publishing

`.github/workflows/publish-packages.yml` runs on `workflow_dispatch` from `dev` or `main`, and is a dry run by default. It has four jobs:

1. **Test.** `test:release`. It runs `@aztec/*` code, so it makes no bytes.
2. **Pack.** A frozen install with no shared cache and no lifecycle scripts, then stage, pack and check the digests. It runs no test code.
3. **Publish.** The only job with `id-token: write`. It runs in the `npm-publish` environment, which needs the owner's approval, refuses any version but `0.1.0` until `0.1.0` is on npm, and publishes each tarball with `npm publish --provenance` through npm trusted publishing. No npm token exists anywhere.
4. **Verify.** Runs `verify-provenance.sh` on each tarball, which requires the registry's provenance to be signed by this workflow on `dev` or `main` and to name these bytes, then runs `npm audit signatures`. A re-run that found a version already published is verified the same way.

`publish` and `verify` download `pack`'s artifact by its ID and check every tarball against the sha256 list `pack` outputs: `test` runs beside `pack` with the same artifact token, and could otherwise replace a named artifact.

`scripts/ci-cd/publish-packages.test.ts` pins that shape.

**Before the first publication** (owner and agent, from a workstation):

0. **Environment.** Create the `npm-publish` environment with the owner as required reviewer and deployment branches `dev` and `main` only. GitHub creates a referenced environment with no protection at all, so this must exist before the first real dispatch. Check it with `gh api repos/alejoamiras/nulo/environments/npm-publish`: `protection_rules` lists `required_reviewers` and `branch_policy`.
1. **Placeholders.** Publish a code-free `0.0.0-bootstrap.0` of each package under the `bootstrap` dist-tag.
2. **Trusted publisher.** Attach it to each package. This needs an npm that has `npm trust`: 11.19.0 does, 11.6.2 (bundled with Node 24.12.0) does not.
   ```sh
   npm trust github <pkg> --file publish-packages.yml --repo alejoamiras/nulo --env npm-publish --allow-publish
   ```
   Then confirm each record with `npm trust list <pkg>`.
3. **Package settings.** Require 2FA and disallow tokens on each package, then deprecate the placeholders.
4. **Log out.** Run `npm logout`.
5. **Rehearsal.** Record the three `0.1.0` digests in `approved-digests.json`.
