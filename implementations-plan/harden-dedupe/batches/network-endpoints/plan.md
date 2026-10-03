---
plan: harden-dedupe / network-endpoints (arc 9 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/09-network-endpoints, stacked on harden-dedupe
---

# network-endpoints: one primary-endpoint lookup, one status skeleton, one transport rule

Finding Q-04 (a) service and popup sites, (b), (c), (d) and (e), from `audit/quality/2026-09-30-dedup-high/`. The primary endpoint is looked up by hand at 11 sites outside execution, the two node-status methods share a drifted skeleton, the endpoint identity guard is written twice, the RPC transport allowlist exists in the extension and again in aztec-runtime, and the two endpoint popups carry the same error ladder. This batch states each once. Every site keeps its exact acceptance set, missing-primary policy, error text and copy. B-09 stays live behind a named argument. Q-04 (a)'s four execution sites belong to estimate-reuse.

Paths below are under `apps/extension/src/` unless they start with `packages/` or `implementations-plan/`.

## Outcome & Quality Bar

- **For whom:** whoever next changes endpoint policy: a new transport rule, a new missing-primary case, a status fix such as B-09. Today the transport rule is two copies that already disagree on userinfo, and the status methods disagree on the local carve-out.
- **Excellent:**
  - One `findPrimaryEndpoint`; each caller keeps its own missing-primary policy, and a test pins each policy.
  - One status skeleton, where B-09 is a single argument the alignment arc can flip.
  - One transport rule in a wallet-core leaf. Each site keeps its own wrapper: the schema still refuses userinfo, the adapter still accepts it, and the adapter's refusal reasons stay byte-identical.
  - The popups' copy is byte-identical, pinned per popup and per error before the refactor, and the endpoint popups are pixel-identical in the zero-diff harness.
- **Good enough:** the add/update preambles (peek, probe outside the lock, locked re-read) stay inline, and so does `getNode`'s own throw.

## Architecture & Implementation

Read on `harden-dedupe` at `7450928c`, which includes arcs 1, 2, 3, 5 and 7.

### (a) Primary-endpoint lookup: the sites this arc owns

New in `wallet/services/network/spec.ts`, beside `networkInfoFrom`:

```ts
/** The endpoint `primaryEndpointId` names, or `undefined`; each caller owns its missing-primary policy. */
export function findPrimaryEndpoint(network: Network): NetworkEndpoint | undefined {
	return network.endpoints.find((e) => e.id === network.primaryEndpointId)
}
```

| site | today | policy kept | after |
|---|---|---|---|
| `network/service.ts:340` (`activateSeededLocked`) | `…find(…)!` | non-null assertion | `findPrimaryEndpoint(active)!` |
| `:415` (`resolveVerifiedL1ChainId`) | `…find(…) ?? network.endpoints[0]` | fall back to the first endpoint | `findPrimaryEndpoint(network) ?? network.endpoints[0]` |
| `:587` (`setActiveNetwork`) | `if (primaryEndpoint)` cache the node | skip the cache, still emit | `findPrimaryEndpoint(network)` |
| `:737`, `:753` (status) | `if (!primary) return Inactive` | `Inactive`, no node built | inside the shared skeleton, (b) |
| `:775` (`getNode`) | throws `Network ${id} has no primary endpoint` | same throw, same text | `findPrimaryEndpoint(network)`, throw line kept |
| `:849-855` (`getNetworkInfo`) | verbatim copy of `networkInfoFrom` | same throw text | `return networkInfoFrom(await this.getNetwork(networkId))`, after the existing `ensureInitialized` |
| `spec.ts:92-96` (`networkInfoFrom`) | throws | same | `findPrimaryEndpoint(network)` |
| `spec.ts:106-108` (`primaryEndpointUrl`) | `network.endpoints?.find(…)?.rpcUrl` | `undefined` when `endpoints` is nullish | `network.endpoints == null ? undefined : findPrimaryEndpoint(network)?.rpcUrl` |
| `incoming-transfer/service.ts:536-538` (`getReceiptFee`) | `endpoints?.find`, `null` when absent, then `getNodeForUrl(primary.rpcUrl)` | `null`, never the chain node | `const rpcUrl = primaryEndpointUrl(network)`; `if (rpcUrl === undefined) return null`; `getNodeForUrl(rpcUrl)`; its comment stays |
| `popup/components/popups/EditNetworkPopup.vue:58` | `networkToEdit.value?.endpoints.find(…)` | `""` when no network or no primary | `networkToEdit.value && findPrimaryEndpoint(networkToEdit.value)` |

- **Strictness per site.** `findPrimaryEndpoint` keeps today's non-optional `.endpoints`, so the nine strict sites still throw `TypeError` on a missing array. The two lenient sites keep their nullish guard. Both codecs require the array (`spec.ts:72`, `:193`), so that branch is reachable only from test stubs, which the incoming-transfer scenarios use (`incoming-transfer/service.scenarios.test.ts:210`).
- **`getReceiptFee`** differs only for a found endpoint whose `rpcUrl` is not a string, which neither codec admits.
- **`EditNetworkPopup`'s URL field is vestigial.** Nothing renders `urlTerm` (`:42`), so the swap is invisible, and only a throw at `onShow` could break it.
- **Not sites:** `popup/pages/settings/networks/[id].vue:84, 96, 201, 202, 219` compare ids; `network/service.ts:787` (`readPublicStorageOnce`) already calls `primaryEndpointUrl`. The four execution sites (`execution/transfer-executor.ts:377`, `dapp-send-executor.ts:470`, `operation-estimate-reuse.ts:141`, `transfer-estimate-reuse.ts:181`) are estimate-reuse's, and they adopt `findPrimaryEndpoint` there.

### (b) Node status: one skeleton, B-09 behind an argument

Today (`network/service.ts:732-765`), the two methods differ in three ways:

| | `getNodeStatus` | `probeNodeStatus` |
|---|---|---|
| probe | `_getChainId(url)`: retrying `createNode`, logs `"Failed to fetch node info"` on failure | `nodeFactory.probeChainId(url, timeoutMs)`: one attempt, silent |
| local carve-out | the seeded-URL check only, inside `_probeChainIdentity` (`:1015`) | `network.kind === "local"` or the seeded URL (`:759`) |
| order | probe, then carve-out | probe, then carve-out |

Both validate their params, call `ensureInitialized`, require the active profile and an owned row, return `Inactive` without a primary or on any throw, and compare against `network.chainId`.

**What changes:**

- A module function `isLocalNetworkTarget(rpcUrl, kindHint)`: `kindHint === "local" || sameLocalNetworkUrl(rpcUrl, LOCAL_NETWORK_RPC_URL)`. `_probeChainIdentity`'s two `if`s (`:1014-1015`) become one, with the same short-circuit order.
- A private skeleton:

  ```ts
  private async primaryEndpointStatus(
  	networkId: string,
  	chainIdAt: (rpcUrl: string, kindHint: ChainKind | undefined) => Promise<number>,
  	localKind: "applied" | "ignored",
  ): Promise<NodeStatus>
  ```

  Its body: active profile, owned row, `findPrimaryEndpoint` (none → `Inactive`), then `try { chainIdAt(primary.rpcUrl, localKind === "applied" ? network.kind : undefined) }`. Equal → `Active`, different → `InvalidChain`, a throw → `Inactive`.
- `getNodeStatus` keeps `validateParams` and `ensureInitialized`, then calls `primaryEndpointStatus(networkId, (url, hint) => this._getChainId(url, hint), "ignored")`. `"ignored"` is B-09, kept.
- `probeNodeStatus` does the same with an async probe: `await this.nodeFactory.probeChainId(url, timeoutMs)` first, then `isLocalNetworkTarget(url, hint) ? 0 : probed`. So `"applied"` is today's behaviour, and a dead local node is still `Inactive`.
- The alignment arc's B-09 commit is one token: `"ignored"` → `"applied"` in `getNodeStatus`.
- **Why an explicit argument and not a default:** it puts the knob where B-09 lives. Today's behaviour is the value each caller passes (see Asks).

### (c) Endpoint identity guard

- `addEndpoint` (`:609-621`) and `updateEndpoint` (`:656-667`) throw the same two `ENDPOINT_CHAIN_MISMATCH` messages, composite first, then L1. A module function `assertSameChainIdentity(probed, network)` holds both checks and the existing XOR-collision comment, called at the same point: inside the lock, after the locked re-read. In `updateEndpoint` it still runs before the endpoint-id lookup (`:668-669`), so the existing precedence test at `network/service.test.ts:990-998` holds.
- `label?.trim() || undefined` at `:629`, `:676` and `:971` becomes `trimmedLabel(label)`.
- **What stays:** the peek-and-probe preambles (`:602-606`, `:647-653`). They are two lines each whose comments carry site-specific reasoning, and merging them adds an await hop for nothing.

### (d) Transport allowlist: a wallet-core leaf, each site's wrapper kept

Today:

- `RpcUrlSchema` (`spec.ts:151-178`): `z.string().url()` (zod 4.4.3 trims, then checks that `new URL` parses, and hands the refine the trimmed value), then the refine: parse, refuse userinfo, `https:` to any host, `http:` only when `hostname.toLowerCase()` is `localhost`, `127.0.0.1` or `[::1]`.
- `isAllowedRpcUrl` (`packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:59-74`): the same scheme and host rule on the raw string, no userinfo check, and three refusal reasons that embed the URL, host or scheme.

**New `packages/wallet-core/src/utils/rpc-url.ts`,** exported from `utils/index.ts`:

```ts
export type RpcTransportVerdict =
	| { allowed: true }
	| { allowed: false; refusal: "non-loopback-http"; host: string }
	| { allowed: false; refusal: "scheme"; scheme: string }

/** `https:` to any host; `http:` only to loopback, as `URL.hostname` spells it (IPv6 keeps its
 *  brackets). Userinfo is not judged here: the extension's schema refuses it, the adapter does not. */
export function rpcTransportVerdict(url: URL): RpcTransportVerdict
```

- It keeps today's literal comparisons and `.toLowerCase()`, with no module-level value, so nothing changes for the npm stager's tree-shaking.
- **Schema:** the refine keeps its parse and its userinfo line, then returns `rpcTransportVerdict(parsed).allowed`. The `z.string().url().refine(fn, { message })` chain and its message stay byte-identical. Every `NetworkMethodSchemas` entry, `NetworkEndpointSchema`, `NetworkSchema` and `NetworkInfoSchema` keep using `RpcUrlSchema`.
- **Adapter:** `isAllowedRpcUrl` keeps its signature, its `new URL` try/catch and its `not a valid URL: ${rpcUrl}` reason. It maps `non-loopback-http` and `scheme` onto today's two reason strings verbatim, from the verdict's `host` and `scheme`. The four methods' refusals and their order stay unchanged.
- **Comments in these lines:** the schema's TSDoc (`spec.ts:127-150`) loses `F-011 / Phase 5`, the "Pre-fix" history and both "codex Round 2 B-3" tags (`:140`, `:172`). It now names the leaf as the rule, states that userinfo is refused here only, and lists where the schema actually runs: popup-side params and results (`network/client.ts:39-47`), service params, and the backup-restore filter (`account-state/service.ts:303`), not the lax row codec. The adapter header (`:11-21`) stops claiming its policy "matches the schema" (it accepts userinfo), and `:55` loses `F-011:`.
- **Alternatives not taken:**
  - A boolean `isAllowedRpcTransport`: it forces the adapter to re-derive scheme and host to word its reasons, so the rule stays duplicated.
  - Calling the adapter's function from the schema: `./adapters` does not export it, and its module imports the node client into the popup graph (the audit's own call).

