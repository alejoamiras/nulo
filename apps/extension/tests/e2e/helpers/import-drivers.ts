/**
 * Shared drivers for the profile-IMPORT e2e flows, used by both the popup
 * (`import-paths.test.ts`) and onboarding (`onboarding-import.test.ts`) shells.
 *
 * The import method picker + secret/password inputs are shared L3 composite
 * components (`@/components/composite/import/*`), so their testids are identical
 * across shells. Only three things differ per shell — the profile-name input
 * testid, the submit-button testid, and the success hash — captured in
 * `ImportShell`.
 */
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { type Page, TimeoutError } from "puppeteer"
import { expect } from "vitest"
import { clickByTestId, type ExtensionContext, openOnboarding, openPopup, waitForHash, withTimeoutMessage } from "../fixtures/extension"
import {
	appendImportRecord,
	buildImportRecord,
	buildTraceLostRecord,
	type FinalObservation,
	formatTrajectoryDiagnostic,
	type ImportStageRecord,
	type StageEvent,
} from "./import-stage-timing"
export { TEST_PASSWORD } from "../fixtures/constants"

/** Per-fork measurement identity (vitest runs one fork per test file). */
const RUN_ID = `${process.pid}-${Date.now()}`
let importCounter = 0

interface StageTraceWindow {
	__nuloStageTrace?: { events: StageEvent[]; observer: MutationObserver | null }
}

/** Arm the page-side stage recorder BEFORE submit: a MutationObserver on
 *  `[data-restore-stage]` pushing `{stage, tMs}` into a window-scoped buffer,
 *  seeded with the current (baseline) value. The baseline seed is the attempt
 *  fence: a stale pre-submit stage can never be mistaken for this attempt's
 *  transition (`resetBackupState` deliberately does not reset `restoreStage`). */
async function armStageTrace(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as StageTraceWindow
		w.__nuloStageTrace?.observer?.disconnect()
		const read = () => document.querySelector("[data-restore-stage]")?.getAttribute("data-restore-stage") ?? ""
		const trace: NonNullable<StageTraceWindow["__nuloStageTrace"]> = {
			events: [{ stage: read(), tMs: performance.now(), baseline: true }],
			observer: null,
		}
		const observer = new MutationObserver(() => {
			const stage = read()
			const last = trace.events[trace.events.length - 1]
			if (last?.stage !== stage) trace.events.push({ stage, tMs: performance.now() })
		})
		observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-restore-stage"] })
		trace.observer = observer
		w.__nuloStageTrace = trace
	})
}

/** ONE post-settle read (success or timeout): the buffer + final hash/stage/
 *  continue-screen, all stamped on the page's own `performance.now()` clock.
 *  Idempotent — disconnects the observer but keeps the events, so the lapse
 *  diagnostic and the measurement record share one observation. */
async function readStageTraceFinal(page: Page): Promise<FinalObservation> {
	return await page.evaluate(() => {
		const w = window as unknown as StageTraceWindow
		w.__nuloStageTrace?.observer?.disconnect()
		return {
			events: w.__nuloStageTrace?.events ?? [],
			finalTMs: performance.now(),
			hash: window.location.hash,
			stage: document.querySelector("[data-restore-stage]")?.getAttribute("data-restore-stage") ?? "",
			continueScreen: !!document.querySelector('[data-testid="import-full-backup-continue-btn"]'),
		}
	})
}

/** Canonical BIP39 24-word zero-entropy vector. Stable across Aztec versions
 *  and BIP39 dictionary changes. Sourced from `mnemonic.test.ts:24`. */
export const CANONICAL_SEED_24 =
	"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"

export type ImportMethod = "seed" | "private-key" | "public-key" | "full-backup"

/** The only parts of the import flow that differ between shells. */
export interface ImportShell {
	/** Profile-name input testid — popup: `import-name-input`; onboarding: `onboarding-name-input`. */
	nameInputTestId: string
	/** Submit-button testid for a method — popup: per-method `import-<m>-submit-btn`; onboarding: single `onboarding-submit-import`. */
	submitTestId: (method: ImportMethod) => string
	/** Hash the flow lands on after a successful import. */
	successHash: string
}

