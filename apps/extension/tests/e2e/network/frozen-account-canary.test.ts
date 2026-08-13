/**
 * Frozen-account execution canary — the per-`@aztec/*`-bump gate for the address freeze.
 *
 * A green address KAT says NOTHING about executability: frozen 5.0.1 account bytecode driven by a
 * newer simulator/prover/entrypoint encoding is a combination upstream never tests. This file
 * asserts the full frozen-ctor arc, stage by stage, against a live node:
 *
 *   1. The FROZEN derivation (vendored artifact + descriptor) reproduces the live wallet's
 *      account addresses, re-derived test-side from the revealed profile master.
 *   2. The accounts' initialization nullifiers are ABSENT on the node (nothing deployed yet).
 *   3. The first tx executes the frozen constructor via the multicall deploy path — simulate,
 *      REAL proof, node acceptance — proven by the init nullifier flipping to PRESENT.
 *   4. A subsequent authwit-CONSUMING tx (grant as A → consume as the named caller B) succeeds.
 *   5. A service-worker restart later, the re-derived account still signs, proves, and lands a tx
 *      (the background's re-derivation path throws "account address inconsistency" on drift, so
 *      an ok result pins re-derivation AND execution).
 *
 * Every stage asserts an exact outcome — no ok-or-error tolerances in this file. Run it
 * prover-ON per bump: `bun run e2e:agent tests/e2e/network/frozen-account-canary.test.ts`
 * (see the aztec-update skill; a red canary BLOCKS the bump — hold the line, or ship a new
 * extension major as a deliberate rotation).
 */
import { Buffer } from "node:buffer"
import { expect, inject } from "vitest"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { mintPublicTokensForAccount, waitForTxMined, type AztecTestConfig } from "../fixtures/aztec"
import { clickByTestId, openPopup, test, waitForHash, type ExtensionContext } from "../fixtures/extension"
import { ensureUnlocked, getAccountAddress, revealSecretKey } from "../fixtures/helpers"
import { assertPgOk, formatPgMismatch, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, approveVerify, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import { TEST_PASSWORD } from "../fixtures/constants"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

test("agent-runner contract: a live sandbox must be configured (no false skip)", () => {
	if (process.env.E2E_REQUIRE_SETUP === "1") {
		expect(hasConfig).toBe(true)
	}
})

/** Mirrors backup-restore-sw-restart.test.ts: an ABSENT SW target means Chrome's MV3 reaper
 *  already delivered the restart this stage exists to exercise, so it proceeds to recovery. */
async function stopServiceWorker(ctx: ExtensionContext): Promise<void> {
	const swTarget = await ctx.browser
		.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(ctx.extensionId), { timeout: 5_000 })
		.catch(() => null)
	if (!swTarget) {
		console.warn("[frozen-canary] no live SW target — Chrome already killed it; proceeding to recovery")
		return
	}
	const swSession = await swTarget.createCDPSession()
	try {
		await swSession.send("Runtime.terminateExecution")
	} catch {
		// Session dies along with the SW; swallow disconnect noise.
	}
}

/** `grantPublicAuthwit` resolves to a bare tx-hash string; `sendTx` (NO_WAIT) resolves to
 *  `TxSendResultImmediate` = `{ txHash, ... }`. Accept exactly those two shapes — anything else
 *  is a hard error, not a tolerance. */
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

