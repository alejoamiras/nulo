/**
 * Passkey execution canary — the passkey analog of `frozen-account-canary.test.ts`.
 *
 * The address KAT (key-vectors V3, reference-pinned) proves the passkey master DERIVES correctly;
 * it says nothing about executability. This file asserts a passkey-registered wallet operates
 * end-to-end against a live node, EXECUTION-ONLY by design (PRF secrets cannot be read back via
 * CDP, so a test-side formula cross-check is impossible — the V3 reference vector carries that
 * burden; see `implementations-plan/key-model-v2-hardening/plan.md` §D):
 *
 *   1. Register a passkey profile via the in-page (path A) ceremony against a virtual
 *      authenticator, create a second account, connect the playground, grant the transaction
 *      bundle to both accounts.
 *   2. A's FIRST tx executes the frozen ctor via the multicall deploy path — simulate, REAL
 *      proof, node acceptance (mined).
 *   3. An authwit-CONSUMING tx as the named caller B (B's first tx — its own ctor) lands.
 *   4. A service-worker restart later, the profile re-unlocks via a FRESH WebAuthn ceremony in
 *      the SAME popup FrameTreeNode (passkey sessions are never silently restored), and the
 *      re-derived account still signs, proves, and lands a tx.
 *
 * FTN discipline (load-bearing): the virtual authenticator — and therefore the credential and its
 * PRF seed — is scoped to the anchor popup page's FrameTreeNode. The anchor popup stays OPEN for
 * the whole test; closing it garbage-collects the credential and makes the post-restart unlock
 * impossible. No browser-relaunch leg, ever: credentials die with the browser instance.
 *
 * Every stage asserts an exact outcome — no ok-or-error tolerances. Run prover-ON:
 * `bun run e2e:agent tests/e2e/network/passkey-execution-canary.test.ts`.
 */
import { expect, inject } from "vitest"
import { mintPublicTokensForAccount, waitForTxMined, type AztecTestConfig } from "../fixtures/aztec"
import {
	clickByTestId,
	connectPlayground,
	grantCapBundle,
	openPopup,
	test,
	waitForHash,
	type ExtensionContext,
} from "../fixtures/extension"
import { createAccount, switchToLocalNetwork } from "../fixtures/helpers"
import { registerPasskeyProfile, setupPasskeyVirtualAuth } from "../fixtures/passkey"
import { assertPgOk, formatPgMismatch, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup } from "../fixtures/popups"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

test("agent-runner contract: a live sandbox must be configured (no false skip)", () => {
	if (process.env.E2E_REQUIRE_SETUP === "1") {
		expect(hasConfig).toBe(true)
	}
})

/** Duplicated verbatim from frozen-account-canary.test.ts (kept file-local there by design —
 *  that file is the KDF-bump gate and stays untouched by this arc). */
async function stopServiceWorker(ctx: ExtensionContext): Promise<void> {
	const swTarget = await ctx.browser
		.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(ctx.extensionId), { timeout: 5_000 })
		.catch(() => null)
	if (!swTarget) {
		console.warn("[passkey-canary] no live SW target — Chrome already killed it; proceeding to recovery")
		return
	}
	const swSession = await swTarget.createCDPSession()
	try {
		await swSession.send("Runtime.terminateExecution")
	} catch {
		// Session dies along with the SW; swallow disconnect noise.
	}
}

/** Duplicated from frozen-account-canary.test.ts (see stopServiceWorker note). */
function txHashOf(resultJson: unknown): string {
	const candidate =
		typeof resultJson === "string"
			? resultJson.replace(/^"(.*)"$/, "$1")
			: (resultJson as { txHash?: unknown } | null | undefined)?.txHash
	if (typeof candidate !== "string" || !candidate.startsWith("0x")) {
		throw new Error(`cannot extract tx hash from result: ${(JSON.stringify(resultJson) ?? "undefined").slice(0, 2_000)}`)
	}
	return candidate
}

/** Duplicated from frozen-account-canary.test.ts (see stopServiceWorker note). */
async function setPgInputs(page: import("puppeteer").Page, values: Record<string, string>): Promise<void> {
	await page.evaluate((entries: Record<string, string>) => {
		for (const [name, v] of Object.entries(entries)) {
			const input = document.querySelector<HTMLInputElement>(`[data-testid="pg-input-${name}"]`)
			if (!input) throw new Error(`pg-input-${name} not present`)
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
			setter?.call(input, v)
			input.dispatchEvent(new Event("input", { bubbles: true }))
		}
	}, values)
}

