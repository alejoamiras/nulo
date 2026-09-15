# @nulo/passkey-rp

The Cloudflare Worker behind `passkey.nulo.sh`, the WebAuthn relying-party host for Nulo wallet passkeys (`RP_ID` in `apps/extension/src/wallet/services/passkey/spec.ts`; the threat model is in `SECURITY.md` § Passkey RP ID).

## Invariants

- **Content-less.** One static page, `Content-Security-Policy: default-src 'none'; … sandbox`, `Permissions-Policy` denying WebAuthn to the page itself. Never application code, never a script.
- **No `/.well-known/webauthn`.** The extension authorizes the RP ID through its host permission; that file would enable related-origin authorization for whatever origins it listed.
- **One name.** A single custom domain, `workers_dev: false`, `preview_urls: false`. No wildcard route or record: every `*.passkey.nulo.sh` descendant stays unregistered (NXDOMAIN) — WebAuthn lets any such descendant assert with the credential, so "content-free" is enforced by not existing.

`test/worker.test.ts` pins all three; `bun run test` / `bun run typecheck` run in the workspace battery.

## Deploy

`bun run deploy` with `CLOUDFLARE_API_TOKEN` in the environment — a token scoped to the account (Workers Scripts: Edit, Account Settings: Read) and the `nulo.sh` zone (Workers Routes: Edit, DNS: Edit). The custom domain creates its own proxied `AAAA 100::` record and certificate. Without the zone's Workers Routes permission wrangler still uploads the script but fails reconciling the custom domain; the domain can then be attached once through the account-level domains API (`PUT /accounts/{id}/workers/domains`), which needs only the script and DNS permissions. `bun run deploy:dry` bundles without credentials.

Verify: `curl -sI https://passkey.nulo.sh/` shows the policy headers; `curl -s -o /dev/null -w '%{http_code}' https://passkey.nulo.sh/.well-known/webauthn` is `404`; `dig +short x.passkey.nulo.sh` is empty.
