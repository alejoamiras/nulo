# Arc 2 — redactor: codex review loop

Branch `log-safety/02-redactor`. Session `01a044f2-99c3-7870-b3bc-e88882b0e516`,
`CODEX_DIR=/home/homelab/.cache/tmp/codex-XGfsgjDv`. Three rounds; converged.

**Convergence quote (round 3):** *"No material findings remain. Record convergence and move to
`log-safety/03-call-sites`."*

## Round 1 — 5 findings, all applied

| # | Finding | Verdict |
|---|---|---|
| 1 | Denylist missed real wallet secrets: `claimSecret` (`wallet-bridge/src/fee.ts:10`) and `secretKey` (`operation.ts:149`, a plaintext `Fr` the walk would descend into and print as a raw bigint) | **applied** — both added, plus a `/secretkey$/i` SUFFIX rule covering Aztec's `master*SecretKey` family without enumerating upstream spellings. Codex confirmed no benign field in the tree ends in `SecretKey`. |
| 2 | The URL match excluded `]`, so an IPv6 authority truncated at the bracket and left the credential-bearing path in the message. Verified by running the regex: `http://[::1]:8080/v1/key` matched only `http://[::1` | **applied** — brackets admitted, trailing punctuation trimmed after the match. Protocol-relative matching REMOVED: it mangled `//foo/bar`. |
| 3 | `SECRET_BLOB` (`/\b[A-Za-z0-9+/=_-]{32,}\b/g`) destroyed every address, tx hash and class id while still missing shorter/dotted secrets | **REMOVED, not tuned** — see below |
| 4 | The `Note` duck-type checked two fields where the real type has four, so unrelated diagnostics were collapsed | **applied** — requires `rawContent` (array) + `storageSlot` + `contract` + `txHash`; new test pins that a look-alike is NOT collapsed |
| 5 | Three client tests passed against the parent, because `JSON.stringify(new Error(…))` is natively `{}` — so "does not contain the secret" was vacuous | **applied** — assert positively on the transformed value instead |

**The one I got wrong in kind, not degree (#3).** I added a "long high-entropy run" scrubber to
catch secrets interpolated into error messages. Codex's objection was decisive: at any threshold
low enough to catch a key it also redacts every Aztec address, tx hash and class id — the
identifiers that make an error message worth reading — while a 31-char key, a dotted token, or a
padded base64 ending in `=` still walks through. **Length is not an entropy test.** Removed, with a
test pinning that a 64-char address SURVIVES so nobody re-adds it casually. Keeping secrets out of
messages is the call site's job, which is what the branches above are for.

## Round 2 — 1 finding, applied

**`DOMException` still flattened to `{}`.** It carries a distinct object tag rather than
`[object Error]`, and its fields are non-enumerable, so the single-tag check missed it and the
generic walk produced nothing. Reachable: WebAuthn failures are forwarded as their original error
from the passkey ceremony dialog and logged during backup export — so this silently discarded
exactly the diagnosis those paths log for. Tag check is now a set.

Codex then inventoried the rest of the tree: every other reachable brand — `WalletError`, Aztec
simulation errors, `AggregateError`, WebAssembly runtime errors, viem's `BaseError` — reports
`[object Error]`. DOMException was the only distinct one.

## Rejections / deliberate omissions

- **`Error.cause` stays dropped.** I asked whether a projected `cause.name` would help. Codex
  argued against: reachable causes include arbitrary viem/RPC failures, and `L1RpcError`
  deliberately hides provider URLs in its outer message — recursing risks restoring exactly what
  the outer projection removed, for marginal and forgeable context. Agreed and kept dropped.
- **The bare keys `secret` and `token` remain un-denylisted** (decision carried from the plan
  audit): `secret` names ciphertext on `Profile` and a plaintext `Fr` on `ActiveSession`, `token`
  almost always means a token contract. Both are handled by SHAPE.

## Durable lessons

- **A heuristic that cannot distinguish a secret from an identifier is not a security control.**
  It trades certain diagnostic loss for uncertain protection. Prefer naming the field.
- **An absence assertion is only as good as what the serializer would have shown anyway.**
  `JSON.stringify(new Error(…)) === "{}"` made three tests vacuous. Assert on the transformed
  value, positively.
- **Duck-typing needs the type's REQUIRED fields, not the two that come to mind.** Two fields felt
  distinctive; four is what the type actually guarantees.
