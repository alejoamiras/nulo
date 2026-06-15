# Implementations plan index

Format: `- [plan-name](plan-name/plan.md) — status — one-line hook`

- [faucet-bridge](faucet-bridge/plan.md) — completed (mega-deep) — L1↔L2 Portal bridge shipped into the faucet (public PR #76, private PR #78); swap/fuel remains a future arc
- [bridge-ux-trust](bridge-ux-trust/plan.md) — implemented (deep), awaiting manual testnet validation — swap-style bridge form + in-flight journal + seal-trust cache; PV5 HIGHs folded in
- [bridge-ux-feedback](bridge-ux-feedback/plan.md) — implemented (mid), awaiting manual testnet validation — live card narration, self-resolving dones, dual balances, direction chips, explorer links
- [bridge-form-stepper](bridge-form-stepper/plan.md) — shipped in PR #80 — takeover stepper, CAS foreground, dopamine UX
- [bridge-seal-backup](bridge-seal-backup/plan.md) — shipped in PR #81 — per-bridge sealed recovery file + restore
- [token-identity](token-identity/plan.md) — implemented + deployed (mid), awaiting manual testnet validation — NULO/OLUN/AZLO live, isTokenRegistered + contracts field-diff re-consent
- [incoming-trust-state-machine-refactor](incoming-trust-state-machine-refactor/plan.md) — completed (mega-deep, PR #75) — global service Lock serializing the incoming-transfer trust FSM; race class closed
- [authwit-lifecycle-and-execution-followups](authwit-lifecycle-and-execution-followups/plan.md) — completed (mid; 3 plan audits + 4-way post-impl fan-out), PR #85 awaiting QA+merge — grantPublicAuthwit RPC + lifecycle e2e (CI-gated) + exec follow-ups; audit caught+fixed a dead scope gate
- [execution-decomposition](execution-decomposition/plan.md) — completed (PR #83, awaiting manual QA + merge) — facade 2,302 → 746 lines, 3 executors + lane, zero behavior change
- [swap-fuel](swap-fuel/plan.md) — foundation merged (deep), private gas + B-presets in follow-up — bridge-and-fuel: atomic AZLO deposit + V4 two-hop slice→FeeJuice (live fee-987 pools), fjwc self-paying claim + inclusion-grade recovery; fuel withheld on private bridges until private FeeJuice ships
- [e2e-proverless-stub](e2e-proverless-stub/plan.md) — all phases ✓, PR #86 (deep; 3 plans + audit round + post-impl codex audit) — proverEnabled:false for bulk network e2e + SW-side barrier-gated stub for sequencing/cancel + prover-ON canaries; double-opt-in + DCE + negative-grep prod guard
- [private-fuel](private-fuel/plan.md) — in progress (deep), approved; P0–P3 code ✓ (private fuel deposit→claim end-to-end + no-fuel L7 faucet-only; faucet 330/330, bridge-core 107/107). Remaining: sandbox-gated P2 network-e2e + P4 live dust-canary + P5 harden — private Fee Juice via Wonderland PrivateFPC; gas-follows-token, B-presets, fee-method matrix
- [bridge-security-remediation](bridge-security-remediation/plan.md) — PR A merged (F-005/F-007); PR B cut over to testnet, awaiting review (deep, codex-guided deploy rework) — init-once portal (F-001) + single-minter proxy (F-002) + swapTarget-bound/non-zero-minOutput fuel (F-004/F-006); testnet-validated (both bridge paths + on-chain re-init revert); F-003 deferred, F-008 skipped
