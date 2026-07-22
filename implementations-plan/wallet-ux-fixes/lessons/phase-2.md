# Phase 2 — import network fallback → the primary network (item 1a)

**Done.** New RPC `NetworkService.getPrimaryNetwork()` returns the profile's network whose chainId
matches the single `isPrimaryActive` seed (`PRIMARY_SEED = DEFAULT_SEEDS.find(s => s.isPrimaryActive)`
— Alpha in prod, Testnet under `VITE_NULO_E2E_DEFAULT_NET=testnet`). Wired through spec (Methods +
NetworkMethodSchemas), service (`rpcMethods` list + method), and client. `useProfileBootstrap`'s
no-active fallback now calls it instead of the stale hardcoded `kind === "testnet"` — so imported and
fresh profiles converge on the SAME primary for a given build, and e2e (which forces testnet-primary
because CI can't reach Alpha's RPC) is honored. Tail `?? networks[0]` for the primary-absent edge.

**Why single-sourced, not `kind === "mainnet"`:** `isPrimaryActive` deliberately flips to Testnet
under the e2e flag; a hardcoded mainnet check would blackhole imported e2e profiles on Alpha's RPC
and diverge from fresh. The service owns the policy so composable + seed can't drift (audit-mandated).

**Tests:** `service.test.ts` getPrimaryNetwork (matches the primary seed's chainId regardless of
insertion order; null when absent) — 54/54. `useProfileBootstrap.test.ts` (no-active → primary not
testnet; primary-absent → networks[0]) — 10/10; refactored the network-client mock to a hoisted,
reconfigurable stub so the fallback path is drivable.

**Env lesson (recurring):** the extension jsdom vitest transforms a 1.7 MB JSON artifact via a vite
alias; under tmpfs (/tmp RAM-backed) pressure that write fails with `EDQUOT (-122)` — NOT a code
bug. Fix: run with `TMPDIR` pointed at real disk (`/home/homelab/.cache/nulo-vitest-tmp`). Same
root cause as the e2e datadir work; the account-freeze/e2e skill already documents the tmpfs trap.

**Gate:** bootstrap 10/10 + service 54/54 (unit/component, discriminating on the flag-derived
primary) · lint + typecheck:all 0 · build:chrome 0. Dual-mode build smoke folded into the
consolidated e2e pass before the post-impl audit.
