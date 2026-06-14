# Implementations plan index

Format: `- [plan-name](plan-name/plan.md) — status — one-line hook`

- [faucet-bridge](faucet-bridge/plan.md) — completed (mega-deep) — L1↔L2 Portal bridge shipped into the faucet (public PR #76, private PR #78); swap/fuel remains a future arc
- [bridge-ux-trust](bridge-ux-trust/plan.md) — implemented (deep), awaiting manual testnet validation — swap-style bridge form + in-flight journal + seal-trust cache; PV5 HIGHs folded in
- [bridge-ux-feedback](bridge-ux-feedback/plan.md) — implemented (mid), awaiting manual testnet validation — live card narration, self-resolving dones, dual balances, direction chips, explorer links
- [bridge-form-stepper](bridge-form-stepper/plan.md) — shipped in PR #80 — takeover stepper, CAS foreground, dopamine UX
- [bridge-seal-backup](bridge-seal-backup/plan.md) — shipped in PR #81 — per-bridge sealed recovery file + restore
- [token-identity](token-identity/plan.md) — implemented + deployed (mid), awaiting manual testnet validation — NULO/OLUN/AZLO live, isTokenRegistered + contracts field-diff re-consent
- [execution-decomposition](execution-decomposition/plan.md) — completed (PR #83, awaiting manual QA + merge) — facade 2,302 → 746 lines, 3 executors + lane, zero behavior change
- [swap-fuel](swap-fuel/plan.md) — foundation merged (deep), private gas + B-presets in follow-up — bridge-and-fuel: atomic AZLO deposit + V4 two-hop slice→FeeJuice (live fee-987 pools), fjwc self-paying claim + inclusion-grade recovery; fuel withheld on private bridges until private FeeJuice ships
- [private-fuel](private-fuel/plan.md) — in progress (deep), approved; P0 ✓ (keystone: DOM_SEP=3952304070 + FPC `0x1b1706cc…` pinned, tripwire + 104/104). Ask 1 resolved: testnet 4.3.1 is backward-compatible with the 4.2.0 artifact (user-confirmed). Next: P1 plumbing — private Fee Juice via Wonderland PrivateFPC; gas-follows-token, B-presets, fee-method matrix
