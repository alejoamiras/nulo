import { expect, inject } from "vitest"
import { pxeHostState } from "../fixtures/browser"
import { openPopup, test } from "../fixtures/extension"
import { sendDefaultTx } from "../fixtures/send"
import { mintPublicTokensForAccount, type AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const PXE_PAGE = "src/offscreen/index.html"

/** Whether a `web_accessible_resources` pattern reaches the PXE page. `*` is the only wildcard;
 *  Firefox reports patterns with a leading `/`, Chrome without, so neither side keeps one. */
const reachesPxePage = (pattern: string): boolean => {
	const literals = pattern.replace(/^\/+/, "").split("*")
	return new RegExp(`^${literals.map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(PXE_PAGE)
}

/**
 * After a real send: exactly one PXE host, and it is `visible` — the property that keeps its timers
 * unthrottled (a hidden document's are clamped to one a second, and the node client waits on a
 * zero-delay timer per RPC batch). A guard against hiding the host again, not a speed guarantee.
 * The same run reads the BUILT manifest: the build emits `web_accessible_resources` the source
 * manifest never declares, and none may reach the PXE page.
 */
test.skipIf(!hasConfig)(
	"pxe-host-state — one visible PXE host after a send; the PXE page is not web-accessible",
	{ timeout: 360_000 },
	async ({ dappConnectedExtensionWithTransactionCap: ctx }) => {
		await mintPublicTokensForAccount(aztecConfig!, ctx.accountAddress)
		await sendDefaultTx(ctx, ctx.playgroundPage, aztecConfig!, "pxe-host-state:send")

		const popup = await openPopup(ctx)
		try {
			expect(await pxeHostState(popup)).toEqual({ count: 1, visibility: ["visible"] })

			const patterns = await popup.evaluate((): string[] => {
				const entries = (chrome.runtime.getManifest().web_accessible_resources ?? []) as Array<string | { resources: string[] }>
				return entries.flatMap((entry) => (typeof entry === "string" ? [entry] : entry.resources))
			})
			// Controls: the matcher sees the page through every shape a manifest can carry, and only those.
			expect(
				["src/offscreen/index.html", "/src/offscreen/index.html", "/src/*", "*", "src/offscreen/*.html"].every(reachesPxePage),
			).toBe(true)
			expect(["src/offscreen/index.htm", "/assets/*", "src/*/other.html"].some(reachesPxePage)).toBe(false)
			expect(patterns.filter(reachesPxePage)).toEqual([])
		} finally {
			await popup.close().catch(() => {})
		}
	},
)
