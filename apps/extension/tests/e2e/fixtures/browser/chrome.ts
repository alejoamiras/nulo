import puppeteer from "puppeteer"
import type { BrowserDriver, LaunchOptions, LaunchedBrowser } from "./index"

const SCHEME = "chrome-extension://"

async function launch({ extensionPath, userDataDir, headless }: LaunchOptions): Promise<LaunchedBrowser> {
	// Headless `true` (the modern default in Puppeteer 24+) supports MV3
	// extensions (offscreen docs, SW, chrome.storage, chrome.runtime.Port).
	// `"new"` was the predecessor name that's now deprecated as a value;
	// passing it here historically generated a deprecation warning that we
	// ignored.
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
			// Artifact mode runs the PRODUCTION bundle, so Alpha is active and its
			// default-token seeds are real — a first account now triggers a seed
			// pass that can resolve. `fiat-display` asserts no fiat renders on a
			// fresh wallet, and a resolved seed plus a resolved quote would break
			// that, so the PRICE host is blocked. Deliberately not the RPC host:
			// blocking that makes the node client retry, which delays profile
			// deletion past the reset specs' waits (measured — it fails three specs
			// that pass without it). A seeded token card is harmless here; no smoke
			// assertion looks at the token list.
			...(process.env.NULO_E2E_ARTIFACT_RUN === "1" ? ["--host-resolver-rules=MAP api.coingecko.com 127.0.0.1:1"] : []),
		],
		ignoreDefaultArgs: ["--disable-extensions"],
		// Default protocolTimeout is 180_000ms — bump to 300_000 because the
		// wallet's argon2 KDF unlock + bb.js wasm boot can spike CDP latency
		// past 3 minutes on cold first run when vitest's worker pool has
		// the host under memory pressure. Past timeouts (e.g. profile-export
		// reveal flow) showed the unlock completed eventually but the CDP
		// reply was lost because the call timed out.
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
