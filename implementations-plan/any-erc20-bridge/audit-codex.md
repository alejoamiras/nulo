# audit-codex.md — any-erc20-bridge

All codex transcripts for this plan, in order. Session ids are recorded so later rounds resume the right context.

## Round 0 — independent plan draft (2026-09-01)

- Session `01a05ef7-6f15-7280-97d6-ce0c7a6adfa7`, model gpt-5.6-sol, effort xhigh, read-only sandbox.
- Prompt: the planning packet (`brief.md`, `recon.md`, `research/*`) + the 7-section plan template.
- Output: [drafts/plan-codex.md](drafts/plan-codex.md).
- Notable independent positions (ledger candidates): hub recomputes CREATE2 in the AVM and needs `bind_l1(factory, implementation)` not an init-code hash (A1); salt bytes must be ratified (A2); reject fee-on-transfer at exact-in (A4); guardian renounce must be disabled (A5); mainnet UI must be disabled rather than keep the retired Circle bridge (A7); public first claim = one L2 tx, private = two; spikes + keystones as Phase 1 before any L1 code.

## Round 0.5 — contradiction check (resumed session, 2026-09-02)

- Same session, resumed with the consolidated `plan.md` + ledger. Transcript: [audit-codex-contradiction.md](audit-codex-contradiction.md).
- 9 contradictions + 4 silent resolutions, all wording/consistency or ledger gaps; **no D3–D5 residue**. Dispositions in the ledger (D14 amended, D18–D19 added) and the plan text.

## Round 1 — full packet (resumed session, 2026-09-02)

- Transcript: [audit-codex-r1.md](audit-codex-r1.md). Verdict: **NOT-READY** (blocking SEC-1, SEC-2, SEC-5, SEC-8, INF-3, ASK-1, IMP-1, IMP-3).
- Dispositions (all adopted unless noted): SEC-1 tuple test → P1; **SEC-2 router portal rule per entrypoint → D23** (real design bug); SEC-3 create-before-pull; SEC-4 router owner in threat model; SEC-5 journal union → D18 amended; SEC-6 streaming cap + `redirect: "error"`; SEC-7 hooks/continuity asserted off-chain; SEC-8 exit preflight + burn-before-finish warning; SEC-9 idempotent hub/class → D2 amended; SEC-10 cross-token authwit replay → P4; SEC-11 TXE server deps via committed lockfile → D24; SEC-12 decimals bounds tests; FACT-1 corrected (faucet tab renders on mainnet); FACT-2 I3 demoted (and made moot by D11 revision); FACT-3 qualified; INF-1..4 adopted; ASK-1 A1 framed as a brief amendment; ASK-2/3/4 split; IMP-1 → D22 wallet regrant; **IMP-2 partially** — `str<31>` stays the baseline, words-only is a P0 spike (the `[u8;31]→str<31>` conversion is unverified on 5.0.1) → D21; IMP-3 fork in P1 + forge/halmos in P3/P4; IMP-4 `--crate` verbatim; IMP-5 two-leaf test; SCOPE-1 `derive_token` view dropped; SCOPE-2 one TS conductor, Solidity script = fixture.

## Round 2 — resumed self-critique (2026-09-02)

- Transcript: [audit-codex-r2.md](audit-codex-r2.md). Verdict: **NOT-READY** (M1, M2, M3, M4, B-ASK-1).
- Retractions accepted: SEC-1/SEC-5 were Medium (O1/O2); SEC-8 residual is D3-intrinsic and owner-accepted; IMP-3 mechanical (O3); INF-3 pinnable (O4).
- Dispositions: **M1** authoritative `PortalCreated` words + post-receipt re-derive (portal is metadata-independent so the recovery domain is stable); **M2** claim-time branch on `token_for` + race retry + relayer-first/concurrent tests; **M3** CI compiles the hub with the pinned toolchain and compares class id/bytecode to the committed artifact (P0 probes whether `aztec-nargo compile` transpiles; else install the transpiler in CI); **M4** selection epoch + serialized regrants + returned-scope verification; M5 halmos `check_*` names committed; V1 D22 rewritten to the real widen/replace semantics (`dispatcher.test.ts:1488`); V2 D11 confirmed; D21 keep `str<31>` unless the spike proves round-trip + keystone parity + a proving-cost win; witness stays 12 fields (dispute closed); ownerless hub = testnet-acceptable, `/harden security` made a blocking mainnet decision on recovery/migration; B-ASK-1 goes to the owner at the gate as A1.

## Round 3 — final fresh-context pass (NEW session, 2026-09-02)

- Session dir `codex-rjmE35L7`, gpt-5.6-sol, xhigh, read-only; given plan + brief + recon + every prior transcript. Transcript: [audit-codex-final.md](audit-codex-final.md).
- **`VERDICT: conditional approve`** — conditions dispositioned in the plan (D36–D39, D14/D18/D28 amended, A7 removed, A6 reframed as required, A9 added). One condition resolved differently: exact *recipient-credit* on withdraw rejected (it would brick every withdrawal of a token that later enables a tax); exact *portal-debit* adopted (D37). The I4 correction (a stranded publish nullifier is NOT inert) was real and is closed structurally by consuming the register message in the private phase (D36) rather than by proving rollback.
