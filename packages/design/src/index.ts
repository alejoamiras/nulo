/**
 * @nulo/design — the brutalist design system shared across Nulo apps.
 *
 * Tokens are a typed reflection of the CSS variables declared in base.css.
 * Import the global stylesheet once at app entry: `import "@nulo/design/base.css"`.
 * Components are exported as Vue SFC source; the consumer's Vite pipeline compiles them.
 *
 * Fonts are package-owned (`src/fonts`, referenced package-relative from base.css); the consumer's
 * Vite bundles them. There is NO auto-import in this package — every component, Vue API, and helper
 * uses explicit imports (consumers like the faucet have no unplugin-auto-import).
 *
 * Presentational only: components take their data + any `data-testid` via props.
 * They never import app-specific utilities, stores, or service clients.
 */

/** Core (L1) primitives */
export { default as Flex } from "./core/Flex.vue"
export { default as Icon } from "./core/Icon.vue"
export { default as MaterialIcon } from "./core/MaterialIcon.vue"
export { default as Text } from "./core/Text.vue"

/** UI primitives */
export { default as AppButton } from "./ui/AppButton.vue"
export { default as Badge } from "./ui/Badge.vue"
export { default as Banner } from "./ui/Banner.vue"
export { default as BrutalistTitle } from "./ui/BrutalistTitle.vue"
/** Router-free base; the extension keeps a local <Button> wrapper that injects RouterLink. */
export { default as Button } from "./ui/Button.vue"
export { default as Card } from "./ui/Card.vue"
export { default as Checkbox } from "./ui/Checkbox.vue"
export { default as Input } from "./ui/Input.vue"
export { default as LoadingState } from "./ui/LoadingState.vue"
export { default as Popover } from "./ui/Popover.vue"
export { default as SectionLabel } from "./ui/SectionLabel.vue"
export { default as Spinner } from "./ui/Spinner.vue"
/** TEMPORARY (round-2 D-FAUCET-DEFER): faucet-frozen legacy spinner; removed in P7. */
export { default as SpinnerLegacy } from "./ui/SpinnerLegacy.vue"
/** Router-free base; the extension keeps a local <SubPageHeader> wrapper that injects useRouter. */
export { default as SubPageHeaderBase } from "./ui/SubPageHeaderBase.vue"
export { default as Tag } from "./ui/Tag.vue"
export { default as Toast } from "./ui/Toast.vue"
/** Extension's transient single-toast region (distinct from the faucet's `Toast` item). */
export { default as ToastManagerBase } from "./ui/ToastManagerBase.vue"
export { default as Toggle } from "./ui/Toggle.vue"
export { default as Tooltip } from "./ui/Tooltip.vue"

/** Composites */
export { default as AddressDisplay } from "./composite/AddressDisplay.vue"
export { default as BalanceRow } from "./composite/BalanceRow.vue"
export { default as DisclaimerTag } from "./composite/DisclaimerTag.vue"
export { default as DripButton } from "./composite/DripButton.vue"
export { default as EmojiGrid } from "./composite/EmojiGrid.vue"

/** Tokens */
export * from "./tokens"
