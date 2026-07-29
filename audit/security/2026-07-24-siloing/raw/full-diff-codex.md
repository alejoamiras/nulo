## Findings

### 1. Legacy transactions are attributed to whichever same-address profile is active

**Impact:** Confidentiality and integrity; transaction history, counterparties, amounts, and activity metadata can cross between profiles sharing a mnemonic/address. Blast radius is every legacy transaction for the shared account and chain.

**Exploitability:** Local UI vector; low complexity; no special privileges beyond access to another same-mnemonic profile; user interaction requires switching/unlocking that profile. **Confidence: high.**  
**Mapping:** CWE-639 (Authorization Bypass Through User-Controlled Key), CWE-200; OWASP A01 Broken Access Control.

**TRACE:** Legacy rows are accepted without ownership fields at [transaction/spec.ts:164] (`apps/extension/src/wallet/services/transaction/spec.ts:164`) → decoded from shared storage at [transaction/service.ts:56] (`apps/extension/src/wallet/services/transaction/service.ts:56`) → fetched solely by address at [transaction/service.ts:90] (`apps/extension/src/wallet/services/transaction/service.ts:90`) → after profile B is active, filtered only by address and chain and installed wholesale into B’s slice at [app.store.ts:187] (`apps/extension/src/stores/app.store.ts:187`) and [activity.store.ts:149] (`apps/extension/src/stores/activity.store.ts:149`) → the render guard explicitly accepts missing `profileId` at [activity-rows.ts:62] (`apps/extension/src/utils/activity-rows.ts:62`) → row renders at [activity-rows.ts:72] (`apps/extension/src/utils/activity-rows.ts:72`).

**Missing control:** Legacy records need durable ownership migration/quarantine. Address plus chain is not a profile identity.

**Exploit story:** Alice imports one mnemonic into profiles A and B. An older A transaction lacks `profileId/networkId`. Opening B fetches it by the identical derived address and writes it directly into B’s active slice, disclosing A’s history as B’s.

**Preconditions:** Same derived address and chain; at least one pre-scope transaction.

**Why mitigations fail:** JSON slice keys are sound, but the row is assigned B’s scope before keying. UI checks intentionally fail open for missing ownership. Lock-time `clearAll` removes memory, but the next durable fetch recreates the leak.

**All instances:** Wholesale fetch attribution above; event attribution through the same fail-open rule at [activity.store.ts:64] (`apps/extension/src/stores/activity.store.ts:64`); both archive and recent-feed guards accept missing profile IDs at [activity-rows.ts:62] (`apps/extension/src/utils/activity-rows.ts:62`) and [RecentActivityView.vue:109] (`apps/extension/src/popup/components/modules/general/RecentActivityView.vue:109`).

### 2. Resolver candidate mismatch files a dApp send under the wrong account and hides cancellation

**Impact:** Integrity and availability; misleading audit history plus loss of the visible cancel path/account switching during the send. Blast radius is one profile’s activity UI and account-switch control.

**Exploitability:** Connected dApp with a transaction grant and multi-account session; moderate state setup, low attack complexity; no interaction needed to enqueue, although approval may be required. **Confidence: high.**  
**Mapping:** CWE-863 (Incorrect Authorization), CWE-362 (Shared-resource state inconsistency); OWASP A01.

**TRACE:** dApp `sendTx` reaches pre-journaling at [background.ts:263] (`apps/extension/src/wallet/services/wallet-sdk/background.ts:263`) → queued resolution requests hidden and visible accounts using `all=true` at [queued-journal.ts:120] (`apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:120`) and chooses the first authorized account at [account-resolution.ts:58] (`packages/wallet-bridge/src/account-resolution.ts:58`) → journal records account A at [queued-journal.ts:173] (`apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:173`) → dispatcher requests only visible accounts at [dispatcher.ts:1357] (`packages/wallet-bridge/src/dispatcher.ts:1357`), because omission of `all` filters hidden rows at [account/service.ts:91] (`apps/extension/src/wallet/services/account/service.ts:91`), and therefore sends from B → journal claim reuses A’s record without validating `accountAddress/networkId` at [claim-helper.ts:89] (`apps/extension/src/wallet/services/execution/claim-helper.ts:89`) → A’s record is hidden while viewing B at [RecentActivityView.vue:278] (`apps/extension/src/popup/components/modules/general/RecentActivityView.vue:278`), while the profile-wide guard still blocks switching at [in-flight-send.ts:35] (`apps/extension/src/utils/in-flight-send.ts:35`) and [AccountsPopup.vue:34] (`apps/extension/src/popup/components/popups/AccountsPopup.vue:34`).

**Missing control:** Both resolutions must use the identical eligible-account set, and queued-record claim must verify profile, network, and account against the executed operation.

**Exploit story:** A session is authorized for A and B; A is later hidden and has the lower index. A no-`from` send is queued under A but dispatched from visible B. While proving, its cancel card is invisible under B, yet it blocks switching profile-wide.

**Why mitigations fail:** The shared function receives different inputs. Caps and the reaper bound individual stale records but do not correct attribution or expose cancellation; repeated sends sustain the denial.

**All instances:** Omitted and `NO_FROM` sends share this path; both silent and confirmation execution reuse the unchecked queued ID.

## What’s genuinely solid

- JSON tuple encoding resists separator, quote, bracket, Unicode, and prefix-forgery attacks.
- Backup import unconditionally remaps child `profileId`s before restore and duplicate-checks composite account identity.
- Explicit out-of-session `from` remains fail-closed.
- Lock-time activity clearing and LRU eviction do not leave inactive rows reachable through the active slice.