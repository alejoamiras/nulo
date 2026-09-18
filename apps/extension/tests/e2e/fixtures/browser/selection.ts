export type BrowserKind = "chrome" | "firefox"

const SUPPORTED: readonly BrowserKind[] = ["chrome"]

/**
 * Resolve the browser this run drives, rejecting anything there is no driver for.
 *
 * Kept free of any driver import so a global setup can call it before it spends a minute booting
 * a sandbox: an unusable selector must fail before the side effects, not after. Falling back to
 * Chrome would be worse than either — a lane would report a pass for a browser that never ran.
 */
export function resolveBrowserKind(): BrowserKind {
	const requested = process.env.NULO_E2E_BROWSER ?? "chrome"
	const kind = SUPPORTED.find((supported) => supported === requested)
	if (!kind) throw new Error(`NULO_E2E_BROWSER=${requested} is not a browser this suite can drive (have: ${SUPPORTED.join(", ")})`)
	return kind
}
