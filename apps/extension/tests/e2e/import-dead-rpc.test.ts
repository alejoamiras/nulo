/**
 * Import with a DEAD/degraded RPC must reach an actionable screen fast — the
 * product fix for e2e-deflake ledger entry 1 (the smoke backup-roundtrip
 * flake's root). The import's account-state leg is the ONE step that dials
 * the network (PXE boot against the backup-carried rpcUrl); it is now
 * preflight-gated and deadline-bounded, and skipped registrations surface on
 * the existing finished-with-errors screen whose Continue proceeds into the
 * wallet.
 *
 * Three endpoint shapes, each proving a different bound:
 *  - REFUSED   (`http://localhost:1`)      → preflight classifies in ~ms/attempt.
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
 */
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo, Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect } from "vitest"
import type { Page } from "puppeteer"
import { clickByTestId, launchExtension, test, waitForHash } from "./fixtures/extension"
import {
	buildSyntheticBackup,
	deriveNuloAccountAddress,
	gotoPopupImport,
	makeRandomMasterBase64,
	setInputs,
	submitWhenEnabled,
	TEST_PASSWORD,
	writeBackupToTemp,
} from "./helpers/import-drivers"

/** The synthetic network's chain id — the stateful stub answers for it. */
const STUB_CHAIN_ID = 4242

const ZERO_ETH = `0x${"00".repeat(20)}`
const ZERO_AZTEC = `0x${"00".repeat(32)}`

/** Schema-valid `getNodeInfo` result for the stateful stub (NodeInfoSchema:
 *  @aztec/stdlib contract/interfaces/node-info). `l1ChainId ^ rollupVersion`
 *  composes the wallet's chain id, so `(0, STUB_CHAIN_ID)` answers "I am the
 *  restored network". */
function nodeInfoResult(): Record<string, unknown> {
	return {
		nodeVersion: "0.0.0-stub",
		l1ChainId: 0,
		rollupVersion: STUB_CHAIN_ID,
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
				// The aztec JSON-RPC client BATCHES: bodies arrive as arrays of
				// request envelopes (the Phase-1 evidence harness learned this the
				// hard way). Log + answer element-wise; a batch with ANY
				// unanswerable element blackholes whole (no partial responses).
				let entries: Array<{ method?: string; id?: unknown }>
				let wasBatch = false
				try {
					const parsed = JSON.parse(body) as { method?: string } | Array<{ method?: string }>
					wasBatch = Array.isArray(parsed)
					entries = Array.isArray(parsed) ? parsed : [parsed]
				} catch {
					methods.push(`<unparsed:${body.slice(0, 60)}>`)
					return
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
				if (blackhole) return
				res.setHeader("content-type", "application/json")
				res.end(JSON.stringify(wasBatch ? replies : replies[0]))
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

/** Synthetic backup whose ONE network (kind custom, STUB_CHAIN_ID) points at
 *  `rpcUrl` and carries a senders-only account-state slice — the minimum
 *  registrable work that forces the chain-registration leg to engage. */
async function deadRpcBackup(rpcUrl: string, withAccountState = true): Promise<string> {
	const master = await makeRandomMasterBase64()
	const address = await deriveNuloAccountAddress(master, STUB_CHAIN_ID)
	const base = buildSyntheticBackup({
		masterBase64: master,
		// The stub network's L1 identity — must match what `address` was derived under.
		l1ChainId: STUB_CHAIN_ID,
		accountAddress: address,
		extraData: withAccountState ? { "account-state": [{ networkId: "syn-network-id", senders: [{ address }], contracts: [] }] } : {},
	})
	// Retarget the synthetic network at the stub: rpcUrl + a NON-local kind +
	// the stub's chain id (kind "local" short-circuits chain checks to 0, which
	// would misclassify the stub as InvalidChain), then re-checksum — the
	// importer verifies the hash over the parsed-minus-checksum body.
	const parsed = JSON.parse(base) as {
		checksum?: string
		data: { network: Array<Record<string, unknown>>; account: Array<Record<string, unknown>> }
	} & Record<string, unknown>
	const { checksum: _drop, ...bodyRest } = parsed
	const body = bodyRest as typeof parsed
	for (const n of body.data.network) {
		n.rpcUrl = rpcUrl
		n.kind = "custom"
		n.name = "Stub Net"
		n.chainId = STUB_CHAIN_ID
		for (const e of (n.endpoints as Array<Record<string, unknown>>) ?? []) e.rpcUrl = rpcUrl
	}
	for (const a of body.data.account) a.chainId = STUB_CHAIN_ID
	const checksum = createHash("sha256").update(JSON.stringify(body)).digest("hex")
	return JSON.stringify({ ...body, checksum })
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

async function withFreshExtension(fn: (page: Page) => Promise<void>): Promise<void> {
	const profileDir = mkdtempSync(join(tmpdir(), "nulo-dead-rpc-"))
	const ctx = await launchExtension({ userDataDir: profileDir })
	try {
		const page = await gotoPopupImport(ctx)
		await fn(page)
	} finally {
		await ctx.browser.close()
		rmSync(profileDir, { recursive: true, force: true })
	}
}

test("REFUSED rpc: import lands on the errors screen fast; Continue enters the wallet", { timeout: 180_000, retry: 0 }, async () => {
	// http://localhost:1 refuses cross-platform (endpoints.test.ts precedent):
	// each preflight attempt classifies in ~ms, so the whole leg costs ≈6s of
	// backoff waits. Budget: slow-runner storage restore (≤15s) + ≈6s + margin.
	const backup = await deadRpcBackup("http://localhost:1")
	await withFreshExtension(async (page) => {
		await submitBackup(page, writeBackupToTemp(backup, "refused.json"))
		await continueThroughErrorsScreen(page, 60_000)
	})
})

test("BLACKHOLE rpc: the preflight's per-attempt abort bounds a hanging endpoint", { timeout: 180_000, retry: 0 }, async () => {
	// Never-answering socket: 3 aborted attempts (5s each) + backoff = 21s of
	// preflight, then skip records. Budget: restore ≤15s + 21s + margin.
	const stub = await startStub(() => undefined)
	try {
		const backup = await deadRpcBackup(stub.url)
		await withFreshExtension(async (page) => {
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
		const backup = await deadRpcBackup(stub.url)
		await withFreshExtension(async (page) => {
			await submitBackup(page, writeBackupToTemp(backup, "stateful.json"))
			await continueThroughErrorsScreen(page, 90_000)
		})
		const firstInfo = stub.methods.indexOf("aztec_getNodeInfo")
		const firstBoot = stub.methods.indexOf("aztec_getL1ContractAddresses")
		expect(firstInfo).toBeGreaterThanOrEqual(0)
		expect(firstBoot).toBeGreaterThan(firstInfo)
	} finally {
		await stub.close()
	}
})