test.skipIf(!hasConfig)(
	"passkey canary — register via PRF ceremony, ctor-deploy with real proof, authwit consume, SW-restart ceremony re-unlock",
	// retry: 0 — this is the KDF-change execution gate; a retry-masked failure defeats it.
	{ timeout: 900_000, retry: 0 },
	async ({ freshExtensionPerTest }) => {
		const ctx = freshExtensionPerTest
		const step = (m: string) => console.log(`[passkey-canary] ${m}`)

		// ── Stage 1: passkey profile + second account + dApp connection ──
		// The anchor popup owns the virtual authenticator's FTN — it stays open until the end.
		const anchorPopup = await openPopup(ctx)
		const auth = await setupPasskeyVirtualAuth(ctx.browser, anchorPopup)
		try {
			step("registering passkey profile (in-page PRF ceremony)")
			await registerPasskeyProfile(anchorPopup)
			await switchToLocalNetwork(anchorPopup)
			step("creating the second account")
			await createAccount(anchorPopup, "Second")

			step("connecting the playground")
			const page = await connectPlayground(ctx)
			const accountAddresses = await grantCapBundle(ctx, page, "transaction", async (accountIds) => {
				const granted = accountIds.slice(0, 2).filter((a): a is string => !!a)
				if (granted.length < 2) {
					throw new Error(`capabilities popup exposed ${granted.length} account(s); passkey canary needs 2`)
				}
				return granted
			})
			const [ownerA, callerB] = accountAddresses as [string, string]
			step(`granted A=${ownerA.slice(0, 12)}… B=${callerB.slice(0, 12)}…`)

			// ── Stage 2: A's FIRST tx — frozen ctor + set_authorized, REAL proof, mined ──
			step("minting to owner A")
			await mintPublicTokensForAccount(aztecConfig!, ownerA)
			await setPgInputs(page, {
				tokenAddress: aztecConfig!.tokenAddress,
				authwitOwner: ownerA,
				authwitCaller: callerB,
				authwitAmount: "1",
				authwitNonce: "1",
			})
			step("granting public authwit as A (A's FIRST tx — ctor + set_authorized)")
			const seqGrant = await snapshotResultSeq(page)
			const grantPopupP = waitForPopup(ctx, "execute", { timeout: 30_000 })
			await clickByTestId(page, "pg-btn-grantPublicAuthwit")
			const grantPopup = await grantPopupP
			await waitForExecuteContent(grantPopup)
			await approveExecute(grantPopup, { approvableTimeoutMs: 120_000 })
			const grantResult = await waitForPgResult(page, "grantPublicAuthwit", seqGrant, 300_000)
			await assertPgOk(page, grantResult, "passkey-canary:grantResult")
			const grantTxHash = txHashOf(grantResult.resultJson)
			step(`grant submitted (${grantTxHash.slice(0, 12)}…); waiting for the node to mine it`)
			await waitForTxMined(aztecConfig!, grantTxHash, 300_000)
			step("A's ctor-deploy tx MINED — real proof accepted for a passkey-derived account")

			// ── Stage 3: authwit-CONSUMING tx as the named caller B (B's FIRST tx) ──
			await page.evaluate((caller: string) => {
				const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-select-account"]')
				if (!select) throw new Error("pg-select-account not present")
				select.value = caller
				select.dispatchEvent(new Event("change", { bubbles: true }))
			}, callerB)
			step("consuming the authwit as B (B's FIRST tx — its own ctor + transfer_from)")
			const seqConsume = await snapshotResultSeq(page)
			const consumePopupP = waitForPopup(ctx, "execute", { timeout: 30_000 })
			await clickByTestId(page, "pg-btn-consumeAuthwit")
			const consumePopup = await consumePopupP
			await waitForExecuteContent(consumePopup)
			await approveExecute(consumePopup, { approvableTimeoutMs: 120_000 })
			const consumeResult = await waitForPgResult(page, "sendTx", seqConsume, 300_000)
			await assertPgOk(page, consumeResult, "passkey-canary:consumeResult")
			await waitForTxMined(aztecConfig!, txHashOf(consumeResult.resultJson), 300_000)
			step("authwit consumed; B's ctor-deploy tx MINED")

			// ── Stage 4: SW restart → ceremony re-unlock in the SAME FTN → still operates ──
			// Liveness snapshot must run in an extension page; the anchor popup is one.
			const preKillLiveness = await anchorPopup.evaluate(async () => {
				try {
					const r = await chrome.storage.session.get("nulo:liveness")
					return Number(r["nulo:liveness"] ?? 0)
				} catch {
					return 0
				}
			})
			expect(preKillLiveness).toBeGreaterThan(0)
			step("terminating the service worker")
			await stopServiceWorker(ctx)

			await anchorPopup.waitForFunction(
				async (priorTs: number) => {
					try {
						const result = await chrome.storage.session.get("nulo:liveness")
						return Number(result["nulo:liveness"] ?? 0) > priorTs
					} catch {
						return false
					}
				},
				{ timeout: 30_000, polling: 500 },
				preKillLiveness,
			)
			step("SW rebooted; driving the passkey re-unlock in the SAME FrameTreeNode")
			// Passkey sessions are never silently restored — the SW-side session is gone. But the
			// anchor popup's IN-MEMORY store is stale (isLogined still true), so a bare
			// `location.hash = "#/popup/auth"` gets bounced by the router before auth mounts
			// (observed on the first live run). Drive the app's own lock path instead — it flips
			// the local store first, exactly like passkey-paths' lock+unlock leg; the popup stays
			// open (same FTN = same virtual authenticator = same credential).
			await clickByTestId(anchorPopup, "header-lock")
			await waitForHash(anchorPopup, "#/popup/auth", 15_000)
			await anchorPopup.waitForSelector('[data-testid="auth-submit"]', { visible: true, timeout: 15_000 })
			await anchorPopup.waitForFunction(
				() => {
					const btn = document.querySelector<HTMLButtonElement>('[data-testid="auth-submit"]')
					return btn !== null && !btn.disabled
				},
				{ timeout: 15_000 },
			)
			await clickByTestId(anchorPopup, "auth-submit")
			await waitForHash(anchorPopup, "#/popup/general", 60_000)
			step("post-restart ceremony unlock ok")

			// Reconnect the dApp and land a post-restart tx as A. The background rebuilds the
			// account from the re-derived passkey master on this path and hard-throws on address
			// drift, so an ok result pins BOTH re-derivation and execution.
			await page.reload({ waitUntil: "domcontentloaded" })
			await page.waitForSelector('[data-testid="pg-btn-connect"]', { visible: true, timeout: 30_000 })
			const verifyP = waitForPopup(ctx, "verify", { timeout: 30_000 })
			await clickByTestId(page, "pg-btn-connect")
			const { approveVerify } = await import("../fixtures/popups")
			await approveVerify(await verifyP)
			await page.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 30_000 })
			await page.evaluate(() => {
				const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')
				if (!select) throw new Error("pg-bundle-select not present")
				select.value = "transaction"
				select.dispatchEvent(new Event("change", { bubbles: true }))
			})
			const seqCaps = await snapshotResultSeq(page)
			await clickByTestId(page, "pg-btn-requestCapabilities")
			const capsResult = await waitForPgResult(page, "requestCapabilities", seqCaps, 60_000)
			await assertPgOk(page, capsResult, "passkey-canary:capsResult")
			await page.waitForFunction(() => document.querySelectorAll('[data-testid="pg-select-account"] option').length >= 2, {
				timeout: 30_000,
				polling: 200,
			})
			const selected = await page.evaluate((owner: string) => {
				const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-select-account"]')
				if (!select) throw new Error("pg-select-account not present")
				select.value = owner
				select.dispatchEvent(new Event("change", { bubbles: true }))
				return select.value
			}, ownerA)
			expect(selected).toBe(ownerA)
			await setPgInputs(page, {
				tokenAddress: aztecConfig!.tokenAddress,
				recipient: aztecConfig!.minterAddress,
				amount: "1",
			})
			step("post-restart sendTx as A (re-derived passkey account, non-init path)")
			const seqFinal = await snapshotResultSeq(page)
			const finalPopupP = waitForPopup(ctx, "execute", { timeout: 180_000 })
			await clickByTestId(page, "pg-btn-sendTx-default")
			const errorSentinel = new Promise<never>((_, reject) => {
				waitForPgResult(page, "sendTx", seqFinal, 175_000).then(
					(r) => {
						if (r.status === "error") {
							reject(new Error(`post-restart sendTx errored dApp-side: ${formatPgMismatch(r)}`))
						}
					},
					() => {},
				)
			})
			const finalPopup = await Promise.race([finalPopupP, errorSentinel])
			await waitForExecuteContent(finalPopup)
			await approveExecute(finalPopup, { approvableTimeoutMs: 120_000 })
			const finalResult = await waitForPgResult(page, "sendTx", seqFinal, 300_000)
			await assertPgOk(page, finalResult, "passkey-canary:finalResult")
			await waitForTxMined(aztecConfig!, txHashOf(finalResult.resultJson), 300_000)
			step("post-restart tx mined — passkey-derived account fully operational after ceremony re-unlock")
		} finally {
			await auth.cleanup()
			await anchorPopup.close().catch(() => {})
		}
	},
)
