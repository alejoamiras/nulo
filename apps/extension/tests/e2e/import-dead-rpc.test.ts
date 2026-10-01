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
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Page } from "puppeteer"
import { CHROME_ONLY, interceptRpc, isFirefox, type RpcInterception } from "./fixtures/browser"
import { LOCAL_L1_CHAIN_ID } from "@/utils/chain-ids"
import { clickByTestId, type ExtensionContext, launchExtension, test, waitForHash, pickFileByTestId } from "./fixtures/extension"
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
import { nodeInfoResult, planBatchReplies, startStub } from "./helpers/rpc-stub"

/** The LOCAL seed's compiled-in endpoint (`LOCAL_NETWORK_RPC_URL`'s default and env override). */
const LOCAL_RPC = process.env.VITE_LOCAL_NETWORK_RPC_URL ?? "http://localhost:8080"

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
	await pickFileByTestId(page, "import-full-backup-pick-file", filePath)
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
	fn: (page: Page, ctx: ExtensionContext, intercepted: () => Promise<number>) => Promise<void>,
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
		// A target the helper could not arm may have dialed the real seed endpoint: the scenario's
		// outcome proves nothing then, whichever way it came out.
		expect(await armed.failures(), "rpc interception failures").toEqual([])
	} finally {
		await armed?.stop()
		await ctx.close()
		rmSync(profileDir, { recursive: true, force: true })
	}
	return { profileDir }
}

describe.skipIf(isFirefox)(CHROME_ONLY.cdpFetch, () => {
	test("REFUSED rpc: import lands on the errors screen fast; Continue enters the wallet", { timeout: 180_000, retry: 0 }, async () => {
		// The seed's requests fail at the browser as a refused connection: each preflight attempt
		// classifies in ~ms, so the whole leg costs ≈6s of backoff waits. Budget: slow-runner
		// storage restore (≤15s) + ≈6s + margin.
		const backup = await deadRpcBackup()
		await withFreshExtension({ kind: "refuse" }, async (page, _ctx, intercepted) => {
			await submitBackup(page, writeBackupToTemp(backup, "refused.json"))
			await continueThroughErrorsScreen(page, 60_000)
			// The refusal must be the interception's, not whatever happens to listen on the seed's port.
			expect(await intercepted()).toBeGreaterThan(0)
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

	test("STATEFUL rpc (probe passes, then blackholes): the registration deadline bounds the leg", {
		timeout: 240_000,
		retry: 0,
	}, async () => {
		// Answers aztec_getNodeInfo (the preflight probe → Active) and blackholes
		// everything after — the PXE boot's aztec_getL1ContractAddresses hangs, so
		// ONLY the 30s registration deadline can unpark this variant. The observed
		// method sequence proves the race actually engaged (probe answered BEFORE
		// the boot call arrived). Budget: restore ≤15s + probe ≈0 + 30s + margin.
		const stub = await startStub((method) =>
			method === "aztec_getNodeInfo" ? nodeInfoResult(LOCAL_L1_CHAIN_ID, LOCAL_L1_CHAIN_ID) : undefined,
		)
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
})
