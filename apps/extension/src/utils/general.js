export const isPrefersDarkScheme = () => {
	return window.matchMedia("(prefers-color-scheme: dark)")?.matches
}

// Key shared with the pre-paint boot script at public/theme-boot.js. Keep both in sync.
export const THEME_HINT_KEY = "nulo:theme"

// Mirror the chosen theme to localStorage so theme-boot.js can set <html theme> BEFORE first paint,
// killing the flash-of-dark (the extension CSP forbids inline JS, so the boot script is external).
// chrome.storage stays the source of truth; this is only a synchronous paint cache. Store the RAW
// choice ("dark"|"light"|"system") so "system" re-resolves to the CURRENT OS preference on next load —
// storing the resolved value would desync after the OS theme changes while the popup is closed.
export const persistThemeHint = (value) => {
	try {
		localStorage.setItem(THEME_HINT_KEY, value)
	} catch {
		// localStorage can throw (privacy mode / disabled storage); the paint-hint is best-effort.
	}
}

export const debounce = (fn, delay) => {
	let timeout

	return (...args) => {
		clearTimeout(timeout)
		timeout = setTimeout(() => {
			fn(...args)
		}, delay)
	}
}

export async function ensurePermissions(perms) {
	return new Promise((resolve) => {
		chrome.permissions.contains(perms, (has) => {
			if (has) return resolve(true)

			chrome.permissions.request(perms, (granted) => {
				resolve(Boolean(granted))
			})
		})
	})
}
