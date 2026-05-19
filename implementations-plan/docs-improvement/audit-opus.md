# Opus 4.7 audit — verdict: ship with changes

## P0 (must fix before implementation)

1. **Grep undercounts comment refs.** Missing classes: `PR[- ]\d+` (44 hits), bare `M\d+` without dot (34 hits), `pre-[A-Z]\d` beyond `pre-A11` (18 hits), `Stage [A-Z]` (1 hit). Real total ≈ **300+** comment refs, not 237. **Fix:** expand canonical grep to:
   ```
   (M[0-9]+(\.[0-9]+)?\b|A11\.|pre-[A-Z][0-9]|PR[- ][0-9]+|Stage [A-Z]|implementations?-plan|implementation plan|phase [0-9])
   ```
   Re-count per package and update the inventory table. Explicitly exclude `AUDIT [A-Z]\d` (security markers — keep).

2. **ARCHITECTURE.md missing six load-bearing sections.** Add:
   - Account-contract adapter (NuloAccount, multicall, Fr.ZERO salt) — currently in CLAUDE.md:182-194.
   - Storage-version migration gate (`migrate.ts`) + 0.11.0 wipe behavior.
   - Offscreen reconnect / lifecycle (SW-suspend → offscreen resurrection).
   - dApp session lifecycle, separate from "dApp surface".
   - Capability map as first-class (wallet-bridge/capability-map.ts).
   - Fee-payment model (cold-start gap; even an "incomplete + see plan" paragraph).

3. **CLAUDE.md compression risk — enumerate "DO NOT compress" verbatim sections.** These four must survive the rewrite character-for-character:
   - `onBeforeUnmount` cleanup-order code block.
   - Coverage minimums per layer (≥5 / ≥10 / ≥10).
   - Vue SFC ordering 10-section script-setup template.
   - `chrome.*` stub file:line citation (`tests/vitest.setup.ts:88-113`).

4. **Storybook gate is wrong.** Plan said spot-check one. Codebase has ~25 stories; many have milestone-tagged headers visible in autodocs UI. **Fix:** run `bun run --cwd packages/extension build-storybook` (all stories) post-cleanup. Treat per-story header rewrites as user-visible UX copy, not throwaway prose.

## P1

5. **Live cross-reference allow-list incomplete.** Code cites 5 distinct `implementations-plan/<...>.md` paths:
   - `M6/conventions.md` (3 cites) → recommend fold into CLAUDE.md.
   - `passkey-e2e/PRF-NON-PORTABLE.md` → KEEP (live).
   - `network-test-triage/plan.md` → KEEP (live).
   - `fee-estimation-init-race/plan.md` (1 cite) → decide.
   - `pre-a11-ux-cleanup/plan-v4.md` (2 cites) → DELETE per §3.4.
   - `pr-8c-mixed-and-fee/consolidated.md` (1 cite, fast-path.ts:34) → DELETE.

6. **Commit 3 monolithic.** ~300+ edits across 123+ files in a single commit is unreviewable in GitHub diff UI. **Fix:** propose splitting commit 3 into 6 per-package commits (wallet-core / wallet-crypto / extension-messaging / aztec-runtime / wallet-bridge / extension). Yields 8 commits total in one PR. Ask user to confirm relaxation of "literal three commits".

7. **`audit:vue` baseline.** Run on master first; if dirty, mark "pre-existing" in PR description so flaky tests don't block the docs PR.

8. **Migration history paragraph too vague.** Map prefixes: M2 = wallet-crypto extraction, M3 = layer-package split, M4 = profile/session/security model, M6 = component refactor, A11 = onBeforeUnmount/lifecycle hardening. 5-line table beats hand-wave.

## P2

9. playground "scaffold" (CLAUDE.md) vs "solid" (plan) — reconcile.
10. `SECURITY.md` / `AUDIT.md` cites in `config.test.ts:16` — check existence.
11. `noExplicitAny` placement (CLAUDE.md ops rule, or ARCHITECTURE.md build artifact).
12. Watch for comments that should be promoted to a README rather than deleted.

## Voice calibration — package README openers (adopted with light edits)

1. **`@nulo/extension`** — "The Chrome/Firefox Manifest V3 wallet extension: service worker, popup UI, content script, and offscreen PXE host wired together."
2. **`@nulo/wallet-bridge`** — "The dApp-facing dispatcher: implements the wallet-sdk capability map, narrows protocol messages into typed service calls, and enforces session scope."
3. **`@nulo/aztec-runtime`** — "Owns the PXE lifecycle, the upstream `@aztec/accounts/schnorr` adapter, class-id verification, and payload chunking."
4. **`@nulo/extension-messaging`** — "Typed RPC plumbing between the service worker, popup, and offscreen document."
5. **`@nulo/wallet-crypto`** — "Password and passkey-based KDF, `PasswordSecretBox` encryption, and the vector-locked derivation chain."
6. **`@nulo/wallet-core`** — "The foundation: pure ports, types, and platform-agnostic utilities. No `chrome.*`; no I/O."
7. **`@nulo/playground`** — "A test dApp used by the network e2e suite."
8. **`@nulo/landing`** — "Marketing landing page for the wallet. Standalone Vite app; ships independently of the extension."

## Densest cleanup file
`packages/extension/src/wallet/services/profile/session-manager.ts` — 20 milestone refs in one 579-line file.
