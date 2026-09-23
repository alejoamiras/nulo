## Findings

### 1. Every `WalletError` subclass repeats its runtime identity setup

**Smell:** Duplicate Code. Eleven subclasses repeat the same `this.name = "<class>"` plus `Object.setPrototypeOf(this, <class>.prototype)` constructor tail.

**Impact bucket:** local — one file/module, 11 classes. Change frequency: high relative to the cluster; `errors.ts` changed in 7 commits between May and August 2026.

**Evidence:** Each constructor delegates its distinct code/message/details to `WalletError`, then repeats identical name/prototype initialization:

- `packages/extension-messaging/src/errors.ts:47-54`
- `packages/extension-messaging/src/errors.ts:68-75`
- `packages/extension-messaging/src/errors.ts:99-106`
- `packages/extension-messaging/src/errors.ts:125-132`
- `packages/extension-messaging/src/errors.ts:153-160`
- `packages/extension-messaging/src/errors.ts:175-182`
- `packages/extension-messaging/src/errors.ts:186-193`
- `packages/extension-messaging/src/errors.ts:201-209`
- `packages/extension-messaging/src/errors.ts:219-226`
- `packages/extension-messaging/src/errors.ts:238-245`
- `packages/extension-messaging/src/errors.ts:261-268`

The base already performs the same operation for itself at `packages/extension-messaging/src/errors.ts:28-35`.

**Why it harms future change:** Any adjustment to error identity handling—for example, accommodating a different compilation target or adding another cross-realm identity field—requires editing every subclass. Adding a new error also requires remembering this non-domain-specific constructor ritual.

**Smallest safe refactoring:** **Pull Up Method / Pull Up Constructor Behavior**. Have `WalletError` assign the explicit error name and set the prototype using `new.target.prototype`; subclasses supply their stable name through `super`. The 22 repeated identity statements disappear while each subclass retains its distinct signature and message defaults.

**Instances:** `errors.ts:47-54`, `68-75`, `99-106`, `125-132`, `153-160`, `175-182`, `186-193`, `201-209`, `219-226`, `238-245`, `261-268`.

---

### 2. Both messaging transports implement the same error-shaping quartet

**Smell:** Duplicate Code, with a small Shotgun Surgery surface. Both transport clients reconstruct remote errors, construct typed timeout/send errors with the same metadata, and construct the same disconnect error. Only the human-readable timeout/send messages differ.

**Impact bucket:** structural — two transport modules plus their shared base contract, three files total. Change frequency: both client files changed in 4 commits between May and August 2026.

**Evidence:**

Background transport:

- Remote-error delegation: `packages/extension-messaging/src/background/client.ts:134-136`
- Timeout error and `{requestId, methodName}` details: `packages/extension-messaging/src/background/client.ts:138-143`
- Send-failure error and `{requestId, methodName, cause}` details: `packages/extension-messaging/src/background/client.ts:145-151`
- Disconnect error: `packages/extension-messaging/src/background/client.ts:153-155`

Offscreen transport:

- Remote-error delegation: `packages/extension-messaging/src/offscreen/client.ts:113-115`
- Timeout error and identical details shape: `packages/extension-messaging/src/offscreen/client.ts:117-122`
- Send-failure error and identical details shape: `packages/extension-messaging/src/offscreen/client.ts:124-130`
- Disconnect error: `packages/extension-messaging/src/offscreen/client.ts:132-134`

The shared base requires all four implementations at `packages/extension-messaging/src/core/base-client.ts:259-269`, although both transports now use the same error types and remote decoder.

**Why it harms future change:** Adding common diagnostic metadata, changing the disconnect contract, or changing remote-error reconstruction requires coordinated edits in both transports. A transport-specific wording difference makes it easy to mistake the entire construction policy for transport-specific behavior.

**Smallest safe refactoring:** **Pull Up Method** combined with **Template Method**. Give `BaseServiceClient` concrete implementations for remote and disconnect errors, and centralize timeout/send error construction there. Retain small overridable message-formatting hooks for the genuinely different wording. The duplicated error classes, detail-object assembly, cause normalization, and two one-line delegators disappear.

**Instances:** `background/client.ts:134-155`; `offscreen/client.ts:113-134`; abstract duplication-enforcing contract at `core/base-client.ts:259-269`.

---

### 3. Schema-method installation repeats one registration algorithm three times

**Smell:** Duplicate Code. `applyNuloSchemaPatch` contains three copies of the same algorithm: detect an existing key, skip an identical schema, inspect Zod internals for compatibility, throw a tailored drift error, or install the patch.

**Impact bucket:** local — one function/file with three registration branches. Change frequency: `apply.ts` changed in 2 commits between May and August 2026. Runtime behavior is consumed through the package’s registration entry point, but the change locus is one module.

**Evidence:**

- `registerToken` branch: `packages/wallet-sdk-schema-patch/src/apply.ts:55-74`
- `isTokenRegistered` branch: `packages/wallet-sdk-schema-patch/src/apply.ts:76-90`
- `grantPublicAuthwit` branch: `packages/wallet-sdk-schema-patch/src/apply.ts:92-111`

Each branch repeats:

1. `"methodName" in schema`
2. Fetch the existing entry
3. Fast-path identity comparison
4. Extract and inspect `existing.def.input.def.items`
5. Throw a method-specific compatibility message
6. Otherwise assign the patched schema

**Why it harms future change:** Adding another custom RPC encourages copying an entire branch. Any revision to upstream-signature handling, Zod-internal access, or diagnostic wording must then be propagated across every branch.

**Smallest safe refactoring:** **Extract Function**. Introduce an internal `installSchemaMethod` accepting the method key, patch schema, compatibility predicate, and expected-signature description. Replace the three branches with three declarative calls. The repeated lookup, identity check, throw construction, and assignment control flow disappear.

**Instances:** `apply.ts:55-74`, `76-90`, `92-111`.

## Non-findings

- `Lock` versus `ReadWriteGuard`: rejected. Their queues, acquisition rules, ownership state, and force-release semantics are materially different; extracting a shared concurrency base would couple two distinct state machines for little removed duplication.
- `normalizeError` versus `WalletError`: rejected. They project hostile input into different storage and RPC contracts, so the superficial envelope similarity does not represent one change reason.
- `BaseServiceClient` and `BaseService`: rejected. They already centralize the substantial request/service lifecycle duplication; their remaining transport hooks represent real routing and lifecycle differences.
- `PasswordSecretBox` versus `SessionSecretBox`: rejected. Both use AES-GCM, but password stretching, persisted formats, key derivation, authentication context, and failure contracts deliberately differ.
- Schema patch `apply.ts` versus `register.ts`: rejected. The latter is a necessary side-effect adapter and contains only a single call, not duplicated patch logic.
