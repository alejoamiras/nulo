// Type sidecar for the `composables/toast.js` re-export shim. The extension tsconfig has allowJs off,
// so TS reads the `.js` module's types from this `.d.ts`; it re-exports the package's types so the
// shim's `.js`-suffixed importers stay typed without a second source of truth.
export { TOAST_DURATION, type ToastOptions, useToast } from "@nulo/design/composables/toast"
