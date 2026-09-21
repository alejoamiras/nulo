import type { ArmedInterception, RpcInterception } from "./index"
import type { WebDriverSession } from "./webdriver-classic"

/** Where the armed observer is kept between privileged scripts: the browser window they all run in. */
const SLOT = "__nuloE2eRpcIntercept"

interface Tally {
	hits: number
	failures: string[]
}

/**
 * Firefox's counterpart of the CDP interception. One observer in the parent process sees every
 * HTTP channel the browser opens — the background script's, the PXE frame's, a popup's — before
 * it connects, so there is no target to arm and no first request to race. The observer is held by
 * the browser window privileged scripts run in, which outlives every window a test opens.
 *
 * Only `refuse` exists: the one spec that redirects is Chrome-only for other reasons, and a mode
 * nothing runs is a mode nothing proves.
 */
export async function observeAndRefuse(session: WebDriverSession, fromOrigin: string, mode: RpcInterception): Promise<ArmedInterception> {
	if (mode.kind !== "refuse") throw new Error(`rpc-intercept: "${mode.kind}" is not implemented on Firefox`)
	const armed = await session.chromeScript<string>(
		`
		const [slot, origin, done] = arguments;
		if (window[slot]) return done("an interception is already armed in this browser");
		const tally = { hits: 0, failures: [] };
		const observer = {
			observe(subject) {
				try {
					const channel = subject.QueryInterface(Ci.nsIHttpChannel);
					if (channel.URI.prePath !== origin) return;
					tally.hits++;
					channel.cancel(Cr.NS_ERROR_CONNECTION_REFUSED);
				} catch (err) {
					tally.failures.push(String(err));
				}
			},
		};
		Services.obs.addObserver(observer, "http-on-modify-request");
		window[slot] = { tally, observer };
		done("armed");
		`,
		[SLOT, new URL(fromOrigin).origin],
	)
	if (armed !== "armed") throw new Error(`rpc-intercept: ${armed}`)

	const tally = () =>
		session.chromeScript<Tally>(
			`
			const [slot, done] = arguments;
			const held = window[slot];
			done(held ? held.tally : { hits: 0, failures: ["the interception is no longer armed"] });
			`,
			[SLOT],
		)
	return {
		hits: async () => (await tally()).hits,
		failures: async () => (await tally()).failures,
		stop: async () => {
			await session.chromeScript<string>(
				`
				const [slot, done] = arguments;
				const held = window[slot];
				if (held) Services.obs.removeObserver(held.observer, "http-on-modify-request");
				delete window[slot];
				done("stopped");
				`,
				[SLOT],
			)
		},
	}
}
