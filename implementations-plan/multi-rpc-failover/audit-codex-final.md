1. `primaryEndpointId` drop: I think you’re right to drop it. Once `endpoints[]` is the persisted priority order (`implementations-plan/multi-rpc-failover/plan.md:66-68`, `:142-156`), keeping `primaryEndpointId` just creates dual persisted truth. The real downside of dropping it is narrower: any accidental reorder becomes a semantic preference change. That’s a maintainability risk, not a correctness win for keeping the field. Guard it with tests/docs that array order is authoritative.

2. No-replay policy: with the current plan, a `getCurrentMinFees()` 503 during fee estimation does error out. First hard failure: no failover yet. Second consecutive hard failure: failover happens, but the same call still bubbles the error; the next retry succeeds on backup (`plan.md:48-62`, `:390-395`; `packages/extension/src/wallet/services/execution/service.ts:633-650`; `packages/extension/src/wallet/services/execution/tx-request-builder.ts:448-449`). I would keep that for v1. It is not perfect UX, but it is safe and predictable. If you ever add retries, do it only for narrowly opt-in, known-idempotent node reads, not generic node/PXE calls.

3. PXE write-guard sequencing: I do not see a deadlock in the intended design, because `emit()` does not await listeners (`packages/extension-messaging/src/background/service.ts:104-117`; `packages/wallet-core/src/utils/event-handler.ts:22-28`), and `PxeService` does not call back into `NetworkService` while holding its chain guard (`packages/aztec-runtime/src/pxe/service.ts:405-443`). A running PXE write can delay the rebind, but not deadlock it. The actual problem is different: `plan.md` is underspecified on how offscreen PXE subscribes at all (`implementations-plan/multi-rpc-failover/plan.md:313-318`). Today the offscreen bootstrap only injects `{ profiles, logger }`, not a `NetworkServiceClient` (`packages/extension/src/offscreen/index.ts:52-55`; `packages/aztec-runtime/src/offscreen/entry.ts:19-32`).

4. Caller-sweep risk: the pinning invariant survives only if the binding survives the whole op. The current long-lived flows do preserve `node`/`pxe` from build through prove/send (`packages/extension/src/wallet/services/execution/service.ts:489-547`, `:1104-1133`, `:1912-1949`), so that part is sound. The two holes are:
   - reused-estimate path reacquires `network` and `node` separately (`packages/extension/src/wallet/services/execution/service.ts:469-471`);
   - estimate cache snapshots endpoint identity after the fact from `network.primaryEndpointId` / URL (`packages/extension/src/wallet/services/execution/service.ts:707-734`).
   
   So Phase 3 needs `buildAndEstimateTxRequest()` to return binding-derived endpoint identity, or return the binding itself, not just `network`.

5. Open questions: most of the 8 should not go to the user. Only failback policy is clearly user-facing. Schema drop is optional if you want explicit user blessing. The rest are implementation choices, not approval questions (`implementations-plan/multi-rpc-failover/plan.md:495-504`).

6. Biggest missing piece: failure reporting. The plan defines a classifier and state machine (`plan.md:35-44`, `:198-277`), but `acquireBinding()` alone does not tell `NetworkService` when a `binding.node` or `binding.info`-driven PXE call failed. Today only tx polling reports failures explicitly (`packages/extension/src/wallet/services/transaction/service.ts:204-218`). Without a wrapper/protocol for caller sites, failover will not trigger on most real traffic.

7. Other missing / inconsistent items:
   - `addTransaction()` currently recomputes `submittedEndpointUrl` from current network state, not from the op’s captured binding (`packages/extension/src/wallet/services/transaction/service.ts:109-136`). That races failover and breaks receipt pinning. Phase 3 needs an API change, not just an internal lookup tweak (`implementations-plan/multi-rpc-failover/plan.md:326-345`).
   - `getNodeStatus()` / header semantics are inconsistent. The plan still points Phase 1 at `endpoints[0]` (`plan.md:295`), but the UI wants amber when active backup is healthy and preferred is down (`plan.md:123-125`, `:354`). Today `getNodeStatus()` probes the preferred endpoint (`packages/extension/src/wallet/services/network/service.ts:470-485`), so the header would tend red, not amber (`packages/extension/src/stores/app.store.ts:107-116`; `packages/extension/src/components/Header.vue:233-242`, `:373-392`).
   - `promoteEndpoint()` and `clearEndpointCooldowns()` set `activeEndpointId` too early (`plan.md:130`, `:223-225`, `:261-274`). That bypasses the promotion-time chain probe the security section relies on (`plan.md:367-369`) and can show false recovery. Manual promote should re-probe before activating, and `clearEndpointCooldowns()` should clear gates only.
   - The 5s candidate probe timeout is not implementable as written with current interfaces (`plan.md:58`; `packages/aztec-runtime/src/ports/node-factory-port.ts:23-24`; `packages/aztec-runtime/src/utils/fetch.ts:17-18`, `:87-97`).
   - The latency-based soft-failure path is underspecified. “>10s without explicit error” needs a timing wrapper the plan never defines (`plan.md:39-44`).
   - Minor validation mismatch: “set primary to a known-bad URL” is not compatible with current add/update endpoint validation; the test should be “configure a good endpoint, then make it fail later” (`plan.md:450-453`; `packages/extension/src/wallet/services/network/service.ts:338-346`, `:384-392`).

> **APPROVE-WITH-CHANGES**

Must fix before user sees this:
- Define the failure-reporting contract for `acquireBinding` callers.
- Specify the actual Phase 2 transport/wiring for PXE rebind.
- Change `addTransaction()` to take the captured endpoint URL/ID.
- Fix active-vs-preferred health semantics for the header / `getNodeStatus`.
- Do not flip `activeEndpointId` on manual promote / cooldown-clear before a successful probe.
- Remove or re-spec the 5s probe timeout and the latency-based soft-fail path.

Post-approval cleanup:
- Trim the user-facing “open questions” down to the genuinely user-facing ones.
- Tighten the network e2e wording around bad-endpoint setup.