export const POPUP_IMPORT_SHELL: ImportShell = {
	nameInputTestId: "import-name-input",
	submitTestId: (m) => `import-${m}-submit-btn`,
	successHash: "#/popup/general",
}

export const ONBOARDING_IMPORT_SHELL: ImportShell = {
	nameInputTestId: "onboarding-name-input",
	submitTestId: () => "onboarding-submit-import",
	successHash: "#/onboarding/learn",
}

/** Set a batch of `<Input>` values in page context (native setter + input event
 *  so Vue's v-model picks them up). Keys are CSS selectors. */
export async function setInputs(page: Page, fields: Record<string, string>): Promise<void> {
	await page.evaluate((entries: Array<[string, string]>) => {
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
		for (const [sel, v] of entries) {
			const input = document.querySelector<HTMLInputElement>(sel)
			if (!input) throw new Error(`input not found: ${sel}`)
			setter?.call(input, v)
			input.dispatchEvent(new Event("input", { bubbles: true }))
		}
	}, Object.entries(fields))
}

/** Wait for a testid'd button to be enabled, then click it. */
export async function submitWhenEnabled(page: Page, testId: string): Promise<void> {
	await page.waitForFunction(
		(id: string) => {
			const btn = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
			return !!btn && !btn.disabled
		},
		{ timeout: 10_000 },
		testId,
	)
	await clickByTestId(page, testId)
}

/** Open the popup and land on `/popup/import` (waits for register + global-loader to clear). */
export async function gotoPopupImport(ctx: ExtensionContext): Promise<Page> {
	const page = await openPopup(ctx)
	await waitForHash(page, "#/popup/register", 15_000)
	await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), { timeout: 15_000, polling: 500 })
	await page.evaluate(() => {
		window.location.hash = "#/popup/import"
	})
	await waitForHash(page, "#/popup/import", 5_000)
	return page
}

/** Open the onboarding tab and land on `/onboarding/import` via the welcome CTA. */
export async function gotoOnboardingImport(ctx: ExtensionContext): Promise<Page> {
	const page = await openOnboarding(ctx)
	await page.waitForSelector('[data-testid="onboarding-welcome-import"]', { visible: true, timeout: 15_000 })
	await clickByTestId(page, "onboarding-welcome-import")
	await waitForHash(page, "#/onboarding/import", 10_000)
	return page
}

export async function importPlainKey(page: Page, secret: string, password: string, shell: ImportShell): Promise<void> {
	await page.waitForSelector('[data-testid="import-option-private-key"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "import-option-private-key")
	await page.waitForSelector('[data-testid="import-private-key-input"] input', { visible: true, timeout: 10_000 })
	await setInputs(page, {
		[`[data-testid="${shell.nameInputTestId}"] input`]: "Imported Profile",
		'[data-testid="import-private-key-input"] input': secret,
		'[data-testid="import-password-input"] input': password,
		'[data-testid="import-password-confirm-input"] input': password,
	})
	await submitWhenEnabled(page, shell.submitTestId("private-key"))
	await waitForHash(page, shell.successHash, 30_000)
}

export async function importEncryptedKey(page: Page, encrypted: string, password: string, shell: ImportShell): Promise<void> {
	await page.waitForSelector('[data-testid="import-option-public-key"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "import-option-public-key")
	await page.waitForSelector('[data-testid="import-public-key-input"] input', { visible: true, timeout: 10_000 })
	// public_key flow has a single password field (no confirm).
	await setInputs(page, {
		[`[data-testid="${shell.nameInputTestId}"] input`]: "Imported Profile",
		'[data-testid="import-public-key-input"] input': encrypted,
		'[data-testid="import-password-input"] input': password,
	})
	await submitWhenEnabled(page, shell.submitTestId("public-key"))
	await waitForHash(page, shell.successHash, 30_000)
}

export async function importSeed(page: Page, seed: string, password: string, shell: ImportShell): Promise<void> {
	await page.waitForSelector('[data-testid="import-option-seed"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "import-option-seed")
	await page.waitForSelector('[data-testid="import-seed-input"] input', { visible: true, timeout: 10_000 })
	await setInputs(page, {
		[`[data-testid="${shell.nameInputTestId}"] input`]: "Imported Profile",
		'[data-testid="import-seed-input"] input': seed,
		'[data-testid="import-password-input"] input': password,
		'[data-testid="import-password-confirm-input"] input': password,
	})
	await submitWhenEnabled(page, shell.submitTestId("seed"))
	await waitForHash(page, shell.successHash, 30_000)
}

/** Drive the popup/onboarding full-backup flow up to (and including) submit,
 *  WITHOUT any completion wait. Shared with the crash-truth suite (its
 *  `driveImportToSubmit` delegates here) so the two halves of the flow have
 *  exactly one implementation. */
export async function submitFullBackupImport(page: Page, filePath: string, password: string, shell: ImportShell): Promise<void> {
	await page.waitForSelector('[data-testid="import-option-full-backup"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "import-option-full-backup")

	// `pickFile` creates a hidden <input type="file"> + clicks it; puppeteer
	// captures the resulting file chooser.
	await page.waitForSelector('[data-testid="import-full-backup-pick-file"]', { visible: true, timeout: 10_000 })
	const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10_000 }), clickByTestId(page, "import-full-backup-pick-file")])
	await chooser.accept([filePath])

	await page.waitForSelector(`[data-testid="${shell.submitTestId("full-backup")}"]`, { visible: true, timeout: 10_000 })
	await setInputs(page, {
		'[data-testid="import-full-backup-password-input"] input': password,
		'[data-testid="import-full-backup-password-confirm-input"] input': password,
	})

	await submitWhenEnabled(page, shell.submitTestId("full-backup"))
}

