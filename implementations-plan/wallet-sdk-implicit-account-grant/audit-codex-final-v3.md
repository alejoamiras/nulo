1. **Verdict**

ship-with-tiny-changes

2. **Patch-by-patch absorption check**

1. **Wrong file path:** mostly fixed. `§4 Phase 1` now points mapping work to `background.ts` and the helper. But `§3` still wrongly says the writer is at `dispatcher.ts:461-472` and implies the dispatcher writes the envelope. Fix that stray reference too.
2. **Same-shape no-op test:** fixed correctly. Test `#7` is the missing regression pin.
3. **Real seam for wire mapping:** fixed correctly. Extracting `toWalletResponseError()` is the right move.
4. **E2E relaxed assertion:** fixed correctly. Matching `4100|CAPABILITY_NOT_GRANTED` is the right e2e level.
5. **Wire reality / JSON envelope:** accurate now. The parse recipe is correct in substance.
6. **Session-not-found ordering pin:** good addition. That was a real refactor hazard.
7. **JSON-envelope round-trip test:** good. This is the load-bearing contract test.
8. **Stable error-message contract:** good addition. The “no interpolation” rule is exactly what I wanted.
9. **Log level drop to Debug:** correct.
10. **Typed-codes follow-up plan:** sensible and low priority.

3. **New risks v3.1 introduces**

- `toWalletResponseError()` is a new seam, but it does not expose anything materially new. It only centralizes already-observable behavior.
- The README parse recipe does create a softer public contract around `data.walletErrorCode`. That is acceptable; it already becomes a de facto contract the moment external dApps depend on it.
- Minor doc risk: the README snippet uses `err.message` directly. For TS users, safer is `const msg = err instanceof Error ? err.message : String(err)`.

4. **Phase 1.5 reconfirm**

Still right: keep `accounts`-only field-aware diff in this PR, defer the broader capability-shape fix.

5. **Final adversarial review**

- No race is introduced by the pure helper. It is pure and synchronous.
- A dApp can fake a 4100-looking envelope to its own UI, but that only fools itself or its users; it does not create wallet-side authority.
- `error-envelope.ts` is in the right layer. It is wallet-sdk transport shaping, not wallet-bridge domain logic.
- Remaining regression gap is small: the plan should explicitly say the helper preserves plain-string fallback for non-`WalletError` throws. The code sketch does that, but call it out once in prose.

6. **Final blockers**

- Fix the lingering wrong reference in `§3`: change `dispatcher.ts:461-472` to `background.ts:461-472`, and stop calling it the dispatcher’s writer.
- Tighten the README parse snippet to handle non-`Error` throws safely:
  `const msg = err instanceof Error ? err.message : String(err)`.
- Make sure one test explicitly asserts the exact stable message string, since `§5` now treats it as contract.

7. **What looks fine**

The plan is now coherent. The helper extraction is clean, the test matrix is the right size, the wire-reality caveat is finally accurate, and the v3 direction remains the right one. After the two doc nits and the message-string assertion are tightened, this is ready.