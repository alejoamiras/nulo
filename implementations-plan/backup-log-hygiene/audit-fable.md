# Audit — Claude (Opus, adversarial architectural pass)

Verdict: *"directionally right but its two load-bearing claims — 'Debug is safe' and 'arc 1 below
arc 2/3 is the safe order' — are both false, and one arc-2 instruction as written breaks profile
restore."*

## Findings adopted (all verified against the code before acceptance)

| # | Finding | Verified at | Action |
|---|---|---|---|
| F1 | **Arc 2's "move `trim()` earlier" breaks restore.** `base-client.ts:123-127` is the generic request path for EVERY client (`params: jsonSanitize(wrapParams(params))`), not the logger's. Once arc 1 denylists `masterKey`/`entropy`/`importedKeysDek`, `trim()` there rewrites **live RPC params** to `"[masterKey]"` and restore/unlock/export fail. Arc 1 landing below arc 2 is what ARMS the bug. | Read `base-client.ts:118-132` — confirmed generic path | **CUT the instruction.** Redact only in `LoggerServiceClient.log`. |
| F2 | **`base-client.ts:196` is a key-material leak.** `handleResponse` logs full `content` (incl. `result`) at Warn on any unmatched `requestId` — i.e. any timeout (60s) or duplicate. `exportMnemonic`/`exportPlain`/`exportBackupMaterial` resolve through it. | Read `base-client.ts:188-200` — confirmed | **Promote to arc 1.** Recon's "no key material" headline corrected. |
| F3 | **Four missed sinks.** `background/client.ts:87` + `offscreen/client.ts:74` log whole envelopes at **Warn**; `background/client.ts:94` + `offscreen/client.ts:81` log `("Event received", event, payload)` — every balance/profile/tx/transfer payload. | Read both files — confirmed verbatim | Add to arc 1 (Warn) and arc 3 (the Event pair). |
| F4 | **`trim()` expands typed arrays.** `Object.entries(new Uint8Array([1,2,3]))` yields indexed entries, so a 32-byte key becomes a 32-key object. `Map`/`Set` collapse to `{}`. | Standard JS semantics | Arc 1 must collapse `ArrayBuffer.isView` and non-plain objects, not just add names. |
| F5 | **Missed remote egress.** `error-envelope.ts:106` returns `error.message` to an arbitrary dApp. Recon's "no network egress" only checked telemetry SDKs. | Read `error-envelope.ts:96-112` — confirmed | New arc. Off-machine, silent. |
| F6 | **The branded-types mitigation is not buildable.** Brands erase at emit; biome has no type information. | `secret-types.ts` | **Strike the line** rather than soften it. |
| F7 | **Outline B rejection reason #4 was factually wrong.** Restore-error data DOES traverse `LoggerStore` — `useFullBackupImport.ts:507` is a `console.warn`, and `console.*` is globally hijacked. | By construction | Rejection reasons 1–3 stand; B is stronger than credited. |
| F8 | **Debug entries survive the flag.** Disabling Debug Mode neither clears the ring buffer nor the session key; a SW restart re-imports them via `rehydrate()`. So "Clear logs" is undone by a restart. | `store.ts:23-25,65-78,94-99` | Fold into the `clearLogs` fix. |

## Disputed / not adopted

- **F9 — "add `secret` to the denylist; over-redacting ciphertext costs nothing."** Codex argues
  the opposite (never globally redact an ambiguous key). See the ledger — resolved in codex's
  favour with a narrower rule.
