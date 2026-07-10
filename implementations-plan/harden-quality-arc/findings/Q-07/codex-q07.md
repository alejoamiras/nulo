# Q-07 codex blueprint audit (xhigh) — session `019f1a37-c0cc-7782-b0a0-ffea62de75fd`

**Verdict:** partially sound — the single `errorMessageFromUnknown` MERGE is **NOT behavior-preserving**; the payload DU is low-value without a runtime parser. Re-scope accordingly.

## Findings (cross-checked against source by me)
1. **Message extraction is NOT equivalent — do NOT merge** (CONFIRMED). `getErrorMessage` (`utils/errors.ts:3`): `.message ?? raw ?? "Unknown error"` (can return a NON-string raw object/number — a type lie). `extractMessage` (`jobs/error.ts:53`): `"null"`/`"undefined"`/`String(raw)`. **`getErrorMessage` drives the WIRE error** at `extension-messaging/src/core/error-response.ts:21`; jobs tests already pin `"null"`/`"undefined"`/hostile at `jobs/error.test.ts:60`. Merging would change thrown `null`/`undefined` from `"Unknown error"`→literal, and objects from raw structured-clone→`"[object Object]"`. → keep them SEPARATE (or share via an explicit option/wrapper that preserves each caller's semantics).
2. **`makeRemoteError` extraction IS safe** (CONFIRMED byte-identical — only the comment differs; verified bg `client.ts:134-141` vs offscreen `client.ts:113-117`). Standalone helper imported by both clients; do NOT fold into `BaseServiceClient` (it keeps error-shaping as a hook, `base-client.ts:27`). The sibling `makeTimeoutError`/`makeSendFailureError` are **intentionally divergent** ("RPC '…' timed out after Nms" vs "Offscreen request timed out: …") — leave them.
3. **`WalletErrorPayload` DU = higher blast radius, low value now.** The wire boundary is still `errorPayload?: unknown` (`base-client.ts:67`); without a runtime parser a DU just moves casts around; `walletErrorFromPayload` still needs boundary casts. → DEFER the payload-DU to **Q-01/P19** (the boundary-decode layer that ADDS the parser). Out of Q-07 scope.
4. **`KnownJobErrorKind | (string & {})` = autocomplete, NOT exhaustiveness.** A `switch` won't narrow to `never` (open arm). UI already defaults unknown kinds (`journal-state.ts:164,225`). Live kind `stuck_queued` is emitted (`reaper.ts:184`) but MISSING from the wallet-core comment. → add `KNOWN_JOB_ERROR_KINDS` const as source-of-truth (incl. `stuck_queued`); keep schema `z.string().min(1)` (`operation-journal/spec.ts:189`); cover with tests, not `never`.

## Minimal-safe ordering (codex)
1. Extract `remoteErrorFromResponseContent` first (+ bg/offscreen parity tests).
2. PIN `getErrorMessage` vs `normalizeError`/`extractMessage` edge cases (null, undefined, number, plain object, object-with-message, hostile proxy) BEFORE touching message code — locks the intentional divergence.
3. Do NOT merge the two message semantics. If sharing, explicit option/wrapper.
4. Add `KnownJobErrorKind` + `KNOWN_JOB_ERROR_KINDS`; keep schema `z.string().min(1)`; tests not `never`.
5. Payload typing LAST — but per (3) above, DEFER fully to Q-01/P19.

**Net re-scope:** Q-07 shrinks from "days / 4 big changes" to: (a) extract `remoteErrorFromResponseContent` [real dedup], (b) `KNOWN_JOB_ERROR_KINDS` source-of-truth + open-union `kind` typing, (c) edge-case PINS locking the getErrorMessage↔extractMessage divergence. DROP the message-merge; DEFER the payload-DU to Q-01.
