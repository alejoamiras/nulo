# M4.1 — Plan agent audit

Date: 2026-04-26

**BLOCKING**
- Hostile-frame defenses inside `content.ts` contradict the upstream-thin invariant. Today (`content.ts:11-22`) is a `ContentScriptConnectionHandler` constructor + `.start()` — no place to interpose origin checks without wrapping/replacing the upstream handler. Either commit to a local `WrappedContentScriptHandler` (changes the upstream-thin invariant) or propose an upstream PR. As-written, Design 1's Step 2 ("check `event.source`...") isn't implementable.
- Migration UX for Design 2 underspecified: where does existing-session catalog live (`dapp-session/service.ts` exists), what happens on denial (evict vs dormant), boot ordering vs M3.7 boundary checks. Memo handwaves the migration-heavy part.

**SHOULD-FIX**
- Missing **Design 1.5**: narrowed `matches` allowlist (e.g. `["https://app.aztec.network/*"]`) without dynamic registration. Strictly less code than Design 2 if dApp set is small/identifiable.
- `all_frames: true` reduction not enumerated as separate axis (near-free win).
- CWS re-review impact overstated — broad `optional_host_permissions` typically does NOT trigger re-review.
- ContentScriptConnectionHandler audit is **gate condition**, not prework — promote.
- Recommendation heuristic is vague — pivot is **discovery vs explicit-connect axis**, not ecosystem size.

**NIT**
- Test counts (5 D1 vs 3 D2) inverted by risk — D2's permission/migration paths are riskier.
