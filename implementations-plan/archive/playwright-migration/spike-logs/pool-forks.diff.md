# pool=forks experiment edit

File: `packages/extension/vitest.e2e.network.config.ts`

## What this isolates

Adds `pool: "forks"` + `singleFork: false` + `isolate: true` (matching what
smoke config already does at `vitest.e2e.config.ts:28-33`).

Each network test FILE runs in its own forked Node worker process. Process-side
state (memory, FD pressure, vitest module cache) cannot leak across files.

The shared Aztec sandbox is untouched (it runs as a child process spawned by
globalSetup; all workers connect to the same sandbox URL). So this experiment
specifically tests whether host-side process state — NOT browser state, NOT
sandbox state — is the cumulative-load mechanism.

## Patch

```ts
import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    test: {
        include: ["tests/e2e/network/**/*.test.ts"],
        environment: "node",
        globalSetup: "./tests/e2e/global-setup.ts",
        testTimeout: 30_000,
        hookTimeout: 300_000,
        fileParallelism: false,
        // SPIKE: process isolation per file. Matches smoke config pattern.
        pool: "forks",
        poolOptions: {
            forks: { singleFork: false, isolate: true },
        },
        server: {
            deps: {
                inline: [/@aztec/],
            },
        },
    },
})
```
