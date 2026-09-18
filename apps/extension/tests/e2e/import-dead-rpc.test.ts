/**
 * Import with a DEAD/degraded RPC must reach an actionable screen fast — the
 * product fix for e2e-deflake ledger entry 1 (the smoke backup-roundtrip
 * flake's root). The import's account-state leg is the ONE step that dials
 * the network (PXE boot against the reseeded local endpoint); it is now
 * preflight-gated and deadline-bounded, and skipped registrations surface on
 * the existing finished-with-errors screen whose Continue proceeds into the
 * wallet.
 *
 * Three endpoint shapes, each proving a different bound:
 *  - REFUSED   (connection refused at the browser) → preflight classifies in ~ms/attempt.
 *  - BLACKHOLE (accepts, never responds)   → preflight's per-attempt abort + backoff.
 *  - STATEFUL  (answers the probe, then blackholes the PXE boot call) → the
 *    30s registration deadline — the only variant that reaches registration,
 *    proven by the stub's observed method sequence.
 *
 * Waits here are NEW-test budgets sized from the product's own deadline
 * arithmetic (45s shared tail: preflight ≤21s hanging/≈6s refused,
 * registration ≤30s) + slow-runner storage-restore margin — causal bounds,
 * not blind timeouts. Tests run with retry: 0 so a bound that only passes on
 * a vitest retry cannot hide.
 *
 * The backup carries no network rows (the import reseeds the built-in networks), so the endpoint
 * under test is the compiled-in LOCAL seed. Its origin is rerouted per test through CDP `Fetch`
 * interception to a stub on an ephemeral, run-owned port — the seed's port is never bound.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo, Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Page } from "puppeteer"
import { LOCAL_L1_CHAIN_ID } from "@/utils/chain-ids"
import { clickByTestId, type ExtensionContext, launchExtension, test, waitForHash } from "./fixtures/extension"
import { interceptRpc, type RpcInterception } from "./helpers/rpc-intercept"
import {
	buildSyntheticBackup,
	deriveNuloAccountAddress,
	gotoPopupImport,
	makeRecoveryTriple,
	setInputs,
	submitWhenEnabled,
	TEST_PASSWORD,
	writeBackupToTemp,
} from "./helpers/import-drivers"

/** The LOCAL seed's compiled-in endpoint (`LOCAL_NETWORK_RPC_URL`'s default and env override). */
const LOCAL_RPC = process.env.VITE_LOCAL_NETWORK_RPC_URL ?? "http://localhost:8080"

const ZERO_ETH = `0x${"00".repeat(20)}`
const ZERO_AZTEC = `0x${"00".repeat(32)}`

/** Schema-valid `getNodeInfo` result for the stateful stub (NodeInfoSchema:
 *  @aztec/stdlib contract/interfaces/node-info). It answers as the LOCAL seed: the exact
 *  `l1ChainId` is what the identity check pins for chain 0 (the composite is skipped there). */
function nodeInfoResult(): Record<string, unknown> {
	return {
		nodeVersion: "0.0.0-stub",
		l1ChainId: LOCAL_L1_CHAIN_ID,
		rollupVersion: LOCAL_L1_CHAIN_ID,
		l1ContractAddresses: Object.fromEntries(
			[
				"rollupAddress",
				"registryAddress",
				"inboxAddress",
				"outboxAddress",
				"feeJuiceAddress",
				"feeJuicePortalAddress",
				"coinIssuerAddress",
				"rewardDistributorAddress",
				"governanceProposerAddress",
				"governanceAddress",
				"stakingAssetAddress",
			].map((k) => [k, ZERO_ETH]),
		),
		protocolContractAddresses: {
			classRegistry: ZERO_AZTEC,
			feeJuice: ZERO_AZTEC,
			instanceRegistry: ZERO_AZTEC,
			multiCallEntrypoint: ZERO_AZTEC,
		},
		realProofs: false,
		txsLimits: { gas: { daGas: 0, l2Gas: 0 } },
	}
}

interface StubServer {
	url: string
	methods: string[]
	close: () => Promise<void>
}

