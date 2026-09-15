# @nulo/passkey-rp

The Cloudflare Worker behind `passkey.nulo.sh`, the WebAuthn relying-party host for Nulo wallet passkeys (`RP_ID` in `apps/extension/src/wallet/services/passkey/spec.ts`; the threat model is in `SECURITY.md` § Passkey RP ID).

## Invariants

- **Content-less.** One static page, `Content-Security-Policy: default-src 'none'; … sandbox`, `Permissions-Policy` denying WebAuthn to the page itself. Never application code, never a script.
- **No `/.well-known/webauthn`.** The extension authorizes the RP ID through its host permission; that file would enable related-origin authorization for whatever origins it listed.
- **One name.** A single custom domain, `workers_dev: false`, `preview_urls: false`. No wildcard route or record: every `*.passkey.nulo.sh` descendant stays unregistered (NXDOMAIN) — WebAuthn lets any such descendant assert with the credential, so "content-free" is enforced by not existing.

`test/worker.test.ts` pins all three (the exact policy headers on every status); `bun run test` / `bun run typecheck` run in the workspace battery.

## What the Worker cannot pin (zone level — verified 2026-09-15, re-verify after any zone change)

Cloudflare answers some paths on every proxied hostname itself — `/cdn-cgi/trace` (text/plain) and, when a WAF or bot rule challenges a request, a challenge page that runs Cloudflare's script in place of the Worker's response. That content is Cloudflare's, not an attacker's, and the same edge already terminates this host's TLS, so it adds no trust root; it is still script on the RP origin, so keep it off. On this Free-plan zone that means **Bot Fight Mode off** (Security → Bots) — a WAF *Skip* rule cannot exempt a host from it; only Super Bot Fight Mode, on paid plans, takes hostname exclusions — and no WAF custom or rate-limiting rule whose action challenges `passkey.nulo.sh` (for those, a Skip rule scoped to the host makes the exemption explicit). HTML-rewriting features (Rocket Loader, Email Obfuscation, Automatic HTTPS Rewrites, Mirage) inject `<script>` tags the page's CSP refuses to execute — disable them for the host anyway (Configuration Rule on the hostname) so nothing depends on the browser. Neither setting is readable with a Workers-scoped token, so this is a zone check, not a test. Current state of zone `nulo.sh`: Bot Fight Mode off; no WAF custom, rate-limiting or legacy firewall rules; one Configuration Rule on `(http.host eq "passkey.nulo.sh")` — `rocket_loader`, `email_obfuscation`, `automatic_https_rewrites`, `mirage`, `bic` (Browser Integrity Check, which can substitute a block page for the Worker's response) all `false`, `polish` `off`. Audit it with a token carrying zone `Zone Settings: Read`, `Bot Management: Read`, `Zone WAF: Read`, `Config Settings: Read`: `GET /zones/{zone}/bot_management` (`fight_mode`), the `http_request_firewall_custom` / `http_ratelimit` phase entrypoints (absent or no challenge action), and the `http_config_settings` entrypoint (the rule above, enabled).

## Deploy

`bun run deploy` with `CLOUDFLARE_API_TOKEN` in the environment — a token scoped to the account (Workers Scripts: Edit, Account Settings: Read) and the `nulo.sh` zone (Workers Routes: Edit, DNS: Edit). The custom domain creates its own proxied `AAAA 100::` record and certificate. Without the zone's Workers Routes permission wrangler still uploads the script but fails reconciling the custom domain; the domain can then be attached once through the account-level domains API (`PUT /accounts/{id}/workers/domains`), which needs only the script and DNS permissions. `bun run deploy:dry` bundles without credentials.

Verify: `curl -sI https://passkey.nulo.sh/` shows the exact policy headers; `curl -s -o /dev/null -w '%{http_code}' https://passkey.nulo.sh/.well-known/webauthn` is `404`; `curl -sI http://passkey.nulo.sh/` is a `301` to https; `dig x.passkey.nulo.sh` reports `status: NXDOMAIN` (an empty `+short` also matches a record of another type) and the zone's DNS table holds no `*.passkey` or `<name>.passkey` record; `curl -sI https://passkey.nulo.sh/cdn-cgi/trace` is `text/plain`.
