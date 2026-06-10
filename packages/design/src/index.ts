/**
 * @nulo/design — the brutalist design system shared across Nulo apps.
 *
 * Tokens are a typed reflection of the CSS variables declared in base.css.
 * Import the global stylesheet once at app entry: `import "@nulo/design/base.css"`.
 * Components are exported as Vue SFC source; the consumer's Vite pipeline compiles them.
 *
 * Fonts are NOT bundled — each consumer ships the woff2 files under its own
 * `public/fonts/` (base.css references them by absolute `/fonts/...` URL).
 *
 * Presentational only: components take their data + any `data-testid` via props.
 * They never import app-specific utilities, stores, or service clients.
 */

/** UI primitives */
export { default as AppButton } from "./ui/AppButton.vue"
export { default as Card } from "./ui/Card.vue"
export { default as Spinner } from "./ui/Spinner.vue"
export { default as Tag } from "./ui/Tag.vue"
export { default as Toast } from "./ui/Toast.vue"

/** Composites */
export { default as AddressDisplay } from "./composite/AddressDisplay.vue"
export { default as BalanceRow } from "./composite/BalanceRow.vue"
export { default as DisclaimerTag } from "./composite/DisclaimerTag.vue"
export { default as DripButton } from "./composite/DripButton.vue"
export { default as EmojiGrid } from "./composite/EmojiGrid.vue"

/** Tokens */
export * from "./tokens"
