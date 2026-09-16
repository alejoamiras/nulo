/**
 * Stale-anchor recovery canary — the extension-level gate for the offscreen's resync-and-retry.
 *
 * A production PXE anchors on the node's tip before every op and queries the node by that
 * anchor's block hash. An L1 reorg that prunes the tip between the two makes the node reject the
 * hash ("… possibly a reorg has occurred"); the offscreen helper resyncs and retries once, logging
 * `stale anchor on first attempt — resynced, retrying once`. This spec drives that through the
 * real stack — playground dApp → wallet-sdk → service worker → offscreen PXE → node — and asserts:
 *
 *   1. HARD: every view issued across the reorg succeeds. The wallet survives an L1 reorg, whether
 *      the retry fired or the pre-op sync saw the prune first.
 *   2. SOFT: the retry line is in the service worker's log trail. Landing the prune inside the
 *      sync→query window is a race the test cannot pin from outside (it is exactly the window the
 *      helper exists for), so the spec drives a burst of views per reorg and tries a few reorgs.
 *      Reproduced → the line is asserted verbatim. Not reproduced after the budget → the test
 *      SKIPS with the reason; the delivery report carries the recovery as unmet at this layer
 *      (the real-PXE integration test in aztec-runtime pins it with a frozen anchor).
 *
 * Run it first, alone and armed:
 * `NULO_E2E_REORG=1 bun run e2e:agent tests/e2e/network/stale-anchor-recovery.test.ts`. Unarmed it
 * skips: the reorg leaves the local network unable to mine again, so inside a pooled run every later
 * spec that lands a transaction would time out on the shared sandbox. The reorg drops the tip L2
 * block, so a disposable mint lands first: the pruned block then carries nothing the view depends on
 * (pruning the token's own deployment block turns the view into a legitimate "Not initialized"
 * failure, which is not what this spec is about).
 */
import { expect, inject } from "vitest"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { type AztecTestConfig, mintPublicTokensForAccount } from "../fixtures/aztec"
import { clickByTestId, openPopup, test, waitForHash } from "../fixtures/extension"
import { setDebugMode, setDeveloperMode } from "../fixtures/helpers"
import { readSwLogTrail } from "../fixtures/journal"
import {
	assertPgOk,
	callExpectingNoPopup,
	type PgResult,
	setPgInput,
	setPgTextarea,
	snapshotResultSeq,
	waitForPgResults,
} from "../fixtures/playground"
import { serializeInstance } from "../fixtures/selfpay-phase"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined
const reorgArmed = process.env.NULO_E2E_REORG === "1"
const ANVIL_URL = process.env.ANVIL_URL ?? "http://localhost:8545"

const RETRY_LINE = "executeUtility: stale anchor on first attempt — resynced, retrying once"
const TRAIL_MATCH = "stale anchor on"
// One reorg per run: after a prune the local network does not reliably mine again (a second
// disposable mint timed out awaiting its block), so a second attempt cannot land its own block.
const MAX_REORGS = 1
const VIEWS_PER_REORG = 8
const VIEW_BUTTON = "pg-btn-phase-balance"
const VIEW_METHOD = "phase.balance"

test("agent-runner contract: a live sandbox must be configured (no false skip)", () => {
	if (process.env.E2E_REQUIRE_SETUP === "1") {
		expect(hasConfig).toBe(true)
	}
})

async function l1Rpc<T>(method: string, params: unknown[]): Promise<T> {
	const res = await fetch(ANVIL_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	})
	const body = (await res.json()) as { result?: T; error?: { message: string } }
	if (body.error) throw new Error(`${method}: ${body.error.message}`)
	return body.result as T
}

type Node = ReturnType<typeof createAztecNodeClient>

async function tipHash(node: Node, tip: number): Promise<string | undefined> {
	const data = await node.getBlockData(tip)
	return data ? (await data.header.hash()).toString() : undefined
}

