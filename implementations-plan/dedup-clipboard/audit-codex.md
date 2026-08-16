# Codex audit trail — dedup-clipboard

## Plan audit (dual-audit codex leg, xhigh)

The direction is sound, but the plan is not implementation-ready.

1. **Blocking: the helper signature cannot preserve existing toast behavior.** One `icon` and one `duration` cannot represent:

   - Header: success/default duration; failure warning/3,000 ms.
   - IncomingTrust: success copy/1,500 ms; failure warning/default.
   - Received: success copy/2,000 ms; failure alert/2,000 ms.

   Use separate success/failure toast specifications, each containing full `ToastOptions` plus optional duration. Also, “generalizes the reference verbatim” must not copy the header’s `if (!address)` guard into the generic helper: several sites can pass empty/nullish values today. Keep that guard only in `copyAddressToClipboard`, or copied-byte behavior changes.

2. **Blocking: sanitization inventory is wrong.** Three locations sanitize today: header, `ScopeAddress`, and `ScopeClassId`. The plan says two. `ScopeClassId` must pass `sanitize: true`; its existing tests explicitly enforce this security property.

3. **Post-copy behavior must remain synchronous relative to the click.** Four ordinary sites have UI state beyond toast:

   - JsonViewer and AccountsPopup: 1,500 ms `isCopied`.
   - account-state/senders: 2,000 ms `copiedAddress`.
   - useProfileImportFlow: 1,500 ms `isCopied`.

   These flashes currently start even when copying fails and must remain so. BalanceView also invokes copy fire-and-forget after `nextTick`. Avoid converting formerly synchronous wrappers to `async`; call `void copyToClipboard(...)`. Vue callers do not presently consume their return values, but changing them is unnecessary observable drift. IncomingTrust and received may remain async.

4. **Secret timing needs an explicit ordering invariant.** `copySecret(value)` cleanly supports key.vue’s private/public choice and is safer than retaining a getter. It must:

   - Invoke `writeText(value)` synchronously during the gesture.
   - Immediately start the 60,000 ms scrub and 2,500 ms flash timers.
   - Clear only the previous scrub timer on re-copy.
   - Never store `value` or capture it in either timer.
   - Never cancel scrub on unmount.

   Scheduling in `finally` or after `await` changes the scrub epoch and means a never-settling clipboard promise prevents scrubbing. Awaiting after invoking `writeText` creates no gesture-transience problem; awaiting before invocation would.

5. **D2 is correct for this authorized arc, but deserves an owner follow-up.** Blanket sanitization would change malformed/raw diagnostic payloads. Separately review address-like values by provenance and consider `stripWireControl` for externally influenced addresses. D3 preserves audited behavior, although “strictly safer” is overstated: after a known rejection, the delayed scrub can only clobber an unrelated clipboard value.

6. **A remains preferable, but B’s stated technical objection is inaccurate.** `useToast()` is a module singleton without setup/injection dependencies, so it can technically be called from a plain module. A still wins through explicit dependency injection, easier tests, compatibility with `useProfileImportFlow`’s injected toast, and little savings from B because many sites already need `openToast`.

Current grep finds 22 production writer modules: header, 19 ordinary modules, and two exports. The plan names them all, but its “~15” count should be corrected.

Add characterization tests for separate success/failure toast metadata, all four ordinary UI flashes, unresolved/rejected secret writes, exact timer epoch, re-copy, unmount survival, both key values, and all three sanitizing sites.

**Verdict: conditional approve (with conditions: correct the toast API and sanitization inventory; pin synchronous handler/UI and secret-timer ordering; expand the characterization tests before implementation).**
---

## Final fresh-context pass (mid step 5)

The architecture is sound, but three plan edits remain before implementation:

- Toast coverage is incomplete: [plan.md:15](implementations-plan/dedup-clipboard/plan.md:15) requires failure metadata, but only the three already-correct sites are specified. Define a default or explicit matrix for the 19 newly-honest sites.
- Inventory conflicts: phase 3 says “~15” despite 19 ordinary modules. Enumerate all 22 and change the gate to exactly 19.
- Resolve stale contradictions: [plan.md:8](implementations-plan/dedup-clipboard/plan.md:8) still omits `ScopeClassId`; “guard only in `copyAddressToClipboard`” must mean no shared guard—`IncomingTrustPopup`’s existing local empty-value guard must remain. Remove Outline B’s disproven “unusable outside setup” rationale; A still wins on explicit dependency injection and testability.

Scrub same-tick ordering, unresolved-promise survival, no lifecycle/dispose, flash timing, and the three distinct existing toast shapes are correctly pinned.

**VERDICT: conditional approve (with conditions: make the three plan corrections above before migration).**
---

## Post-implementation diff review

### Medium

- [header-copy-address.ts:11](apps/extension/src/components/header-copy-address.ts:11) remains byte-identical to base and still owns its own `writeText`/sanitize/try-catch implementation. The approved plan explicitly required a guarded thin delegation with `sanitize: true`; consequently only 21 of the promised 22 modules are deduplicated.

- [auto-imports.d.ts:208](apps/extension/src/types/auto-imports.d.ts:208) and [.eslintrc-auto-import.json:297](apps/extension/src/types/.eslintrc-auto-import.json:297) contain required generated entries only as uncommitted worktree changes. `HEAD` therefore omits the tracked catalogs for `useSecretClipboardCopy`, `copyToClipboard`, and `CopyToastSpec`.

### Low

- [clipboard.test.ts:19](apps/extension/src/utils/clipboard.test.ts:19) and [useSecretClipboardCopy.test.ts:25](apps/extension/src/composables/useSecretClipboardCopy.test.ts:25) do not actually pin “first effect” or post-settlement toast ordering: both use already-resolved promises and merely confirm synchronous invocation. A premature success toast would pass. Production code is correct, but these promised regression assertions are partially vacuous.

Everything else checked clean: F-14 timing/constants/re-copy/scrub/no-lifecycle behavior, key selector and page nulling, all 19 success shapes, failure matrix, exactly two new sanitizer opts, handler synchronicity, four flash orderings, IncomingTrust guard/shape, Balance `nextTick`, injected toast, and the exact received-detail failure pin. The two arity edits did not weaken their prior assertions.

Focused rerun was blocked by the read-only environment failing to create `~/.cache/tmp`; supplied gates remain authoritative.

**Verdict: fix required**
### Convergence

No new material findings. Re-read confirms guarded header delegation with preserved shapes/sanitization, committed generated catalogs, and genuinely deferred ordering assertions. Header arity-only test edits preserve assertion content.

converged