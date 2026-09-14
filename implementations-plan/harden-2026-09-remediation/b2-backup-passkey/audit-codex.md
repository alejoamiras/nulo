# harden-b2-backup-passkey — codex audit transcript

## Round 1 — 2026-09-14, GPT-6 Astra `high`, session `01a0a125-5a36-7163-a747-c2ff3c15bd1c`

Prompt: the plan, recon, seed rows F-03/F-04/F-05, the verified findings, the touched code, the arc map, the owner's constraints, six open asks (A–F), the no-over-engineering rule verbatim.

### Response (paths made repo-relative)

Read-only review; no tests run or files modified. Confidence: **high** on the code findings below.

1. **Blocking — reseeding a non-active profile changes the active profile’s node cache.**  
   Plan `plan.md:15`; [`network/service.ts:306`](apps/extension/src/wallet/services/network/service.ts:306). `activateSeededLocked()` writes `this.nodes`, which is keyed only by `chainId`. While profile A remains active, restoring B can replace A’s cached mainnet node with B’s default endpoint. `getNode()` returns that cached node without checking ownership (`:721`). This can redirect A’s traffic before B finalizes.  
   **Smallest plan change:** reuse seed construction, but make restore-time activation write only B’s persisted pointer; leave cache population to normal active-profile access. Add a test with A using a custom endpoint, reseed B, then assert A’s `getNode()` still uses A’s endpoint. Phase 2’s stated storage/remap tests would miss this. Fix it here; do not defer it to B3.

2. **Should-fix — a deletion epoch does not establish that the target profile exists.**  
   Plan `plan.md:15`; [`restore-fence.ts:19`](apps/extension/src/wallet/services/restore-fence.ts:19). `captureRestoreEpochs()` accepts any nonempty, unreserved ID. After deletion completes, the reservation is released; a later call can capture the new epoch and seed orphan rows successfully. An unknown ID also passes this fence.  
   **Smallest plan change:** capture the epoch before asynchronous target validation, require a live target profile, and reassert under the network lock before writes. Specify repeat-call behavior so it cannot duplicate `(profileId, chainId)` rows or reset existing endpoint configuration. Test nonexistent, already-deleted, mid-delete and repeated calls. The composable must pass only `newProfile.id`; the epoch itself provides neither target authorization nor existence validation. This is an internal-RPC correctness issue, not a demonstrated dApp-accessible attack.

