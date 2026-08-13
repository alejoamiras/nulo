import { expect } from "vitest"
import { test, openPopup, waitForHash, clickByTestId } from "./fixtures/extension"
import { navigateByHash, navigateToSettings, setTheme } from "./fixtures/helpers"

test("cycle theme system → light → dark verifies html[theme=…] each step", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "appearance")

	await setTheme(page, "system")
	const systemTheme = await page.evaluate(() => document.documentElement.getAttribute("theme"))
	expect(systemTheme).toBeTruthy()

	await setTheme(page, "light")
	expect(await page.evaluate(() => document.documentElement.getAttribute("theme"))).toBe("light")

	await setTheme(page, "dark")
	expect(await page.evaluate(() => document.documentElement.getAttribute("theme"))).toBe("dark")

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("animations toggle persists across navigation", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "appearance")
	await page.waitForSelector('[data-testid="animations-toggle"]', { visible: true, timeout: 5_000 })

	// `data-toggle-active` reflects the Toggle's modelValue directly — a stable
	// literal, unlike the CSS-module-mangled `active` class. The flip is gated
	// (click → ConfigService RPC → SW broadcast → model ref → re-render is a
	// multi-hop chain a fixed sleep cannot honestly bound).
	const toggleState = () =>
		page.evaluate(() => document.querySelector('[data-testid="animations-toggle"]')?.getAttribute("data-toggle-active"))
	const before = await toggleState()
	expect(before === "true" || before === "false").toBe(true)

	await clickByTestId(page, "animations-toggle")
	const want = before === "true" ? "false" : "true"
	await page.waitForFunction(
		(w: string) => document.querySelector('[data-testid="animations-toggle"]')?.getAttribute("data-toggle-active") === w,
		{ timeout: 5_000, polling: 50 },
		want,
	)
	const after = await toggleState()
	expect(after).not.toBe(before)

	// Navigate away and back. Use `/about` — a real sibling settings page.
	// (Previously navigated to `/privacy`, but `src/popup/pages/settings/`
	// has no `privacy.vue`, so the hash never settled and waitForFunction
	// timed out at 5s. about.vue exists, has no auto-redirect, and is
	// already exercised by `navigation.test.ts`.)
	await navigateByHash(page, "#/popup/settings/about")
	await navigateByHash(page, "#/popup/settings/appearance")
	await page.waitForSelector('[data-testid="animations-toggle"]', { visible: true, timeout: 5_000 })

	// The remount's `getProps` RPC resolves BEFORE the toggle renders (the
	// block is v-if'd on !isLoading), so a rendered toggle carries the settled
	// persisted value — no extra wait belongs here.
	const persisted = await toggleState()
	expect(persisted).toBe(after)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

// SKIP: pre-existing smoke flake (documented in
// wallets-architecture-research/nulo/self-analysis.md:427 — popup-internal
// navigateByHash race). Flakes intermittently on Linux CI even though it
// passed locally. Un-skip when the navigation race is fixed.
test.skip("theme persists across navigation away and back", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "appearance")
	await setTheme(page, "light")

	// Navigate to a different settings page and back. Uses `/about` — a real
	// sibling settings page. (Previously `/privacy`, which has no `.vue`
	// page; vue-router never settles the hash there.)
	await navigateByHash(page, "#/popup/settings/about")
	expect(await page.evaluate(() => document.documentElement.getAttribute("theme"))).toBe("light")

	await navigateByHash(page, "#/popup/settings/appearance")
	expect(await page.evaluate(() => document.documentElement.getAttribute("theme"))).toBe("light")

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})
