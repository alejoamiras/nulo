/**
 * vitest setup. Installs `@webext-core/fake-browser` so files under
 * test can call `chrome.runtime.*` without a real browser. Each test
 * starts with a clean state via `beforeEach`.
 *
 * Consumer packages that want to import the shared setup can do
 * `import "@nulo/extension-messaging/testing/setup"` — but most
 * extension tests already have their own setup wire, so the package
 * doesn't export this file.
 */

import { fakeBrowser } from "@webext-core/fake-browser"
import { beforeEach } from "vitest"

beforeEach(() => {
	fakeBrowser.reset()
})