3. **Should-fix — the RP injection gate contradicts the current manifest, and the tests lack an explicit locked-value pin.**  
   Plan `plan.md:19,26`; [`manifest.config.ts:35`](apps/extension/manifest/manifest.config.ts:35). `matches: ["*://*/*"]` already covers `passkey.nulo.sh`. Changing the host permission alone cannot satisfy “no content-script match covers the RP host.” Also, checking permission equality against `RP_ID` proves consistency, not the owner’s selected value.  
   **Smallest plan change:** explicitly exclude the RP host and its descendants from injection, and test effective matching, including exclusions. Pin `RP_ID === "passkey.nulo.sh"` separately. Keep the repository deployment check small; it cannot verify dashboard-managed hosting. Document that `*.passkey.nulo.sh` must also remain free of application content: those descendants remain RP-eligible under the domain-suffix rule. [WebAuthn specification](https://www.w3.org/TR/webauthn-3/#relying-party-identifier).

4. **Should-fix — the fixture inventory misses several guaranteed failures.**  
   Plan `plan.md:30,35`; [`helpers/import-drivers.ts:406`](apps/extension/tests/e2e/helpers/import-drivers.ts:406), [`passkey-backup.test.ts:152`](apps/extension/tests/e2e/passkey-backup.test.ts:152), [`import-dead-rpc.test.ts:226`](apps/extension/tests/e2e/import-dead-rpc.test.ts:226). Both synthetic-backup builders emit `network`; the dead-RPC suite modifies it to reach its stub. They will reject at normalization, before exercising their intended behavior. Consumers include import-paths, backup-migration and the network profile-reimport matrix.  
   **Smallest plan change:** include these builders and consumers in Phase 2. Give successful fixtures seeded chain identities. Preserve explicit retired-slice rejection fixtures. Retarget dead-RPC tests through the test harness’s seeded endpoint, preserving refused/blackhole/post-probe deadline assertions; merely removing their network slice loses that coverage.

5. **Should-fix — the remap’s trust claim and malformed-input behavior need tightening.**  
   Plan `plan.md:15,41`; [`account-state/service.ts:284`](apps/extension/src/wallet/services/account-state/service.ts:284). A backup author can change an account-state item’s `chainId` to mainnet, and the proposed remap will register its contents there. Equality with a seeded chain proves routing consistency with the **claimed** chain, not the contents’ original provenance. Furthermore, processing only items carrying both fields leaves missing-`chainId` items with raw `networkId` values; transaction `networkId` is optional.  
   **Smallest plan change:** define behavior explicitly for the two affected slices: use strict numeric lookup against seeded rows, never fall back to an imported network ID, drop/report malformed or unsupported account-state chain identities, and assign transaction network IDs from their valid chain even when the old ID is absent. Preserve bounded account-state error handling. Test chain `0`, conflicting old IDs, missing/malformed chain IDs and duplicate claimed chains. Replace “cannot graft” with the narrower guarantee that imported data cannot define the destination network or endpoint. No new authenticity scheme belongs in B2.

6. **Should-fix — retaining the obsolete restore implementations is not required by the messaging contract.**  
   Plan `plan.md:17`; [`background/service.ts:99`](packages/extension-messaging/src/background/service.ts:99). The base class already supplies null-returning `backup/restore` defaults. Keeping the network override preserves an internal RPC that accepts arbitrary HTTPS endpoints; keeping FPC restore preserves an unnecessary row-insertion path. These are protected internal RPCs, so this does not establish a backup-file bypass.  
   **Smallest plan change:** delete the four service overrides and their now-unused helpers/imports. If explicit rejection is desired, override `frameworkRpcMethods` with an empty set in these two services. Update their direct tests. No shared messaging-contract rewrite is necessary.

**A. Reseed design — keep the centralized chain remap and `active-chain-id`.** It preserves selection without distributing restore logic across services. Treat the pointer as an untrusted preference: strict numeric membership in returned seeds, including `0`; otherwise retain the primary seed. An attacker can select among approved seeded endpoints by selecting a chain, but cannot supply an arbitrary endpoint through this field. Likewise, relabeling account-state remains possible; the backup is not authenticated provenance. Dropping the pointer would simplify code but unnecessarily discard existing restore behavior.

**B. Old backups — keep fail-closed rejection.** This fits the locked pre-production baseline and requires the least compatibility code. Tolerate-and-strip could also be safe if done before normalization and restoration; it is not intrinsically insecure. There is simply no user-compatibility requirement here that justifies it. Test `network` and `fpc` independently, including empty slices.

**C. Dead RPC surface — remove the implementations now.** The actual removal is two override pairs, unused validation/import cleanup and affected tests. The inherited convenience methods can remain inert, or the existing per-service framework allowlist hook can reject them. Retaining substantive restore code as a “larger contract change” overstates the work.

**D. Developer Mode — creation-only is acceptable.** Existing custom networks should remain manageable and removable. This is a user-experience gate, not authorization against compromised extension code. Phase 3’s positive/negative button tests prove its core behavior; add a small assertion that existing custom-row management and seeded endpoint editing remain usable with Developer Mode off.

**E. `.well-known/webauthn` — unnecessary for this design.** The extension uses host-permission-based RP authorization, not related-origin authorization. The well-known document enables the latter and should not be added. Browser support is version-specific; Mozilla documents this mechanism from Firefox 150 and Chrome 122. Host provisioning remains the owner’s task. [Browser documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Use_the_web_authn_api), [related-origin specification](https://www.w3.org/TR/webauthn-3/#sctn-related-origins).

**F. Registry removal — no migration acknowledgement is required now.** `IMPORT_BLOCKING_ACK` records migration versions; the real migration list is empty. Update registry entries, export/import callers, fixtures and compatibility documentation, then run footprint coverage. Future migrations touching these now-unmapped roots will already trigger the coverage guard. CI’s network specs additionally prove real PXE registration, fresh post-import balances, the build-stamped local endpoint and service-worker restart persistence. Local unit/composition tests must prove hostile remap cases and deterministic deletion/cache races; successful network roundtrips do not cover those. Phase 2 is currently missing those proofs; Phase 3’s principal gate is sound.

**reject — blocking item 1: restore-time seeding contaminates the active profile’s node cache.**

## Round 2 — 2026-09-14 (same session)

Prompt: the plan revised per round 1 (per-item summary), re-verify.

### Response (paths made repo-relative)

The original cache-isolation blocker is resolved. One new blocker remains; confidence: **high**.

1. **Blocking — the dead-RPC fixture assumes ownership of the compiled seed’s port.**  
   [`plan.md:30`](implementations-plan/harden-2026-09-remediation/b2-backup-passkey/plan.md:30) says the stub binds that port. The default is `localhost:8080`; network builds instead stamp the running sandbox’s port. Neither belongs to this stub. Concurrent runs can therefore get `EADDRINUSE`, and the REFUSED case can contact a real node rather than observe refusal. Serializing tests within one Vitest process does not isolate other agents.

   **Smallest plan change:** retain ephemeral, run-owned stub ports and redirect the seeded URL within this test’s browser, covering the service-worker/offscreen requests. Alternatively, reserve a dedicated stub port and stamp it through the existing `VITE_LOCAL_NETWORK_RPC_URL` into an isolated test build. Never bind the sandbox’s port or assume an unreserved port is unused. Preserve the three failure-class assertions.

The other round-1 revisions adequately address the findings at plan level. No additional should-fix items. No tests run or files modified.

**reject — blocking: dead-RPC stub port ownership and run isolation.**

## Round 3 — 2026-09-14 (same session)

Prompt: the dead-RPC fixture redesigned to CDP `Fetch` interception on the service-worker and offscreen targets with ephemeral run-owned stub ports.

### Response

approve
