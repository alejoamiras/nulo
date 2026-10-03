# Arc 9, network-endpoints: lessons log

## Plan

- **Plan audit:** Codex (GPT-6 Astra, xhigh): REVISE; independent Opus panelist: REVISE. Seven items were adopted; the batch plan's Decisions block lists them.
- **NBSP is not one case.**
  - zod 4 trims Unicode space before the refine; WHATWG does not.
  - A leading NBSP, or one right after the host, passes the schema and fails the adapter.
  - A trailing NBSP after a path or query passes both: the adapter reads it as URL data.
  - Probed on Bun at the base; Phase 1 pins all three shapes in both tables.

## Build

- **Phase 1 passed on the unchanged code.** Seven files: the schema and adapter tables (40 and 41 tests), the node-status table and the identity, label and missing-primary rows in the network service (101), the `getReceiptFee` rows, and the three popup files (16, 9, 1).
  - The popups' auto-imported composables are not auto-imported under vitest: the Edit popup tests `vi.stubGlobal` the real `useFormState` and `usePopupEntity`.
  - A rejection from a submit button's handler reaches the app's `errorHandler`, so `mount(…, { global: { config: { errorHandler } } })` is how the tests see Edit's thrown chain-id read.
  - The Edit popup's form unmounts with its network (`v-if="endpoint"`), so the lazy-read rows read the copy after putting the network back.
- **Phase 2 changed no existing test file.** It adds only `packages/wallet-core/src/utils/rpc-url.test.ts`.
- **The catch boundary was unpinned.** Moving the profile and row checks inside the status probe's `try` survived every Phase 1 test. A pin (a row another profile owns rejects on both status methods) was added in its own commit; it passes on the base code too.
- **Mutation checks**, in scratch with files restored from copies (never with git):

  | Mutation | Failing tests |
  |---|---|
  | `getNodeStatus` passes `"applied"` | 1, the BUG PIN row |
  | `probeNodeStatus` passes `"ignored"` | 1, the BUG PIN row (its probe column) |
  | the carve-out runs before the probe | 1, the local-unreachable row |
  | `getNodeStatus` probes with `probeChainId` | 2, the spy rows |
  | the identity checks' order is swapped | 2, the both-mismatch rows (add, update) |
  | `findPrimaryEndpoint` falls back to `endpoints[0]` | 7, every dangling row |
  | the leaf admits `127.0.0.2` | 2, one per table |
  | the leaf admits `ws:` | 2, one per table |
  | the leaf drops `[::1]` | 4, both IPv6 rows per table |
  | userinfo moves into the leaf | 4, the adapter's userinfo rows |
  | userinfo leaves the schema | 4, the schema's userinfo rows |
  | one adapter reason is reworded | 5, the adapter table |
  | the ladder's order is swapped | 2, the both-prefix rows |
  | `===` becomes `includes` | 2, the near-miss rows |
  | Edit gets New's duplicate copy | 2, Edit's duplicate rows |
  | the chain id is read eagerly | 1, Edit's lazy duplicate row (New's `?.` makes an eager read invisible) |
  | New reads the chain id with `.` | 1, New's lazy mismatch row |
  | Edit reads the chain id with `?.` | 1, Edit's lazy mismatch row |
  | `getReceiptFee` falls back to `getNode` | 2, both its rows |
  | `EditNetworkPopup` throws on a dangling primary | 1, its row |
  | the profile and row checks move inside the probe catch | 1, the ownership pin |

  A control, `EditNetworkPopup` reading `endpoints[0]` for a dangling primary, survives as expected: the URL field it fills is never rendered.
- **Engine error text** for a strict lookup on a row with no `endpoints` array, probed on Bun 1.4.2, Chrome and Firefox (puppeteer):
  - Chrome: `Cannot read properties of undefined (reading 'find')` at every site, before and after.
  - Bun and Firefox name the expression (`'active.endpoints.find'`, `active.endpoints is undefined`), so the two sites whose local name is not `network` (`activateSeededLocked`'s `active`, `EditNetworkPopup`'s `networkToEdit.value`) now read `network.endpoints`.
  - Neither is reachable from data. `active` is a seed built in code. `EditNetworkPopup`'s rows come through the client, whose result schema requires a non-empty array. The storage row codec also requires the array, and a backup goes through `NetworkSchema`. Every `network`-named site keeps its text.