#### Acceptance sets: today, both sites (probed on Bun at `7450928c`)

After the change, both columns must stay identical, row for row. Phase 1 pins the bolded rows, and the adapter's reasons, verbatim.

| input | `RpcUrlSchema` | `isAllowedRpcUrl` | why |
|---|---|---|---|
| **`https://rpc.example.com`**, **`HTTPS://RPC.EXAMPLE.COM/Path?Q=1`** | ok | ok | scheme lowercased by WHATWG |
| **`https://a@b.example`**, **`https://user:pass@b.example`**, **`https://user@evil.com@safe.com`**, **`http://user@localhost:8080`** | refuse | ok | userinfo: kept policy difference |
| **`https://@b.example`** | ok | ok | empty userinfo parses to `""` |
| **`http://localhost:8080`**, **`HTTP://localhost:8080`**, **`http://LOCALHOST:8080`**, `http://localhost` | ok | ok | |
| **`http://localhost.:8080`** | refuse | refuse (`host="localhost."`) | trailing dot is not in the list |
| **`http://sub.localhost:8080`**, `http://localhost.evil.com` | refuse | refuse | |
| **`http://127.0.0.1:8080`**, **`http://127.1:8080`**, `http://2130706433:8080`, `http://0x7f000001/` | ok | ok | IPv4 shorthand normalises to `127.0.0.1` |
| **`http://127.0.0.2:8080`**, **`http://0.0.0.0:8080`**, `http://192.168.1.10:8080` | refuse | refuse | |
| **`http://[::1]:8080`**, **`http://[0:0:0:0:0:0:0:1]:8080`** | ok | ok | canonical `[::1]` |
| **`http://[::ffff:127.0.0.1]:8080`** | refuse | refuse (`host="[::ffff:7f00:1]"`) | |
| **`https://[2001:db8::1]:8443`**, **`https://exämple.com`**, `http://ⓛocalhost:8080` | ok | ok | IDNA maps `ⓛ` to `l` |
| **`https://rpc.example.com:65536`**, **`""`** | refuse | refuse (`not a valid URL: …`) | |
| **`" https://rpc.example.com"`** | ok | ok | both strip C0 and space |
| **`"https://rpc.example.com "`** | ok | refuse (`not a valid URL`) | zod trims Unicode space before the refine; WHATWG does not |
| **`https:rpc.example.com`** | ok | ok | zod 4 requires `://` only under its http-protocol option |
| **`ws://localhost:8080`**, **`javascript:alert(1)`**, **`file:///etc/passwd`**, `data:…`, `chrome://extensions`, `blob:https://…` | refuse | refuse (`scheme "<s>:" not in allowlist …`) | |
| **`localhost:8080`** | refuse | refuse (`scheme "localhost:"`) | |
| **`http://localhost\@evil.com`** | ok | ok | backslash is a path separator, so the host is `localhost` |

