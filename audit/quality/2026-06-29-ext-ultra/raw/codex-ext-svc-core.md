### Q1 Operation-kind policy is split across string switches
- Smell: Switch Statements + Shotgun Surgery
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 6 scoped files/modules
- Instances: `packages/extension/src/wallet/services/dapp-interaction/materialize.ts:44-61`, `packages/extension/src/wallet/services/dapp-interaction/materialize.ts:76-126`, `packages/extension/src/wallet/services/dapp-interaction/service.ts:346-390`, `packages/extension/src/wallet/services/dapp-interaction/service.ts:467-515`, `packages/extension/src/wallet/services/execution/service.ts:355-454`, `packages/extension/src/wallet/services/execution/dapp-send-executor.ts:130-164`, `packages/extension/src/wallet/services/execution/operation-planner.ts:257-267`, `packages/extension/src/wallet/services/execution/contract-resolver.ts:85-107`
- Evidence: `OperationKind` is a discriminant union from `packages/wallet-bridge/src/operation.ts:12-14`, but this scope re-lists the same kind strings for request materialization, session permission validation, access-level mapping, execution dispatch, primary-method extraction, and action contract extraction. Several paths also fall back to casts/defaults instead of exhaustiveness checks, e.g. `materialized as unknown as Operation` at `dapp-interaction/service.ts:294`, `default: return AccessLevel.None` at `dapp-interaction/service.ts:513-514`, and `default: throw new Error("Invalid operation")` at `execution/service.ts:452-453`.
- Why it harms future change: adding or renaming one dApp operation kind requires coordinated edits across materialization, authorization, access policy, execution dispatch, and display extraction. TypeScript will not reliably point to every missed policy because the switches are not backed by `satisfies Record<OperationKind, ...>` or `never` exhaustiveness.
- Refactoring: Replace Conditional with Polymorphism / typed registry → introduce an `OperationPolicy` table keyed by `OperationKind` for materialize/validate/access/execute metadata, or derive extension policy from the existing wallet-bridge method descriptor registry where possible.
- Effort: days
- Confidence: high

### Q2 Aztec.js payload normalization is duplicated across standard and no-from paths
- Smell: Duplicate Code
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 3 scoped files plus the shared `FeeOptions` type
- Instances: `packages/extension/src/wallet/services/execution/operation-planner.ts:166-250`, `packages/extension/src/wallet/services/execution/tx-request-builder.ts:412-424`, `packages/extension/src/wallet/services/execution/dapp-send-executor.ts:492-500`, `packages/wallet-bridge/src/operation.ts:59-70`
- Evidence: `OperationPlanner.processAztecJsPayload` parses capsules, auth witnesses, extra hashed args, and projects fee gas options including `maxPriorityFeesPerGas`. `TxRequestBuilder.buildNoFrom` repeats the parsing loops and explicitly comments that it is “same as processAztecJsPayload”. `DappSendExecutor.executeNoFromSendTx` separately constructs `FeeOptions` from the same `op.opts.fee.gasSettings` shape.
- Why it harms future change: any upstream Aztec payload field, auth-witness carrier, or fee option added to `ExecutionPayload`/`FeeOptions` must be threaded through multiple hand-maintained paths. The current comments already show the maintainers know these branches must stay in sync.
- Refactoring: Extract Function / Introduce Parameter Object → centralize `parseAztecPayloadParts(exec, opts)` and `projectFeeOptions(exec, opts, defaults)` so standard, simulate, and no-from paths consume the same typed projection.
- Effort: hours
- Confidence: high

### Q3 Profile secret/key material uses overloaded primitive strings
- Smell: Primitive Obsession
- Lens: typing
- Maintenance impact: structural
- Blast radius: 5 scoped profile modules plus backup/import callers
- Instances: `packages/extension/src/wallet/services/profile/spec.ts:18-35`, `packages/extension/src/wallet/services/profile/spec.ts:183`, `packages/extension/src/wallet/services/profile/spec.ts:191`, `packages/extension/src/wallet/services/profile/spec.ts:214`, `packages/extension/src/wallet/services/profile/spec.ts:230`, `packages/extension/src/wallet/services/profile/spec.ts:250-262`, `packages/extension/src/wallet/services/profile/client.ts:76-110`, `packages/extension/src/wallet/services/profile/service.ts:620-628`, `packages/extension/src/wallet/services/profile/service.ts:651-654`, `packages/extension/src/wallet/services/profile/service.ts:699-742`, `packages/extension/src/wallet/services/profile/service.ts:761`, `packages/extension/src/wallet/services/profile/service.ts:886-913`, `packages/extension/src/wallet/services/profile/service.ts:981`, `packages/extension/src/wallet/services/profile/session-manager.ts:202-215`, `packages/extension/src/wallet/services/profile/passkey-recovery-coordinator.ts:38-41`
- Evidence: the same primitive `string` shape represents encrypted profile secret, plain base64 master key, passkey credential id, exported “plain” value, restore `masterKey`, and persisted passhash bearer. Comments distinguish the meanings, but the type system does not.
- Why it harms future change: backup/restore and import/export changes can mix encodings or key modes without a compile-time error. The service then relies on profile-type branches, byte-length checks, and comments to recover the intended meaning.
- Refactoring: Replace Primitive with Object / Introduce Branded Types → add branded serializable types such as `EncryptedSecretB64`, `PlainMasterKeyB64`, `PasshashB64`, `PasskeyCredentialId`, and a discriminated restore/export payload instead of `masterKey: string` / `Promise<string>`.
- Effort: days
- Confidence: high

## Likely false-positive checks
- The `null!` service fields in `execution/service.ts:91-137`, `dapp-interaction/service.ts:63-68`, `dapp-session/service.ts:49`, and `profile/service.ts:60-61` match the documented service-init / composition-root DI convention; I would not score them without evidence of pre-init access.
- The 3-copy `nulo-schema-patch.ts` duplication is documented in `CLAUDE.md` and is outside this requested scope.
- Fee-strategy similarity is tempting to overstate, but the files carry parity/byte-shape constraints; I would audit that separately before calling it removable duplication.

## Summary
3 findings; highest-value is Q1 because it turns every new `OperationKind` into multi-file policy surgery.