/** Drive the full-backup import. Lands on the shell's success hash, or — when
 *  `expectError` — waits for the inline error banner + disabled submit
 *  (`true` expects the default "Can't import" copy; a string expects that
 *  exact banner title — a content assertion, not a click target).
 *
 *  LEDGER ENTRY importFullBackup-300s (e2e-deflake) FIX: the success wait is
 *  the UNCHANGED 300s hash wait — the sole overall criterion, hardcoded so no
 *  caller can move it. What changed: a stage recorder armed before submit
 *  feeds (a) a full trajectory diagnostic on lapse (labels for failure
 *  terminals, the Continue-gated degraded screen, and the auth-route
 *  fallback — none of which EXIT early; per the settled design only
 *  product-owned-deadline stages could, and none qualifies) and (b) an
 *  env-gated per-import measurement record (`NULO_E2E_STAGE_LOG=1`).
 *  Assumes a fresh import-page mount per attempt (every consumer does);
 *  the baseline seed fences stale pre-submit stage values either way. */
export async function importFullBackup(
	page: Page,
	filePath: string,
	password: string,
	shell: ImportShell,
	{ expectError = false }: { expectError?: boolean | string } = {},
): Promise<void> {
	if (expectError) {
		await submitFullBackupImport(page, filePath, password, shell)
		const expectedText = typeof expectError === "string" ? expectError : "Can't import"
		await page.waitForFunction(
			(id: string, wanted: string) => {
				const btn = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
				const text = document.body.textContent ?? ""
				return btn?.disabled === true && text.includes(wanted)
			},
			{ timeout: 30_000, polling: 250 },
			shell.submitTestId("full-backup"),
			expectedText,
		)
		return
	}

	const importOrdinal = ++importCounter
	await armStageTrace(page)
	await submitFullBackupImport(page, filePath, password, shell)

	let outcome: ImportStageRecord["outcome"] = "success"
	let final: FinalObservation | null = null
	const readFinal = async (): Promise<FinalObservation> => {
		final ??= await readStageTraceFinal(page)
		return final
	}
	try {
		// The import flow is restore + (possibly) the app's OWN bounded 30s recovery wait before it
		// routes (import.vue completeImportWithRecovery) - a 30s clock expired structurally whenever
		// the recovery leg ran. Sized to the recovery envelope + slow-runner restore + margin.
		await withTimeoutMessage(waitForHash(page, shell.successHash, 300_000), async () =>
			formatTrajectoryDiagnostic(await readFinal(), shell.successHash),
		)
	} catch (err) {
		outcome = err instanceof TimeoutError || (err instanceof Error && err.cause instanceof TimeoutError) ? "timeout" : "error"
		throw err
	} finally {
		// Measurement never masks the wait's outcome: a dead page yields an
		// explicit trace-lost record; any recording fault degrades to a log line.
		try {
			const state = expect.getState()
			const attribution = {
				runId: RUN_ID,
				file: basename(state.testPath ?? "unknown"),
				test: state.currentTestName ?? "unknown",
				importOrdinal,
			}
			const observed = await readFinal().catch(() => null)
			appendImportRecord(
				observed ? buildImportRecord({ ...attribution, final: observed, outcome }) : buildTraceLostRecord(attribution),
			)
		} catch (recordErr) {
			console.log(`[import-stage-timing] attribution failed (measurement lost, test unaffected): ${String(recordErr)}`)
		}
	}
}

