/**
 * F-09: authenticate the sender of an internal extension message.
 *
 * Same-extension SW / popup / offscreen contexts report
 * `sender.id === chrome.runtime.id` and carry **no** `tab` — only
 * content-scripts and web pages carry a `sender.tab`. Reject foreign
 * extensions (`id` mismatch) and any tab-bound sender. This mirrors the
 * wallet-sdk `content-script-validator` subframe defense, applied at the
 * SW↔offscreen / popup↔SW messaging layer as defense-in-depth.
 *
 * The `{id, tab}` shape is identical on Chrome and Firefox `MessageSender`,
 * so the same predicate holds on both.
 */
export function isTrustedInternalSender(sender: chrome.runtime.MessageSender | undefined): boolean {
	return sender?.id === chrome.runtime.id && sender.tab === undefined
}
