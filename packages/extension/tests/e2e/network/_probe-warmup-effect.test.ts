/**
 * Phase 3A probe — measures whether a throwaway "warm-up" browser run
 * meaningfully reduces the FIRST cap-popup + cap-account-item latency in
 * a second fresh browser on the same host. The decision criterion (per
 * plan §5.3) is ≥30% reduction → ship warm-up in `global-setup.ts`;
 * otherwise fall back to per-test fixture-layer warm-up.
 *
 * GATED on `NULO_E2E_PROBE=1`. Default runs skip this file harmlessly
 * (so adding it to the suite is zero risk). To run:
 *
 *   NULO_E2E_PROBE=1 bun run e2e:agent \
 *     tests/e2e/network/_probe-warmup-effect.test.ts
 *
 * Designed as a one-shot measurement; outputs mean ± stdev per arm and
 * a verdict line. Expected wall-time: ~15–25 min (10 trials × 1–2 min).
 *
 * Bias note: NO_WARMUP trials run first (host caches coldest). WITH_WARMUP
 * trials follow on a warmer host, which BIASES AGAINST detecting a warm-up
 * effect. A positive result (≥30% reduction) under that bias is robust;
 * a negative result needs interpretation.
 */

import { appendFileSync, writeFileSync } from "node:fs"
import { inject } from "vitest"
import { test } from "../fixtures/extension"
import { launchExtension, registerProfile, connectPlayground, openPopup, waitForHash, clickByTestId } from "../fixtures/extension"
import { switchToLocalNetwork } from "../fixtures/helpers"
import { snapshotResultSeq } from "../fixtures/playground"
import { waitForPopup, rejectCapabilities } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

// vitest's pool:forks captures stdout per-test and only surfaces it on
// failure or with --reporter=verbose. Mirror probe output to a file so the
// raw measurements survive vitest's buffering and are easy to copy back.
const OUTPUT_FILE = process.env.NULO_E2E_PROBE_OUT || "/tmp/nulo-probe-warmup-results.log"
function log(line = ""): void {
	console.log(line)
	appendFileSync(OUTPUT_FILE, `${line}\n`)
}

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined
const probeEnabled = process.env.NULO_E2E_PROBE === "1"

const TRIALS_PER_ARM = 5

interface TrialResult {
	capPopupMs: number
	capAccountItemMs: number
}

/** Launches an extension, registers, connects playground, drives a cap-popup
 *  request, REJECTS the cap (per plan §8.3 — never approve in warm-up paths
 *  because that mutates state), and returns timings. The browser is closed
 *  before this function returns. */
async function runCapPopupCycle(label: string): Promise<TrialResult> {
	const ctx = await launchExtension()
	try {
		await registerProfile(ctx)
		// CRITICAL: switch to Local Network BEFORE connecting playground. Playground
		// uses chainId 0 (Local Network); without this switch the extension stays
		// on Testnet where there are no accounts → cap-account-item never renders.
		// Same constraint as the dappConnectedExtension fixture.
		const setupPage = await openPopup(ctx)
		await waitForHash(setupPage, "#/popup/general", 30_000)
		await switchToLocalNetwork(setupPage)
		await setupPage.close()
		const dappPage = await connectPlayground(ctx)

		// Pick the `accounts` bundle so the popup needs to resolve
		// availableAccounts (the slow path under measurement).
		await dappPage.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')
			if (!select) throw new Error("pg-bundle-select not present")
			select.value = "accounts"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})

		// Make sure prior responses don't pollute the seq snapshot.
		await snapshotResultSeq(dappPage)

		const t0 = Date.now()
		const capPopupP = waitForPopup(ctx, "capabilities", { timeout: 120_000 })
		await clickByTestId(dappPage, "pg-btn-requestCapabilities")
		const capPopup = await capPopupP
		const tPopup = Date.now()

		await capPopup.waitForSelector('[data-testid="cap-account-item"]', { timeout: 120_000 })
		const tAccountItem = Date.now()

		// Reject (don't approve — codex §8.3). Suppresses state mutation
		// so neither this nor the next trial sees a grant carry-over.
		await rejectCapabilities(capPopup)

		const result: TrialResult = {
			capPopupMs: tPopup - t0,
			capAccountItemMs: tAccountItem - t0,
		}
		log(`[probe ${label}] capPopup=${result.capPopupMs}ms capAccountItem=${result.capAccountItemMs}ms`)
		return result
	} finally {
		await ctx.browser.close()
	}
}

function mean(xs: number[]): number {
	return xs.reduce((a, b) => a + b, 0) / xs.length
}

