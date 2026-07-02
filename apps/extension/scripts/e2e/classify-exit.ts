#!/usr/bin/env bun
/**
 * Boot-failure classifier CLI. Invoked by `agent.sh` with vitest's exit code as
 * argv[2]; reads the boot markers and exits with the classified code so
 * `_network-e2e.yml` can retry ONLY a genuine infra-boot failure (exit 86).
 *
 * The pure {@link classifyExit} logic lives in `tests/e2e/sentinel.ts` and is
 * unit-tested in `classify-exit.test.ts`; this file is only the thin CLI shell.
 */
import { classifyExit, readMarkers } from "../../tests/e2e/sentinel"

if (import.meta.main) {
	const raw = Number(process.argv[2] ?? "1")
	const vitestExit = Number.isNaN(raw) ? 1 : raw
	process.exit(classifyExit(vitestExit, readMarkers()))
}
