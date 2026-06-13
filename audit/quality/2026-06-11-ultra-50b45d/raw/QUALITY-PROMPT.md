# Quality audit prompt (verbatim for all Phase 2 agents — Claude + Codex)

You are auditing a code cluster for QUALITY (maintainability, not correctness). Mindset: future-change cost.

Find ONLY concrete code smells with NAMED catalog mappings. The code currently works; your job is to surface what makes it expensive to change.

For each finding, you MUST provide:

1. Title: concise.
2. Smell name — must come from Fowler's Refactoring catalog OR a named close analog with the mapping explained. Examples:

   Fowler classics:
   - Bloaters: Long Method, Large Class, Primitive Obsession, Long Parameter List, Data Clumps
   - OO-Abusers (or language equivalents): Switch Statements, Temporary Field, Refused Bequest, Alternative Classes with Different Interfaces
   - Change Preventers: Divergent Change, Shotgun Surgery, Parallel Inheritance Hierarchies
   - Dispensables: Comments-as-deodorant, Duplicate Code, Dead Code, Lazy Class, Data Class, Speculative Generality
   - Couplers: Feature Envy, Inappropriate Intimacy, Message Chains, Middle Man

   Named close analogs (cite the source / community canon):
   - Cyclic dependencies (boundary erosion)
   - Temporal coupling (operations that must happen in a specific order without enforcement)
   - Config sprawl (the same config knob duplicated across N files)
   - Test brittleness (tests that fail on unrelated refactors)
   - Vue/reactivity-specific: over-coupled prop drilling, composable extraction opportunity, fire-and-forget effects
   - Async-specific: callback chains where promises/async would do, missing error boundary in async flows, sync-over-async
   - Error-handling: try/catch nesting, exception swallowing, error-as-success-path

   For analogs, EXPLAIN the mapping: "This is a form of Shotgun Surgery because changing X requires touching N unrelated files".

3. Maintenance impact bucket: architectural (wrong abstraction at module/package level) / structural (wrong shape within a module) / local (within a single function or file) / cosmetic (minor). PLUS blast radius (how many files/modules touched) and change frequency (how often this code is modified, inferred from git history if available). A local smell touched weekly may matter more than a dormant architectural smell.

4. Concrete evidence: cite specific instances. For duplication: cite ALL N locations and the duplicated logic. For Feature Envy: name the data the function envies and where it lives. For dead code: cite the absence of inbound references with grep-style evidence AND confirm no DI / reflective registration covers it.

5. Why it harms future change: be concrete. What scenario gets harder?

6. Smallest safe refactoring: from Fowler's refactoring catalog (Extract Method / Move Function / Replace Conditional with Polymorphism / Inline Function / etc.) OR a named analog refactoring. Name it.

7. What disappears: what duplication / coupling / complexity goes away after the refactoring.

8. Instances: ALL file:line locations sharing this root cause.

If you cannot name a smell (Fowler or close analog with mapping), mark as a NON-FINDING.

DO NOT FLAG:
- Style or formatting (Biome handles).
- Naming preferences without a concrete duplication or coupling consequence.
- "Could be cleaner" / "more idiomatic" without naming a smell.
- Speculative future flexibility ("what if you need to support X later?").
- Performance optimizations (separate concern).
- Anything about wrong behavior, crashes, data integrity, or trust boundaries — out of scope; note in one line under "Out-of-scope observations" and move on.
- Pre-existing patterns the codebase consistently uses UNLESS they create measurable duplication, coupling, or change amplification. (Conventions are not smells unless they cost something.)
- Issues in test, demo, fixture, or migration code UNLESS that code is production-wired OR the finding is specifically about test-harness duplication flagged in your cluster scope.
- Dead-code claims in reflective / DI / framework-registration contexts UNLESS you can confirm no registration covers it (note: this repo auto-imports `src/utils/`, `src/composables/`, `src/stores/`, `src/components/` in the extension package — a missing explicit import does NOT mean dead).
- Framework defaults you would override with no clear gain.
- The `spec.ts`/`service.ts`/`client.ts` triple itself (house convention) — only its measurable duplication costs.
- `AUDIT`/`F-0xx` security-marker comments (sanctioned by CLAUDE.md).
- Generated files (`src/types/auto-imports.d.ts`, `components.d.ts`) and vendored code (`JsonViewer/creator.js`, `theme.js`).

Repo context: Bun monorepo, Vue 3 extension + 5 library packages, biome-enforced layering (wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension), CLAUDE.md documents the house conventions. Layer order and the L0-L6 component model are deliberate; flag violations OF them, not their existence.

In-cluster traces cap at ~4 functions of inter-procedural context; the cap escalates one function across handoff edges (event emit→listener, DI inject→consumer, framework hook→handler).

Output format: markdown. One `## F<n>: <title>` section per finding with the 8 numbered fields. Then `## Non-findings` (considered + rejected, one line each). Then `## Out-of-scope observations` (one line each).
