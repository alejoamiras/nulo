# M4.6 — audit-diff (post-dual-audit)

Date: 2026-04-26

## No BLOCKERs from either audit

Both auditors agreed plan is structurally sound. Several SHOULD-FIX items.

## Codex BLOCKER (under-scoping, treat as BLOCKER for completeness)

- **5 missing zeroize sites in `ProfileService`** (codex flagged as BLOCKING — under-scope of Step 5):
  - `service.ts:380` — `confirmProfileOperation` unseals + discards `secret`.
  - `service.ts:511` — `exportPlain` (password branch) unseals + base64-encodes.
  - `service.ts:534` — `exportMnemonic` unseals + derives words.
  - `service.ts:640` — password `restore()` creates `plainSecret` and silently drops `seal()`'s returned `passhash`.
  - `service.ts:678` — passkey `restore()` derives `recovery.secret` but never uses it.
- Public `import*` methods (`importEncrypted` line 432, `importPlain` line 453, `importMnemonic` line 463) can throw before reaching `importPasswordProfile` (which the plan zeroes). Wrap public methods, not just helper.

## Codex SHOULD-FIX

- Caller-vs-callee responsibility: promote from "checklist item" to **explicit JSDoc edits** in Step 2 / Step 4 for `sealWithPasshash`, `unsealWithPasshash`, `SessionManager.open`. Current callee docs at `password-secret-box.ts:89` and `session-manager.ts:148` don't mention the contract.
- `Fr` self-test: must cover BOTH `Fr.fromBuffer(Buffer.from(...))` AND `Fr.fromBufferReduce(Buffer.from(...))` (passkey-credential.ts:45 uses the second).

## Plan agent SHOULD-FIX

- Same as above — converged on missing sites + JSDoc + Fr-fromBufferReduce test.

## Plan agent NIT

- 5 helper tests adequate.
- Helper location (`@nulo/wallet-crypto`) right call.
- Buffer instanceof: comment that `Buffer` hits Uint8Array branch, not ArrayBuffer.
- Step 4 `restore` snippet type: `Uint8Array<ArrayBuffer> | null | undefined`.
- README clarification: `implementations-plan/M4/README.md` AND `SECURITY.md` get the limitation block.

## Recommended execution-time absorption

1. **Step 5 expansion**: add 5 callsites flagged above. Total ~10 wire-ups, not the original 5-6.
2. **JSDoc edits** on `sealWithPasshash`, `unsealWithPasshash`, `SessionManager.open` — committed code change, not just plan checklist.
3. **Fr self-test**: cover `Fr.fromBuffer` AND `Fr.fromBufferReduce` patterns. Both must round-trip with input zeroed in between.
4. **Buffer comment**: clarify Uint8Array branch path.

## Status

- Plan v0 SHIPPED. Audits absorbed in this audit-diff.
- Plan v1 — small revisions; mostly enumeration of additional callsites. Tractable in-place at execution time.