The service (`addEndpoint` and the rest) passes the raw string, not zod's trimmed copy, to `normalizeRpcUrl` and the probe. A NBSP-padded URL therefore passes the schema, is refused by the adapter, and reads "RPC didn't respond". That stays (see Drift).

### (e) Popup error ladders

- `NewEndpointPopup.vue:53-63` and `EditEndpointPopup.vue:68-78` run the same ladder: `includes("ENDPOINT_CHAIN_MISMATCH")` → wrong-chain copy; `includes("DUPLICATE_ENDPOINT")` → duplicate copy; `=== "Failed to fetch node info"` → unreachable copy; anything else → `"Something went wrong."`
- They differ in two ways:
  - the duplicate copy: New says "This URL is already an endpoint of this network.", Edit says "Another endpoint of this network uses that URL.";
  - the chain id: New reads `network.value?.chainId`, Edit reads `network.value.chainId`. Both are read only inside the mismatch branch, so Edit throws there only if the network vanished mid-request.
- **New `popup/components/popups/endpoint-error-text.ts`:** `endpointErrorText(err, { duplicate, chainId })`. `chainId` is a getter, called only in the mismatch branch. The function keeps the ladder's order, `errorMessageFromUnknown`, the `===` and all four strings. It matches on `ERR_ENDPOINT_CHAIN_MISMATCH` and `ERR_DUPLICATE_ENDPOINT` from `spec.ts`, whose values are the same literals.
- Each popup's `catch` becomes one assignment, passing its own duplicate string and `() => network.value?.chainId` (New) or `() => network.value.chainId` (Edit). Templates are untouched.

