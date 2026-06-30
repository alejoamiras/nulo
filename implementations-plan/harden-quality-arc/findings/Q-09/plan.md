# Q-09 — unify hex/base64 encoders → `@nulo/wallet-core/utils` · tier: **light**

**Re-verify (STEP 1, vs `dev-quality` @ 1537dc7):** VALID. 6 non-excluded sites still hold the idioms (13 idiom lines); the 2 excluded bridge-core encoders present.

## Divergence map (the byte-identicality crux)
**Hex** — two variants, both lowercase + `padStart(2,"0")` → **byte-identical**, safe to unify:
- `packages/wallet-core/src/utils/random.ts:7-9` — `for` loop (Buffer-free, by design).
- `packages/wallet-crypto/src/encryption-key.ts:114` — `[...arr].map(...).join("")`.

**Base64** — all **standard** alphabet (grep: NO base64url anywhere), but split impls:
- `password-secret-box.ts:160-161` encode `Buffer.from(x.buffer).toString("base64")`; `:169,174` decode `Buffer.from(str,"base64")`.
- `passkey-credential.ts:37,39` decode `Buffer.from(x,"base64")`.
- `passkey-ceremony.ts:17-23` `encodeBase64`/`decodeBase64` via `Buffer` (with a `BufferSource`→bytes normalization).
- `full-backup-helpers.ts:19` decode `Uint8Array.from(atob(trimmed), c=>c.charCodeAt(0))` — **atob**, inside a `try/catch` backup-type detector.

## Canonical design (Buffer-free — preserves wallet-core's portability invariant AND is the finding's actual goal: "remove the Buffer polyfill")
New `packages/wallet-core/src/utils/encoding.ts`, exported from `utils/index.ts`:
- `bytesToHex(bytes: Uint8Array): string` — the existing Buffer-free loop, lowercase padded. Byte-identical to both hex sites.
- `toBase64(bytes: Uint8Array): string` — `btoa` over a **chunked** latin1 string (NOT `String.fromCharCode(...bytes)` spread — that `RangeError`s on large inputs). Byte-identical to `Buffer.from(bytes).toString("base64")` for all inputs.
- `fromBase64(b64: string): Uint8Array` — `atob` → `Uint8Array`. **Byte-identical to `full-backup-helpers` (same `atob`) including its malformed-input leniency**, and byte-identical to the `Buffer.from(_,"base64")` crypto sites for VALID base64 (the only kind they decode — their own ciphertext).

## Why no behavior change (the adversarial proof obligation)
- Hex: identical output, trivially.
- Base64 encode: `btoa(latin1(bytes)) === Buffer.from(bytes).toString("base64")` for standard base64.
- Base64 decode: crypto sites only ever decode base64 THEY produced (always valid) → `atob` path === `Buffer` path. The one site that decodes untrusted/malformed input (`full-backup-helpers`) ALREADY uses `atob` → identical edge behavior (Buffer-decode would have been MORE lenient — we deliberately do NOT switch it to Buffer).
- **PIN to verify in impl:** `password-secret-box` encodes `x.buffer` (whole underlying ArrayBuffer) vs canonical `toBase64(x)` (logical view bytes). Confirm `guard`/`encryptedSecret` from `key.encrypt()` are full-buffer (offset 0, length === buffer.byteLength) so the two agree; add a test. If ever an offset view → BUG-PIN + keep `.buffer` semantics at that one site.

## Scope
Replace the 6 non-excluded sites. **EXCLUDE** `bridge-core/content-hash.ts` + `recovery-crypto.ts` (feed content-addressed recovery fields; not byte-identical to the others; ~zero maintainability win, real cross-device-recovery risk).

## Validation gate
- Unit (new `encoding.test.ts` in wallet-core): per-site byte-identical vectors (hex of a known buffer; `toBase64`/`fromBase64` round-trip; **large-input** encode = no RangeError; `fromBase64` malformed-input parity with `atob`).
- `bun run test` for **wallet-core, wallet-crypto, bridge-core, extension** (bridge-core in the gate per audit — proves the excluded encoders untouched + nothing imports broke).
- `bun run lint` + `bun run typecheck:all`.
- smoke + FULL network e2e (per owner ruling).

## Decision ledger
- A (per-site replace) over leaving as-is: the finding converged both-models, high-confidence, hours.
- Buffer-free canonical impl (not Buffer-based) — preserves wallet-core layering + delivers the "drop the polyfill" win. Codex to confirm the btoa/atob byte-identicality claim + the chunking + the `.buffer` pin.