type BatchPlan = { kind: "unparsed" } | { kind: "blackhole" } | { kind: "replies"; payload: unknown }

/** Plans the stub's answer to one request body. The aztec JSON-RPC client BATCHES: bodies
 *  arrive as arrays of request envelopes (the Phase-1 evidence harness learned this the hard
 *  way). Every element is logged into `methods` and asked of `answer`, in order, even after one
 *  proves unanswerable — a batch with ANY unanswerable element blackholes whole (no partial
 *  responses); a bare request answers as a bare object. An `answer` throw escapes. */
function planBatchReplies(body: string, answer: (method: string) => unknown | undefined, methods: string[]): BatchPlan {
	let entries: Array<{ method?: string; id?: unknown }>
	let wasBatch = false
	try {
		const parsed = JSON.parse(body) as { method?: string } | Array<{ method?: string }>
		wasBatch = Array.isArray(parsed)
		entries = Array.isArray(parsed) ? parsed : [parsed]
	} catch {
		methods.push(`<unparsed:${body.slice(0, 60)}>`)
		return { kind: "unparsed" }
	}
	const replies: unknown[] = []
	let blackhole = false
	for (const entry of entries) {
		const method = entry?.method ?? "<no-method>"
		methods.push(method)
		const result = answer(method)
		if (result === undefined) blackhole = true
		else replies.push({ jsonrpc: "2.0", id: entry?.id ?? null, result })
	}
	if (blackhole) return { kind: "blackhole" }
	return { kind: "replies", payload: wasBatch ? replies : replies[0] }
}

describe("planBatchReplies (no browser)", () => {
	const answer = (method: string) => (method === "ok" ? { fine: true } : undefined)

	it("logs an unparseable body as a note truncated to 60 chars and answers nothing", () => {
		const methods: string[] = []
		const body = `{not json ${"x".repeat(80)}`
		expect(planBatchReplies(body, answer, methods)).toEqual({ kind: "unparsed" })
		expect(methods).toEqual([`<unparsed:${body.slice(0, 60)}>`])
		expect(methods[0]?.length).toBe("<unparsed:".length + 60 + 1)
	})

	it("answers a bare request as a bare object and a batch as an array, keeping falsy ids", () => {
		const methods: string[] = []
		expect(planBatchReplies(JSON.stringify({ method: "ok", id: 0 }), answer, methods)).toEqual({
			kind: "replies",
			payload: { jsonrpc: "2.0", id: 0, result: { fine: true } },
		})
		expect(
			planBatchReplies(JSON.stringify([{ method: "ok", id: "" }, { method: "ok", id: false }, { method: "ok" }]), answer, methods),
		).toEqual({
			kind: "replies",
			payload: [
				{ jsonrpc: "2.0", id: "", result: { fine: true } },
				{ jsonrpc: "2.0", id: false, result: { fine: true } },
				{ jsonrpc: "2.0", id: null, result: { fine: true } },
			],
		})
		expect(planBatchReplies("[]", answer, methods)).toEqual({ kind: "replies", payload: [] })
		expect(methods).toEqual(["ok", "ok", "ok", "ok"])
	})

	it("blackholes a whole batch on one unanswerable element, still logging and asking every element", () => {
		const methods: string[] = []
		const asked: string[] = []
		const spy = (method: string) => {
			asked.push(method)
			return answer(method)
		}
		expect(planBatchReplies(JSON.stringify([{ method: "ok" }, { method: "nope" }, {}]), spy, methods)).toEqual({ kind: "blackhole" })
		expect(methods).toEqual(["ok", "nope", "<no-method>"])
		expect(asked).toEqual(methods)
	})
})

/** Local stub bound to an OS-assigned port (parallel-agent safe). Logs every
 *  JSON-RPC method it receives; `answer` decides which methods get a real
 *  response — everything else blackholes (accepted, never answered). */
