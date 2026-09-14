# harden-2026-09-remediation — seed (owner decisions locked 2026-09-14)

**Status:** in progress — B1 implemented, PR #592 open on the audit-docs PR #591 (2026-09-14, `b1-mechanical/plan.md`); B2 implemented, PR #594 open on #592 (2026-09-14, `b2-backup-passkey/plan.md`); B3–B4 pending. Each batch below gets its own `/blueprint` inside this arc, in order, driven by the `/goal` at the bottom.
**Source audit:** `audit/security/2026-09-13-high-prerelease/` — `report.md` (overview), `findings/verified.md` (the ten double-verified findings with strengthened traces, probes, coupled groups), `findings/consolidated.md` (all 18 + the 17 dropped items). Read `verified.md` before touching any finding it covers; read the finding's section in `consolidated.md` for the Lows.
**Home:** this arc runs in the worktree `harden-security-prerelease` (branch `worktree-harden-security-prerelease` = `dev` + the audit docs + this seed). Do NOT re-home per batch; the blueprint's Phase 0.75 is satisfied by this line. Batches are stacked branches on top of it.
**Delivery:** stacked PRs into `dev` via `gh stack` (owner decision). Stack order: `worktree-harden-security-prerelease` (PR: the audit docs + this seed) ← `harden-b1-mechanical` ← `harden-b2-backup-passkey` ← `harden-b3-isolation` ← `harden-b4-approval`. `gh stack submit --auto` opens PRs; `gh stack sync` cascades after any lower branch changes. **The goal never merges anything; the owner merges via `gh stack merge`.**
**Tiers:** B1 light, B2 light, B3 mid, B4 mid.
**Pre-production rule holds:** no storage migrations; shape changes redefine the baseline (CLAUDE.md § Persisted-storage shape changes). Reinstall locally when a shape changes.

## Owner decisions (locked — do not re-ask)

