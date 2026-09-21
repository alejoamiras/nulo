import { expect, inject } from "vitest"
import { pxeHostState } from "../fixtures/browser"
import { openPopup, test } from "../fixtures/extension"
import { sendDefaultTx } from "../fixtures/send"
import { mintPublicTokensForAccount, type AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const PXE_PAGE = "src/offscreen/index.html"

/** A `web_accessible_resources` pattern as a matcher: `*` is the only wildcard. */
const patternToRegExp = (pattern: string): RegExp =>
	new RegExp(
		`^${pattern
			.split("*")
			.map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
			.join(".*")}$`,
	)

/**
 * The PXE host after a real send: exactly one, and `visible`. Visibility is what keeps a document's
 * timers unthrottled — Firefox clamps a hidden document's timers to one a second, and the node
 * client waits on a zero-delay timer per RPC batch — so this is the property that fails if a change
 * hides the host again, with no wall-clock threshold to flake on. A guard against that regression,
 * not a speed guarantee.
 *
 * The same run reads the BUILT manifest: the build emits `web_accessible_resources` for the
 * content-script chunks that the source manifest never declares, and the PXE page must not be
 * reachable from a web page through any of them.
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
			expect(patterns.filter((pattern) => patternToRegExp(pattern).test(PXE_PAGE))).toEqual([])
		} finally {
			await popup.close().catch(() => {})
		}
	},
)