- **Generated files and outputs unchanged.**
  - `auto-imports.d.ts` and `components.d.ts` are byte-identical after the build.
  - `THIRD-PARTY-NOTICES.txt` is byte-identical between the base and head builds, Chrome and Firefox.
  - The staged npm packages are identical (`diff -r`) with and without the new barrel line: Bun's bundler drops the unused leaf.
- **Local gates at the head:** `lint`, `typecheck:all`, `test:all`, `test:ci-gating` and `audit:vue` exit 0. The smoke file `tests/e2e/endpoints.test.ts` passes 6/6 on Chrome and on Firefox.
- **`test:release` exits 1 on the same three environmental failures as arc 7:** the `zip-reproducible` tests, because `zip` is not installed on this machine. The other 161 tests pass.

## Code review

- **Round 1** (Codex, GPT-6 Astra, xhigh): NOT CONVERGED, one should-fix and one nit, both adopted.
  - **Should-fix, adopted: the status skeleton changed the await shape.** Returning the async helper added a settlement hop, and the async probe callback another. Measured after the probe resolves, on the shared service test setup: base 4 and 2 microtasks (getNodeStatus, probeNodeStatus), skeleton 5 and 4, inline again 4 and 2. Both bodies stay inline because an extracted async body cannot keep the base's await shape. Only the synchronous `findPrimaryEndpoint` and `isLocalNetworkTarget` helpers are shared. `getNodeStatus` still passes no kind hint (B-09 as at base).
  - **Nit, adopted:** the adapter's `isAllowedRpcUrl` doc and `NewEndpointPopup.test.ts`'s header are now one sentence each.
  - Restacked onto `harden-dedupe` at `169bed04` (arcs 6 and 8) with no conflicts.
  - The status mutants were rerun on the inline bodies, and all 5 were killed: the kind applied in getNodeStatus, the kind ignored in probeNodeStatus, the carve-out before the probe, and the checks moved inside the catch on each method.
  - **Re-proved at the new head:**
    - `lint`, `test:all`, `test:ci-gating` and `audit:vue` exit 0.
    - `test:release` exits 0, 164 pass, with a user-local `zip`: the Ubuntu `zip` .deb was fetched with `apt-get download` and unpacked with `dpkg -x` into a scratch dir on PATH for that run only, with no sudo and no system install.
    - `THIRD-PARTY-NOTICES.txt` is identical on both browsers.
    - Shots: base `169bed04` vs the new head, 44/44 identical; stability on the head, 44/44 identical. The same fixture and port discipline was used, and no registry row or process was left.

## Screenshots

- **A fake node, no proxy.** `ne-fixture.ts`, beside the harness, answers the SDK's batched `aztec_getNodeInfo` with the identity its path names (`/l1/<n>/rv/<n>`). It drives the real popup, client, service and adapter, because `http://127.0.0.1` is already allowlisted and in the manifest's host permissions.
  - Its wrapper claims one port in the host registry under the lock and binds loopback only.
  - It starts the fixture detached in its own process group and keeps the same URL for the base, head and stability captures.
  - On exit it kills that group only, reaps it and drops its registry row; both runs left no row and no process.
- **The Local Network forces the composite to 0,** so wrong chain is an L1 mismatch (`/l1/1/rv/1`), and its copy reads "chain 0".
- **Result:** 11 surfaces (Edit network; New and Edit endpoint at rest, invalid, unreachable, wrong chain, duplicate), each copy asserted before the shot. Chrome 152 and Firefox 153, dark and light: 44/44 identical base vs head, and 44/44 identical in the stability pass.
- **Waits:** the shared harness lock was held by arc 4 for about 10 minutes per run; the wrapper retried every 60 s.