| Item | Decision |
|---|---|
| F-01 | Fix as verified: exact `l1ChainId` equality in `assertLiveChainIdentity` (plus the composite), `assertCanonicalL1ChainId` range guard on the live value, route `wallet/utils/fn.ts:85-95` through the assert, local networks compare against `LOCAL_L1_CHAIN_ID`. Mirror `network/service.ts:565-572`. |
| F-02 | Fallback = **warn + show indexed raw args, approve allowed** (no acknowledgement checkbox). Derive the recognized-transfer set and arities from `TOKEN_FN_DESCRIPTORS`; delete the second and third hardcoded lists (`utils/transfer-intent.ts`, `utils/tx-enrichment.ts`); add a pin test asserting popup vocabulary == descriptor set; authwit card renders `caller`, args, and `innerHash` with an "opaque authorization" warning; discovered authwits surfaced from the estimate result onto the card. One line in `UPDATE.md` noting the popup now derives from descriptors. |
| F-03 | **Drop the FPC slice from the backup registry entirely** (protocol FPCs re-derive; user-added sponsored FPCs are re-added by hand). Keep the picker fix as defense in depth: `fee-helpers.ts:157` and `gas-balance-reader.ts:181` select `type === PrivateFpc && isProtocol === true`. |
| F-04 | **Drop the network slice from the backup registry entirely** (seeds rebuild; custom networks/endpoints are local config, re-added by hand). **Gate "Add network" (custom networks, `NewNetworkPopup`) behind Developer Mode.** Custom endpoints on seeded networks (`NewEndpointPopup`/`EditEndpointPopup`) stay available to everyone (they already pass the exact-L1 probe). |
| F-05 | **RP ID → `passkey.nulo.sh`.** Change `RP_ID`, `manifest.config.ts` `host_permissions`, `check-rp-id.ts`; keep the drift scanner. Write the DNS/Pages requirement into the batch plan (a static page, strict CSP, no scripts, never application code). `wrangler` is not on this machine and no CF credentials are set, so the **owner provisions the subdomain**; the goal may provision only if credentials appear. WebAuthn create/get do not fetch the RP domain, so the code change is safe to land first. Must land before any real passkey wallet exists (changing RP ID later bricks them). |
| F-06 | **Mix the profile DEK into BOTH derivations** (`ikm = master ‖ dek`, as `entropy-mac.ts` does): the dApp-session MAC key (`profile/service.ts:913-933`) and the PXE store key (`packages/wallet-crypto/src/pxe-store-key.ts`). A degraded (DEK-less) session cannot open the PXE store; accepted. Fix `dapp-session/service.test.ts:26-48`, which stubs the derivation. Update `key-vectors.test.ts` V11 for the new PXE-key input. |
| F-07 | Add `profileId` + `chainId` to `Authwit` rows and the status key; scope `getAuthwits`, `purgeForAccounts`, `syncAuthwits` and the status store by `(profileId, chainId, account)`. Do NOT skip the purge on reconcile (authwit slices restore at `useFullBackupImport.ts:524` before the reconcile at `:534`); scope it. |
| F-08 | Bind name↔selector on the simulate fast path before `runFastPath` (same three lines as `execution/service.ts:900-908`); add the missing mismatch test. |
| F-09 | **DEFERRED — out of this goal.** Owner's separate Presto-migration arc. Carry two notes there: (1) confirm the production factory (`chain-runtime.ts:228-229`, `accelerator: undefined`) actually inherits Presto's `httpsOnly: true` default; (2) nobody established whether CI's `accelerator-server` serves trusted HTTPS on its port — confirm before the flip or the required-mode network gate reds. |
| F-10 | Log `Error` objects, not messages, at `pxe/service.ts:926-927` and `network/service.ts:1003`; add `scrubUrls` to the primitive-string branch of `trim()`; extend `log-payload-ban.test.ts` to flag `getErrorMessage(`/`errorMessageFromUnknown(` as a log argument. |
| F-11 | Gate every journal method on `record.profileId === activeProfile.id` (mirror `execution-lane.ts:174-177`); remove `transitionOperation`/`setOperationMeta`/`deleteOperation` from the popup-reachable `rpcMethods` (no popup caller exists); add the profile compare at `TokensView.vue:52`. |
| F-12 | `ContactService.restore` applies `sanitizeString(name, 20)`; `TokenBalanceService.restore` forces `updatedAt: 0`. |
| F-13 | Keyed account reads require `account.address === address` (or enable the composite-key identity check `liveRows` uses); `loadImportedAccountContract` compares the rebuilt address to the requested one. |
| F-14 | Add `isTrustedInternalSender(sender)` to `offscreen/client.ts:60` and the READY/PONG listeners; move store-key provisioning to a `chrome.runtime.connect` Port if the refactor is bounded (ask Codex at the B3 blueprint; sender checks are mandatory either way). |
| F-15 | `finalizePasskeyRestoreHoldingLock` rejects entries older than `PENDING_RESTORE_TTL_MS` (mirror `:221-225`); `lockActiveProfile` clears `pendingRestoreSecrets`/`pendingDekRewraps`. |
| F-16 | In B4 with F-02: materialize executable operations SW-side from the stored payload; accept from the popup only wallet-generated deltas (`feeSettings`, `previewedInterface`, estimate ids) per index; reject `approveInteraction` for payloads without `session`. |
| F-17 | Serve the discovery icon inline (data URI) and drop the `web_accessible_resources` entry; if the wallet-sdk `walletIcon` cannot take a data URI (check at the B1 blueprint), narrow `matches` instead. |
| F-18 | **Design decided with Codex at the B4 blueprint**, under these constraints: single-tab flows unchanged; a second handshake while a verify window is open is queued/reserved, never dropped; per-origin throttle (token bucket) preferred over a hard count so a reload loop is slowed, not blocked; duplicate waiters bounded per key; e2e `account-switch-live-session`, `cap-widening`, `multi-account-from` and the two-tab cells stay green; add one flood e2e (N handshakes → ≤ cap windows). |
| Hygiene (B1) | Zeroize the password buffer in `getPasshash` (`encryption-key.ts:122-125`) + the two extra copies Codex noted (c01 NF-12/13); `autocomplete` on every secret input (`create.vue`, `ImportSecretForm.vue`, `SecretUnlockSection.vue`, `change-password.vue`; mirror `auth.vue:257`); neutralize `= + - @` cell prefixes in `logs-csv.ts`; fix the two write-before-check orderings (`pxe/service.ts:449-450` registerContract, `tx-request-builder.ts:381-407` buildNoFrom); **show the full address on the account-import preview** (`import.vue:227`, July residual re-opened). |
| July residual (envelope swap) | **Stays accepted** as adjudicated in `implementations-plan/mac-identity-binding/plan.md`; re-checked 2026-09-13. Record, do not touch. |

