# @nulo/tools-redirect

The Cloudflare Worker that keeps the retired tools hostnames answering. The tools app (the bridge, the faucet, the Send wizard) moved to [`alejoamiras/unleashed`](https://github.com/alejoamiras/unleashed) and its own Workers, while released wallets still open `https://tools.nulo.sh` (the fee card's `FEE_JUICE_BRIDGE_URL` default) and the landing still links `testnet.tools.nulo.sh`.

| Host | Redirects to |
|---|---|
| `tools.nulo.sh` | `https://unleashed-mainnet.alejo-amiras.workers.dev` |
| `testnet.tools.nulo.sh` | `https://unleashed-testnet.alejo-amiras.workers.dev` |

## Invariants

- **Fixed origins.** Each host maps to one hardcoded origin; only the request's path and query are carried, re-serialised through `URL`, so no path (`//evil`, a backslash, an encoded slash) and no header (`Host`, `X-Forwarded-Host`) can move the redirect elsewhere. Any other host is an empty 404.
- **302 with `Cache-Control: no-store`.** Browsers keep a 301 indefinitely; the targets are not final (a custom domain may replace the `workers.dev` names).
- **Two names only.** Two custom domains, `workers_dev: false`, `preview_urls: false`.

`test/worker.test.ts` pins all three against a hand-written copy of the map; `bun run test` / `bun run typecheck` run in the workspace battery.

## Deploy

By hand, with `CLOUDFLARE_API_TOKEN` in the environment (the same scopes as [`infra/passkey-rp`](../passkey-rp/README.md#deploy)). Cloudflare refuses a Custom Domain over a record another project holds, and both names belong to the paused tools Pages projects until the cut-over, so the order is:

1. Comment out `routes`, `bun run deploy` (uploads the script, attaches nothing), and exercise it with `bunx wrangler dev`.
2. Detach both names from their Pages projects and delete their `*.pages.dev` CNAMEs (match the CNAME target, not the dashboard label).
3. Restore `routes` and `bun run deploy` again; the custom domains create their own records and certificates.

Between steps 2 and 3 the names do not resolve at all, which is the point: they never point at an unclaimed `*.pages.dev` target. Rollback is re-attaching the names to Pages. `bun run deploy:dry` bundles without credentials.

Verify: `curl -sI "https://tools.nulo.sh/a/b?c=1"` is a `302` with `location: https://unleashed-mainnet.alejo-amiras.workers.dev/a/b?c=1` and `cache-control: no-store`; the same for `testnet.tools.nulo.sh` and the testnet origin.
