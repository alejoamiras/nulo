# Diagnostic probe infrastructure

## The problem

When e2e tests hang at 30s, the obvious diagnostic move is "add console.log in the wallet code, see what fires." That **didn't work** for this investigation. Three failure modes:

1. **Vitest's default reporter suppresses test stdout for passing tests.** `console.log` calls inside test bodies were swallowed even on the very first run. Failing-test stdout did surface, but only in the failure report.
2. **Puppeteer's `WebWorker` class has no `console` listener.** `worker.on("console", ...)` is silently a no-op for ServiceWorker targets. SW probe output stayed in the SW devtools panel.
3. **CDP-based `Runtime.consoleAPICalled` capture worked sometimes, didn't work other times.** Async race between attach + first console call.

So we ended up needing a **deterministic, side-effect-free probe channel**. The solution:

## The pattern — storage-based probes

```ts
// packages/extension/src/wallet/utils/probe.ts (deleted on strip)

declare const __VERSION__: string

export const E2E_PROBE_ENABLED: boolean = import.meta.env.VITE_E2E_PROBE === "1"

const PROBE_KEY_PREFIX = "nulo:probe:"
let probeCounter = 0

export function probe(boundary: string, payload: Record<string, unknown> = {}): void {
  if (!E2E_PROBE_ENABLED) return
  const rec = { b: boundary, t: Date.now(), ...payload }
  console.log(`[PROBE]${JSON.stringify(rec)}`)
  if (typeof chrome === "undefined" || !chrome.storage?.local) return
  // Unique key per call avoids read-modify-write races between concurrent probes.
  probeCounter += 1
  const key = `${PROBE_KEY_PREFIX}${rec.t}:${probeCounter}:${Math.random().toString(36).slice(2, 6)}`
  void chrome.storage.local.set({ [key]: rec }).catch(() => {})
}

export function hashSid(sessionId: string | undefined | null): string {
  if (!sessionId) return "none"
  return sessionId.slice(0, 6)
}
```

Test-side dump helper:

```ts
// packages/extension/tests/e2e/fixtures/helpers.ts (deleted on strip)

import { appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export async function dumpProbes(page: Page, label = "probes"): Promise<void> {
  if (process.env.VITE_E2E_PROBE !== "1") return
  const runId = process.env.NULO_PROBE_RUN_ID ?? String(process.pid)
  const path = join(tmpdir(), `nulo-probes-${runId}.jsonl`)
  const probes = (await page.evaluate(async () => {
    const all = (await chrome.storage.local.get(null)) as Record<string, unknown>
    const records: unknown[] = []
    const keys: string[] = []
    for (const k of Object.keys(all)) {
      if (k.startsWith("nulo:probe:")) {
        records.push(all[k])
        keys.push(k)
      }
    }
    if (keys.length > 0) await chrome.storage.local.remove(keys)
    return records
  })) as Array<{ t?: number } & Record<string, unknown>>
  probes.sort((a, b) => (a?.t ?? 0) - (b?.t ?? 0))
  appendFileSync(path, `# ${new Date().toISOString()} label=${label} count=${probes.length}\n`)
  for (const p of probes) appendFileSync(path, `${JSON.stringify(p)}\n`)
  process.stderr.write(`[DUMP-${label}] wrote ${probes.length} records to ${path}\n`)
}
```

## Why this pattern survives the failure modes above

- **Vitest stdout suppression**: doesn't matter, dump goes to a tmpfile directly via `appendFileSync`.
- **SW console listener gaps**: doesn't matter, probes write to `chrome.storage.local` which the test reads via `page.evaluate`. Works regardless of console capture status.
- **Concurrent probe writes**: unique per-call keys avoid the read-modify-write race between probes. Tests read with `get(null)` then filter, then clear.

## How to use it

Wire probes at suspected boundaries:

```ts
// Inside the SW or popup code:
if (E2E_PROBE_ENABLED) probe("BCH-RECV", { sidH: hashSid(s), method, messageId })
```

The `if` guard at the call site lets Vite/esbuild dead-code-eliminate the entire `probe(...)` call when `VITE_E2E_PROBE` is unset. Bundle-grep in CI verifies (planned, not yet wired).

Wire on-failure dump in a fixture helper that wraps a critical path:

```ts
try {
  await criticalPathThatMightHang(page)
} catch (err) {
  if (probeEnabled) await dumpProbes(page, `${critical-path}-fail`)
  throw err
}
```

Set the env in `agent.sh`:

```sh
VITE_E2E_PROBE=1 bun run build:chrome
...
VITE_E2E_PROBE=1 ... bun run vitest run --config vitest.e2e.network.config.ts
```

Cat the resulting JSONL file at `$TMPDIR/nulo-probes-<runId>.jsonl`. Each line is one probe record:

```json
{"b":"BCH-RECV","t":1779460095491,"sidH":"3e4fdf","method":"requestCapabilities","queueDepth":0}
```

## Boundaries probed during this investigation

(All deleted on strip, but the pattern survives.)

| Probe | Where |
|---|---|
| PG-OUT / PG-IN | `playground/src/lib/log.ts` (dApp side) |
| BCH-RECV, BCH-DECRYPT-IN/OUT, BCH-SESSION-LOOKUP-MISS, BCH-SEND, BCH-SEND-WIRE | `extension/src/wallet/services/wallet-sdk/background.ts` |
| SESSION-EST / SESSION-TERM | same file |
| WB-IN / WB-OUT | `wallet-bridge/src/dispatcher.ts` |
| DI-CAP-OPEN / DI-CAP-SETTLE | `extension/src/wallet/services/dapp-interaction/service.ts` |
| CAP-APPROVE | `extension/src/popup/windows/capabilities/index.vue` |
| EXEC-IN / EXEC-OUT | `extension/src/wallet/services/execution/service.ts` |
| WATCH-IN / WATCH-OUT / WATCH-AFTER-GET / WATCH-ENSURE | `extension/src/popup/app.vue` (the watcher whose silence revealed the race) |
| ACCT-ENSURE-*, ACCOUNT-NEW-* | `extension/src/wallet/services/account/service.ts` |
| SW-LIFECYCLE | `extension/src/wallet/index.ts` (chrome.runtime.onStartup/onSuspend) |
| SWITCH-IN/HDR/ACTIVE | `tests/e2e/fixtures/helpers.ts` (test-side) |

## What I'd do differently next time

- **Wire probes BEFORE writing the consolidated plan.** Probe data invalidated the plan's hypothesis tree. If I'd done it first, the plan would have been much smaller and right.
- **Probe storage > probe console.** Don't even bother with `console.log` + listener forwarding. Just go straight to storage-based dump.
- **Unique per-call keys.** I burned an hour on read-modify-write races with a single-key append. Per-call random suffix is one line of code and zero contention.
- **Test the probes pass through to dump BEFORE adding probes to product code.** A no-op smoke test of "does dumpProbes return anything when I write a single probe?" would have caught the console-vs-storage architecture issue an hour earlier.
