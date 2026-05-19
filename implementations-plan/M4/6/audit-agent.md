# M4.6 — Plan agent audit

Date: 2026-04-26

**No BLOCKING.** Plan structurally sound.

**SHOULD-FIX**
- 5 missing zeroize sites in `ProfileService`:
  - `service.ts:380` — `confirmProfileOperation` unseals + discards; zeroize secret in finally.
  - `service.ts:511` — `exportPlain` (password branch) unseals + base64-encodes; zeroize secret post-encode.
  - `service.ts:534` — `exportMnemonic` unseals + derives words; zeroize after.
  - `service.ts:432-448` — `importEncrypted` derives `passhash` + `_plainSecret = key.decrypt(...)` BEFORE delegating; zeroize on throw paths (lines 443, 446).
  - `service.ts:645` — `restore` (password branch); zeroize after seal.
- Caller-vs-callee responsibility — promote from "checklist item" to **explicit JSDoc edits** in Step 2 / Step 4 for `sealWithPasshash`, `unsealWithPasshash`, `SessionManager.open`.
- Fr self-test must cover both `Fr.fromBuffer(Buffer.from(...))` AND `Fr.fromBufferReduce(Buffer.from(...))` (passkey-credential.ts:45 uses the second).

**NIT**
- 5 helper tests adequate.
- Helper location (`@nulo/wallet-crypto`) right call.
- Buffer instanceof comment — `Buffer` hits Uint8Array branch, not ArrayBuffer.
- Step 4 `restore` snippet type — `Uint8Array<ArrayBuffer> | null | undefined`.
- README: clarify `implementations-plan/M4/README.md` AND `SECURITY.md` get the limitation block.
