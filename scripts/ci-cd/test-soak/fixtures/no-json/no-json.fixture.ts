import { test } from "vitest"

test("kills the vitest launcher so no JSON report is ever written", () => {
	// The forks worker's parent is the vitest main process; killing it ends the run by signal,
	// before any reporter can write — a non-timeout "missing JSON" outcome.
	process.kill(process.ppid, "SIGKILL")
})
