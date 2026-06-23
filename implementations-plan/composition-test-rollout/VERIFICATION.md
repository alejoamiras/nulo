# VERIFICATION — assumption-attack results (main agent, during drafting)

Verified against the code while the parallel planners ran. These supersede the BRIEF's "shallow" framing where they conflict; consolidation + audits cite this.

## The shared port surface = 4 methods (not 3)

Both Token and Fpc reach PXE via `this.pxeService.getPXE(networkInfo)` then call, on the returned `IPXE`:
`getContractInstance`, `getContractArtifact`, `getContracts`, `registerContract`.

`getContracts()` was missed in the first recon — it is the **dedup lever**: `if (!registered.includes(addr)) await pxe.registerContract(...)` (token:300-302/385-387; fpc:256-258/356-358). It is REAL orchestration worth asserting (canned `[]` → registers; canned `[addr]` → skips). It stays in the port.

Port = `Pick<IPXE, "getContractInstance" | "getContractArtifact" | "getContracts" | "registerContract">`. Four methods, under the doc's `>5` cap. `proveTx`/`simulateTx`/`profileTx`/`executeUtility` (the deep methods, `ipxe.ts:40-43`) are EXCLUDED by design. IPXE lives at `packages/aztec-runtime/src/pxe/ipxe.ts:27-50`.

## Token import is NOT uniformly shallow — it has TWO paths (KEY finding)

- **SHALLOW (composition-testable):** `getTokenInterface` (`service.ts:276`) + `parseTokenInterface` (`:362`) — resolve instance/artifact, dedup via `getContracts`, `registerContract`. Dumb-fakeable; real register/dedup orchestration.
- **DEEP (e2e only):** `fetchTokenMetadata` (`:476`, private) + `previewTokenMetadata` (`:461`) — `service.ts:490` gets the PXE and calls `simulate(node, pxe, account, getNameFn/getSymbolFn/getDecimalsFn, …)` where `simulate` is `@/wallet/utils/fn` (a real view-function SIMULATION). This is the same simulation machinery that's "second-wallet" deep. A composition fake must NOT model it.

⇒ The Token composition test targets the **shallow register/dedup path** (`parseTokenInterface`/`getTokenInterface`); the metadata-simulate path is left to e2e (or a separately-tested pure wrapper). **This split is the canonical example for `COMPOSITION-TESTS.md`** — one service, one shallow path (composition) + one deep path (e2e), separated at the method seam.

(Open Phase-2 detail: confirm whether `addToken:113` orchestrates BOTH paths; if so the test enters at the shallow method directly, not `addToken`.)

## Fpc is fully shallow — the cleanest target

`getFpcs` (`:115`, auto-discovery+register), `addFpc` (`:231`), `updateFpcAddress` (`:318`) use ONLY the 4 registry methods + the PURE `getContractInstanceFromInstantiationParams` (`@aztec/stdlib`, no PXE). `detectFpcType` (`:433`) and `getFpcImpl` (`:413`) are artifact-inspection, pure-ish. **No `simulate` anywhere in fpc/service.ts.** Fpc is the cleanest composition target — start the rollout here, before Token.

## DappSession is PXE-free — confirmed

`grep -rniE "pxe|PxeServiceClient|getContractInstance|proveTx|simulateTx"` across the WHOLE `dapp-session/` dir → **0 matches**. Its boundary is storage + messaging/session only. The no-PXE harness stands.

## Consequences for the plan
1. Port is 4 methods (add `getContracts`). The dedup branch is a first-class thing the Token/Fpc tests must exercise (both arms).
2. Consider reordering: **Fpc first** (fully shallow), then Token (must carve the shallow path off the simulate path), then DappSession (no-PXE, droppable).
3. The Token shallow/deep split is the doc's headline worked example — keep it.

## Port-shape correction (Opus planner, verified) — supersedes the BRIEF + my draft

The 4 registry methods live on the **`IPXE`** object returned by `getPXE()`, NOT on the client. Token/Fpc call EXACTLY ONE client-level method: `getPXE(networkInfoFrom(network))`. So:
- **The minimal shared port is `PxeGateway = { getPXE(network): IPXE }`** — one method. The brief's `{getContractInstance, getContractArtifact, registerContract, getPXE}` (as client methods) is a LEAKY UNION + factually wrong for Token/Fpc (they never call client-level contract methods).
- The **fake** implements a subset of `IPXE` (the 4 registry methods); the single `as unknown as IPXE` cast lives in one shared factory.
- **ExecutionService (spike) stays client-level** — it DOES call client-level `getContractInstance(net, addr)` + executors need the concrete client. Two consumers, two surfaces; the shared FAKE is the unifier, not the port. Do NOT merge.

## Storage-construction obstacle (Opus, verified) — the harness blocker

All three services build storage at FIELD-INIT against `chrome.storage.local`:
- token:43 `new EntityStorage("nulo:core:tokens", chrome.storage.local)`; fpc:44; dapp-session:29.
- `vitest.setup.ts:89-90` stubs `chrome` with `storage: {}` (EMPTY) → `chrome.storage.local` is `undefined` in tests → a real service-under-test fails on storage use.
- **Precedent for the fix:** `OperationJournalService` (`:74-87`) takes `browserApi?` and builds storage in the CONSTRUCTOR body (not field-init), using `browserApi.storage.local` when provided. The spike used `new OperationJournalService(logger, api)` with `FakeBrowserApi` for exactly this reason.

**Two options (DISPUTED — for the ledger/audit):**
- (Opus) `vi.stubGlobal("chrome", {...chrome, storage: {local: api.storage.local, …}})` before constructing — zero prod change, but global mutation + field-init timing coupling (fragile under parallel tests).
- (main lean) add a defaulted `browserApi?` ctor seam to each service + move storage build into the ctor, mirroring `OperationJournalService` — the established, explicit, house pattern; symmetric with the PXE seam (inject PXE + inject storage = fully composition-testable). Small prod diff (3 ctors). I prefer this; matches "well-typed boundaries" + the team already blessed the pattern for the journal.
