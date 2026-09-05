# connect-chain-mismatch — codex plan audit

Session `01a07268-aca2-79d2-86a7-3eed84474c4d` (gpt-5.6-sol, xhigh, read-only). Prompt: plan.md +
recon.md + the standard packet (adversarial/security · assumption-attack · implementation critique · copy).

## Round 1 — response (verbatim)

**1. Security & adversarial**

- **Medium — I1 understates the change.** A dApp would trigger persistent account creation before capability approval; creation writes storage and emits `onAccountAdded` (`apps/extension/src/wallet/services/account/service.ts:255`). Configured endpoints constrain the target, but “once per chain” is false: unsuccessful creation leaves no default, so subsequent requests can probe again (`account/service.ts:196`; `network/service.ts:375`). Specify bounded retry behavior before accepting this exposure.
- **Medium — `{ chainId, error }` does not guarantee address-free logs.** Error projection preserves message text and scrubs URLs; it deliberately does not redact addresses or arbitrary embedded secrets. Prefer a controlled failure reason over an unrestricted exception message (`apps/extension/src/wallet/logger/utils.ts:163`; `CLAUDE.md:125`).

**2. Assumption attack**

**Facts**

- **Medium — F4 is only an entry check.** The unlocked-profile gate precedes dispatch; account creation subsequently reads the secret, awaits verification/derivation, then checks a deletion fence before writing. A lock after secret acquisition does not necessarily produce `unauthorized`. Correct the claimed guarantee and test both timing cases (`apps/extension/src/wallet/services/wallet-sdk/background.ts:880`; `account/service.ts:227`; `account/service.ts:254`).
- **Low — F8’s reproduction is sound, but “inside the sandbox” overstates isolation.** Testnet has a public RPC, and popup bootstrap starts network-status synchronization. Starting on Testnet therefore retains an external-network dependency (`apps/extension/src/wallet/services/network/service.ts:110`; `apps/extension/src/composables/useProfileBootstrap.ts:77`; `apps/extension/src/stores/app.store.ts:429`).

**Inferences**

- **Medium — I4 has a counterexample:** a chain containing only hidden imported accounts. `getAccounts` returns no visible rows, while `ensureDefaultAccount` excludes imported rows and creates a visible derived account. The proposed flow consequently permits approval instead of preserving the promised all-hidden error. Distinguish zero rows from zero visible rows and pin this case (`apps/extension/src/wallet/services/account/service.ts:168`; `account/service.ts:201`; `account/service.ts:249`).
- **Medium — I1/I2 need revision:** pre-approval mutation is a changed trigger, and operational failure is not evidence of account absence. See the security findings and failure-handling recommendation below.
- **Low — I3/I5 are substantially supported.** Approval constructs CAIP identifiers from window-local selected accounts; the network watcher replaces the shell’s account client/store. Discovery parameters contain only metadata (`apps/extension/src/popup/windows/capabilities/index.vue:202`; `apps/extension/src/popup/app.vue:113`; `apps/extension/src/wallet/services/dapp-interaction/spec.ts:97`). However, activation serialization explicitly covers only one popup realm (`apps/extension/src/utils/guarded-network-activation.ts:15`).

**Asks**

- **Medium — Surface the actual policy choices:** repeated custom-endpoint probes, persistence after the user rejects, and hidden-imported-only behavior. “Accepted once-per-chain probing” does not settle repeatable failure behavior; copy and merge authority do not settle these product decisions.

**3. Implementation critique**

- **Low — (a) Prefer the required dependency and wiring adapter.** Optional provisioning makes correctness depend silently on the host. Keeping account type/name in the extension respects the narrow consumer boundary; `IAccountReader` becomes a misleading name once it provisions accounts (`packages/wallet-bridge/src/services-contract.ts:10`; `services-contract.ts:40`; `apps/extension/src/wallet/services/account/service.ts:196`).
- **Medium — (b) Do not collapse every derivation exception into `[]`.** Prefer rejecting with a sanitized operational error, especially for authorization failure. If wallet-side presentation is required, carry an explicit failure state. Today an empty list becomes a hard error with no recovery path, while the dApp request awaits the interaction (`apps/extension/src/popup/windows/capabilities/index.vue:146`; `packages/wallet-bridge/src/dispatcher.ts:1089`).
- **Low — (c) One thin activation wrapper is reasonable.** Reuse the existing guard and feedback ladder. As C1, receive connected clients or callbacks instead of introducing hidden manager ownership; preserve parent-controlled teardown (`apps/extension/src/popup/pages/settings/networks/[id].vue:68`; `CLAUDE.md:221`; `CLAUDE.md:291`).
- **Low — (d) Compute the name locally.** The session already supplies the chain string and bootstrap supplies network rows. Additional wire metadata adds little; gate the action until a matching row exists (`packages/wallet-bridge/src/session-types.ts:59`; `apps/extension/src/composables/useProfileBootstrap.ts:63`).
- **Medium — (e) Add approval without switching.** The proposed e2e exercises only the optional switch. Assert the returned address, unchanged active network, and successful approval separately. Also cover Approve/Reject during a pending switch and repeated switch clicks: Banner invokes callbacks directly, and its loading prop does not disable the action (`packages/design/src/ui/Banner.vue:58`). Arm popup listeners before triggering requests (`apps/extension/tests/e2e/fixtures/extension.ts:287`).
- **Low — (f) No necessary budget breach.** The cited dispatcher method has 70 nonblank lines; `init()` has 47. Helpers outside those bodies preserve headroom; cognitive complexity still requires measurement, not inference from length (`packages/wallet-bridge/src/dispatcher.ts:1044`; `apps/extension/src/popup/windows/capabilities/index.vue:118`; `CLAUDE.md:82`).

**4. Copy**

- **Medium — Suppress the normal invitation on hard errors.** “Approve as is” is misleading when derivation failure/all-hidden disables Approve. Preserve the locked wording for eligible requests (`apps/extension/src/popup/windows/capabilities/index.vue:361`).

conditional approve (with conditions: correct probe and lock assumptions, preserve all-hidden behavior, distinguish operational failures, gate misleading copy, and add no-switch and switch-race coverage)

## Round 1 — triage

Adopted: the unattended rule (probe-free kinds only, chain has no rows of any kind —
`AccountService.provisionDefaultAccount`, `NetworkService.derivesOffline`); no swallowing (rejections
propagate as the dApp error envelope); F4 corrected to an entry gate; banner hidden while the hard error
shows; no-switch e2e added; re-entry + pending-approve guard on the switch action; the C1 composable
receives persist/read callbacks; the action only with a matching row; `IAccountProvisioner` split instead
of widening `IAccountReader`.

Rejected: a timing test for a lock landing after the secret read (the row write is secret-free and
identical to an in-flight switch — benign); an e2e for approve-vs-switch (a timing race is not a
deterministic browser test; the guard is a two-line check).
