# Phase 5 · C4 · the account-state filter

## The change

- `keepChainAccountState(data, chainId, tokenAddress)` in `tests/e2e/helpers/backup-export.ts`
  keeps only the `account-state` items of the funded account's chain, and throws unless a kept
  item lists the funded token's contract (case-insensitive), so the import still registers the
  contract the balance sync reads. It asserts nothing about what it removed.
- Both backup tests call it just before the re-seal. The roundtrip reads the funded account's
  chain from the backup's account row, as the integrity test already did for its doctored txs.
- Cleanup covers a failed launch in both tests: the profile directory is created, then the file
  written, and `try` opens right after; `ctx2` is assigned inside it and closed only when set, in
  an inner `try` whose `finally` removes the profile directory and the backup file.
- Comments: the integrity test's header, its arming-contract comment and its step 6 lose their
  plan, phase and finding references and keep what each leg proves; the roundtrip's cleanup
  comment loses its review reference. The `(P1 provenance)` test title stays.

## The probe (uncommitted; its source is in the build's scratch directory)

A temporary spec replaying the integrity test's export → filter → import path:

1. Before the export it reads the funded wallet's `nulo:core:networks@` rows (a backup carries
   none) and arms `interceptRpc(…, { kind: "refuse" })` on the fresh extension, before its import,
   for each distinct endpoint origin of every network whose chain is not the funded one, minus
   the sandbox's own origin and loopback.
2. **Fix run**: the filtered backup into a fresh extension through `importFullBackup`; counters
   read in a `finally`.
3. **Negative control**: the filtered backup plus a copy of the kept item relabelled with the
   chain of a public network whose endpoint is armed, re-sealed, into another fresh extension
   through `submitFullBackupImport`; it waits for the first hit or 60 s and reads the counters in a
   `finally`.

Chrome ran prover-ON and Firefox proverless, at retry 0; Chrome also logged each hit's target.
Origins only below: the public seeds' RPC path carries an API key.

| | Chrome | Firefox |
|---|---|---|
| Networks (chain, origin) | Local (0, the sandbox on loopback), Testnet (1816023401), Alpha V5 (4248422646), both public on `https://lb.drpc.live` | same |
| Armed origins | `https://lb.drpc.live` | same |
| Export's account-state items | chain 0: 10 contracts; Testnet: 9; Alpha V5: 7; no senders | same |
| Kept by the filter | chain 0, 10 contracts | same |
| Fix run | imported; 0 hits; no failure | imported; 0 hits; no failure |
| Negative control | relabelled to Testnet; first hit at 1.8 s; 1 hit (the service worker's preflight, refused); no failure | relabelled to Alpha V5; first hit at 1.9 s; 1 hit; no failure |
| Exit | 0 (202 s) | 0 (165 s) |

The exports did carry public recovery material on both browsers (both public nodes answered at
export), so the fix run's zero is not an export that happened to hold none. I6 holds: with those
items gone, the restore dialed no public origin.

## Gate

- `bun run lint`: exit 0 (29 warnings and 3 infos, none in a file this branch touches).
  `bun run typecheck:all`: exit 0.
- The probe, on each browser: exit 0, results in the table above.
- The flake bar, both files in one run, at retry 0 with `NODE_OPTIONS=--dns-result-order=ipv4first`
  and the import stage recorder on:

  | Browser | Run 1 | Run 2 | Run 3 |
  |---|---|---|---|
  | Chrome (prover-ON) | exit 0, 4 passed (187 s) | exit 0, 4 passed (242 s) | exit 0, 4 passed (355 s) |
  | Firefox (proverless) | exit 0, 4 passed (208 s) | exit 0, 4 passed (187 s) | exit 0, 4 passed (186 s) |

  All 12 recorded imports ran `restoring:*`, `finalizing`, `chain-sync` and `finished` in 6 to
  10 s; none reached the errors screen.
- `bun run e2e:reap`: exit 0, nothing to reap.

### Attempt log

1. Firefox bar, first invocation: run 1 exited 86 after 506 s with no test run. The local Aztec
   node did not answer its health check within 90 s; the host's five-minute load average was 721
   on 192 cores at the time. The node's `Address already in use (os error 98)` line is not the
   cause: every green boot in this build prints it too. `e2e:reap` found nothing owned. The bar
   was restarted from run 1.
