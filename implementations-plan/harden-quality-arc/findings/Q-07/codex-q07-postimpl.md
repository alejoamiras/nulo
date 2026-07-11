# Q-07 codex POST-IMPL audit (xhigh) — session `019f1a5a-835c-7d92-9632-c7b14a3102c1`

**Verdict:** NOT strictly behavior-preserving as first implemented — **one real HIGH on p2**, fixed before merge. p1/p3/p4a confirmed clean.

## HIGH (fixed) — p2 `getErrorMessage` wrapper changed observable wire/log bytes
My Phase-2 wrapper string-coerced non-string values. codex traced that `getErrorMessage`'s result flows UN-coerced to two sinks:
- the **dApp wire JSON** — `buildErrorResponseContent` (`extension-messaging/src/core/error-response.ts:22`) stores it directly,
- **`LoggerStore`** (`apps/extension/src/wallet/logger/store.ts:37`) keeps `trim(data)` un-coerced.

Concrete before→after wire JSON the wrapper would have caused:
- `42`: `{"error":42}` → `{"error":"42"}`
- `{message:0}`: `{"error":0}` → `{"error":"0"}`
- `{message:null}`: `{"error":{"message":null}}` → `{"error":"[object Object]"}`
- `{nope:1}`: `{"error":{"nope":1}}` → `{"error":"[object Object]"}`
(No change for `null`/`undefined`/`{message:""}`/`Error("")`/`""`. Client-side rejection text was unchanged because `remoteErrorFromResponseContent` wraps via `new Error(...)`, but the intermediate wire shape + log data differ.)

**Fix (commit `5c76e9a`):** reverted `getErrorMessage` to **byte-identical original**; kept ONLY the `errorMessageFromUnknown` extraction + `jobs/error` routing (that path stays proven byte-identical by the untouched `jobs/error.test.ts`). The pre-existing type-lie (typed `string`, can return a non-string) is documented in-code + BUG-PINned in `utils/errors.test.ts`, deferred to **Q-01** (boundary decode, where the wire field gets a real parser).

## Confirmed clean (codex "looks fine")
- **p4a** runtime-identical: `known.details?.capabilityType ?? "unknown"` = the old cast read; `TOO_MANY_PENDING` correctly still falls to base `WalletError` (only live `TooManyPendingError` path is local throw + wallet-sdk mapping at `error-envelope.ts:73`).
- **p3**: open union keeps `journal-state.ts` defaults alive (`:191`,`:253`); `KNOWN_JOB_ERROR_KINDS` covers all live producers; `z.string().min(1)` stays assignable to `z.ZodType<JobError>`.
- **p1**: exact extraction — both clients delegate to the same payload-first / `new Error(content.error ?? "Unknown error")` logic.

## Lesson
"Observably identical at sinks" is only true where the sink **string-coerces**. A value that reaches a JSON-serialized wire field or a raw-stored log is NOT coerced — a type-lie "fix" there changes bytes. The behavior-preserving move was to leave the lenient projection untouched and defer the honest typing to the boundary-parser finding (Q-01).
