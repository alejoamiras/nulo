# Follow-ups

Open follow-ups lifted out of closing plans, one entry each, or a pointer to the GitHub issue that owns it. Read when planning; delete an entry when it resolves. A plan never closes while it still owns an open follow-up.

- **P1, the first release after the tools extraction** (from [tools-extraction](tools-extraction/plan.md), 2026-09-28). The next `release: promote dev → main` carries the tools removal, #711 and #713 to `main`, and with them the first production build of `nulo-landing` from `main` with the routes-free config. After `attach-assets`, re-run that build in the Cloudflare dashboard, confirm it succeeded, and check that `curl -s https://nulo.sh` links `releases/tag/v<version>` and that `curl -sI` returns every header in `apps/landing/public/_headers`. Delete this entry when it passes.
- **The gas link and USDC on mainnet** (owner UI calls, 2026-09-28). The fee card's get-gas link opens unleashed's testnet app on every network, on its `workers.dev` host; the mainnet USDC seed is the retired bridge's token. Revisit when unleashed has its own domain or a public mainnet bridge.
