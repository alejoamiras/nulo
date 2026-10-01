# Recon · send-states

Read at `48a97f4a` (the head of #718), re-checked after round 1 at `f32b1e0a`, its tree-identical
squash on `dev`, and after the final pass against `85c4d20f` (#719 merged), whose only cited file is
`FeeMethodSelector.vue` (`data-fpc-id` at `:59`). Overlapping branches read with `git diff origin/dev...origin/<branch>`:
`test/e2e-reliability-fixes` (#719) and `fix/send-amount-exact`. The node's admission check was read
from the published `@aztec/p2p` 5.2.0 tarball (`npm pack`), which this repo does not install.
Nothing was run.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Read an address's public Fee Juice balance through a node | `auth-registry.ts:52-65` reads public storage with `deriveStorageSlotInMap` and `node.getPublicStorageAt("latest", …)`; `@aztec/aztec.js` 5.2.0 `getFeeJuiceBalance` (`dest/utils/fee_juice.js:7-9`) does the same with a literal slot and carries a "TODO: Consider nuking"; `gas-balance-reader.ts:172-179` reads `balance_of_public` through `batchedViewSimulation`, which needs an account's view deps | **adapt**: a `readPublicFeeJuiceBalance(node, owner: AztecAddress)` in `apps/extension/src/wallet/utils/fee-juice.ts`, the auth-registry shape, the Fee Juice contract as an `AztecAddress` (the existing `feeJuiceAddress` export is a string, `fee-juice.ts:7`; `getPublicStorageAt` takes an `AztecAddress`, stdlib `dest/interfaces/aztec-node.d.ts:335`) |
| The Fee Juice balance slot of a fee payer | `computeFeePayerBalanceStorageSlot(feePayer)` (`@aztec/protocol-contracts` 5.2.0 `dest/fee-juice/index.js:18-20`), the function the node's admission check (`@aztec/p2p` `gas_validator.js:173`) and the simulator (`public_tx_simulator.js:336`) use; `@aztec/protocol-contracts/fee-juice` is a direct dependency, already bundled through `packages/aztec-runtime/src/pxe/artifact-catalog.ts:6`. The recon's first search trail missed it | **reuse-as-is**; a unit test pins it against the literal map slot `Fr(1)` |
| The node's admission rule | `@aztec/p2p` 5.2.0 `dest/msg_validators/tx_validator/gas_validator.js:166-187`: balance at the payer's slot, plus a setup-phase Fee Juice claim to that payer (`fee_payer_balance.js:12-20`), refused when below `gasSettings.getFeeLimit().toBigInt()` (`:9-11`), accepted at equality | **reuse-as-is** the rule: the probe compares the same figures |
| The fee limit the node checks | `GasSettings.getFeeLimit()` (`@aztec/stdlib` 5.2.0 `dest/gas/gas_settings.js:56-57`): Σ `maxFeesPerGas × gasLimits`, an `Fr`. Nulo's `getEstimatedFee` / `computeMaxFee` (`tx-fee-details.ts:14`, `utils/fee-estimation.ts:41-49`) adds the teardown limits on top | **reuse-as-is** `getFeeLimit().toBigInt()`; `maxFee` is the display figure and overstates the node's check |
| Who pays | `TxSimulationResult.publicInputs.feePayer` (`@aztec/stdlib` 5.2.0 `dest/tx/simulated_tx.d.ts:124-126`, `dest/kernel/private_kernel_tail_circuit_public_inputs.d.ts:71`), the kernel's payer, the same `tx.data.feePayer` the node checks. A `DefaultSponsoredFpc` row is validated by function name and signature only (`fpc/handlers/default-sponsored-fpc-handler.ts:9-17`, `fpc/service.ts:421-423`) | **reuse-as-is** the kernel's payer from the strategy's final simulation; never the row's address alone |
| The node a transaction goes to | `BuiltStandardTx.node` and `.network` (`tx-request-builder.ts:72-74`), returned by every strategy (`FeeEstimate extends BuiltStandardTx`, `fee-strategy.ts:72-74`); the node is a retrying 60 s client (`aztec-node-factory-adapter.ts:55`, `utils/fetch.ts:112-122`) | **reuse** `.network` for the endpoint; **not** `.node` for the probe, whose lost race would leave its retries running |
| A bounded, single-attempt node read | `NodeFactory.probeChainId` (`node-factory-port.ts:26-34`, `aztec-node-factory-adapter.ts:58-68`): `makeSingleAttemptFetch(timeoutMs)`, whose abort covers the body read (`fetch.ts:34-69`) | **adapt**: `readPublicStorageOnce(rpcUrl, contract, slot, timeoutMs)` beside it, through `NetworkService` on the row's primary endpoint (`network/service.ts:763-765`), outside its `rpcMethods` (`:167-186`) |
| Keeping the SDK's RPC logging out of the log buffer | `createSafeJsonRpcClient` logs a malformed body and a fetch error at `warn` and params/results at `debug` (`@aztec/foundation` 5.2.0 `safe_json_rpc_client.js:75-77`, `:124`, `:164-166`) to `config.log` or its own pino logger (`:29`), which in the extension writes through `console.*` at `LOG_LEVEL: "verbose"` (`vite.config.ts:323-326`); `createAztecNodeClient` takes no logger (`@aztec/stdlib` 5.2.0 `aztec-node.js:371-383`) | **build new**: `SILENT_RPC_LOG`, a no-op `Logger` passed as `config.log` by the probe's client only |
| Where the sponsor is named | `FpcStrategy.buildAndEstimate` resolves the row (`fpc-strategy.ts:101-106`); `Fpc.infoData` carries `type` and `address` (`fpc/fpc.ts:14-16`); each path's last simulation is at `:142`/`:157` (fast) and `:265` (Pass 2) | **adapt**: the strategy names the sponsor on its `FeeEstimate` when the final simulation's payer is the row (no I/O); the estimate entry points probe between their cancellation checks |
| A deadline on the read | `withTimeout` in `stores/balances.store.ts:124-138`, a popup store and an auto-imported export (`types/auto-imports.d.ts:336`) | **not needed**: the single-attempt transport's own abort is the deadline, and a race would not stop the request |
| Carrying a verdict to the popup | `TransferFeeEstimate` (`packages/wallet-bridge/src/fee.ts:46-75`), plain JSON over the port, returned by `transfer-executor.ts:414-419` and `dapp-send-executor.ts:336-344` | **adapt**: one optional field, `{ fpcId, address, funded }` |
| Comparing the verdict's contract with the row's | `sameFieldAddress` (`packages/wallet-bridge/src/field-address.ts:26-29`, exported at `index.ts:24`); `updateFpcAddress` keeps the id when the address changes (`fpc/service.ts:375-381`) | **reuse-as-is** |
| Ignoring a held key | `isRepeatOrComposing` (`composables/usePopupEntity.ts:5-7`), used by two popups | **reuse-as-is** on the token card's Retry |
| Treating a sponsor as unusable | `buildFeeMethods` disables self-paid rows with a reason (`fee-helpers.ts:230-274`); `FeeMethodSelector.vue:57-67` renders `disabledReason`; `resolveSavedSelection` honours `disabled` for `fj` and `private_fpc` only (`fee-helpers.ts:148-161`); `defaultSponsor` (`:220-222`) and `isEligible`'s `fpc` case (`fee-privacy.ts:33-34`) ignore it | **adapt**: a sponsor row can be `disabled`, and the three readers honour it, so a short sponsor behaves as a missing one (#718's O4 (a), owner-signed) |
| Dropping a verdict from a superseded estimate | the fee-estimation engine drops a stale run's result (`composables/internal/fee-estimation-engine.ts:103-110`, `:205-212`) | **reuse-as-is**; a test holds an estimate across an account switch |
| Dropping an unasked choice when its row stops qualifying | `onFpcUpdated`'s `chosenUnasked && !fpc.isProtocol` (`FeeSettingsCard.vue:346-348`) | **reuse-as-is** the pattern |
| A notice row in the fee card | the degraded row (`FeeSettingsCard.vue:797-802`, testid `fee-init-degraded`, which shows `PRIVATE_GAS_UNCHECKED` on a private hold, `:376-384`) and the nudge (`:813-826`) | **adapt**: a sibling row, its own testid; it takes the private-hold sentence's place so one row shows |
| Wire-shaped execute-window fee tests | `OperationCard.fee.test.ts:70-104` (`field()`, `sendTx()`, `NULO_SPONSOR`, `HAND_ADDED`) | **reuse-as-is** |
| Token card states | `SelectTokenCard.vue:21-22` (`ready` / `loading` / `empty` via `data-state`), keyboard at `:67-68` | **adapt**: a `failed` state and a `retry` event |
| The page's token load | `refetchIdentityScopedState` (`send.vue:530-574`), sequence-guarded, one `Promise.all` of tokens, balances and contacts, each its own client and port (`:88`, `:135`, `:188`; `extension-messaging/src/background/client.ts:66`) to one background, each rejected on a disconnect and reconnected at once (`client.ts:80-97`), so a restart can refuse one after another answered; `awaitingNewToken` (`:86`, set at `:603-605`) moves the active token to the first one on the next non-empty list (`:468-476`) | **adapt**: a `tokensFailed` ref reset before the incomplete-identity return (`:534`) and set by the current fetch's rejection; Retry calls the same function; `awaitingNewToken` only after a successful empty load |
| Applying a URL preselect after a load, once | `applyQueryContact` (`send.vue:515-524`) | **reuse-as-is** the pattern for `route.query.tokenId`, which today applies only at mount (`:596-601`) |
| A real unfunded sponsor in e2e | `contracts-register.test.ts` registers an instance through the playground; `fixtures/aztec.ts:175-181` derives SponsoredFPC instances by salt; Settings → FPCs has `fpc-new-btn`, `fpc-address-input`, `fpc-name-input`, `new-fpc-submit` (`settings-crud.test.ts:134-170`); `addFpc` needs the instance in the local PXE (`fpc/service.ts:266-274`, `@aztec/pxe` 5.2.0 `dest/pxe.js:365-366`) | **adapt**: register a salt-1 SponsoredFPC instance through the playground, add it by hand, pick it by `data-fpc-id` (#719) |
| Holding a port reply in a capture | ux-owner-picks' throwaway capture spec held `getTokenBalances` in the page (`ux-owner-picks/lessons/phase-5.md`, step 6 and the `rows` root cause) | **reuse-as-is** the technique, uncommitted |

Search trail for "is there already a sponsor balance read": `rg "getPublicStorageAt|getFeeJuiceBalance|balance_of_public"` over `apps/extension/src` and `packages/*/src`: only `auth-registry.ts` (auth registry slots) and `gas-balance-reader.ts` (the account's own balance). Nothing reads an FPC's balance. After round 1: `rg "computeFeePayerBalance|feePayer"` over the pinned `@aztec/*` `dest/` found the protocol's slot function and the kernel's payer field above; `rg "publicInputs.feePayer"` over `apps/extension/src` finds no reader yet.

## Conventions to match

- Background logging: `logDebug` with a named object property; balances never logged, only whether
  a leg read and funded (`gas-balance-reader.ts:197-200`). An error's message survives `trim()`
  except for URLs (`wallet/logger/utils.ts:160-175`), so an outcome-only line carries no error. The
  SDK's own client logging reaches the same buffer through `console.*` unless silenced (above).
- A read that failed is unknown, never zero (`GasBalances` doc, `packages/wallet-bridge/src/fee.ts:37-41`;
  `fee-helpers.ts:95-104`).
- Fee card state derives from props and the committed snapshot; a user pick is never overwritten
  by a data refresh (`FeeSettingsCard.vue:175-189`, `:288-293`).
- Card copy: 12px secondary text beside an `info` or `warning` icon (`:797-826`); empty-state
  labels are uppercase by CSS (`SelectTokenCard.vue:183-199`).
- Tests red first on the base; wire-shaped fixtures for the execute window (CLAUDE.md § UI changes).
- `@aztec` couplings get a line in `UPDATE.md` § Types coupled to `@aztec` shape.

## Collision and dedup risks

- `FeeSettingsCard.vue`, `fee-helpers.ts`, `fee-privacy.ts`: #718 rewrote the default sponsor here;
  this plan builds on it. `fix/send-amount-exact` edits `FeeCostReadout.vue` (a testid only); this
  plan does not touch it.
- Embedded fee payments: the execute window hides the fee card for them (`popup/windows/execute/index.vue:349-361`,
  `OperationCard.vue:292-312`) and `EmbeddedStrategy` estimates them; this plan does not touch
  either (F-2).
- `send.vue`: `failed-send-check` edits Send's submit and failure path (`send-submit.ts`, the
  journal copy); this plan touches only the token loaders and the token card's props. `send.test.ts`
  gains a case from `fix/send-amount-exact` (`:284-306` on that branch); the token-load describe
  (`:744-930` here) is disjoint.
- `FeeMethodSelector.vue`: #719 (merged, `85c4d20f`) added `data-fpc-id` at `:59`; this plan does not
  edit the file, and its e2e selects a row by it.
- `packages/wallet-bridge/src/fee.ts`: an internal wire type, not one of the three npm-staged
  packages (CLAUDE.md § The wallet repo).
- Two readers of a Fee Juice balance after this change (`gas-balance-reader.ts`, the new helper)
  on different paths (a view simulation with an account, a storage read without one); unifying
  them would change the account reader's failure domain, so they stay separate.
