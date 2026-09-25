// Re-export shim: the toast composable lives in @nulo/design as the single module-scope singleton;
// this file keeps the `composables/toast.js` specifier its importers and auto-imports.d.ts use.
// Explicit named re-exports (not `export *`) so unplugin-auto-import reliably surfaces the names.
export { SUCCESS_TOAST_MS, useToast } from "@nulo/design/composables/toast"
