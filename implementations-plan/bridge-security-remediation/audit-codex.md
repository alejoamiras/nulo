# Codex audit trail — bridge-security-remediation

Codex (xhigh) across the deep-blueprint rounds. Sessions: plan/contradiction/double-audit `019ecb5a-9d78-7271-ba61-a146266828d8`; final fresh pass = new session (see below).

## Round 1 — independent plan draft
Contributed the two ideas that initially superseded the other drafts: (a) a **CREATE2 PortalFactory** for atomic deploy+init that breaks the portal↔bridge cycle; (b) **compile the forked portal inside the l1-artifacts root** (which already has the blob remap + fs_permissions). Confirmed token-minter immutability and that F-004 forces an `l1.fuel.*` redeploy. Flagged candidate-config-out-of-band cutover.

## Round 2 — contradiction-check (verdicts)
- **disagree** on minimal-interface-fork-as-primary → flip: staging into the l1-artifacts root is the deploy/verify source of truth; the shim is test-only.
- **agree, with fix** on CREATE2: cycle-break sound; the real residual is operator **salt-generation self-collision** (not a front-run); `onlyOwner` + same-tx closes the mempool front-run.
- **disagree (factual)**: the "live salts ≠ committed script salts" premise is false — `0x5b11/12/13` = `23313/14/15`.
- **disagree**: `deposit-testnet.ts` has no `--use-existing` mode (always deploys fresh) → B6's smoke depends on a mode B4 never builds.
- **disagree**: PoC file naming — split `PortalReinit.t.sol` (unit) + `PortalReinit.fork.t.sol` (fork) so the `*.fork.t.sol` selectors line up.

## Round 3 — double audit. Verdict: **reject**
Blocking: (1) candidate-config app-verify isn't real — the faucet statically imports the committed JSON; `--config` on helper scripts doesn't change what `vite build`/e2e consume; `audit:vue` doesn't touch the faucet. (2) B4/B5 sequencing — the candidate manifest is written post-deploy but B5 ("no live tx") consumes it; L1 addresses aren't deterministic pre-deploy → move manifest consumption to post-deploy (B6). (3) **per-attempt portal salt insufficient** — one-shot L2 wiring can burn a full generation on a failed attempt → per-attempt full-generation salts + resume rule. (4) PR A doesn't truly guard PR B — `bun run lint:actions` doesn't exist; Noir proxy/bridge compile not gated. (5) **Asks 1 & 2 must be explicit, not assumed.** Also: artifact-parity — CI must prove the bridge-evm shim's creation-code hash == the staged full-body fork (else the factory deploys different bytecode); staged-into-node_modules is a supply-chain boundary (clean lockfile checkout); `/tmp` candidate path is TOCTOU; Etherscan-verify-as-gate is an availability surface.

## Disposition
All Round-2 + Round-3 findings folded into `plan.md` (the CREATE2 factory was dropped entirely per the cross-model double-reject — see audit-opus.md; salts→per-generation; candidate-manifest→post-deploy/private-temp/rename; Etherscan non-blocking; `lint:actions`→actionlint; the 5 user-decided Asks). Final fresh-context verdict recorded at the gate.
