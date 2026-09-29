# Phase 8 · C7 · the port draw skips Fetch's bad ports (addendum)

## The mechanism, reproduced here

- A scratch probe (uncommitted) bound a raw TCP listener on a loopback port, then opened Node's
  global `WebSocket` to it, the constructor `bidi-attach.ts:95` uses. On Node 24.21.0 (built-in
  undici 7.29.1) the listener counted 1 connection on 10079, **0 on 10080** and 1 on 10081. The
  probe only connects after its own bind succeeds, so it never reaches another run's port.
- This host's ephemeral range is 32768–60999, so the static window is [10000, 32256): 22,256
  ports, of which 10080 is the only bad port. Each draw hits it with probability 1 in 22,256, and
  a Firefox launch makes two draws (`spawnGeckodriver`: the HTTP port and `--websocket-port`).
  geckodriver's HTTP port is spoken to over Node's fetch, which refuses bad ports as well.

## The change

1. `staticWindow(floor)` now holds the window's bounds, exported, with no change in behaviour.
2. The unit test (below), run against the unfixed draw: red.
3. `FETCH_BAD_PORTS`, a named set, and `if (FETCH_BAD_PORTS.has(candidate)) continue` in the
   draw. A skipped candidate spends one of the 256 tries, so the `listen(0)` fallback is still
   bounded; the fallback draws from the ephemeral range, which holds no bad port.

The set is spelled out rather than imported: undici's public entry (`index.js`) does not export
`badPorts`, and no workspace declares undici, so importing its internal file would be a phantom
dependency under the isolated linker.

## Gate

- Red, before the skip: `bun --bun vitest run scripts/e2e/resolve-ports.test.ts` exit 1,
  `AssertionError: expected 10080 not to be 10080` at the new case, the other 4 passing.
- Green, after it: exit 0, 5 passed.
- The set against `lib/web/fetch/constants.js` of the installed undici 7.29.0: 82 entries each,
  none on only one side, equal.
- `bun run lint`: exit 0 (warnings only, none in `resolve-ports*`). `complexity-baseline check OK`.
- `bun run typecheck:all`: exit 0, every one of the 14 `@nulo/*` workspaces.

The network legs of P6 draw every run's five ports through the changed function, on both
browsers, at the final code revision.
