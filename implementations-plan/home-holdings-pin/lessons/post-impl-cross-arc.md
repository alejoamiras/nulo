# Cross-arc codex pass

Fresh session over the net diff `dev@2a3d2d87…HEAD` (top of the stack). Astra at `high`,
read-only, session `01a07b4e-df1b-7d73-beda-8b9020cf8115`.

## Round 1 — verdict `reject`, eight findings, all verified and taken

1. **High — pin/unpin re-checked scope only before their awaits.** A chain switch during the storage
   read let `knownContracts()` (the NEW chain's rows) prune the OLD chain's list. Fix: the write ops
   re-check the captured scope after every await and bail as `stale`. New case (held storage read).
2. **High — a late "Home is full" could keep a destructive callback.** `showHomeFull` assigned
   fields onto whatever `cacheStore.confirm` held, so a Remove-token confirm opened during the symbol
   fetch kept its callback under a "Got it" button. Fix: the result is fenced (unmount, token change,
   scope change, a confirm already open) and the store gets a complete fresh object. New case.
3. **Medium — an older `refresh()` could roll pins back.** Fix: refresh generation + a disposed flag.
   New case.
4. **Medium — Home kept the previous scope's rows while fetching**, so old-chain rows were ordered
   under new-chain pins, and a rejected fetch left them for good. Fix: rows cleared before the await,
   no fetch without an account, rejection caught. New case.
5. **Medium — the token hero (prop path) still did unchecked `BigInt`.** Opening a malformed card's
   page threw. Fix: `parseRawBalance` / `isValidDecimals` on the hero; dashes and no fiat when
   malformed. New case. (Arc A file; landed on Arc A by cherry-pick.)
6. **Medium — write serialisation was per instance.** An unmounted page's pending write could
   overlap a new page's. Fix: a module-level queue keyed by the storage key. New case (two instances
   pin at once, both kept).
7. **Low — chain keys accepted 16-digit unsafe integers.** Fix: `Number.isSafeInteger` + canonical
   round-trip. New case.
8. **Low — comments.** The sanitiser paragraph compressed; "oldest" → "in key iteration order".

Test-harness lesson: a `DropdownItem` stub that both re-emits `click` and lets the parent's
`@click` fall through fires twice; the second, queued pin then hung on a never-resolved mock and
starved the next case's queue. Declare `emits` on such stubs.
