# P18 / Q-03 — dedup RPC client/PXE passthroughs

**Tier:** deep, TRUST-BOUNDARY (registry cluster P15/P18/P19/P20).
**Status:** BLUEPRINT CONSOLIDATED (main leg + codex `019f1cca` xhigh; opus leg env-blocked). Impl NEXT on `qa/Q-03-service-client-factory` off dev-quality `7a2cf43`.

## Finding
21 extension `services/<name>/client.ts` mechanically `return this.request("method", ...args)` though `Methods` already defines the surface; PXE repeats the method list across `Methods`/`IPXE`/subset/proxy/client/service. Refactor: a `ServiceClient` factory derives passthroughs; PXE uses one descriptor table.

## STEP 1 re-verify (HEAD 7a2cf43 — Q-03 files untouched by P17)
- Base present: `packages/extension-messaging/src/core/{base-client.ts:75 BaseServiceClient, base-service.ts:42 BaseService, rpc-methods.ts defineRpcMethods}`.
- Trust-boundary pin: `base-service.ts:87-93` the `rpcMethods` guard (`!rpcMethods.has(m) && !frameworkRpcMethods.has(m)` → reject) strictly UPSTREAM of `invoke` `:111/:124`; `rpc-methods.ts:4` "never invoke arbitrary `this[method]`".
- **Client scan (all 21):** ~18 are PURE passthroughs (every method `return this.request(...)`, no extra logic) → factory-eligible. **3 do NOT fit:** `operation-journal` + `network` (req=0 — custom/non-mechanical client logic; INSPECT before touching, likely LEAVE) and `pxe` (deferred to P18b). `profile` (req=23, +3 extra lines) is mostly passthrough — inspect the 3 extra.

## Scope (codex-adjudicated — the finding shrinks)
- **P18a (this PR) — SAFE:** a client-side `ServiceClient` factory (CODEGEN or a prototype-defining helper from an EXPLICIT method-name list — NOT a `Proxy`: Proxy breaks stack traces/identity/`function.length`/`this`) for the ~18 mechanical clients. Client-side only, no authz. + MINIMAL messaging-base typing (strengthen `request`/response/event typing + factory support) for P20 sequencing.
- **KEEP EXPLICIT (do NOT auto-derive): service-side `rpcMethods`.** The allowlist IS the dispatch trust boundary — `BaseService.invoke()` calls `this[name]`, so a client-seeded list would make helper/lifecycle/framework methods callable. Each service keeps its hand-written `defineRpcMethods(...)`. NEVER derive it from the client factory / consumer interface / prototype / "all Methods".
- **P18b (DEFERRED, separate PR): PXE descriptor table** — shape-only (names/subset/proxy/zod) with EXPLICIT per-field flags (`rpc`, `ipxe`, `requiresNetwork`), NO permissive defaults; service bodies (validation/rehydration/locks/senderForTags/skipKernels/node-fallback/cleanup) stay hand-written. `Methods` has SW-only methods (`clearChainState`,`getNoteSchemas`,`getBlockTimestamp`) that `IPXE` EXCLUDES — a naive one-table could expose chain-purge via the per-network facade.
- The 3 non-fitting clients (`operation-journal`,`network`,`pxe`) stay as-is (inspect, BUG-PIN if surprising).

## Oracle (trust-boundary proof — codex #6)
Frozen `method-descriptors.test.ts` FROZEN_* UNEDITED (`git diff --exit-code`) + adversarial-bypass suite (P15) re-run green, PLUS negative assertions:
- helper/prototype/framework methods remain UNINVOKABLE after generation (feed the dispatcher a helper name → rejected).
- each service's `rpcMethods` set byte-identical before/after.
- generated clients preserve request method NAMES + PARAMETER ORDER (spy transport).
- (P18b) PXE SW-only methods stay ABSENT from IPXE/proxy; `proveTx` timeout + response validation unchanged.

## Security & Adversarial
Threat: a caller reaching an unexported SW method via the dispatcher. Defense = the explicit `rpcMethods` allowlist upstream of `invoke`. The refactor must not widen it. Risk: a factory deriving BOTH client + service surface from one table → over-exposure. Mitigation: client factory ONLY; service allowlist stays hand-written + the rpcMethods-unchanged test.

## Assumptions
- Facts: file:line above (HEAD 7a2cf43). ~18 pure-passthrough clients (scan).
- Inferences (codex to re-attack at impl): (a) the ~18 are 100% mechanical (verify each during migration); (b) a codegen/prototype factory preserves consumer TS inference; (c) `operation-journal`/`network` genuinely don't fit (inspect).
- Asks: none for owner (all resolvable). If PXE half proves entangled → confirm P18b split, log it.

## Ordered steps
1. Inspect the 3 non-fitting clients (`operation-journal`,`network`,`profile` extras) — confirm leave-as-is / BUG-PIN. Gate: read-only.
2. Build the `ServiceClient` factory (prototype-helper from explicit name list) + migrate the ~18 mechanical clients. Gate: lint + typecheck:all + extension-messaging + the migrated clients' tests + the rpcMethods-unchanged + name/param-order oracle tests.
3. Minimal messaging-base typing (request/response/event + factory) for P20 sequencing. Gate: extension-messaging units + typecheck:all.
4. Per-arc tail: `/code-review max --fix` → codex post-impl audit → fix loop.
5. Gate PR `qa/Q-03-service-client-factory`: frozen oracle UNEDITED + adversarial-bypass suite + units + smoke + full network. Green → plain squash-merge (no --admin).
6. Re-run P15 adversarial-bypass + frozen oracle vs the new HEAD (registry-cluster rule).
   P18b (PXE descriptor) = a separate later PR.

## Decision ledger (CONSOLIDATED — main + codex 019f1cca)
- **factory shape** → codegen / prototype-helper from explicit name list, NOT a Proxy.
- **service rpcMethods** → stays explicit, never derived (BaseService.invoke calls this[name]).
- **PXE** → deferred to P18b, shape-only + explicit per-field flags.
- **messaging-base typing** → minimal; no dispatch-authority typing (that's P20; authority = runtime allowlist).
- **non-fitting clients** → operation-journal/network/pxe out; inspect + BUG-PIN.
- **split** → P18a (factory + base typing) now; P18b (PXE) separate.
