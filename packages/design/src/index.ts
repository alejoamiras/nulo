/**
 * @nulo/design — the brutalist design system shared across Nulo apps.
 *
 * Tokens are a typed reflection of the CSS variables declared in base.css.
 * Import the global stylesheet once at app entry: `import "@nulo/design/base.css"`.
 * Components are exported as Vue SFC source; the consumer's Vite pipeline compiles them.
 *
 * Fonts are NOT bundled — each consumer ships the woff2 files under its own
 * `public/fonts/` (base.css references them by absolute `/fonts/...` URL).
 */

export * from "./tokens"
