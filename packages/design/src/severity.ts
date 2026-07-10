/**
 * Shared semantic severity/status vocabulary for the design system.
 *
 * Single source for the tone NAMES used across the severity-bearing primitives
 * (Badge, Banner, Toast). Each renderer applies its OWN visual treatment and
 * renders only the SUBSET it has styles for — so each types its prop as an
 * `Extract<SeverityTone, …>` (plus any renderer-local extra, e.g. Badge's
 * non-semantic `purple`). The colors stay per-renderer (Badge = background,
 * Banner = icon fill, Toast = left border) — they are genuinely different
 * surfaces, so this unifies the VOCABULARY, not the palette.
 *
 * Not the same axis as `ToastManagerBase`'s raw `red|green|orange` borders or
 * `composables/toast.ts`'s `color?: string` passthrough — those are raw colors,
 * deliberately left as-is (unifying them into tones risks a visual change).
 */
export type SeverityTone = "info" | "warning" | "error" | "done" | "ok"
