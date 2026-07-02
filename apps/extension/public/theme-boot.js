/*
 * Pre-paint theme boot. A classic (render-blocking) external script — the extension CSP
 * (`script-src 'self' 'wasm-unsafe-eval'`) forbids INLINE js but allows self-hosted files, so this
 * runs before first paint and sets <html theme> so light-mode users never flash dark. chrome.storage
 * is the source of truth; localStorage["nulo:theme"] is a synchronous paint cache written on every
 * theme change (see utils/general.js persistThemeHint). Keep the key + allowed values in sync.
 */
function bootTheme() {
	let choice = null
	try {
		choice = localStorage.getItem("nulo:theme")
	} catch {
		// localStorage may be unavailable (privacy mode); fall through to the OS preference.
	}
	if (choice !== "dark" && choice !== "light" && choice !== "system") choice = "system"
	let resolved = choice
	if (choice === "system") {
		resolved = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light"
	}
	document.documentElement.setAttribute("theme", resolved)
}

try {
	bootTheme()
} catch {
	// Never block first paint on the theme hint.
}
