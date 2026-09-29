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
   bounded. The fallback's ephemeral range holds no bad port here, nor under the Linux (32768+)
   or macOS (49152+) defaults.

The set is spelled out rather than imported: undici's public entry (`index.js`) does not export
`badPorts`, and no workspace declares undici, so importing its internal file would be a phantom
dependency under the isolated linker.

Committed as `2829f9a4`. Codex's round 4 then found the test too weak and the list one entry
short (`post-impl.md`), and both were fixed:

- **The test.** It asserted only the result, so with 10080 held by another process a draw
  without the skip spent its 256 tries on refused binds, took the `listen(0)` fallback, and
  passed. It now also spies on `Server.prototype.listen` and fails if any bind tries 10080.
- **The list.** The Fetch standard's table (`fetch.bs` on `whatwg/fetch` main, read 2026-09-29)
  has 83 entries: undici 7.29.0's 82 and 0. The set now holds 0 too, so it equals the table its
  comment cites. No behaviour change: no candidate is ever 0.

## Gate

The first version of the test, at `2829f9a4`:

- Red, before the skip: `bun --bun vitest run scripts/e2e/resolve-ports.test.ts` exit 1,
  `AssertionError: expected 10080 not to be 10080` at the new case, the other 4 passing.
- Green, after it: exit 0, 5 passed.

The final test. The probe copied the draw without the skip line (one line removed) next to the
real file, pointed each test version at it, ran the case alone, and deleted the copies after.
"Held" is a separate process listening on 127.0.0.1:10080 for the run:

| Test | Draw | 10080 | Exit | Result |
|---|---|---|---|---|
| first version | no skip | held | 0 | passes: the weakness codex reported |
| final | no skip | held | 1 | `expected [ 10080, 10080, 10080, 10080, …(253) ] to not include 10080` |
| final | no skip | free | 1 | `expected [ 10080 ] to not include 10080` |
| final | with skip | held | 0 | passes |
| final | with skip | free | 0 | passes |

- The whole file on the final test: exit 0, 5 passed, on Bun (`bun --bun vitest`) and on Node.
- `tsc` over `resolve-ports.ts` and its test with Node's types (no gate typechecks `scripts/`):
  exit 0.
- The set against the Fetch standard's table: 83 entries each, none on one side only. Against
  undici 7.29.0's `badPorts`: the same but 0.
- `bun run lint`: exit 0 (warnings only, none in `resolve-ports*`). `complexity-baseline check OK`.
- `bun run typecheck:all`: exit 0, every one of the 14 `@nulo/*` workspaces.

The network legs of P6 draw every run's five ports through the changed function, on both
browsers, at the final code revision.
