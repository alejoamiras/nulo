import type { Browser } from "puppeteer"
import { actionPopupContext } from "./firefox"

/**
 * The toolbar popup is a *panel*: not a tab, not a window, and no WebDriver or BiDi command reaches
 * its document — which is why the rest of the suite opens the popup document in a window, and why
 * a layout that only breaks inside a panel went unseen. These two reach it the way Firefox's own
 * tests do: from the browser's privileged scope, and into the panel with a frame script.
 */

const PANEL_BROWSER = ".webextension-popup-browser"

/** Opens the panel as a toolbar click would, and resolves once its document is the extension's. */
export async function openActionPopup(browser: Browser): Promise<void> {
	const { session, addonId } = actionPopupContext(browser)
	const opened = await session.chromeScript<string>(
		`
		const [addonId, selector, done] = arguments;
		const win = Services.wm.getMostRecentWindow("navigator:browser");
		const { extension } = WebExtensionPolicy.getByID(addonId);
		extension.apiManager.global.browserActionFor(extension).openPopup(win, true);
		const started = Date.now();
		(function poll() {
			const popup = win.document.querySelector(selector);
			if (popup?.currentURI?.spec.startsWith("moz-extension:")) return done("open");
			if (Date.now() - started > 15000) return done("the action popup never loaded an extension page");
			win.setTimeout(poll, 100);
		})();
		`,
		[addonId, PANEL_BROWSER],
	)
	if (opened !== "open") throw new Error(`openActionPopup: ${opened}`)
}

/**
 * Evaluates `body` — the source of a function body whose `content` is the popup's window — inside
 * the open panel, and resolves with the JSON-serialisable value it returns.
 */
export async function evaluateInActionPopup<T>(browser: Browser, body: string): Promise<T> {
	const { session } = actionPopupContext(browser)
	const frameScript = `sendAsyncMessage("nulo-e2e:result", (function () { ${body} })());`
	const reply = await session.chromeScript<{ value?: T; error?: string }>(
		`
		const [selector, source, done] = arguments;
		const popup = Services.wm.getMostRecentWindow("navigator:browser").document.querySelector(selector);
		if (!popup) return done({ error: "the action popup is not open" });
		const mm = popup.messageManager;
		const listener = (message) => { mm.removeMessageListener("nulo-e2e:result", listener); done({ value: message.data }); };
		mm.addMessageListener("nulo-e2e:result", listener);
		mm.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(source), false);
		`,
		[PANEL_BROWSER, frameScript],
	)
	if (reply.error !== undefined) throw new Error(`evaluateInActionPopup: ${reply.error}`)
	return reply.value as T
}
