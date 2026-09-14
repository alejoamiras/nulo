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

/** `sender.url` without its query and fragment — the DOCUMENT identity. A Firefox hidden-window
 *  offscreen carries `?instance=<token>`; the page is the same. */
function senderPath(sender: chrome.runtime.MessageSender): string | undefined {
	return sender.url?.split(/[?#]/, 1)[0]
}

/**
 * True iff `sender` is THIS extension's context at exactly `documentUrl` (query/fragment
 * ignored). `sender.tab` is NOT a discriminator: a Firefox hidden-window offscreen is tab-hosted.
 * Used for the two directions where a specific document is the only legitimate peer — an
 * offscreen response/READY/PONG must come from the offscreen document itself, or a
 * compromised same-extension page that observed `{from, requestId}` could settle a pending
 * request with a reflected response.
 */
export function isSenderAtUrl(sender: chrome.runtime.MessageSender | undefined, documentUrl: string): boolean {
	if (sender?.id !== chrome.runtime.id) return false
	return senderPath(sender) === documentUrl
}

/** The URLs this extension's background context reports as `sender.url`: the MV3 service-worker
 *  script (Chrome) or the background page (Firefox). Read from the LIVE manifest so a bundler's
 *  rewritten path is what is compared. Empty when no manifest is reachable (unit tests). */
function backgroundContextUrls(): Set<string> {
	const out = new Set<string>()
	const manifest = (chrome.runtime.getManifest?.() ?? {}) as {
		background?: { service_worker?: string; page?: string; scripts?: string[] }
	}
	const bg = manifest.background
	if (bg?.service_worker) out.add(chrome.runtime.getURL(bg.service_worker))
	if (bg?.page) out.add(chrome.runtime.getURL(bg.page))
	if (bg?.scripts?.length) out.add(chrome.runtime.getURL("_generated_background_page.html"))
	return out
}

/**
 * True iff `sender` is THIS extension's background context — the only sender an offscreen
 * request may come from. A same-extension popup, options page or offscreen document always
 * reports a document URL; the service worker reports its script URL, or on some builds no URL
 * at all (a worker has no document), so a same-extension, tab-less, URL-less sender is the
 * worker. Anything with a document URL must be the manifest's background entry exactly.
 */
export function isBackgroundSender(sender: chrome.runtime.MessageSender | undefined): boolean {
	if (sender?.id !== chrome.runtime.id || sender.tab !== undefined) return false
	if (sender.url === undefined) return true
	const path = senderPath(sender)
	return path !== undefined && backgroundContextUrls().has(path)
}