/** Reorg L1 past the block that published the node's current tip; the node prunes on its next
 *  L1 poll. Returns the tip it will prune so the caller can wait for that to land. */
async function reorgPastTip(node: Node, rollupAddress: string): Promise<{ tip: number; hash: string }> {
	const tip = await node.getBlockNumber()
	const hash = await tipHash(node, tip)
	if (tip < 1 || !hash) throw new Error(`the local network has no L2 block left to prune (tip ${tip})`)
	const logs = await l1Rpc<Array<{ blockNumber: string }>>("eth_getLogs", [
		{ address: rollupAddress, fromBlock: "0x0", toBlock: "latest" },
	])
	const publishedAt = Math.max(...logs.map((l) => Number.parseInt(l.blockNumber, 16)))
	const latest = Number.parseInt(await l1Rpc<string>("eth_blockNumber", []), 16)
	await l1Rpc("anvil_reorg", [latest - publishedAt + 1, []])
	return { tip, hash }
}

async function waitForPrune(node: Node, tip: number, hash: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if ((await tipHash(node, tip)) !== hash) return
		await new Promise((r) => setTimeout(r, 1_000))
	}
	throw new Error(`the node never pruned L2 block ${tip} after the L1 reorg (${timeoutMs}ms)`)
}

/** The service worker's most recent retained lines, for a failure that the dApp only sees as the
 *  wallet's constant "could not process" envelope. */
async function swTrailTail(popup: import("puppeteer").Page, limit = 200): Promise<string> {
	// The store flushes on a 2s debounce; the lines that explain the failure are the newest.
	await new Promise((r) => setTimeout(r, 3_000))
	// Debug mode makes a burst of views log hundreds of oracle lines, so the filter runs on the
	// service-worker side, before the tail is taken.
	const match = "failed|stale anchor|reorg|not found|not-yet-synchronized"
	const read = await readSwLogTrail(popup, { limit, match }).catch((e: unknown) => `<trail read failed: ${String(e)}>`)
	if (!Array.isArray(read)) return String(read)
	return read
		.map((e) => {
			const { source, level, data } = e as { source?: string; level?: number; data?: unknown }
			return `[${source}] L${level}: ${JSON.stringify(data ?? []).slice(0, 700)}`
		})
		.join("\n")
}

async function assertOkOrDumpTrail(page: import("puppeteer").Page, popup: import("puppeteer").Page, result: PgResult, label: string) {
	await assertPgOk(page, result, label).catch(async (err: unknown) => {
		console.error(`[stale-anchor-canary] ${label} failed; service worker trail (warn+ and matches):\n${await swTrailTail(popup)}`)
		throw err
	})
}

/** The retry lines the service worker retained since `since`. The store flushes on a 2s debounce,
 *  so this polls a little past that before concluding there are none. */
async function retryLinesSince(popup: import("puppeteer").Page, since: number): Promise<string[]> {
	for (let i = 0; i < 12; i++) {
		const read = await readSwLogTrail(popup, { match: TRAIL_MATCH, limit: 20 })
		const hits = (Array.isArray(read) ? read : [])
			.filter((e) => Number((e as { timestamp?: number }).timestamp) >= since)
			.map((e) => JSON.stringify((e as { data?: unknown }).data ?? []))
		if (hits.length > 0) return hits
		await new Promise((r) => setTimeout(r, 1_000))
	}
	return []
}

