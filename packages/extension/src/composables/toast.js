// Re-export shim (design-system round-2). The toast composable now lives in @nulo/design as the single
// module-scope singleton; this file stays as `composables/toast.js` so the ~55 explicit importers
// (incl. the `.js`-suffixed ones) + auto-imports.d.ts (`'../composables/toast.js'`) resolve unchanged.
// Explicit named re-exports (not `export *`) so unplugin-auto-import reliably surfaces the names.
export { TOAST_DURATION, useToast } from "@nulo/design/composables/toast"
