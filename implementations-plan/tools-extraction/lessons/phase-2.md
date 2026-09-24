# Stage 2 — N2 (publishable packages) and N3 (landing config)

## N3 — landing Worker config (A3, #693)

**Baseline captured 2026-09-24 against `https://nulo.sh` (Pages).**

- **200 with the site's HTML:** `/`, `/terms`, `/privacy`, `/terms/v1.0/`, `/forms/uninstall`, `/forms/uninstall/`, `/does-not-exist`, `/favicon.ico`, `/_headers`.
- **308 to the clean URL:** `/terms/`, `/terms.html`, `/index.html`, `/terms/v1.0`.
- **Headers:** every response carries the full `public/_headers` set. Assets add `cache-control: public, max-age=31536000, immutable`.
- **Consequence:** Pages already serves `index.html` for unknown paths, so `not_found_handling: "single-page-application"` changes nothing users see.

**Local parity.** `wrangler dev --local` (wrangler 4.129.1) served the same build with identical statuses and header sets. It differs from Pages in two ways:

- redirects are **307**, not 308;
- JS is served as `text/javascript`, not `application/javascript`.

**`wrangler deploy --dry-run` needs no credentials** for an assets-only config. wrangler excludes `_headers`, `_redirects` and `.assetsignore` from the uploaded assets and sends them as config (`createAssetsIgnoreFunction`).

**Codex (session `01a0d540`), five rounds:**

