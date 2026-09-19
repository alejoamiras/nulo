import puppeteer from "puppeteer"
import type { BrowserDriver, LaunchOptions, LaunchedBrowser } from "./index"

const SCHEME = "chrome-extension://"

async function launch({ extensionPath, userDataDir, headless }: LaunchOptions): Promise<LaunchedBrowser> {
	// Headless `true` supports MV3 extensions — offscreen documents, the service worker,
	// `chrome.storage` and `chrome.runtime.Port` all work.
	const browser = await puppeteer.launch({
		headless,
		...(userDataDir ? { userDataDir } : {}),
		args: [
			`--disable-extensions-except=${extensionPath}`,
			`--load-extension=${extensionPath}`,
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--window-size=400,600",
			// Prevent Chrome from throttling background/offscreen tabs. Headless
			// Chrome doesn't have a "focused" page, so without these flags the
			// renderer backgrounds the tab and rAF gets throttled to ~1Hz —
			// which freezes Vue's `<Transition>` classes mid-enter and breaks
			// any test that depends on a popup actually rendering.
			"--disable-renderer-backgrounding",
			"--disable-backgrounding-occluded-windows",
			"--disable-features=CalculateNativeWinOcclusion",
			// Artifact mode runs the production bundle, where token seeds resolve for real and a
			// resolved quote would break `fiat-display`'s "no fiat on a fresh wallet". Block the
			// price host only: blocking RPC makes the node client retry, which pushes profile
			// deletion past the reset specs' waits and fails three of them.
			...(process.env.NULO_E2E_ARTIFACT_RUN === "1" ? ["--host-resolver-rules=MAP api.coingecko.com 127.0.0.1:1"] : []),
		],
		ignoreDefaultArgs: ["--disable-extensions"],
		// The default 180s is not enough for a cold first run: argon2 unlock plus the bb.js wasm
		// boot can hold a CDP reply past it while the worker pool has the host under memory
		// pressure, and the call then times out on work that did complete.
		protocolTimeout: 300_000,
	})
	// Chrome owns nothing outside its own process tree, so closing the browser is the whole
	// teardown. A driver that also owns a WebDriver process reaps it here instead.
	return { browser, close: () => browser.close() }
}

export const chromeDriver: BrowserDriver = {
	kind: "chrome",
	scheme: SCHEME,
	launch,
	extensionUrl: (extensionId, path) => `${SCHEME}${extensionId}${path}`,
}
