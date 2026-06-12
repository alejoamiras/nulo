# Implementations plan index

Format: `- [plan-name](plan-name/plan.md) — status — one-line hook`

- [faucet-bridge](faucet-bridge/plan.md) — completed (mega-deep) — L1↔L2 Portal bridge shipped into the faucet (public PR #76, private PR #78); swap/fuel remains a future arc
- [bridge-ux-trust](bridge-ux-trust/plan.md) — implemented (deep), awaiting manual testnet validation — swap-style bridge form + in-flight journal + seal-trust cache; PV5 HIGHs folded in
- [bridge-ux-feedback](bridge-ux-feedback/plan.md) — implemented (mid), awaiting manual testnet validation — live card narration, self-resolving dones, dual balances, direction chips, explorer links
- [bridge-form-stepper](bridge-form-stepper/plan.md) — shipped in PR #80 — takeover stepper, CAS foreground, dopamine UX
- [bridge-seal-backup](bridge-seal-backup/plan.md) — shipped in PR #81 — per-bridge sealed recovery file + restore
- [token-identity](token-identity/plan.md) — implemented + deployed (mid), awaiting manual testnet validation — NULO/OLUN/AZLO live, isTokenRegistered + contracts field-diff re-consent
- [incoming-trust-state-machine-refactor](incoming-trust-state-machine-refactor/plan.md) — completed (mega-deep, PR #75) — global service Lock serializing the incoming-transfer trust FSM; race class closed
- [authwit-lifecycle-and-execution-followups](authwit-lifecycle-and-execution-followups/plan.md) — approved (mid, 3 audit rounds), ready to implement — public-authwit lifecycle e2e + playground panel + execution follow-ups
- [execution-decomposition](execution-decomposition/plan.md) — completed (PR #83, awaiting manual QA + merge) — facade 2,302 → 746 lines, 3 executors + lane, zero behavior change
