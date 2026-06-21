// Re-export shim (design-system round-2): useOutside/useEvent now live in @nulo/design (shared by the
// package's Popover + the extension's DropdownRoot). Kept as composables/outside.js so the explicit
// importers + auto-imports.d.ts ('../composables/outside.js') resolve unchanged. Explicit named
// re-exports (not `export *`) so unplugin-auto-import reliably surfaces the names.
export { useEvent, useOutside } from "@nulo/design/composables/outside"