function startStub(answer: (method: string) => unknown | undefined): Promise<StubServer> {
	return new Promise((resolve) => {
		const methods: string[] = []
		const sockets = new Set<Socket>()
		const server: Server = createServer((req, res) => {
			let body = ""
			req.on("data", (c) => {
				body += String(c)
			})
			req.on("end", () => {
				const plan = planBatchReplies(body, answer, methods)
				if (plan.kind !== "replies") return
				res.setHeader("content-type", "application/json")
				res.end(JSON.stringify(plan.payload))
			})
		})
		server.on("connection", (s) => {
			sockets.add(s)
			s.on("close", () => sockets.delete(s))
		})
		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as AddressInfo).port
			resolve({
				url: `http://127.0.0.1:${port}`,
				methods,
				close: () =>
					new Promise<void>((r) => {
						for (const s of sockets) s.destroy()
						server.close(() => r())
					}),
			})
		})
	})
}

/** Synthetic backup with a senders-only account-state item on the LOCAL chain — the minimum
 *  registrable work that forces the chain-registration leg to dial the (rerouted) seed. */
async function deadRpcBackup(withAccountState = true): Promise<string> {
	const { masterBase64: master, entropyBase64 } = await makeRecoveryTriple()
	const address = await deriveNuloAccountAddress(master, LOCAL_L1_CHAIN_ID)
	return buildSyntheticBackup({
		masterBase64: master,
		entropyBase64,
		accountAddress: address,
		extraData: withAccountState
			? { "account-state": [{ networkId: "syn-network-id", chainId: 0, senders: [{ address }], contracts: [] }] }
			: {},
	})
}

/** Drive pick→fill→submit for the backup file (the shared driver's body minus
 *  its success-route wait — these tests assert the errors-screen branch). */
async function submitBackup(page: Page, filePath: string): Promise<void> {
	await page.waitForSelector('[data-testid="import-option-full-backup"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "import-option-full-backup")
	await page.waitForSelector('[data-testid="import-full-backup-pick-file"]', { visible: true, timeout: 10_000 })
	const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10_000 }), clickByTestId(page, "import-full-backup-pick-file")])
	await chooser.accept([filePath])
	await page.waitForSelector('[data-testid="import-full-backup-submit-btn"]', { visible: true, timeout: 15_000 })
	await setInputs(page, {
		'[data-testid="import-full-backup-password-input"] input': TEST_PASSWORD,
		'[data-testid="import-full-backup-password-confirm-input"] input': TEST_PASSWORD,
	})
	await submitWhenEnabled(page, "import-full-backup-submit-btn")
}

/** Wait for the finished-with-errors screen, assert View Errors rides along,
 *  click Continue, and require the route inside `postClickBudgetMs`. */
async function continueThroughErrorsScreen(page: Page, errorsScreenBudgetMs: number, postClickBudgetMs = 30_000): Promise<void> {
	await page.waitForFunction(() => !!document.querySelector('[data-testid="import-full-backup-continue-btn"]'), {
		timeout: errorsScreenBudgetMs,
		polling: 250,
	})
	expect(await page.evaluate(() => !!document.querySelector('[data-testid="import-full-backup-view-errors-btn"]'))).toBe(true)
	await clickByTestId(page, "import-full-backup-continue-btn")
	await waitForHash(page, "#/popup/general", postClickBudgetMs)
}

async function withFreshExtension(
	mode: RpcInterception,
	fn: (page: Page, ctx: ExtensionContext, intercepted: () => number) => Promise<void>,
	intercept: typeof interceptRpc = interceptRpc,
): Promise<{ profileDir: string }> {
	const profileDir = mkdtempSync(join(tmpdir(), "nulo-dead-rpc-"))
	const ctx = await launchExtension({ userDataDir: profileDir })
	// The interception is armed inside the cleanup scope: a setup failure must still close the
	// browser and remove its profile directory.
	let armed: Awaited<ReturnType<typeof interceptRpc>> | undefined
	try {
		armed = await intercept(ctx.browser, ctx.extensionId, LOCAL_RPC, mode)
		const page = await gotoPopupImport(ctx)
		await fn(page, ctx, armed.hits)
	} finally {
		await armed?.stop()
		await ctx.browser.close()
		rmSync(profileDir, { recursive: true, force: true })
	}
	return { profileDir }
}