### Complexity

Nothing touched is in `scripts/complexity-baseline/manifest.json`. Every new function is a few flat lines; `primaryEndpointStatus` has one ternary and one `try`.

### Coupling with neighbouring arcs

- **chain-id (arc 7, in this base):** it edited `network/service.ts:24` and `:1016`. This arc merges `:1014-1015` directly above `:1016`, which stays.
- **execution-guards (arc 8, building):** it edits `execution/service.ts:1021-1029`, the execution service, not this file. It touches nothing here.
- **estimate-reuse (arc 11):** it owns the four execution sites and adopts `findPrimaryEndpoint`, so this arc lands first.
- **row-lifecycle (arc 12):** it edits `network/service.ts:272`, `:317-322` and `:485-491`. The hunks are neighbours, not overlaps.
- **popup-plumbing (arc 20):** it edits the `displaceIdx` lines of all three popups (`NewEndpointPopup.vue:20`, `EditEndpointPopup.vue:19`, `EditNetworkPopup.vue:15-17`). The hunks are neighbours, not overlaps.
- **incoming-arms (arc 14):** its Q-18 regions in `incoming-transfer/service.ts` (`:447` and on, `:702` and on, `:1383` and on) do not include `:536`.

## Security & Adversarial Considerations

- **Who controls what:**
  - Network-service RPCs are reachable only from extension pages over the internal port; the dApp ingress exposes none of them.
  - The user types endpoint URLs.
  - A backup is attacker-controlled. Its networks pass `NetworkSchema` (`account-state/service.ts:303`). Its transaction and journal rows carry `submittedEndpointUrl`, which reaches the adapter through `getNodeForUrl` and `getSingleAttemptNodeForUrl` (`transaction/service.ts:440`, `operation-journal/send-check.ts:155`) with no schema in between. So **the adapter predicate is the only gate for persisted URLs**, and its acceptance set must not widen by one input.
  - A hostile or drifted node controls `getNodeInfo`, which is what the status and identity checks compare.
