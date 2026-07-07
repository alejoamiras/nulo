/**
 * F-09: authenticate the sender of an internal extension message.
 *
 * Trust same-extension SW / popup / offscreen / options contexts; reject
 * foreign extensions and content-scripts the extension injected into a web
 * page. The discriminator is `sender.url`, NOT `sender.tab`: an extension
 * page can legitimately live in a **tab** (the options page, a popup opened
 * in a tab, or the e2e's tab-hosted popup), so a tab-present sender is NOT by
 * itself untrusted. A content script instead reports its **web-page** URL
 * (http/https), never a `chrome-extension://` URL, and a service-worker
 * sender may carry no url at all. `sender.url`/`sender.id` are set by Chrome,
 * not spoofable by the sender.
 *
 * The `{id, url}` shape is identical on Chrome and Firefox `MessageSender`,
 * so the same predicate holds on both.
 */
export function isTrustedInternalSender(sender: chrome.runtime.MessageSender | undefined): boolean {
	if (sender?.id !== chrome.runtime.id) return false
	// `getURL("")` yields this extension's own base — `chrome-extension://<id>/`
	// on Chrome, `moz-extension://<id>/` on Firefox — so the check is
	// browser-agnostic. A content script's `sender.url` is the web page.
	return sender.url === undefined || sender.url.startsWith(chrome.runtime.getURL(""))
}
