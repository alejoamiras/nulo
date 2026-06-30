# Shared QUALITY audit prompt (harden quality, ultra) — typing + dedup lens

You are a Phase-2 cluster agent in a `/harden quality` audit of the **Nulo Aztec wallet** monorepo (Bun, Vue 3, TypeScript strict, Biome). Focus = **QUALITY only** (maintainability / change cost). The code currently WORKS; your job is to surface what makes it expensive to change. NOT security, NOT correctness bugs (those are other focuses — if you spot one, note it in a `## Out-of-focus notes` tail, don't score it as a quality finding).

**Special lens (the owner's explicit ask), weight these heavily:**
- **TYPING quality**: `any`/`unknown` misuse; loose types at package/RPC/storage boundaries; `as` / `as unknown as` double-casts; primitive obsession (stringly-typed kinds, bare `string`/`ArrayBuffer` for domain concepts); missing/!-used discriminated unions; zod-schema ↔ TS-type drift/duplication; generic params that enforce nothing (`Record<string, any>`); branded-type opportunities for secret/key material.
- **DEDUP (wise)**: duplicated logic/types WITHIN and ACROSS packages. "Wise" = collapse real duplication into a factory/helper/generic, but DON'T over-abstract incidental similarity. Cite ALL instances.

## Rules
- Every finding MUST map to a named smell: a Fowler catalog smell (Long Method, Large Class, Primitive Obsession, Duplicate Code, Shotgun Surgery, Divergent Change, Feature Envy, Data Clump, Switch Statements, Dead Code, Speculative Generality, Middle Man, …) OR a named close analog (Temporal Coupling, Config Sprawl, Stringly-Typed, Boolean Blindness, Schema/Type Drift, Boilerplate-per-consumer, …) — EXPLAIN the mapping for analogs.
- Concrete evidence only. Cite `file:line`. For dedup, list EVERY instance. For typing, cite the exact loose decl + the casts it forces.
- NO speculation, NO "could be cleaner" without a named smell, NO style/format nits (Biome handles those), NO naming preferences, NO speculative-flexibility ("might need X later").
- Do NOT flag test/fixture/generated code (`*.d.ts`, auto-imports, generated `tokens.ts`, vendored files) UNLESS production-wired. Do NOT flag conventions the codebase uses consistently UNLESS they cost real duplication/coupling/change-amplification.
- Respect the repo's own documented intent (read `CLAUDE.md`): the L0–L6 layers, the service triplet pattern, composition-root DI, the composition-test layer. A pattern the repo deliberately standardizes is only a smell if it measurably costs.

## Per-finding structure (in your output file)
```
### <ID> <Title>
- Smell: <Fowler name | analog (+mapping)>
- Lens: typing | dedup | other
- Maintenance impact: architectural | structural | local | cosmetic
- Blast radius: <# files/modules touched by this smell>
- Instances: file:line (ALL of them)
- Evidence: the loose decl / duplicated logic, concretely
- Why it harms future change: <concrete scenario that gets harder>
- Refactoring: <named Fowler/analog refactoring> → <what duplication/coupling disappears>
- Effort: hours | days | weeks
- Confidence: high | moderate | low
```

Aim for the SMALLEST set of high-value findings (target ~1–3 strong findings per cluster; quality over volume). End with a 1-line `## Summary` (count + the single highest-value finding).