- **Guard sets per site, identical after the change:**
  - **Schema:** zod URL check (on the trimmed value), then parse, refuse userinfo, then the transport rule.
  - **Adapter:** parse, then the transport rule. Each method checks before it constructs any client (`:78`, `:86`, `:94`, `:106`).
  - **Status:** profile, owned row, primary, probe (retrying or single-attempt), then the carve-out (URL only, or kind and URL), compared with `network.chainId`.
  - **Endpoint mutation:** schema params, profile, peek, probe outside the lock, locked re-read, composite equality, exact L1 equality, then (update) the endpoint-id lookup, then duplicate, then write.
- **What a careless consolidation would widen, and what pins it:**
  - Moving the userinfo refusal into the leaf would tighten the adapter, which the Behaviour rule excludes. Moving it out of the schema would admit `https://user@evil.com@safe.com`, a phishing-shaped URL. Both columns' userinfo rows pin it.
  - Applying the local carve-out before the probe would turn a dead local node `Active`. Pinned by the local-unreachable row.
  - Merging the two status probes would change retry, timeout and logging. Pinned by spies on `probeChainId` and `createNode`.
  - Merging the identity checks out of order changes the message. Pinned by the both-mismatch row.
  - A lenient `findPrimaryEndpoint` (`?? endpoints[0]`, `?.`) would hand `getNetworkInfo`, `getNode` and the status methods an endpoint the user never made primary. Pinned by the dangling-primary rows.
- **Mixed content and local-network access:** unchanged. `http:` reaches loopback only; `https:` reaches any host, including private addresses and `https://localhost`, as today on both sites.
- **Logging:** no log line changes. The adapter's reasons still embed the URL, and the logger's error projection scrubs URLs (`wallet/logger/utils.ts:170`).
- **Layering and npm:**
  - The leaf imports nothing, which satisfies wallet-core's bans.
  - aztec-runtime and the extension already import `@nulo/wallet-core/utils`, and so does the popup graph.
  - The stager inlines wallet-core source into `@alejoamiras/nulo-wallet-crypto`. Phase 2 stages all three packages at base and head and requires `diff -r` to come back clean.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `7450928c`):

