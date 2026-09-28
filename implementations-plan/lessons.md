# Lessons

Curated gotchas promoted out of closed plans, read at the start of every task so the same dead end is never walked twice. One line per entry, each linking its evidence: an archived lessons log or a permalink. The budget is 8 KiB; a new entry deduplicates against the rest and retires what it supersedes, and anything tied to a tool version carries its date.

## CI & gates

- On a `gh stack` program the plans gate runs on every arc head, so an arc cannot link a plan file that a later arc adds: name it as text, and let the arc that adds the file restore the link. [Evidence](ux-feedback/lessons/final-pass.md)
- The extension's unit vitest auto-imports only `vue` and `vue-router` and registers no components, unlike the build: an auto-imported composable or store throws "is not defined" and a bare component tag stays unresolved, so import them or pass `global.components`. [Evidence](ux-feedback/b5-permissions/lessons/phase-7.md), [more](ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-3.md)
- The tracked declarations in `apps/extension/src/types/` regenerate only when Vite builds or serves (vitest runs with `dts: false`), so local gates can pass on a stale copy and CI's build job then fails on the diff: build before you commit a new auto-imported export or component. [Evidence](ux-feedback/b5-permissions/lessons/phase-4.md), [more](ux-feedback/b3-tooltips-glossary/lessons/phase-3.md)
- Under `vi.useFakeTimers()` a natively dispatched event runs only the first Vue listener it reaches, since runtime-dom skips listeners attached no earlier than the event's `_vts`: dispatch with `wrapper.trigger`, which stamps `_vts` 1 ms ahead, or advance time 1 ms first (Vue 3.5.41, 2026-09). [Evidence](ux-feedback/b3-tooltips-glossary/lessons/phase-1.md), [more](ux-feedback/b3-tooltips-glossary/lessons/phase-4.md)

## Extension runtime

- A wire-shaped field fixture must stay below the BN254 modulus (`0x3064…`): `0x` + `aa` × 32 is above it, so the capability validator refuses it as malformed, while `0x` + `0a` × 32 passes. [Evidence](ux-feedback/b5-permissions/lessons/phase-6.md)
