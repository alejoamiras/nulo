import { test } from "vitest"

test("kills its own worker", () => {
	// Simulates a hard worker death (segfault-class failure) under the forks pool.
	process.kill(process.pid, "SIGKILL")
})