/** Read the active account address the wallet writes after import settles. */
export async function readActiveAccount(page: Page): Promise<string> {
	return await page.evaluate(async () => {
		const r = await chrome.storage.local.get("nulo:ui:activeAccount")
		return r["nulo:ui:activeAccount"] as string
	})
}

/** Wait until the active-account pointer CONVERGES to `expected`. Post-import account setup runs
 *  against the active network's RPC, so the pointer can transit intermediate states first — a
 *  single-shot read races it (surfaced when the default network became Alpha mainnet, whose public
 *  RPC throttles CI). The budget is sized to the node client's DOCUMENTED stall envelope
 *  (aztec-runtime utils/fetch: 60s per-request abort × makeBackoff([1,2,3]) retries), so one
 *  timed-out request + its successful retry fits — a smaller budget loses to a single throttled
 *  request by design. Polls storage; throws on timeout. */
export async function waitForActiveAccount(page: Page, expected: string, timeoutMs = 240_000): Promise<void> {
	await page.waitForFunction(
		async (want: string) => {
			const r = await chrome.storage.local.get("nulo:ui:activeAccount")
			return r["nulo:ui:activeAccount"] === want
		},
		{ timeout: timeoutMs, polling: 500 },
		expected,
	)
}

/** Generate an Fr-valid 32-byte master, base64-encoded (the form `importPlain`
 *  accepts). Lazy-imports `Fr` to avoid loading the heavy aztec wasm. */
export async function makeRandomMasterBase64(): Promise<string> {
	const { Fr } = await import("@aztec/aztec.js/fields")
	return Buffer.from(Fr.random().toBuffer()).toString("base64")
}

/** Derive the REAL Nulo account address for (master, chainId, index) through the frozen
 *  derivation path. Synthetic backups must carry derivation-consistent account rows: the
 *  background integrity coordinator re-derives every account before activating an imported
 *  profile and withholds the session on mismatch — a fabricated address IS a foreign backup. */
export async function deriveNuloAccountAddress(masterBase64: string, chainId: number, index = 0): Promise<string> {
	const { Fr } = await import("@aztec/aztec.js/fields")
	const { poseidon2Hash } = await import("@aztec/foundation/crypto/sync")
	const { NuloAccount } = await import("@nulo/aztec-runtime/account")
	const { createLogger } = await import("@aztec/foundation/log")
	const master = Fr.fromBuffer(Buffer.from(masterBase64, "base64"))
	// Same formula as the wallet's account service: poseidon2Hash([master, chainId, type, index])
	// with AccountType.Nulo_v1 = 0.
	const seed = poseidon2Hash([master, new Fr(chainId), new Fr(0), new Fr(index)])
	const account = await NuloAccount.new(seed, createLogger("import-drivers"))
	return account.address.toString()
}

/** Encrypt a base64 master with the test password, returning the base64
 *  ciphertext `importEncrypted` accepts. Runs in the page's browser context so
 *  `self.crypto.subtle` is available. */
