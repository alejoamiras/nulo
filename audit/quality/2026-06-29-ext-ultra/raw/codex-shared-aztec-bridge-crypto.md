### Q-001 PXE Method Surface Is Hand-Declared 6 Times
- Smell: Duplicate Code / Shotgun Surgery
- Lens: dedup
- Maintenance impact: architectural
- Blast radius: 6 files, 7 synchronized surfaces
- Instances: packages/aztec-runtime/src/pxe/spec.ts:24-80; packages/aztec-runtime/src/pxe/ipxe.ts:27-49; packages/aztec-runtime/src/pxe/subset.ts:25-44; packages/aztec-runtime/src/pxe/proxy.ts:26-103; packages/aztec-runtime/src/pxe/client.ts:76-199; packages/aztec-runtime/src/pxe/service.ts:60-82,190-452
- Evidence: the same PXE method set is retyped as `Methods`, `IPXE`, subset keys, proxy forwarding methods, client request/rehydration methods, service `defineRpcMethods`, and service implementations.
- Why it harms future change: adding or changing one PXE RPC requires coordinated edits across transport type, facade, proxy, client validation, service registry, and implementation; omission can compile unless the specific subset guard catches that boundary.
- Refactoring: Extract Method Table / Generate Facade from Canonical Registry -> derive `IPXE`, proxy forwarding, RPC method list, and validation metadata from one method descriptor table.
- Effort: days
- Confidence: high

### Q-002 Artifact Catalog And Class-Id Work Are Duplicated
- Smell: Duplicate Code
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 2 loaders
- Instances: packages/aztec-runtime/src/pxe/known-artifacts.ts:10-21,40-68; packages/aztec-runtime/src/pxe/note-schemas.ts:3-8,66-83
- Evidence: Token, NFT, Wonderland Token, and Private FPC artifacts are imported/loaded in both files, then `getContractClassFromArtifact` is run in both loaders to compute the same class ids.
- Why it harms future change: an Aztec bump or artifact alias change must update two catalogs and two cache regimes; note schemas can drift from the artifacts actually exposed by known-artifact resolution.
- Refactoring: Extract Class / Single Source Catalog -> one `KnownArtifactCatalog` returns artifact, class id, optional instance, and optional note schema metadata.
- Effort: hours
- Confidence: high

### Q-003 Capability Request Flow Bypasses Its Own Union
- Smell: Schema/Type Drift analog: the `Capability` discriminated union exists, but request/response plumbing degrades it to `unknown[]` and `Record<string, unknown>[]`, forcing re-casts and repeated type checks.
- Lens: typing
- Maintenance impact: structural
- Blast radius: 4 files/modules
- Instances: packages/wallet-bridge/src/capabilities.ts:16-20,53-59; packages/wallet-bridge/src/dapp-interaction-protocol.ts:143-153; packages/wallet-bridge/src/dispatcher.ts:173-236,240-243,694-916,922-965; packages/wallet-bridge/src/method-scope-checkers.ts:42-53,65,77,91,103,121,139,160,182,199,228,231
- Evidence: `CapabilityManifest.capabilities?: unknown[]`, popup params/results use `unknown[]`, `handleRequestCapabilities` casts requested/granted caps through `Record<string, unknown>` and `as unknown as <Capability>`, while coverage helpers duplicate enforcement matching logic.
- Why it harms future change: adding or extending a capability type requires updating delta detection, popup merge, enrichment, and enforcement coverage separately; type drift is easy because the compiler cannot prove all `Capability["type"]` cases are handled.
- Refactoring: Replace Conditional With Polymorphism / Extract Strategy -> `Capability["type"]` keyed handlers with typed parse, coverage, merge, enrich, and enforcement helpers.
- Effort: days
- Confidence: high

### Q-004 Secret Bytes And Wire Encodings Are Primitive-Typed
- Smell: Primitive Obsession / Stringly-Typed
- Lens: typing
- Maintenance impact: structural
- Blast radius: 4 wallet-crypto files plus callers
- Instances: packages/wallet-crypto/src/encryption-key.ts:11,34,54,87,97; packages/wallet-crypto/src/password-secret-box.ts:57-73,80,96,103,122,136,156-174,192; packages/wallet-crypto/src/passkey-credential.ts:7-13,24-29,36-43,53-63; packages/wallet-crypto/src/zeroize.ts:33,39,46
- Evidence: passhash, salt, ciphertext, guard, profile secret, passkey id, PRF output, and user handle are all bare `ArrayBuffer`, `Uint8Array<ArrayBuffer>`, `Buffer<ArrayBuffer>`, or `string`; casts at password-secret-box.ts:157,169,174 and passkey-credential.ts:63 paper over representation differences.
- Why it harms future change: callers can swap base64 fields or pass the wrong byte buffer type without compiler help, and every new crypto consumer must rediscover ownership/zeroize/encoding semantics manually.
- Refactoring: Replace Primitive With Object / Introduce Branded Types -> `Passhash`, `MasterSecretBytes`, `Base64Ciphertext`, `Base64CredentialId`, `Base64SecretPrf`, `HexUserHandle`, plus shared `toBase64/fromBase64` helpers.
- Effort: days
- Confidence: high

## Likely False-Positive
`nulo-schema-patch` triplication is real duplicate code at packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts:45-119, packages/faucet/src/lib/nulo-schema-patch.ts:22-96, and packages/playground/src/lib/nulo-schema-patch.ts:21-95, but CLAUDE.md documents it as an intentional boundary tradeoff to avoid exporting wallet-bridge to third-party dApps.

## Summary
4 findings; highest-value fix is Q-001, the 6-surface PXE method duplication.