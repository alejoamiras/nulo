# Competing outline (B) — "flip everything at once, isolate by config, not by package"

Same goal as [plan.md](plan.md); a deliberately different angle so the audits argue plan-space, not one author's draft. Written by the same author; the audits see both.

## Thesis

The probes show the runtime difference is ONE interop rule and nothing else. A package-by-package rollout therefore buys ceremony, not information: after Phase 0 fixes the rule, every suite is already green on Bun on a single run. Outline B spends the effort on a *stronger single gate* instead of six sequential ones.

## Shape

1. **Foundation (same as plan.md Phase 0)**: root `vitest.base.ts` with `deps.interopDefault: false`, minimal configs for the config-less workspaces, the soak tool, Node baselines.
2. **One flip commit**: switch `bunfig.toml` `[run] bun = true` — every `bun run <script>` executes node-shebang bins on Bun. No package.json edits at all. Vite (`vite build`, `vite dev`), storybook, puppeteer e2e and every other Node-shebang tool flip too.
3. **One gate**: N=30 soaks for every workspace + N=10 full extension + N=30 shard, ALL under Bun, compared to the Node baselines; plus `bun run audit:vue`, `bun run test:e2e` (smoke, now also under Bun), one network-e2e shard solo, `bun run build:faucet`, `bun run --cwd apps/extension build-storybook`.
4. **Two PRs stacked**: PR-1 foundation (inert on Node; can merge alone), PR-2 the `[run] bun` flip + docs.

## What it trades

- **Pro**: one knob, no eleven-line script diff to maintain, `test:watch`/`test:e2e`/root `test:e2e:*`/`agent.sh` all consistent by construction; the isolated-linker world (Arc B) needs no per-package thinking.
- **Con (why plan.md rejects it)**: it silently widens Arc C into Arc D's territory — Vite builds, the crx plugin, storybook, puppeteer, the Aztec CLI helpers and the e2e supervisor all move runtime in the same commit, against the dossier's explicit "e2e configs stay on Node this arc" and "Vite is not replaceable" fences. A red anywhere in that surface blocks the whole flip, and the required `smoke-e2e-status` / `network-e2e-status` gates become the canaries for a test-runner change. Reversal is one line but the blast radius while it is on is the entire toolchain.
- **Middle ground the audit may prefer**: keep per-script `--bun` (plan.md) but collapse Phases 1–4 into one flip commit gated by the full soak matrix, since the probes already de-risked the order. Cost: a failing soak in a late package blocks the earlier, already-proven ones from landing; benefit: fewer phase gates, one lessons file.

## Where B is strictly better and plan.md should steal it

- Running the **smoke e2e once under Bun as an information probe** (not a gate) tells Arc D what it will face for free.
- Stacking the foundation as its own PR lets the interop fix + soak tool land even if a late flip stalls on a real Bun defect.
