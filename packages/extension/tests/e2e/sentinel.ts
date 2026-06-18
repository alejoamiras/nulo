import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Boot-sentinel state dir — `packages/extension/.e2e-state`. Shared with
 * `scripts/e2e/agent.sh`, the boot classifier, and the failure-artifact upload
 * glob in `_network-e2e.yml`. Resolved from this file's location so it is
 * identical no matter which process (global-setup, a test worker, or the
 * classifier CLI) writes or reads it.
 */
export const STATE_DIR = path.resolve(__dirname, "../../.e2e-state")

const BOOT_STARTED = path.join(STATE_DIR, "boot-started")
const BOOT_READY = path.join(STATE_DIR, "boot-ready")
const TESTS_STARTED = path.join(STATE_DIR, "tests-started")

/** Boot-failure sentinel exit code. The agent exits with this code ONLY when
 *  the sandbox (anvil / node / deploy) started but never became ready and no
 *  test ran. CI retries the agent exactly ONCE on this code; any other
 *  non-zero is a real failure and is never retried. */
export const BOOT_FAILURE_EXIT = 86

export interface BootMarkers {
	bootStarted: boolean
	bootReady: boolean
	testsStarted: boolean
}

function touch(file: string): void {
	fs.mkdirSync(STATE_DIR, { recursive: true })
	fs.writeFileSync(file, new Date().toISOString())
}

/** Written by global-setup the instant sandbox bring-up begins (after the
 *  manifest check + orphan reap, before anvil). Its presence opens the 86
 *  classification window. */
export const markBootStarted = (): void => touch(BOOT_STARTED)

/** Written by global-setup the instant the sandbox is confirmed healthy AND
 *  contracts are deployed, BEFORE any test worker starts. Its presence closes
 *  the 86 window — a failure after this point is never an infra-boot failure. */
export const markBootReady = (): void => touch(BOOT_READY)

/** Written by the first test worker (network setupFile) when it reaches test
 *  execution. A run where a test started can never be misclassified as
 *  infra-boot. Best-effort single write; a worker race just rewrites it. */
export const markTestsStarted = (): void => {
	if (!fs.existsSync(TESTS_STARTED)) touch(TESTS_STARTED)
}

/** Remove all sentinel markers so the classifier sees only the current run's
 *  state. Called at the top of `agent.sh`; also safe to call from setup. */
export const clearMarkers = (): void => {
	for (const f of [BOOT_STARTED, BOOT_READY, TESTS_STARTED]) {
		try {
			fs.rmSync(f, { force: true })
		} catch {
			// ignore — absence is the desired post-condition.
		}
	}
}

export const readMarkers = (): BootMarkers => ({
	bootStarted: fs.existsSync(BOOT_STARTED),
	bootReady: fs.existsSync(BOOT_READY),
	testsStarted: fs.existsSync(TESTS_STARTED),
})

/**
 * Classify the agent's final exit code from vitest's exit code + the boot
 * markers. Returns {@link BOOT_FAILURE_EXIT} (86) ONLY in the narrow window
 * where the sandbox started booting but never became ready and no test ran.
 * Everything else passes the vitest code through unchanged: 0 stays 0, and a
 * real test/fixture failure stays its own code so CI does NOT retry it.
 */
export function classifyExit(vitestExitCode: number, markers: BootMarkers): number {
	if (vitestExitCode === 0) return 0
	if (markers.bootStarted && !markers.bootReady && !markers.testsStarted) return BOOT_FAILURE_EXIT
	return vitestExitCode
}