## July 2026 lineage (what this arc inherits)

The previous whole-scope pass was `audit/security/2026-07-06-max/` (14 findings), remediated as units A–L in `implementations-plan/harden-findings-remediation/plan.md` (PR #272; unit L = PR #271). The 2026-09-13 run re-checked every unit at source: all are still in place, but three have coverage gaps and one regressed in vocabulary. Each gap is a finding in this arc; nothing from July is re-implemented, only completed.

| July unit | July finding(s) → band | What it fixed | Status 2026-09-13 | Closed by this arc |
|---|---|---|---|---|
| A | F-01 Critical, F-02 High, F-08 Medium | raw-hash authwit rejected; name↔selector bound at every signing sink; dispatcher arg-shape validation | intact; the later `simulateTx` fast path never got the bind | F-08 (B1) |
| B | F-02 (display) High, F-07 Medium | truthful approval display; bidi/zero-width sanitizer | sanitizer intact; transfer-recognition vocabulary drifted from the token model | F-02 (B4) |
| C | F-03 High | one validated `getNodeInfo` threaded, no re-fetch | threading intact; the July HELD XOR collision was never closed | F-01 (B1) |
| D | F-04 Medium | discovery flood caps 32/4 | caps intact, bypassed on the reconnect branch; verify window uncapped | F-18 (B4) |
| E | F-06 Medium | restore cannot flip `strictSecurityMode` or restore the passhash | intact | — |
| F | F-05 Low | `img-src` CSP for dApp logos | intact; the logo is still web-accessible to every origin | F-17 (B1) |
| G | F-09, F-10 Low | sender auth on the offscreen service listeners; Firefox instance token | intact service-side; SW-side client, READY/PONG, and the broadcast primitive never covered | F-14 (B3) |
| I | F-12 Low | per-row DappSession HMAC | intact; key derivation does not separate same-phrase siblings | F-06 (B3) |
| J | F-13 Low | ValueStorage parse containment | intact | — |
| K | F-14 Low | clipboard scrub on secret copies | intact | — |
| L | F-11 Low | session-only wrapped-secret bearer (`SessionSecretBox`) | intact (both families, c01) | adjacent: F-15 (B1) |

July's two explicitly HELD items (the XOR collision, High; a simulation-only `getNodeInfo` re-fetch in `batched-view-simulation.ts`, Medium) are both inside F-01's instance list and close with it. The two July-era accepted residuals are adjudicated in the decision table above (envelope swap stays accepted; truncated import address re-opened in B1).

Before July, the `2026-06-08-ultra-e6759a` run (12 findings, 8 High / 4 Medium) was remediated in code; its controls carry `F-00x` markers (`F-001` subframe rejection, `F-003`–`F-006` scope enforcement, `F-011` RPC-URL allowlist, `F-012` chain check) and were all re-verified intact on 2026-09-13. F-01 is what completes `F-012`.

## Batches

### B1 — `harden-b1-mechanical` (light)
F-01, F-03 (picker half only), F-08, F-10, F-12, F-13, F-15, F-17, all Hygiene items.
Gates: `bun run audit:vue`; the new unit tests (chain-identity collision KAT, fast-path mismatch, picker isProtocol, TTL, log-scrub); `bun run test:e2e` (smoke: popup files touched). Network e2e runs on the PR in CI.
Open asks for Codex at blueprint: `assertCanonicalL1ChainId` placement for local networks; F-17 data-URI acceptance by the wallet-sdk `walletIcon`; whether F-13's fix should be the `liveRows` identity check or an explicit compare.

### B2 — `harden-b2-backup-passkey` (light)
F-03 (drop FPC slice), F-04 (drop network slice + Developer-Mode gate on custom networks), F-05 (RP subdomain).
Gates: `audit:vue`; `backup/footprint-coverage.test.ts` and the registry tests updated for the two removed slices; `check-rp-id` build gate; `bun run test:e2e`; the passkey e2e cells that exist (`PRF-NON-PORTABLE.md` lists what can run). Network e2e on the PR.
Open asks for Codex: whether removing a slice needs an `IMPORT_BLOCKING_ACK`-style acknowledgement or only registry edits; whether a `.well-known/webauthn` file is needed on `passkey.nulo.sh` (expected: no — no related-origin requests); how the Developer-Mode gate should degrade for a profile that already has custom networks.
Owner action recorded in the plan: provision `passkey.nulo.sh` (static page, strict CSP, no scripts).

### B3 — `harden-b3-isolation` (mid)
F-06, F-07, F-11, F-14.
Gates: `audit:vue`; `key-vectors.test.ts` updated deliberately (V11) with the reason in the commit; `cross-profile-isolation.test.ts` extended (journal, auth-registry); `dapp-session/service.test.ts` stops stubbing the derivation; `bun run e2e:agent` on the multi-profile/import cells locally (`profile-reimport` matrix, passkey cells) — shard per memory.
Open asks for Codex: degraded-session UX for the PXE-key change (what the user sees); Port vs sender-check for F-14; whether the journal write RPCs have any non-popup internal caller that goes through the client.

### B4 — `harden-b4-approval` (mid)
F-02, F-16, F-18.
Gates: `audit:vue`; component tests for `OperationCard.vue` (unverified fallback, authwit caller/args, discovered authwits); the pin test popup-vocabulary == descriptors; `bun run test:e2e`; `bun run e2e:agent` on the dApp cells (`account-switch-live-session`, `cap-widening`, `multi-account-from`, two-tab, the new flood cell).
Open asks for Codex: the F-18 design (mandatory consult, constraints above); the F-16 delta API shape; whether the discovered-authwit list can be returned from the estimate without changing the wire `Operation`.

## Protocol per batch (what the goal does, in order)
1. `/blueprint <tier>` for the batch **inside this worktree**. Phase 0 clarifying questions are answered from this seed; anything not answered here goes to `/codex` at high effort with the seed + the finding's `verified.md` section as context; decide on the stronger argument; log the consult + verdict in `implementations-plan/harden-2026-09-remediation/lessons/b<N>.md`. Never block on the owner.
2. Branch `harden-b<N>-<slug>` stacked on the previous batch's branch (`gh stack`); implement per the batch plan; tests inline; commit small and signed (this machine's key is non-interactive).
3. Run the plan's post-implementation Codex fix loop until it converges; local gates as listed; `gh stack submit --auto` (opens/updates PRs; never merges); `gh stack sync` if a lower branch moved.
4. Mark the batch plan's Status line `implemented, PR open`; update `implementations-plan/index.md`; move to the next batch.
Hard limits: never merge (`gh pr merge`, `gh stack merge`); never push to `dev`/`main`; never force-push a branch another human touched; no secrets, no auth flows; scope is this seed — a new finding discovered along the way is logged in lessons and left for the owner, not fixed.

## Seeds

```
/goal Every batch B1–B4 in implementations-plan/harden-2026-09-remediation/seed.md is done: blueprinted at its tier inside this worktree (B1, B2 light; B3, B4 mid) with every open ask resolved via /codex and logged in lessons/, implemented on its stacked branch, the post-implementation codex fix loop converged, the batch's local gates green, submitted as a stacked PR into dev via gh stack submit --auto, its plan.md Status line reading "implemented, PR open", and its index.md row updated. F-09 stays deferred. Never merge; the owner merges.
```

```
/loop 15m Drive implementations-plan/harden-2026-09-remediation/seed.md forward; never idle. Each firing: read seed.md + the current batch plan + lessons/; run git status; pick the next unfinished step of the current batch (blueprint → implement → codex loop → gates → gh stack submit); consult /codex on any decision you would otherwise bring to the owner and log it; commit small and signed; never merge, never push to dev or main.
```
