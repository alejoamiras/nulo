# The actual bug — `handleSetActive` route race

## TL;DR

`packages/extension/src/popup/pages/settings/networks/[id].vue:47-57` had this code:

```ts
const handleSetActive = async () => {
  if (!network.value) return
  if (isActive.value) return
  try {
    await managers.network.setActiveNetwork(network.value.id)
    appStore.network = network.value     // ← BUG: network.value may now be undefined
```

`network` is a computed off `route.params.id`. The e2e test helper `switchToNetwork` clicks "Set as active" then **immediately** forces `window.location.hash = "/popup/general"`. The route change makes `route.params.id` undefined, which makes `network.value` undefined, which makes `appStore.network` undefined.

The popup's app.vue network watcher then `early-returns` on `!appStore.network`. The header chip never updates. The test waits 30s for the header to show the new network name. Timeout. Cascade: 22 different "cluster A" tests that depended on the `dappConnectedExtension` fixture (which calls `switchToLocalNetwork` in setup) all looked like wallet RPC dispatch bugs but were really fixture hangs.

## The 4-line fix

```ts
const handleSetActive = async () => {
  if (!network.value) return
  if (isActive.value) return
  const target = network.value          // ← snapshot BEFORE the await
  try {
    await managers.network.setActiveNetwork(target.id)
    appStore.network = target
```

Snapshot the reactive value before the await. Everything else stays the same.

## Why this took so long to find

1. **The symptom looked like a RPC bug.** "Wallet doesn't respond to 2nd dApp call" was what the failing-test outputs said. We chased that for hours.
2. **22 tests failing in the same way is more diagnostic than 1.** When 22 dApp tests fail with the same timeout signature, you assume "wallet's RPC dispatcher is broken." When it's actually 22 tests cascading off ONE fixture hang, the diagnostic-by-quantity is misleading.
3. **The bug only manifested in the e2e fixture.** A real user clicking "Set as active" wouldn't navigate away mid-RPC. So this bug never surfaced in manual QA.
4. **Probes were essential.** Without the `WATCH-IN` probe in `app.vue:97-127` we couldn't see that `appStore.network` was becoming `undefined` after the click. The diagnostic dump showed `WATCH-IN` firing on popup mount, then 30 seconds of probe silence — that asymmetry pointed at "watcher returned early."

## What this implies for similar bugs

- **Vue computeds bound to route params are reactive timebombs in async handlers.** Any `await` between reading and writing the computed can let a router event in.
- **e2e helpers that navigate while RPCs are in flight will surface races that manual testing never sees.** This is a feature, not a bug, of the e2e harness — but it also means the test helper's navigation timing is part of the contract.
- **Cluster taxonomies in failure reports can be misleading.** A "cluster" of identical-looking failures might be one bug surfacing through many call paths.

## Discovery sequence

1. Tier A plan named 4 clusters with 4 fix candidates. Codex (xhigh) audited it, opus subagent audited it, all approved with deltas.
2. Implemented probes per the consolidated plan. Ran them. All probes fired correctly on a passing diagnostic test in isolation — falsifying the plan's primary hypotheses (cluster A's "wallet RPC dispatch broken" and cluster B's "NuloAccount.new is slow at 30s" — actually 23ms).
3. Ran the full suite with probes on. Captured probe trace at moment of failure via on-failure dump in `switchToNetwork`.
4. Sent the probe trace to codex deep-dive. Codex traced the popup code path and identified the `network.value` race in `handleSetActive` in one round.
5. 4-line fix. Suite went from 36 failures → 2 failures.

## What the fix didn't fix

After landing this fix, 2 more failures surfaced (`batch-mixed` + `meta-batch`) that were NEVER caused by the race — they were a separate, pre-existing functional issue: the playground batch payloads still included `getAccounts` legs, which had become CapabilityNotGrantedError-throwing pre-grant. See commit `5e51325` for that fix.

Plus a long-tail of load-induced flakes (rotating victims under cumulative aztec/anvil sandbox load) mitigated by `retry: 2` at the network vitest config level.
