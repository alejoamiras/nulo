// Long enough that the soak tool's timeout (8 s in cli.test.ts) fires first; short enough that a
// tool bug cannot leave this fixture running for long.
export default { test: { include: ["*.fixture.ts"], environment: "node", pool: "forks", testTimeout: 30_000 } }
