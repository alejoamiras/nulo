import { describe, expect, test } from "vitest"

import { KNOWN_JOB_ERROR_KINDS } from "./types"

describe("KNOWN_JOB_ERROR_KINDS (drift guard)", () => {
	test("contains every literal a producer actually emits", () => {
		// If a producer emits a kind absent here, the open union silently loses
		// its known-set value for that kind. Sources: normalizeError literals,
		// wallet-sdk popup_bound, the reaper, and classifyTokenImportError.
		const produced = [
			"transfer",
			"dapp_execute",
			"duplicate_initialization",
			"prover",
			"network",
			"unknown",
			"popup_bound",
			"sw_restart_post_prove",
			"stuck_proving",
			"stuck_queued",
			"stale_on_resume",
			"network_unreachable",
			"contract_invalid",
			"metadata_fetch",
		]
		for (const k of produced) expect(KNOWN_JOB_ERROR_KINDS).toContain(k)
	})

	test("is non-empty and deduplicated (satisfies-table mirror is well-formed)", () => {
		expect(KNOWN_JOB_ERROR_KINDS.length).toBeGreaterThan(0)
		expect(new Set(KNOWN_JOB_ERROR_KINDS).size).toBe(KNOWN_JOB_ERROR_KINDS.length)
	})
})