1. `git grep primaryEndpointId` finds the lookup at the sites in (a) and the four execution sites, and nowhere else in production code.
2. `getNodeStatus` passes no kind hint (`network/service.ts:740`); `probeNodeStatus` applies `network.kind === "local"` (`:759`). Their consumers: `stores/app.store.ts:495` (the header badge) and `account-state/service.ts:101, 221` (backup capture). Only `full-backup-restore.ts:523` calls `probeNodeStatus`.
3. Zod 4.4.3's URL check trims, parses with `new URL` and passes the trimmed value on (`zod/v4/core/schemas.js:187-259`). Its http-protocol `://` rule is off for a bare `.url()`.
4. The client validates params and results against `NetworkMethodSchemas` (`network/client.ts:39-47`). So a disallowed URL fails in the popup, before any port call, as `Invalid params for addEndpoint: …`, which the ladder shows as "Something went wrong."
5. No test pins the adapter's reasons, `RpcUrlSchema` directly, the L1-mismatch messages, the service's own `getNodeStatus` or `getNetworkInfo` (their consumers' tests mock both), or either popup's error copy. `tests/e2e/endpoints.test.ts:169-171` defers exact copy to unit tests that do not exist.
6. `EditEndpointPopup.vue` and `EditNetworkPopup.vue` use the auto-imported `useFormState` and `usePopupEntity`, which unit tests do not auto-import (`implementations-plan/lessons.md`, Vue unit tests). Their scripts lack `lang="ts"`, so `typecheck:all` does not see them.
7. `NetworkInfoSchema` (`spec.ts:201`) has no importer outside `spec.ts`.

**Inferences:**

- The acceptance table holds on Chrome and Firefox as on Bun for every bolded row: those rows exercise spec-defined WHATWG behaviour. Equivalence after the change does not depend on engine, since both before and after read the same `URL` object.
- The extra microtask hop through `primaryEndpointStatus` is unobservable: both methods are popup RPCs or awaited reads, and no span depends on their timing.

**Asks** (for the panel):

1. **B-09 knob shape.** The program asks for "today's behaviour as the default of a parameter". This plan uses a required `localKind: "applied" | "ignored"` that both callers spell out, rather than a defaulted parameter, so the B-09 value is visible at `getNodeStatus`. Confirm, or ask for a default of `"ignored"`.
2. **Screenshot states.** The wrong-chain and duplicate states need a live node answering for a chosen chain. Reaching them would put the Testnet key-bearing URL into a published picture, or need a fake JSON-RPC node. The plan proves their copy byte-exactly in component tests, and their pixels through the same `FieldWarning` path as the two states it does shoot. Confirm that this is enough.

## Phases

### Phase 1: pin today's behaviour (test only)

Every expected value is a literal, never derived from production code.

- **New `wallet/services/network/spec.test.ts`:**
  - `RpcUrlSchema.safeParse` over the bolded table rows, plus one refusal pinning the refine's message text;
  - `networkInfoFrom`: match → the triple; dangling `primaryEndpointId` → throws `Network n1 has no primary endpoint`;
  - `primaryEndpointUrl`: match, dangling, and `endpoints: undefined` → `undefined`.
- **`packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.test.ts`:** a `describe("isAllowedRpcUrl")` table over the same rows, each `toEqual` the exact `{ ok }` or `{ ok: false, reason }` object.
- **`wallet/services/network/service.test.ts`:**
  - **Status table:** each row through both methods, with `vi.spyOn(factory, "probeChainId")`. The spy is called with `(url, 5_000)` for `probeNodeStatus` only; `getNodeStatus` adds to `factory.created`. Rows:

    | row | `getNodeStatus` | `probeNodeStatus` |
    |---|---|---|
    | custom kind, match | `Active` | `Active` |
    | custom kind, mismatch | `InvalidChain` | `InvalidChain` |
    | custom kind, unreachable | `Inactive` | `Inactive` |
    | local kind on a non-seed URL, composite ≠ 0 | `InvalidChain`, titled `(BUG PIN)` | `Active` |
    | local kind, unreachable | `Inactive` | `Inactive` |
    | custom kind at `LOCAL_NETWORK_RPC_URL`, chain 0 | `Active` | `Active` |
    | dangling primary | `Inactive`, no node created | `Inactive`, no node created |

  - **Identity guard,** for `addEndpoint` and `updateEndpoint`, with exact messages: composite mismatch; L1 mismatch with equal composite (row `(l1 0, rv 50)` against an endpoint answering `(l1 2, rv 48)`); both mismatched → the composite message.
  - **Labels:** `"  x  "` → `"x"`, `"   "` and `undefined` → no label, on add and update.
  - **Dangling primary at each remaining policy site:**
    - `getNetworkInfo` rejects `Network <id> has no primary endpoint`, and a match returns the primary's triple;
    - `getNode` rejects with the same text;
    - `setActiveNetwork` resolves, emits and caches no node;
    - a custom network's `resolveVerifiedL1ChainId` probes `endpoints[0]`.
- **`incoming-transfer/service.scenarios.test.ts`:** `getReceiptFee` returns `null` for a dangling primary and for a network with no `endpoints`, and calls neither `getNodeForUrl` nor `getNode`.
- **`popup/components/popups/NewEndpointPopup.test.ts`:** an error table. `addEndpoint` rejects with a message, and the field shows the copy:

  | rejection message | copy shown |
  |---|---|
  | `ENDPOINT_CHAIN_MISMATCH: …chainId 5…` | `Wrong chain. This network is chain 1.` |
  | the L1 variant | the same copy |
  | `DUPLICATE_ENDPOINT: …` | `This URL is already an endpoint of this network.` |
  | `Failed to fetch node info` | `RPC didn't respond. Check the URL.` |
  | `Failed to fetch node info.` (a near miss, pinning `===`) | `Something went wrong.` |
  | a message containing both prefixes | the wrong-chain copy (pins the order) |
  | `Invalid params for addEndpoint: …` | `Something went wrong.` |

- **New `EditEndpointPopup.test.ts`:** the same table through `updateEndpoint`, with Edit's duplicate copy. It uses `vi.stubGlobal` for the real `useFormState` and `usePopupEntity`, and makes the form dirty before submit.
- **New `EditNetworkPopup.test.ts`:** one row. Opening the popup on a network with a dangling primary runs the default fill without error and fills the name.

The phase is green against the unchanged code, in its own commit, so the test files freeze before Phase 2.

**Mutation check** (scratch copies, reverted, logged in this arc's lessons file):

| mutation | the test that fails |
|---|---|
| `getNodeStatus` passes `"applied"` | the BUG PIN row |
| `probeNodeStatus` passes `"ignored"` | the local probe row |
| the carve-out runs before the probe | the local-unreachable row |
| the probes are swapped | the spies |
| the identity checks' order is swapped | the both-mismatch row |
| `findPrimaryEndpoint` falls back to `endpoints[0]` | the dangling rows |
| the leaf admits `127.0.0.2` or `ws:`, or drops `[::1]` | both tables |
| userinfo moves into the leaf, or out of the schema | the userinfo rows |
| one reason string is reworded | the adapter table |
| the ladder's order is swapped, `===` becomes `includes`, or Edit gets New's copy | the popup tables |
| `getReceiptFee` falls back to `getNode` | its row |

### Phase 2: the refactor

Make the edits in (a) through (e) with every Phase 1 file untouched. The only test file added is `packages/wallet-core/src/utils/rpc-url.test.ts`: one row per verdict, with the `host` and `scheme` fields. `packages/wallet-core/README.md`'s pure-helpers row gains `rpc-url.ts`.

### Phase 3: screenshot evidence

Run the local screenshot harness (outside the repo) as batch `network-endpoints`, base `<parent>` and head `<head>`, on Chrome and Firefox, dark and light, at 360×600@2x on the real build. A `--stability` pass must be clean too.

- **Surfaces.** Each one is reached from Settings → Networks, with no Aztec sandbox and no port stub. Endpoint surfaces use the seeded Local Network: its detail id comes from its `nulo:core:networks@*` row, and its URL carries no provider key.

  | surface | how | copy asserted before the shot |
  |---|---|---|
  | `edit-network` | Testnet detail → `network-detail-rename` | none; the popup's title is shown |
  | `new-endpoint` | Local detail → `endpoint-add-btn` | none; the form is empty |
  | `new-endpoint-invalid` | type `http://example.com` into `endpoint-rpc-input` → `add-endpoint-submit` (refused popup-side, no RPC) | `Something went wrong.` |
  | `new-endpoint-unreachable` | `http://localhost:1` → submit (a refused probe, as `tests/e2e/endpoints.test.ts:162` does) | `RPC didn't respond. Check the URL.` |
  | `edit-endpoint` | Local detail → `endpoint-edit-btn` | none; prefilled `http://localhost:8080` |
  | `edit-endpoint-invalid`, `edit-endpoint-unreachable` | the same two URLs → `edit-endpoint-submit` | the same two strings |

- **Leave and theme loop.** Each surface closes its popup on `leave`. Nothing is persisted, because every submit fails, so the theme loop repeats cleanly.
- **Text assertions.** The surface file asserts each error string before the shot, so a wrong state cannot pass as identical.

**Validation gate (after each phase):**

- **Commands:**
  - `bun run --cwd packages/wallet-core test`, `bun run --cwd packages/aztec-runtime test`;
  - `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run test:release`, `bun run audit:vue`;
  - `bun run build`, then `git diff --exit-code apps/extension/src/types/ apps/extension/.eslintrc-auto-import.json`;
  - `bun scripts/publish/stage.ts --all --version 0.1.0 --out <scratch>` at base and head, then `diff -r`;
  - after Phase 2, the smoke file `tests/e2e/endpoints.test.ts` on Chrome and on Firefox (`NULO_E2E_BROWSER=firefox`).
- **Pass criteria:**
  - every command exits 0;
  - generated declarations and `THIRD-PARTY-NOTICES.txt` are unchanged;
  - the staged packages are identical;
  - Phase 2's `git diff --stat` lists no existing test file;
  - Phase 3 reports every surface identical on both browsers and themes.
- **Layers:** unit, component and composition locally, plus the smoke file; the network lanes run in CI per the program gates, and their endpoint, status and backup paths run for real.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, plus an independent Opus pass, as a MID batch requires.
   - Each gets the adversarial, assumption-attack and implementation-critique asks.
   - Both must confirm the acceptance table and the per-site guard sets.
   - Include the no-over-engineering rule verbatim: "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - Include the comment-quality rule verbatim: "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
2. **Fix loop:** triage each finding, fix, commit, log the round in this arc's file under the program's `lessons/`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against its parent in the gh stack, then add both e2e labels. The PR body attaches the harness report as the screenshot evidence CLAUDE.md asks for on a popup change. When the program gates are green on the head SHA, with the run attempt and shards recorded, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/09-network-endpoints`, stacked on `harden-dedupe` above the arcs open at delivery (the driver sets the parent). It must land before estimate-reuse. Code review: off.

## UI impact

None by design.

- **Surfaces touched:** the Add endpoint and Edit endpoint popups and the Edit network popup (Settings → Networks → network detail).
- **Edits:** script only. Templates, styles and every string are unchanged, and the strings move byte-for-byte into `endpoint-error-text.ts`.
- **Proof:** Phase 1's component tests pin the copy, and Phase 3's zero-diff harness proves the pixels. No owner sign-off is needed, because nothing a user sees changes.

## Drift left for the alignment arc

- **B-09 (owner call 1):** `getNodeStatus` ignores `network.kind`, so an edited Local Network endpoint reads `InvalidChain` on the header badge and is left out of backups (`account-state/service.ts:221`). The fix is the one-token `localKind` flip above. Its evidence covers the badge and a restored backup's contents.
- **Userinfo:** the schema refuses it and the adapter accepts it. This is the program's "kept as today, no call" policy, excluded from the safer-fix route.
- **Duplicate-URL wording** differs per popup: kept as a parameter, no call.
- **Zod trims, the service does not:** a URL padded with Unicode space (NBSP and the like) passes the schema, then fails the adapter as "RPC didn't respond". Never accepted, so not a security gap; a robustness follow-up.
- **Follow-ups, not drift:**
  - `EditNetworkPopup`'s vestigial URL field (`:36-42`, `:61`), dead state with a comment saying so;
  - the unused `NetworkInfoSchema` export (`spec.ts:199-205`);
  - `tests/e2e/endpoints.test.ts:169-171`'s claim that unit tests assert the copy, which becomes true here.

## Decisions (delegated)
