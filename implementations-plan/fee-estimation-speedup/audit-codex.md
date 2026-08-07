# audit-codex.md — fee-estimation-speedup

## Round 1 — fresh session, xhigh, read-only sandbox

- **Verdict**: `reject (with blocking findings: the FPC one-pass collapse is invalid for PrivateFPC, and real-fee discovery silently widens the authwit-signing surface)`
- **Packet**: full plan.md (outline A + competing outline B) + recon.md; adversarial/security + assumption-attack + implementation-critique asks.
- **Verbatim response**: [audit-codex-r1-response.md](audit-codex-r1-response.md)

### Main-agent verification of the two blocking findings (both CONFIRMED against source)

1. **PrivateFPC pass 1 is load-bearing, not vestigial.** `@alejoamiras/private-fee-juice` computes `max_gas_cost` from the transaction's gas-settings envelope inside the Noir contract (`fpc_lib` `get_max_gas_cost`; TS docs: "Credits (amount − max_gas_cost) to msg_sender"; 3 artifact hits). Simulating `pay_fee` under the `GasSettings.forEstimation` envelope (which `buildStandard` applies by default) would compute an absurd `max_gas_cost` — balance exhaustion / extra note selection / revert. Today's Pass 1 exists to install a *bounded* envelope before the FPC call simulates. Plan's Inference 4 and the unconditional "send fpc 2→1" target are invalidated **for PrivateFPC**.
2. **Real-payload discovery widens the auto-signing surface.** `FpcService.addFpc` accepts arbitrary user-supplied contract addresses (ABI-shape validation only). Today a malicious user-added "sponsor" whose call emits `CallAuthorizationRequest` is structurally denied an authwit (discovery builds app-only with `PREEXISTING_FEE_JUICE`; the later validated sim fails absent the authwit → estimate fails). Folding discovery over a request that *includes* the fee payload converts that denial into an auto-signed authorization. Confirmed mechanism; the plan's "superset-faithful" framing was wrong for this negative-security property.
3. **Canonical `SponsoredFPC.sponsor_unconditionally` is envelope-independent** (verified in aztec-packages Noir source: sets fee payer + `end_setup()`, reads nothing) — so a single-pass collapse remains valid for the *canonical, address-pinned* Sponsored FPC (the default fee method on non-mainnet networks).

### Disposition of remaining findings (High/Medium/Low)

| Finding | Disposition |
|---|---|
| A1 split FPC semantics (PrivateFPC keeps two-pass; canonical-Sponsored-only collapse) | **Adopted** — targets revised per-handler |
| F2 fingerprint must cover normalized FeeOptions + execution mode; canonical nested-value encoding with strict type allowlist | **Adopted** |
| F3 reuse entry must carry `txCalls` + `pendingPublicAuthwits` (post-send bookkeeping); never cache profile-bound handles | **Adopted** |
| A2 chain-identity revalidation in the consume ladder (snapshot + re-fetch `l1ChainId`/`rollupVersion`, fail closed) | **Adopted** |
| I1 skipTxValidation gas-neutrality: verified fact but justifies no optimization | **Accepted** (no plan change; sim B stays) |
| A3 cancellation resource contract (dedupe tokens, per-profile keying + caps, ownership-safe cleanup; honest speed claims) | **Adopted** |
| Boundary: strategy-external discovery orchestrator; typed sim request instead of `SimulateTxFn` opts growth; `estimateId` in an approval-RPC envelope, NOT on `packages/wallet-bridge` `Operation` | **Adopted** (envelope = per-op id array on the `approveInteraction` payload, extension-local) |
| gh-stack "private preview requiring enablement" vs plan's "public preview" | **Disputed** — official GitHub changelog (2026-07-30) says public preview; codex cites gh-stack docs saying private. Phase 0's verify-first design covers both; no plan change beyond noting the dispute. |
| A-vs-B: keep A's validated-sizing stance, reject B (repeats the PrivateFPC bug + unproven stub pad + one-PR risk concentration) | **Adopted** — B formally rejected in ledger |

## Final fresh-context pass — new session, xhigh, read-only, on REVISION 2 + full ledger + both r1 transcripts

- **Verdict**: `reject (with blocking findings: estimate handoff is canceled by its own cleanup, the Sponsored fast path changes custom-limit behavior, and reuse/cancellation validation remains incomplete)`
- Verbatim response: [audit-codex-final-response.md](audit-codex-final-response.md)

### Dispositions (ALL adopted → revision 3)

| Finding | Disposition |
|---|---|
| H1 handoff race: cancel-on-unmount evicts the entry the fire-and-forget confirm is about to consume (Send navigation + execute-window close both hit it) | **Adopted** — ownership-handoff protocol: successful submit/approve disarms unmount cancellation for handed-off tokens; reject/dismiss still cancels+evicts; race tests pinned on both flows (Phase 2 + Phase 4 gates) |
| H2 Sponsored fast path not behavior-preserving under dApp `op.fee.gasLimits` (custom limit would constrain app+FPC instead of app-only) | **Adopted** — fast-path eligibility narrowed: custom-limit ops stay on the two-pass path |
| H3 reuse binds `fpcId` only; in-place FPC row address edit ⇒ signed request calls stale address | **Adopted** — resolved-identity snapshot `{id,type,address,chainId,isProtocol}` revalidated at consume, fail-closed |
| H4 fingerprint omits `teardownGasLimits` + `maxPriorityFeesPerGas`; base-fee validation must be payment-aware for explicit `maxFeesPerGas` | **Adopted** — full FeeOptions in the pinned scope + payment-aware ladder rule |
| H5 no per-profile/global active caps (r1 A3 requirement dropped in r2); "bounded" claim false — queued sims are the resource | **Adopted** — per-profile cap, cancel-oldest, counting unsettled jobs until completion |
| M1 "pure extractor" contract internally impossible (chain-bound hashing; lazy node-info ordering); recommend deferring the split | **Adopted** — Phase 5 slimmed to stub-opt threading; discoverer split moved to the follow-up charter (fable-vs-codex disagreement recorded, ledger #11) |
| L1 canonical Sponsored address is artifact-derived (network-independent), not "chain-derived"; discriminator spec + cold-cache/reset race tests | **Adopted** — Inference 3 corrected; discriminator = type + pinned address + row/network chain match; races test-pinned in Phase 3 |

## Re-verdict on revision 3 — resumed final-pass session

_Recorded below when it lands._
