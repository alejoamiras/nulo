# Implementations plan index

Format: `- [plan-name](plan-name/plan.md) — status — one-line hook`

- [nulo-v6](nulo-v6/plan.md) — closed, awaiting archive — the wallet on Aztec 6.0.0-rc.1, merged as #736 and released as 0.29.0 on 2026-10-01: the `@aztec-labs` and `@aztec-foundation` scopes, the V6 account regime, the V6 testnet as the one public network, "Nulo V6", and npm 0.2.0 of the three shared packages; unleashed's V6 token (P8) and the store upload (P9) are in follow-ups.md
- [transport-ready-handshake](transport-ready-handshake/plan.md) — PARKED (owner risk call 2026-08-18, pre-drafting) — the ledgered Ready-handshake transport rework + SW-death debt (canary real-kill, tombstone supersede); 4-scout recon preserved in recon.md; the spec (fix-plan rows 1 and 6, recon-fixes § B, two open flake-ledger entries) is copied verbatim into `spec-rows.md`
- [unserved-chain-connect](unserved-chain-connect/plan.md) — in progress, awaiting the owner's sign-off on the notice — a dApp asking for a chain the wallet has no network for gets a wallet notice and no session, instead of a connection whose every call fails; a session whose network is deleted gets a typed 4901
