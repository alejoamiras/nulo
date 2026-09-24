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

**Comment-only edits leave the staged bytes unchanged.** Probe: add a line comment and a JSDoc block to `account-derivation.ts`, then compare the staged files. Every `dist/*` file and `package.json` hashed the same. The staged bytes move only with:

- a code change;
- a change to an Azguard first line;
- a file move (the module labels).

**`skipLibCheck` hides TS2834** (extensionless relative imports in a `.d.ts` under NodeNext). A lib check is not usable either: `@aztec/foundation`'s declarations fail it (`Buffer`, and an untyped `util`). So the fixture type-checks with `skipLibCheck`, and a separate assertion requires `.js` on every relative declaration import.

**Mutation probes (each restored afterwards):**

| Mutation | Caught by |
|---|---|
| Signing separator +1 | Bun and Node vector legs |
| Declarations written without the `.js` rewrite | the declaration-specifier test (the NodeNext type-check did **not** catch it) |
| `@aztec/*` not external | staging fails closed |
| Banner dropped | the Azguard test |
| A stray file in `dist/` | the allowlist test |

**Biome does not lint `scripts/`.** `biome.json` includes only `apps/`, `infra/`, `packages/` and `scripts/ci-cd/test-soak/`. The new scripts were checked with a scratch config that extends the root one: two functions over the complexity budget were split, then formatted.
