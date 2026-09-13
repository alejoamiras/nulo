You are a Phase 2 cluster auditor in a map-reduce security audit. Working directory is the repo root (a git worktree of origin/dev). READ FIRST, in this order: `audit/security/2026-09-13-high-prerelease/raw/CONTEXT.md`, then `audit/security/2026-09-13-high-prerelease/raw/SECURITY-PROMPT.md` (the exact audit prompt + negative list + output format — follow it exactly), then the repo-map files named below for orientation. Then read the cluster source files IN FULL (not excerpts). Verify every claim against the code; cite file:line. Do not modify any file except your output file.

# Cluster c07-approval-window-binding — what the user sees vs what executes: approval windows, interaction service, window manager, token registration display

Repo maps: `raw/repo-map/extension-services-dapp-exec.md` (§0 steps 7–8, §3d, §3h), `raw/repo-map/extension-shell.md` (windows section).

Source files (read all, in full):
- `apps/extension/src/wallet/services/dapp-interaction/{service.ts, materialize.ts, spec.ts, client.ts}`
- `apps/extension/src/wallet/services/window-manager/window-manager.ts`
- `apps/extension/src/popup/windows/execute/*` (index.vue, OperationCard.vue, OperationActionRow.vue, operation-validation.ts, types.ts, humanize.ts and helpers), `apps/extension/src/popup/windows/capabilities/*`, `apps/extension/src/popup/windows/discover/*`, `apps/extension/src/popup/windows/verify/*`, `apps/extension/src/popup/windows/json/*`
- `apps/extension/src/composables/useDappInteractionPayload*.ts`, `useDappHostname*.ts` (or wherever hostname display lives), `apps/extension/src/components/composite/capabilities/*`
- `apps/extension/src/wallet/services/dapp-session/capability-meta.ts` (sanitizer + display meta)
- `apps/extension/src/wallet/services/token/service.ts` (`previewTokenMetadata`, `fetchTokenMetadata`, `registerToken` path, `addTokenAuthorized`), `apps/extension/src/wallet/services/token/functions/*` (interface parsing)
- `apps/extension/src/popup/components/modules/FeeSettingsCard*` and any fee UI the execute window uses
- Tests: `dapp-interaction/service.composition.test.ts`, `popup/windows/execute/*.test.ts`, `capability-meta.test.ts`.

Specific questions:
1. Displayed-vs-executed: the popup re-materialises operations from the payload and hands back the `operations` array; `approveInteraction` executes what the popup returns. Model a compromised or buggy popup and a hostile dApp separately: can the executed operation differ from what was rendered in (a) call target/selector/args, (b) `from` account, (c) chain, (d) fee payer/fee settings, (e) authwits/capsules/extra args, (f) the number of calls (chunking)? Which of those does `approveInteraction`/`executeAndResolve` re-validate against the ORIGINAL stored `interaction.payload` and which does it trust from the popup?
2. Request binding: `requestId` in the URL, `getInteractionPayload(id)` — can any internal context read/approve another window's interaction (no window-id binding?); first-claim-wins semantics; the 10-minute timeout; what happens if the user approves after the session was torn down or the profile switched (execution fence).
3. Rendering of dApp-controlled strings: method names, arg values, contract addresses, token name/symbol/decimals, dApp name/url, capability descriptions, scope patterns — for each: sanitizer applied? truncation? bidi/zero-width? homoglyph (explicitly not normalised — is there any place a lookalike token symbol or dApp hostname could be mistaken for a trusted one without the disambiguating address/punycode shown)? `v-html` anywhere? URL rendering (`javascript:`, `data:` in dApp url field)?
4. Args display: for `call`/`encoded_call` — are argument VALUES shown (fix F-08/B claimed "truthful approval display") or only names; can a dApp hide the recipient/amount of a transfer behind an `encoded_call`; is `aztec_sendTx` with an unknown-artifact contract rendered as raw selector with a warning?
5. Capability window: unknown capability types render default-off/high-risk — verify; can a dApp pre-check or auto-select anything; are scope patterns (`*` wildcards) rendered so the user understands the breadth?
6. Verify window: `verificationHash` from the URL vs the session's; can a hostile page open `chrome-extension://<id>/src/popup/index.html#/windows/verify?...` itself (web_accessible_resources says no — confirm) or influence it via a link?
7. Fee settings from the popup: bounds (can the popup set an absurd `maxFeesPerGas`/gas limit that the fee cap logic then honours as "explicit"?); embedded/self-pay detection from parsed payload only (`classifyFeePayer`) — can a dApp mislabel a self-pay to skip the popup (`silentInteraction`)?
8. Silent path: exactly which operations skip the popup, and what a dApp can do with them.
9. Window manager races (documented guards) — anything left: two windows for one request, a cancelled window resolving late, focus stealing.

Write your report to `audit/security/2026-09-13-high-prerelease/raw/c07-approval-window-binding-claude.md`.
