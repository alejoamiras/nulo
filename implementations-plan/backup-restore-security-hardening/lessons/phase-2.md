# Phase 2 — tx create-only + reject restored pending txs (B, D16) — lessons

**Status: ✓ (`8c43e1a`).** Gate: `bun run --cwd apps/extension vitest run src/wallet/services/cross-profile-isolation.test.ts` 18 pass (+2 new pins); typecheck 0; lint 0.

## What was built (`transaction/service.ts` `restore`)
Rewrote `restore` to run UNDER a new `Lock` (added `private readonly lock = new Lock()`), per-row:
1. **D16 — reject Pending:** `tx.status === TxStatus.Pending` → drop-and-record (never write, never add to `this.pending`). `submittedEndpointUrl` is backup-controlled and `updateTx` dials it (or, absent, the ACTIVE profile's node) → the worker would leak an attacker-chosen hash to the wrong RPC. Pending is transient; it re-derives on next submission.
2. **B — create-only:** `await this.txs.contains(hash)` → skip+record. `EntityStorage.set` is an upsert on the profile-shared `nulo:core:txs` root keyed by `hash`; a crafted hash == a victim's tx would overwrite (erase) it.
3. **H — parse:** `TxSchema.parse(tx)` before `set` (mirrors the read codec); write + return the PARSED row (D17).

## Key decisions / gotchas
- **A written Pending row is re-armed on restart** — `init` scans `getValues().filter(status===Pending)` into `this.pending` (`:80`). So a restored Pending tx MUST NOT be written at all (writing it non-pending would misrepresent status; writing it pending resurrects polling). Drop is the only safe option → matches codex's "reject all, simplest + strictly safe."
- **Where the pins live:** there is NO `transaction/*.test.ts` dir; the built `TransactionService` + `mkTx`/`seedRow` harness lives in `cross-profile-isolation.test.ts`. Added the 2 pins there (reused `mkTx`, `A1`, seeded `h1`). Updated the plan's Phase-2 gate to the real path.
- **Both pins fail pre-fix by construction:** create-only — pre-fix `set` overwrites `h1` → `getTransaction("h1").account` becomes the attacker's (≠ A1); reject-pending — pre-fix writes it → `getTransaction("hp")` doesn't throw. Post-fix both hold.
- **Lock scope:** the restore lock serializes restore's `contains→set` (closes restore-vs-restore TOCTOU). The `addTransaction`/worker write paths use fresh self-owned hashes (can't collide with a victim), so their lock-guarding + the D13 deletion-epoch re-check are folded into **P8** (where the tombstone/epoch exists), not here — noted to avoid holding the lock across the worker's network I/O.
