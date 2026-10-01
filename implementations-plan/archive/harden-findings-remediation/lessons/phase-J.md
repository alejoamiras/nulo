# Phase J — ValueStorage parse containment (F-13) — DIRECT

Branch: `fix/hf-j-valuestorage` off `fix/harden-findings`. Merged: PR #263 (46fa1df).

## Bug
`ValueStorage.get()` did an unguarded `JSON.parse(res[this.root] as string)`. A single half-written / corrupt / forward-incompatible row threw inside the read path → poisoned wallet startup/restore (`chrome.storage` is shared + write-anywhere).

## Fix
Mirror `EntityStorage.parseOrDelete`: try/catch the parse → log a bounded (`PARSE_FAILURE_PREVIEW_MAX = 200`) payload preview → fire-and-forget quarantine-delete of the bad row → return `undefined`. Never throws.

Modularization: `PARSE_FAILURE_PREVIEW_MAX` **exported** from `entity_storage.ts` and imported into `value-storage.ts` rather than duplicated (same constant, one home).

## Gate (plan.md Unit J: lint · unit) — green
- `bun run --filter '@nulo/wallet-core' test`: **11 files / 95 passed**, exit 0.
- `value-storage.test.ts`: **10 passed** — 2 new: (a) malformed row → `undefined` + delete scheduled + error logged; (b) logged preview length-bounded.
- `bun run lint`: 0 errors.