export async function makeEncryptedKeyBlob(page: Page, masterBase64: string, password: string): Promise<string> {
	return await page.evaluate(
		async ({ master, pwd }: { master: string; pwd: string }) => {
			const utf8 = new TextEncoder()
			const passhash = await self.crypto.subtle.digest("SHA-256", utf8.encode(pwd))
			const iv = self.crypto.getRandomValues(new Uint8Array(12))
			const salt = await self.crypto.subtle.digest("SHA-256", iv)
			const baseKey = await self.crypto.subtle.importKey("raw", passhash, { name: "PBKDF2" }, false, ["deriveKey"])
			// 600_000 — must match wallet-crypto encryption-key.ts PBKDF2_ITERATIONS.
			const key = await self.crypto.subtle.deriveKey(
				{ name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
				baseKey,
				{ name: "AES-GCM", length: 256 },
				false,
				["encrypt"],
			)
			const masterBytes = Uint8Array.from(atob(master), (c) => c.charCodeAt(0))
			const ctBuf = await self.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, masterBytes)
			const ct = new Uint8Array(ctBuf)
			const out = new Uint8Array(13 + ct.length)
			out[0] = 0
			out.set(iv, 1)
			out.set(ct, 13)
			let bin = ""
			for (const b of out) bin += String.fromCharCode(b)
			return btoa(bin)
		},
		{ master: masterBase64, pwd: password },
	)
}

export interface SyntheticBackupOpts {
	masterBase64: string
	profileName?: string
	/** Override the embedded account address (used for the duplicate-rejection test). */
	accountAddress?: string
	/** Extra slices merged into `data` (e.g. a pre-shape `contact` slice for the
	 *  backup-migration smoke). */
	extraData?: Record<string, unknown>
	/** Top-level metadata overrides merged over the body BEFORE the checksum is
	 *  computed. A key set to `undefined` is dropped by JSON.stringify — use
	 *  that to build pre-baseline (legacy `schema-version`) blobs. */
	bodyOverrides?: Record<string, unknown>
}

/** Build a minimum-viable full-backup payload (current metadata fields + valid SHA-256
 *  checksum) the importer accepts: profile + one network + one account + empty
 *  token slice. Missing slices are treated as no-ops by the importer. */
export function buildSyntheticBackup({
	masterBase64,
	profileName = "Imported",
	accountAddress,
	extraData,
	bodyOverrides,
}: SyntheticBackupOpts): string {
	const body = {
		"wallet-version": "test",
		"aztec-version": "test",
		"compat-epoch": 3,
		"backup-schema-version": 1,
		"master-key": masterBase64,
		data: {
			profile: { id: "syn-profile-id", name: profileName, type: "password" },
			network: [
				{
					id: "syn-network-id",
					profileId: "syn-profile-id",
					name: "Local Network",
					rpcUrl: process.env.AZTEC_NODE_URL ?? "http://localhost:8080",
					// Canonical LOCAL chain id is 0 (network/service.ts DEFAULT_SEEDS): the view-simulation
					// identity guard exempts ONLY chain 0 — a synthetic 31337 reads as a REAL chain identity
					// and assertLiveChainIdentity throws on every read (fee-juice "— FJ" forever).
					chainId: 0,
					kind: "local",
					endpoints: [{ id: "syn-endpoint-id", rpcUrl: process.env.AZTEC_NODE_URL ?? "http://localhost:8080" }],
					primaryEndpointId: "syn-endpoint-id",
				},
			],
			account: [
				{
					address: accountAddress ?? `0x${"01".repeat(32)}`,
					profileId: "syn-profile-id",
					// Canonical LOCAL chain id is 0 (network/service.ts DEFAULT_SEEDS): the view-simulation
					// identity guard exempts ONLY chain 0 — a synthetic 31337 reads as a REAL chain identity
					// and assertLiveChainIdentity throws on every read (fee-juice "— FJ" forever).
					chainId: 0,
					name: "Account",
					index: 0,
					type: 0,
					visible: true,
				},
			],
			token: [],
			// Present-but-empty, like a real export: the stamped backup fixture
			// migration READS contacts, and a missing non-optional slice a
			// pending migration reads rejects the import.
			contact: [],
			...(extraData ?? {}),
		},
		...(bodyOverrides ?? {}),
	}
	const checksum = createHash("sha256").update(JSON.stringify(body)).digest("hex")
	return JSON.stringify({ ...body, checksum })
}

/** Drop a JSON string onto disk so puppeteer's `FileChooser.accept(paths)` can pick it up. */
export function writeBackupToTemp(content: string, filename = "backup.json"): string {
	const dir = mkdtempSync(join(tmpdir(), "nulo-e2e-backup-"))
	const file = join(dir, filename)
	writeFileSync(file, content)
	return file
}
