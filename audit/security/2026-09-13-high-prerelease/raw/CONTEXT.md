# Shared context for Phase 2 cluster agents — run 2026-09-13-high-prerelease

## What this is
Final pre-release security pass on the Nulo browser-extension wallet (Aztec network). Target: `origin/dev` @ 62f3456a (checked out in this worktree). Prior whole-scope runs: `audit/security/2026-06-08-ultra-e6759a/` and `audit/security/2026-07-06-max/` (read their `report.md` for what was found; all 14 July findings were remediated in PR #272 — summary of fixes below). Your job is NOT to re-report those; it IS to (a) check for regressions of those fixes, (b) audit the large surface added since July, (c) find what both prior runs missed.

## Repo facts
- Bun monorepo. Layer order (lower can't import higher): `wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension`. `wallet-bridge` deliberately does not depend on `aztec-runtime`. Biome `noRestrictedImports` enforces the layers.
- Extension = MV3 (Chrome) + Firefox build. Background service worker hosts the wallet services; popup/onboarding/windows are Vue; an offscreen document hosts the PXE/prover; a content script bridges dApp pages to the wallet-sdk transport.
- Manifest configs: `apps/extension/manifest/manifest*.config.ts`. Read `ARCHITECTURE.md` + the package/service `README.md`s — they document intended invariants; verify the code honours them.
- Account addresses are FROZEN per extension major (`packages/aztec-runtime/src/account/`); the vendored artifact + descriptor never move with `@aztec/*` bumps.
- Pre-production: no storage migrations expected; backup import goes through the migration engine in-memory.
- `AUDIT [A-Z]\d+` code markers mark security-relevant decisions paired with tests — read them as claims to verify.

## Remediations landed since the July max run (PR #272 units + later arcs) — verify, don't re-report
- A: dispatcher hard-rejects raw-`Fr` authwits; `call.name`↔`selector` bound at all signing sinks; arg-shape validation.
- B: truthful approval display + bidi/RLO/overlong `safe()` sanitizer; `canCreateAuthWit` surfaced.
- C: chain-identity TOCTOU — single validated `getNodeInfo` threaded as `chainInfo`; re-fetch deleted. HELD at the time: the XOR-composite `Network.chainId` collision (a lying RPC presenting a colliding `(l1ChainId, rollupVersion)` tuple). Since then key-model-v2 (#417/#419) derives account seeds from the exact `l1ChainId` and `network/service.ts:991` probes both identities. **Re-examine whether the collision is closed everywhere signed material is bound.**
- D: discovery-flood caps (32/4 + coalesce), locked-queue/popup caps.
- E: backup-restore config allowlist (security keys not restorable).
- F: CSP `script-src 'self' 'wasm-unsafe-eval'; img-src 'self' data: blob:`.
- G: offscreen/messaging sender-auth + Firefox instance token.
- I: per-row DappSession HMAC (profile-master-derived, non-extractable).
- J: ValueStorage parse containment.
- K: clipboard secret hygiene (warn + best-effort scrub); later `ff461a75` "honest clipboard copies via one helper + secret-scrub composable".

## NEW security-relevant surface since July (highest-value targets; codex has never reviewed most of it)
- **key-model-v2 / NULO-ACCOUNT-KDF v2** (`implementations-plan/key-model-v2/`, `key-model-v2-hardening/`): BIP-39 PBKDF2 → `Fr.fromBufferReduce` master → `poseidon2HashWithSeparator([master, l1ChainId, type, index], SEP)` account seed → `sha512ToGrumpkinScalar` signing key. Recovery Phrase is the only wallet-level secret export; account-level encrypted export/import (kdf v2 export/import #419); DEK isolation; duplicate-phrase guard; passkey 512-bit reduce. An in-house adversarial review exists at `implementations-plan/adversarial-key-model-review/findings.md` (F-1 MEDIUM envelope swap / F-2 LOW unauthenticated walletFingerprint) — check whether those were fixed by `mac-identity-binding` (#446 "identity-bound envelope mac + fingerprint coverage").
- **export-integrity**, **mac-identity-binding**, **shell-identity-fences**, **service-fences**, **sw-wallet-protocol**, **transport-ready-handshake**, **dapp-profile-binding**, **wallet-sdk-implicit-account-grant** (#582 widens an accounts grant on a repeat request), **token-identity**, **passkey-in-page-modal** / **passkey-modal-export-import**, **storage-migration-framework** + **storage-migration-backup**, **activity siloing** (`audit/security/2026-07-24-siloing/`), **fee-cap hardening**, **single-sim-estimates** / discovery-aware estimator.
- Read the relevant `implementations-plan/<name>/plan.md` "Security & Adversarial Considerations" section when you audit one of these — it states the threat model the authors defended against; look for what they did not.

## Out of scope
`packages/bridge-core` bodies, `apps/faucet`, `apps/landing`, `apps/playground`, `apps/tools`, `packages/design`, generated `src/types/*.d.ts`, `dist/`, `node_modules/`, all `*.test.ts`, `tests/e2e/**`, Storybook. `apps/extension/src/e2e/` — check whether it is production-wired before excluding.

## Deliverable hygiene
Repo-relative paths only (never absolute, never a home directory). Cite `file:line` for every step of a trace. Prefer fewer, concrete findings over many speculative ones. Record non-findings: the things you checked and why they hold — that is evidence for the report.
