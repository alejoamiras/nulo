# Research: Approval-card redesign (F-008 + F-009)

## Current `OperationCard.vue` shape

File: `packages/extension/src/popup/windows/execute/OperationCard.vue`

- Single v-if/v-else-if ladder across 12+ operation kinds (lines 77→404)
- Per-kind rendering: function name + contract address; args HIDDEN behind secondary "View JSON" link
- F-009 sites in current template:
  - line 156: `dapp.name` rendered raw ("Fee payment method set by [dapp.name]")
  - lines 223, 231: `tokenMetadata.symbol` + `tokenMetadata.name` rendered raw
  - line 371: `artifact.name` rendered raw

## Operation model — typed args per kind

File: `packages/wallet-bridge/src/operation.ts`

The wallet-bridge types are DELIBERATELY GENERIC:
- `send_transaction`: `actions: Action[]` (each action has `args: unknown[]`)
- `aztec_sendTx`: `exec.calls[]` (each call has args; not separately typed)
- `register_token`: `address: string` (token contract), metadata fetched at popup-open
- `register_contract`: `address: string` + `classId`
- `aztec_createAuthWit`: `messageHashOrIntent.call` (CallIntent shape)
- Read-only methods: contract + selector + generic args

**Critical**: there's NO typed `recipient: address` / `amount: bigint` field for transfers. The args are positional `unknown[]`. Runtime extraction is needed (parent `index.vue` should pre-compute, or sub-component introspects).

## Sanitization surface

File: `packages/extension/src/wallet/services/dapp-session/capability-meta.ts:104-166`

- `stripWireControl(input)`: removes Unicode format codepoints (\p{Cf}), variation selectors (FE00-FE0F, E0100-E01EF), control chars (00-1F, 7F-9F)
- `sanitizeWireString(input, maxLen)`: strip + codepoint-length clamp with ellipsis

**Currently used in**: `ScopeAddress.vue`, `ScopeClassId.vue`, `CapabilityDetailPanel.vue` (function names, capability types).
**Currently NOT used in**: `OperationCard.vue` (the high-stakes approval surface — the F-009 gap).

Soft caps: 64 (function selectors), 128 (addresses/class IDs), 32 (unknown capability type, contact names).

## Strings needing sanitization

| String | Source | Render | F-009 risk |
|---|---|---|---|
| `dapp.name` | dApp discovery wire | OperationCard.vue:156 | HIGH (homograph/RTL phishing) |
| Token name | On-chain contract `getName()` | OperationCard.vue:231 | HIGH (fake-USDC) |
| Token symbol | On-chain contract `getSymbol()` | OperationCard.vue:223 | HIGH (primary surface) |
| Artifact name | On-chain artifact | OperationCard.vue:371 | HIGH |
| Account alias | Session/address book (user) | OperationCard.vue:96, 189 | MEDIUM (user-controlled but pasteable) |
| Function name | Action metadata | OperationCard.vue:114, 134, 266 (via `humanizeMethodName`) | MEDIUM |
| Selector hex | On-chain | OperationCard.vue:134 etc | LOW |

## Vue primitives available

- `AddressDisplay` component (imported)
- `trimAddress()` from `@/utils/string` (truncates 8+4)
- `ScopeAddress` (full address + sanitized contact name + copy button)
- `balanceFormatted()` from `@/utils/amount.js` (decimals applied; used in IncomingTrustPopup)
- `Flex` + `Text` primitives + `.prop` style for labeled key-value rows
- `Badge` component (`/components/ui/Badge.vue`) — variants info/warning/error/purple
- `useDappHostname()` composable — returns `{hostname, isSuspicious}`

**No existing "structured arg summary" component** — needs to be built.

## Per-op-type component architecture

### Recommended: **Hybrid** (Option C)

- Keep `OperationCard.vue` as router/discriminator (no template changes)
- Extract 3 HIGH-CHANGE kinds into sub-components:
  - `OperationCardTransfer.vue` (send_transaction + aztec_sendTx) — F-008 structured args go here
  - `OperationCardRegisterToken.vue` — token name/symbol sanitization + structured display
  - `OperationCardRegisterContract.vue` — artifact sanitization + structured display
- Leave 9 low-change kinds inline (read-only queries, utility calls)
- F-009 sanitization applied at ALL surfaces (extracted + inline)

**Why hybrid not full-split**: minimizes diff blast, isolates F-008/F-009 surfaces per kind, keeps shared fee-handling wrapper logic in parent.

## ASCII layout reference (user-approved)

Transfer (the F-008 anchor):
```
┌─────────────────────────────────────────────┐
│  ⇄  Transfer · TST                          │  ← effect, not raw "Token.transfer"
│      Token@0xabc...def     [verified ✓]     │
│  ─────────────────────────────────────────  │
│  To       0xfed...321  (Alice)              │  ← NEW: explicit recipient
│  Amount   100.50 TST                        │  ← NEW: parsed + decimals applied
│  Network  Local Network                     │  ← NEW: visible chain
│                                             │
│                              [Full JSON ›]  │  ← fallback
└─────────────────────────────────────────────┘
```

Register-token, register-contract, authwit, simulate cards in clarifying-answers.md.

## Implementation notes

- Argument extraction for transfer requires consulting the action's typed model. If the action's `kind === "transfer"` (Nulo SendAction enum), recipient + amount + token are extractable. For arbitrary contract calls (typed via ABI but semantically opaque), show typed labels + values verbatim; collapse if >5 args.
- Token verification badge: derive from class-id-verified status (already computed in `ArtifactRegistry`).
- JSON viewer (`packages/extension/src/popup/windows/json/index.vue`) stays unchanged — demoted to a footer link.

## Tests

No `OperationCard.test.ts` exists today. Recommend adding render tests for:
1. Sanitization of `dapp.name`, `tokenMetadata.symbol`, `tokenMetadata.name`, `artifact.name` (inject RTL/ZWSP, verify output stripped + length-clamped)
2. Structured arg summary for transfer (mock transfer op, verify recipient + amount + network display)
3. Per-kind discriminant (spot-check 3 high-change kinds)

Pattern: `@vue/test-utils` + `vitest` (matches existing `capability-meta.test.ts`).