1. **Changes needed.** The README claimed both hosts rebuild. A bad `CLOUDFLARE_LANDING_DEPLOY_HOOK` could report success. Per-Worker token roles exist (verified in Cloudflare's docs: the Editor role, only for a Worker that already exists, and Custom Domains do not support per-Worker roles).
2. **Changes needed.** jq's `//` treated `false` as missing. The URL prefix accepted an empty id and glob syntax.
3. **Approve.** Hook checks tested against 12 response bodies and 8 URLs.
4. **Owner decision 25: no hook for the Worker.** The workflows returned to `dev`'s text.
   - *Why:* the Worker builds only through the Workers Builds Git connection set up in the dashboard.
   - *What was dropped:* the `LANDING || PAGES` fallback and its checks, reverted in `1cf4c146`.
   - *New cut-over step:* the owner re-runs the Worker's production build before `nulo.sh` is attached. The Release-PR build runs before the release has its zip, so attaching without a re-run would serve the previous release.
5. **Approve** on the net diff (`112d878f`).

## N2 — staged packages (A2)

**The bundler labels modules by path relative to the cwd.**

- **Symptom:** run from `/tmp`, the staged bundle carried `// ../mnt/user-data/<user>/…/packages/wallet-crypto/src/…` comments. That leaks a local path into a public tarball, and the bytes depend on where the script runs.
- **Fix:** `stage.ts` refuses any cwd but the repo root. A test also rejects any module comment outside `packages/<pkg>/src/`.

**Emitted declarations carried maintainer-only file headers:**

- "the extension and the playground both activate it";
- "Why a private package";
- a plan path in `resolve-asset`.

**Fix:** the publish tsconfigs set `removeComments`. The READMEs carry the contracts instead.

`tsc` also drops `encryption-key.ts`'s line-1 Azguard notice, because it attaches to an elided import. `stage.ts` re-adds the source's notice to the bundle and to that declaration.

**Ordinary comment-only edits leave the staged bytes unchanged.** Probe: add a line comment and a JSDoc block to `account-derivation.ts`, then compare the staged files. Every `dist/*` file and `package.json` hashed the same. The staged bytes move with:

- a code change;
- a change to an Azguard first line;
- a file move (the module labels);
- a `/*! … */` legal comment, which Bun keeps (probed);
- a `@__PURE__` / `#__NO_SIDE_EFFECTS__` annotation, which changes what the bundle keeps.

**`skipLibCheck` hides TS2834** (extensionless relative imports in a `.d.ts` under NodeNext). A lib check fails as a whole, because `@aztec/foundation`'s declarations fail it (`Buffer`, and an untyped `util`). So the fixture type-checks with `skipLibCheck`, and a separate assertion requires `.js` on every relative declaration import. *Revised after review:* a second run with the lib check on is usable after all when it is judged by *where* the diagnostics fall: every one must have a location, and none may sit under `node_modules/@alejoamiras/`. `IsAny` alone never caught an unresolved import, because TypeScript types it as its internal error type, not `any`.

**Mutation probes (each restored afterwards):**

| Mutation | Caught by |
|---|---|
| Signing separator +1 | Bun and Node vector legs |
| Declarations written without the `.js` rewrite | the declaration-specifier test (the NodeNext type-check did **not** catch it) |
| `@aztec/*` not external | staging fails closed |
| Banner dropped | the Azguard test |
| A stray file in `dist/` | the allowlist test |

**Biome does not lint `scripts/`.** `biome.json` includes only `apps/`, `infra/`, `packages/` and `scripts/ci-cd/test-soak/`. The new scripts were checked with a scratch config that extends the root one: two functions over the complexity budget were split, then formatted.

### Review round 1 (codex + a four-lens review workflow, 23 confirmed findings)

Codex: changes needed (shared cache in the publish build, `--out packages` deletes sources, the idempotent skip proves no provenance, the fixture masks missing peers, file modes). The workflow confirmed 23 findings (4 medium) and refuted 2 that concerned merged refs. All adopted; the ones that changed the design:

- **Bun trusts a warm cache.** The review's probe: poison a cached package's `index.js`, delete `node_modules`, run `bun install --frozen-lockfile` → the poisoned body is installed. Bun does not re-check the lockfile's sha512 against its cache, and `oven-sh/setup-bun` restores its binary without a hash either. So the job that makes the bytes (`pack`) restores no cache (`no-cache: true`, a fresh `BUN_INSTALL_CACHE_DIR`), installs with `--ignore-scripts`, and runs no test code; `test:release` runs in its own job.
- **Browser builds and builtins.** Probe (Bun 1.4.2, `target: "browser"`): `node:fs` stays an external `node:fs` import, but `path` and `crypto` are inlined as polyfills, recorded as metafile inputs `node:path` / `node:crypto` with bytes in the output. The existing `node:` import check could not see those. Staging now refuses any input with bytes in an output that is not under `packages/*/src`, and any input in two outputs.
- **Provenance after the fact.** The skip path publishes nothing, so verifying afterwards (a `verify` job with no privilege) is as good as verifying before, and it covers fresh publications too. The registry serves `/-/npm/v1/attestations/<name>@<version>`; the SLSA v1 statement's subject is `pkg:npm/%40scope/name@version` with the tarball's hex sha512, and `externalParameters.workflow` names repository, path and ref. The filter was probed against `@sigstore/core@3.0.0`: its real digest matches, a changed one is rejected. `npm audit signatures` verifies attestation signatures (probe: "1 package has a verified attestation") but does not fail on a package that has none, so presence and identity come from the statement check.
- **The address claim was wrong.** The npm README said consumers derive "the same Aztec accounts". The peer's `SchnorrAccount.json` at 5.2.0 has class id `0x0833459d…`; the wallet's frozen artifact has `0x0db53983…`. Keys match, addresses do not.

| New mutation | Caught by |
|---|---|
| Mode normalization removed | the reproducibility test, now run under umask 077 |
| Declarations written extensionless after staging | the declaration-specifier test **and** the lib-check run |
| `@aztec/stdlib` dropped from the schema-patch peers | the dependency-completeness test, the peer pin, both runtime legs |
| `sideEffect` flag ignored | the manifest test |
| `zod` inlined | staging fails closed (third-party input) |
| Marker guard removed | the guard test (sentinel deleted) |
| In-repository guard removed | the guard test, through a symlink |
