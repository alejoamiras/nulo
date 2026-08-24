// A huge per-test timeout so vitest itself never gives up: the soak tool's timeout must.
export default { test: { include: ["*.fixture.ts"], environment: "node", pool: "forks", testTimeout: 600_000 } }