function stdev(xs: number[]): number {
	const m = mean(xs)
	const sq = xs.map((x) => (x - m) ** 2)
	return Math.sqrt(mean(sq))
}

function pctReduction(noWarm: number, withWarm: number): number {
	if (noWarm === 0) return 0
	return ((noWarm - withWarm) / noWarm) * 100
}

test.skipIf(!hasConfig || !probeEnabled)(
	"phase-3a-probe — does browser-A warm-up reduce browser-B first-cap latency?",
	{ timeout: 30 * 60_000 }, // 30 min ceiling
	async () => {
		// Truncate previous run's output
		writeFileSync(OUTPUT_FILE, `# Probe run started at ${new Date().toISOString()}\n`)
		log(`[probe] starting — ${TRIALS_PER_ARM} trials per arm`)
		log(`[probe] writing results to ${OUTPUT_FILE}`)

		// Arm 1: NO warm-up. Each trial = one browser, cap-popup-then-reject.
		// Runs first so host is coldest for this arm.
		const noWarmup: TrialResult[] = []
		for (let i = 1; i <= TRIALS_PER_ARM; i++) {
			noWarmup.push(await runCapPopupCycle(`NO_WARMUP trial ${i}`))
		}

		// Arm 2: WITH warm-up. Each trial = throwaway browser A + measured browser B.
		const withWarmup: TrialResult[] = []
		for (let i = 1; i <= TRIALS_PER_ARM; i++) {
			log(`[probe WITH_WARMUP trial ${i}] running warm-up browser A...`)
			await runCapPopupCycle(`WITH_WARMUP trial ${i} (warm-up A)`)
			log(`[probe WITH_WARMUP trial ${i}] running measured browser B...`)
			withWarmup.push(await runCapPopupCycle(`WITH_WARMUP trial ${i} (measure B)`))
		}

		// Report
		const noPopups = noWarmup.map((r) => r.capPopupMs)
		const noItems = noWarmup.map((r) => r.capAccountItemMs)
		const withPopups = withWarmup.map((r) => r.capPopupMs)
		const withItems = withWarmup.map((r) => r.capAccountItemMs)

		const noPopupMean = mean(noPopups)
		const noItemMean = mean(noItems)
		const withPopupMean = mean(withPopups)
		const withItemMean = mean(withItems)

		log("\n========== PROBE RESULTS ==========")
		log(`NO_WARMUP   capPopup:        mean=${noPopupMean.toFixed(0)}ms stdev=${stdev(noPopups).toFixed(0)}ms n=${noPopups.length}`)
		log(
			`WITH_WARMUP capPopup:        mean=${withPopupMean.toFixed(0)}ms stdev=${stdev(withPopups).toFixed(0)}ms n=${withPopups.length}`,
		)
		log(`  → capPopup reduction:     ${pctReduction(noPopupMean, withPopupMean).toFixed(1)}%`)
		log()
		log(`NO_WARMUP   capAccountItem:  mean=${noItemMean.toFixed(0)}ms stdev=${stdev(noItems).toFixed(0)}ms n=${noItems.length}`)
		log(`WITH_WARMUP capAccountItem:  mean=${withItemMean.toFixed(0)}ms stdev=${stdev(withItems).toFixed(0)}ms n=${withItems.length}`)
		log(`  → capAccountItem reduction: ${pctReduction(noItemMean, withItemMean).toFixed(1)}%`)
		log()

		const popupRed = pctReduction(noPopupMean, withPopupMean)
		const itemRed = pctReduction(noItemMean, withItemMean)
		const significantReduction = popupRed >= 30 || itemRed >= 30
		log(
			`VERDICT: ${significantReduction ? "✅ WARM-UP HELPS (≥30% reduction on at least one metric)" : "❌ WARM-UP DOES NOT MEET 30% THRESHOLD"}`,
		)
		log(
			`  → Phase 3B recommendation: ${significantReduction ? "implement warm-up in global-setup.ts" : "fall back to per-test fixture-layer warm-up"}`,
		)
		log("===================================\n")

		// Raw arrays for archival
		log(`[probe raw] NO_WARMUP   capPopup:        ${JSON.stringify(noPopups)}`)
		log(`[probe raw] WITH_WARMUP capPopup:        ${JSON.stringify(withPopups)}`)
		log(`[probe raw] NO_WARMUP   capAccountItem:  ${JSON.stringify(noItems)}`)
		log(`[probe raw] WITH_WARMUP capAccountItem:  ${JSON.stringify(withItems)}`)
	},
)