test("REFUSED rpc: import lands on the errors screen fast; Continue enters the wallet", { timeout: 180_000, retry: 0 }, async () => {
	// The seed's requests fail at the browser as a refused connection: each preflight attempt
	// classifies in ~ms, so the whole leg costs ≈6s of backoff waits. Budget: slow-runner
	// storage restore (≤15s) + ≈6s + margin.
	const backup = await deadRpcBackup()
	await withFreshExtension({ kind: "refuse" }, async (page, _ctx, intercepted) => {
		await submitBackup(page, writeBackupToTemp(backup, "refused.json"))
		await continueThroughErrorsScreen(page, 60_000)
		// The refusal must be the interception's, not whatever happens to listen on the seed's port.
		expect(intercepted()).toBeGreaterThan(0)
	})
})

test("BLACKHOLE rpc: the preflight's per-attempt abort bounds a hanging endpoint", { timeout: 180_000, retry: 0 }, async () => {
	// Never-answering socket: 3 aborted attempts (5s each) + backoff = 21s of
	// preflight, then skip records. Budget: restore ≤15s + 21s + margin.
	const stub = await startStub(() => undefined)
	try {
		const backup = await deadRpcBackup()
		await withFreshExtension({ kind: "redirect", to: stub.url }, async (page) => {
			await submitBackup(page, writeBackupToTemp(backup, "blackhole.json"))
			await continueThroughErrorsScreen(page, 75_000)
		})
		// The preflight probes; the PXE boot call must never have been reached.
		expect(stub.methods).toContain("aztec_getNodeInfo")
		expect(stub.methods).not.toContain("aztec_getL1ContractAddresses")
	} finally {
		await stub.close()
	}
})

test("STATEFUL rpc (probe passes, then blackholes): the registration deadline bounds the leg", { timeout: 240_000, retry: 0 }, async () => {
	// Answers aztec_getNodeInfo (the preflight probe → Active) and blackholes
	// everything after — the PXE boot's aztec_getL1ContractAddresses hangs, so
	// ONLY the 30s registration deadline can unpark this variant. The observed
	// method sequence proves the race actually engaged (probe answered BEFORE
	// the boot call arrived). Budget: restore ≤15s + probe ≈0 + 30s + margin.
	const stub = await startStub((method) => (method === "aztec_getNodeInfo" ? nodeInfoResult() : undefined))
	try {
		const backup = await deadRpcBackup()
		await withFreshExtension({ kind: "redirect", to: stub.url }, async (page) => {
			await submitBackup(page, writeBackupToTemp(backup, "stateful.json"))
			await continueThroughErrorsScreen(page, 90_000)
		})
		const firstInfo = stub.methods.indexOf("aztec_getNodeInfo")
		const firstBoot = stub.methods.indexOf("aztec_getL1ContractAddresses")
		const seen = `stub saw: [${stub.methods.join(", ")}]`
		expect(firstInfo, seen).toBeGreaterThanOrEqual(0)
		expect(firstBoot, seen).toBeGreaterThan(firstInfo)
	} finally {
		await stub.close()
	}
})

test("an interception setup failure still closes the browser and removes its profile directory", {
	timeout: 120_000,
	retry: 0,
}, async () => {
	const failing: typeof interceptRpc = async () => {
		throw new Error("synthetic interception failure")
	}
	let dir = ""
	await expect(
		withFreshExtension(
			{ kind: "refuse" },
			async () => {
				throw new Error("must not run")
			},
			async (browser, id, from, mode) => {
				dir =
					(browser as unknown as { process(): { spawnargs: string[] } })
						.process()
						.spawnargs.find((a) => a.startsWith("--user-data-dir="))
						?.slice("--user-data-dir=".length) ?? ""
				return failing(browser, id, from, mode)
			},
		),
	).rejects.toThrow(/synthetic interception failure/)
	expect(dir).toMatch(/nulo-dead-rpc-/)
	expect(existsSync(dir)).toBe(false)
})