/** Sets a playground input through the prototype value setter (Vue-reactive). */
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
	"frozen-account canary — derive, ctor-deploy with real proof, authwit consume, SW-restart re-derive",
	// retry: 0 — this is a bump gate; a retry-masked single-shot failure would defeat its purpose.
	{ timeout: 900_000, retry: 0 },
	async ({ dappConnectedExtensionWithFirstTwoAccountsCap }) => {
		const ctx = dappConnectedExtensionWithFirstTwoAccountsCap
		const { playgroundPage: page, accountAddresses } = ctx
		const step = (m: string) => console.log(`[frozen-canary] ${m}`)
		expect(accountAddresses.length).toBe(2)

		// ── Stage 1: frozen derivation reproduces the live wallet's addresses ──
		step("revealing profile master")
		const popup = await openPopup(ctx)
		await waitForHash(popup, "#/popup/general", 30_000)
		await revealSecretKey(popup, TEST_PASSWORD, "plain")
		const masterBase64 = await popup.evaluate(() => {
			const scope = document.querySelector('[data-testid="reveal-content"]')
			const input = scope?.querySelector("input") as HTMLInputElement | null
			if (!input) throw new Error("reveal-content input not present")
			return input.value
		})
		await popup.close()
		expect(masterBase64.length).toBeGreaterThan(0)

		step("deriving accounts test-side through the frozen path")
		const { Fr } = await import("@aztec/aztec.js/fields")
		const { poseidon2Hash } = await import("@aztec/foundation/crypto/sync")
		const { NuloAccount } = await import("@nulo/aztec-runtime/account")
		const { computeSiloedPrivateInitializationNullifier } = await import("@aztec/stdlib/hash")
		const { createLogger } = await import("@aztec/foundation/log")
		const logger = createLogger("frozen-account-canary")
		const master = Fr.fromBuffer(Buffer.from(masterBase64, "base64"))
		// Same formula as the wallet's account service: poseidon2Hash([master, chainId, type, index])
		// with Local Network chainId=0 and AccountType.Nulo_v1=0.
		const derived = await Promise.all(
			[0, 1].map(async (index) => {
				const seed = poseidon2Hash([master, new Fr(0), new Fr(0), new Fr(index)])
				const account = await NuloAccount.new(seed, logger)
				const instance = (account as unknown as { instance: { initializationHash: InstanceType<typeof Fr> } }).instance
				const initNullifier = await computeSiloedPrivateInitializationNullifier(account.address, instance.initializationHash)
				return { index, address: account.address.toString(), initNullifier }
			}),
		)
		// Order-independent set match, then map granted → derived so later stages use exact pairs.
		expect(new Set(derived.map((d) => d.address))).toEqual(new Set(accountAddresses))
		const byAddress = new Map(derived.map((d) => [d.address, d]))
		const [ownerA, callerB] = accountAddresses as [string, string]
		const derivedA = byAddress.get(ownerA)
		const derivedB = byAddress.get(callerB)
		if (!derivedA || !derivedB) throw new Error("granted addresses did not map to derived accounts")
		step(`frozen derivation matches wallet: A=${ownerA.slice(0, 12)}… B=${callerB.slice(0, 12)}…`)

		// ── Stage 2: initialization nullifiers ABSENT (accounts not deployed) ──
		const node = createAztecNodeClient(aztecConfig!.nodeUrl)
		expect(await node.getNullifierMembershipWitness("latest", derivedA.initNullifier)).toBeUndefined()
		expect(await node.getNullifierMembershipWitness("latest", derivedB.initNullifier)).toBeUndefined()
		step("init nullifiers ABSENT for both accounts")

		// ── Stage 3: first tx executes the FROZEN ctor (multicall deploy) with a real proof ──
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
		await assertPgOk(page, grantResult, "frozen-account-canary:grantResult")
		const grantTxHash = txHashOf(grantResult.resultJson)
		step(`grant submitted (${grantTxHash.slice(0, 12)}…); waiting for the node to mine it`)
		await waitForTxMined(aztecConfig!, grantTxHash, 300_000)

		// Node ACCEPTED the frozen constructor: A's init nullifier flipped to PRESENT.
		expect(await node.getNullifierMembershipWitness("latest", derivedA.initNullifier)).toBeDefined()
		step("A's init nullifier PRESENT — frozen ctor executed and accepted")

		// ── Stage 4: authwit-CONSUMING tx as the named caller B ──
		await page.evaluate((caller: string) => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-select-account"]')
			if (!select) throw new Error("pg-select-account not present")
			select.value = caller
			select.dispatchEvent(new Event("change", { bubbles: true }))
		}, callerB)
		step("consuming the authwit as B (B's FIRST tx — its own frozen ctor + transfer_from)")
		const seqConsume = await snapshotResultSeq(page)
		const consumePopupP = waitForPopup(ctx, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-consumeAuthwit")
		const consumePopup = await consumePopupP
		await waitForExecuteContent(consumePopup)
		await approveExecute(consumePopup, { approvableTimeoutMs: 120_000 })
		const consumeResult = await waitForPgResult(page, "sendTx", seqConsume, 300_000)
		await assertPgOk(page, consumeResult, "frozen-account-canary:consumeResult")
		const consumeTxHash = txHashOf(consumeResult.resultJson)
		await waitForTxMined(aztecConfig!, consumeTxHash, 300_000)
		expect(await node.getNullifierMembershipWitness("latest", derivedB.initNullifier)).toBeDefined()
		step("authwit consumed; B's init nullifier PRESENT")

		// ── Stage 5: SW restart → recovery re-derives and still operates ──
		step("terminating the service worker")
		// Snapshot liveness BEFORE the kill: session storage retains the pre-kill
		// heartbeat, so a truthy check passes instantly against a stale value and
		// the next UI wait races the worker. Strictly-newer at least proves the
		// worker is live and writing now — it does NOT prove a respawn, since the
		// terminate leaves this worker running and its heartbeat supplies a fresh
		// timestamp on its own (deflake-round-3 `lessons/phase-3.md`). The stage's
		// real assertion — that the frozen account still re-derives and operates —
		// is unaffected. The snapshot MUST run in an extension page: chrome.storage
		// is undefined on the playground page, where the catch's 0 would let the
		// stale heartbeat satisfy the gate.
		const snapshotPopup = await openPopup(ctx)
		const preKillLiveness = await snapshotPopup.evaluate(async () => {
			try {
				const r = await chrome.storage.session.get("nulo:liveness")
				return Number(r["nulo:liveness"] ?? 0)
			} catch {
				return 0
			}
		})
		await snapshotPopup.close()
		// The SW has heartbeat through four stages by now — a zero snapshot means
		// the read itself broke (wrong page type), which would silently degrade
		// the strictly-newer gate back to truthy.
		expect(preKillLiveness).toBeGreaterThan(0)
		await stopServiceWorker(ctx)

		const recoveryPopup = await openPopup(ctx)
		await recoveryPopup.waitForFunction(
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
		await recoveryPopup.waitForFunction(() => window.location.hash.length > 2, { timeout: 60_000 })
		await ensureUnlocked(recoveryPopup, TEST_PASSWORD)
		await recoveryPopup.waitForFunction(() => window.location.hash.includes("/popup/general"), { timeout: 120_000 })
		// WHICH of the profile's accounts the popup presents after a restart is UI behavior, not a
		// freeze invariant — the address just has to be one of the frozen-derived pair (the real
		// re-derivation proof is the post-restart tx as A below).
		expect([ownerA, callerB]).toContain(await getAccountAddress(recoveryPopup))
		await recoveryPopup.close()
		step("post-restart unlock ok; presented account is one of the frozen-derived pair")

		// Reconnect the dApp (verify popup re-fires — the fixture connects with alwaysTrust=false)
		// and land a post-restart tx as A. The background rebuilds the account contract from the
		// seed on this path and hard-throws on address drift, so an ok result pins BOTH
		// re-derivation and execution of the re-derived frozen account.
		await page.reload({ waitUntil: "domcontentloaded" })
		await page.waitForSelector('[data-testid="pg-btn-connect"]', { visible: true, timeout: 30_000 })
		const verifyP = waitForPopup(ctx, "verify", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-connect")
		await approveVerify(await verifyP)
		await page.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 30_000 })
		// Connect alone yields accounts=[] by design (playground populates from
		// requestCapabilities, not getAccounts). Re-request the already-granted bundle: the
		// dispatcher early-returns on the empty delta — NO popup — and the granted accounts
		// repopulate the select.
		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')
			if (!select) throw new Error("pg-bundle-select not present")
			select.value = "transaction"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
		const seqCaps = await snapshotResultSeq(page)
		await clickByTestId(page, "pg-btn-requestCapabilities")
		const capsResult = await waitForPgResult(page, "requestCapabilities", seqCaps, 60_000)
		await assertPgOk(page, capsResult, "frozen-account-canary:capsResult")
		// The reconnected session must expose both granted accounts before the acting-account
		// switch — an empty select would silently no-op the value assignment.
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
		step("post-restart sendTx as A (re-derived account, non-init path)")
		const seqFinal = await snapshotResultSeq(page)
		// 180s: the first post-restart RPC that touches the chain runtime pays the full offscreen
		// re-boot (bb init + encrypted-store unlock) BEFORE the execute popup can open.
		const finalPopupP = waitForPopup(ctx, "execute", { timeout: 180_000 })
		await clickByTestId(page, "pg-btn-sendTx-default")
		// If the dApp-side handler fails before the wallet opens the popup, surface ITS error
		// instead of an opaque popup timeout. Errors only — an ok result still requires the popup
		// path below (this is a diagnostic sharpener, not a tolerance).
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
		await assertPgOk(page, finalResult, "frozen-account-canary:finalResult")
		const finalTxHash = txHashOf(finalResult.resultJson)
		await waitForTxMined(aztecConfig!, finalTxHash, 300_000)
		step("post-restart tx mined — re-derived frozen account fully operational")
	},
)
