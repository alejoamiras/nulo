# @nulo/tools-redirect

The Cloudflare Worker that keeps the retired tools hostnames answering. The tools app (the bridge, the faucet, the Send wizard) moved to [`alejoamiras/unleashed`](https://github.com/alejoamiras/unleashed) and its own Workers, while released wallets still open `https://tools.nulo.sh` (the fee card's `FEE_JUICE_BRIDGE_URL` default) and the landing still links `testnet.tools.nulo.sh`.

| Host | Redirects to |
|---|---|
| `tools.nulo.sh` | `https://unleashed-mainnet.alejo-amiras.workers.dev` |
| `testnet.tools.nulo.sh` | `https://unleashed-testnet.alejo-amiras.workers.dev` |

## Invariants

- **Fixed origins.** Each host maps to one hardcoded origin; only the request's path and query are carried, their percent-encoding intact, through `URL` setters that cannot replace the authority — so no path (`//evil`, a backslash, an encoded slash) and no header (`Host`, `X-Forwarded-Host`) can move the redirect elsewhere. Any other host is an empty 404, whatever its headers claim.
- **302 with `Cache-Control: no-store`.** The destination is temporary (a custom domain may replace the `workers.dev` names), so no browser may persist the redirect.
- **Two names only.** Two custom domains, `workers_dev: false`, `preview_urls: false`.

`test/worker.test.ts` pins all three against a hand-written copy of the map; `bun run test` / `bun run typecheck` run in the workspace battery. `test/live.test.ts` (`bun run test:live`, gated on `TOOLS_REDIRECT_LIVE=1`) probes the **deployed** hosts from outside, since synthetic requests cannot show what Cloudflare's ingress hands the Worker.

## Deploy

By hand, with `CLOUDFLARE_API_TOKEN` in the environment (the same scopes as [`infra/passkey-rp`](../passkey-rp/README.md#deploy)). `bun run deploy:dry` bundles without credentials.

**Before the first cut-over.** The unleashed Workers must be live and verified. The old origins keep each visitor's deposit journal and private-fuel salts in origin-bound `localStorage`, which the redirect makes unreachable: finish or claim any in-flight deposit and residual fuel claim on **both** hosts first. The tools Pages projects stay paused, and are kept, as the rollback.

Cloudflare refuses a Custom Domain over a record another project holds, and both names belong to those Pages projects until the cut-over, so the order is:

1. Comment out `routes`, `bun run deploy` (uploads the script, attaches nothing), and exercise it with `bunx wrangler dev`.
2. Detach both names from their Pages projects and delete their `*.pages.dev` CNAMEs (match the CNAME target, not the dashboard label).
3. Restore `routes` and `bun run deploy` again; the custom domains create their own records and certificates.

Between steps 2 and 3 no record points at a `*.pages.dev` target; resolvers may still serve the old CNAME from cache, which is harmless while the Pages projects exist and stay claimed.

**Rollback** is the same sequence reversed, with one difference: a deploy never detaches a Custom Domain (wrangler reconciles domains only when `routes` lists some, so dropping them leaves both attached). Remove the two Custom Domains explicitly — the Worker's Domains & Routes settings, or `DELETE /accounts/{id}/workers/domains/{domain_id}` — and confirm their records are gone from the zone's DNS; then add each name back as a custom domain on its Pages project and wait for Pages to report it active, which can take a while for a domain that left Pages.

Verify: `bun run test:live`, or by hand `curl -sI "https://tools.nulo.sh/a/b?c=1"` is a `302` with `location: https://unleashed-mainnet.alejo-amiras.workers.dev/a/b?c=1` and `cache-control: no-store`, and the same for `testnet.tools.nulo.sh` and the testnet origin.
