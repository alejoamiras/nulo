import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"

/**
 * Home and History diverged once because each page kept its own token lookup. Textual on purpose:
 * a page that reads the tokens itself again, or stops calling the shared lookup, fails here.
 */

const SRC = resolve(__dirname, "..")
const PAGES = ["popup/components/modules/general/RecentActivityView.vue", "popup/pages/activity.vue"]

describe("the activity pages' token lookup", () => {
	test.each(PAGES)("%s takes its tokens from useScopedTokens and never reads them itself", (path) => {
		const text = readFileSync(resolve(SRC, path), "utf8")
		expect(text).toMatch(/\buseScopedTokens\(/)
		expect(text).not.toMatch(/\bgetTokens\(/)
	})
})
