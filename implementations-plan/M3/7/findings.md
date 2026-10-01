# M3.7 audit findings (2026-04-25, master `954b4d2`)

## A1 — Phantom extraction misses

**Verdict**: zero misses. M3.1–M3.5 cleanly placed all extracted code.

### A1.1 — Pure crypto in extension/wallet/services

Hit: `packages/extension/src/wallet/services/profile/service.ts` — but the matches are **comments only** (lines 112, 137, 506) referencing PBKDF2 timing. Actual crypto lives in `@nulo/wallet-crypto` (`PasswordSecretBox.unseal` + `reseal`). False positive.

### A1.2 — Files with no chrome/aztec deps

20 hits, all `spec.ts`/`client.ts` files for service interfaces. They legitimately stay because they describe extension's RPC surface (Methods/Events types + ServiceClient subclasses). Not phantom misses — these are extension-package contracts.

### A1.3 — Operation/Capability/SessionContext leakage

Zero hits. All wallet-sdk protocol types live in `@nulo/wallet-bridge` per M3.5 Stage D.

## A2 — Path aliases

`packages/extension/tsconfig.json` declares 4 path aliases. Three are dead:

| Alias | Usages in src/ | Action |
|---|---|---|
| `@/*` | many | KEEP |
| `~/*` | 0 | DELETE |
| `src/*` | 0 | DELETE |
| `@assets/*` | 0 | DELETE |

## A3 — Workspace deps

All clean. Each package has the minimum-necessary set:
- `wallet-core`: 0 workspace deps (foundation, correct)
- `wallet-crypto`: `wallet-core` only
- `extension-messaging`: `wallet-core` only
- `aztec-runtime`: `wallet-core` + `extension-messaging`
- `wallet-bridge`: `wallet-core` + `extension-messaging` (no `aztec-runtime` ✓ — confirms the cleaner-than-claimed boundary in the plan)
- `extension`: all 5 (sink, correct)
- `playground`, `landing`: zero deps (scaffolds)

No bloat to drop.

## Summary

Extension is genuinely thin where M3 said it should be. Path aliases need a 3-line cleanup. Workspace deps are correct. Proceeding to Step 2 (component moves) + Step 3 (biome rules).
