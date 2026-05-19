# Codex audit — parallel-e2e-isolation plan v1

Session id: `019e0cf3-1043-7be3-a44d-e583b0bb9e64`
Reasoning effort: `xhigh`

## Verdict
> Directionally right, but its reuse/ownership model is unsafe and its cold-start assumption is false.

## Critical
- **"Already running" reuse is wrong in the current lifecycle.** `tests/e2e/global-setup.ts` kills any aztec/playground it started during teardown — clean reruns do *not* reuse; they cold-start every time. The only thing reuse buys today is accidentally attaching to a foreign/stale process on the same port.
- **Health-based reuse is not isolation.** `checkNodeHealth(LOCAL_NODE_URL)` only proves "something answers here," not "this is *my* worktree's sandbox." If agent selection collides, one agent silently talks to another agent's aztec/playground.

## High
- **Agent 0 on defaults is a real conflict.** :8545, :8080, :5174 are all common. Problem is the base ports, not the offset.
- **Build-time URL injection is acceptable, but the rejection of runtime is overstated.** The seed is created in popup init via `getOrInitNetworks()`, AFTER profile creation — runtime override written in `launchExtension()` before `registerProfile()` is viable. Build-time-only still works but **requires a fail-fast guard**: stale builds with mismatched baked URL must error out.
- **Reuse requires aztec + anvil as a matched pair.** Persisting only aztec is useless at best, dangerous at worst.

## Medium
- **getPort() is racy** — "found a free port" ≠ ownership. Reserve via bind-until-spawn, not probe-and-release.
- **Local-network URL match should normalize** — literal `===` is fragile (trailing slash, 127.0.0.1 vs localhost). Use the existing URL normalizer.
- **`process.kill(-pid, "SIGTERM")` needs `SIGKILL` escalation** after a wait window.
- **Identity check stronger than HTTP** needed for playground + anvil.

## Things that look fine
- Facts about the service.ts hardcodes, env plumbing, `fileParallelism: false`.
- Path-scoped `pkill` across sibling worktrees.
- Chrome profile isolation, `.test-config.json`, PXE temp dirs.
- Keeping Local Network at chainId=0 while changing only the RPC URL.

## Single biggest change
> Replace "reuse if healthy on this port" with **"reuse only if I own this exact service set"** via a per-worktree lockfile/pidfile recording: ports, PIDs/process-groups, and the baked local RPC URL.
