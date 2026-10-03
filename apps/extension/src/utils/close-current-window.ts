/** Closes the browser window this page runs in; a window reported without an id is left open. */
export function closeCurrentWindow(): void {
	chrome.windows.getCurrent(undefined, (window) => {
		if (window.id) chrome.windows.remove(window.id)
	})
}