test.skipIf(!hasConfig || !reorgArmed)(
	"stale-anchor recovery canary — views survive an L1 reorg; the offscreen retry line is asserted when the race lands",
	// retry: 0 — a retry-masked failure of the hard assertion would defeat the gate.
	{ timeout: 900_000, retry: 0 },
	async ({ dappConnectedExtensionWithAccountsCap, skip }) => {
		const ctx = dappConnectedExtensionWithAccountsCap
		const { playgroundPage: page } = ctx
		const step = (m: string) => console.log(`[stale-anchor-canary] ${m}`)
		const node = createAztecNodeClient(aztecConfig!.nodeUrl)
		const rollupAddress = (await node.getL1ContractAddresses()).rollupAddress.toString()

		// Developer Mode is what persists the service worker's log ring to session storage — the only
		// place the offscreen's retry line is readable from the test side.
		const popup = await openPopup(ctx)
		await waitForHash(popup, "#/popup/general", 30_000)
		await setDeveloperMode(popup, true)
		await setDebugMode(popup, true)

		// The view is the phase section's `balance_of_private` utility: it registers the token with
		// the dApp's own artifact first, and a utility run syncs the contract against the anchor
		// (class lookup, note discovery) before it reads. The simulation section's
		// "executeUtility (balance_of_public)" is a PUBLIC function handed to executeUtility, which
		// the wallet rejects on every chain.
		const instance = await node.getContract(AztecAddress.fromStringUnsafe(aztecConfig!.tokenAddress))
		if (!instance) throw new Error("the e2e token instance is not at the node")
		await setPgTextarea(page, "phase-tokenInstance", serializeInstance(instance))
		const registered = await callExpectingNoPopup(
			ctx,
			page,
			"phase.register",
			() => clickByTestId(page, "pg-btn-phase-register"),
			60_000,
		)
		await assertPgOk(page, registered, "stale-anchor-canary:registerContract")
		await setPgInput(page, "phase-from", ctx.accountAddress)
		// The first view boots the offscreen PXE and anchors it; on an intact chain it must succeed.
		step("warming the offscreen PXE with one view")
		const warm = await callExpectingNoPopup(ctx, page, VIEW_METHOD, () => clickByTestId(page, VIEW_BUTTON), 180_000)
		await assertOkOrDumpTrail(page, popup, warm, "stale-anchor-canary:warm")

		const attempts: string[] = []
		let reproduced: string[] = []
		for (let attempt = 1; attempt <= MAX_REORGS && reproduced.length === 0; attempt++) {
			step(`attempt ${attempt}: landing a disposable mint so the block to prune is its own`)
			await mintPublicTokensForAccount(aztecConfig!, ctx.accountAddress)
			const since = Date.now()
			const { tip, hash } = await reorgPastTip(node, rollupAddress)
			step(`attempt ${attempt}: reorged L1 past the publish of L2 block ${tip}; driving ${VIEWS_PER_REORG} views`)
			// The views are issued together and the offscreen serializes them, so while the node's
			// prune lands there is nearly always a view between its sync and its anchor-bound query.
			const fromSeq = await snapshotResultSeq(page)
			for (let i = 0; i < VIEWS_PER_REORG; i++) await clickByTestId(page, VIEW_BUTTON)
			const results = await waitForPgResults(page, VIEW_METHOD, fromSeq, VIEWS_PER_REORG, 300_000)
			expect(results).toHaveLength(VIEWS_PER_REORG)
			for (const r of results) await assertOkOrDumpTrail(page, popup, r, `stale-anchor-canary:attempt-${attempt}`)
			await waitForPrune(node, tip, hash, 120_000)
			reproduced = await retryLinesSince(popup, since)
			attempts.push(
				`attempt ${attempt}: L2 block ${tip} pruned, ${VIEWS_PER_REORG}/${VIEWS_PER_REORG} views ok, ${reproduced.length} retry line(s)`,
			)
			step(attempts[attempts.length - 1] as string)
		}
		await popup.close()

		if (reproduced.length === 0) {
			skip(
				`stale-anchor recovery NOT reproduced through the extension: every view across ${attempts.length} reorg(s) succeeded, but the node's prune never landed inside a view's sync→query window (${attempts.join("; ")}). The real-PXE integration test (aztec-runtime stale-anchor.real.test.ts) remains the recovery evidence; report this canary as unmet.`,
			)
		}
		expect(reproduced.join("\n")).toContain(RETRY_LINE)
		step("reproduced: the offscreen resynced and retried once, and every view still succeeded")
	},
)
