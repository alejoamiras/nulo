import networkConfig from "./vitest.e2e.network.config"

/**
 * Feasibility probes for a second browser. They need the full network stack, so everything but
 * the file list comes from the network config — a probe answered under different settings would
 * not be evidence about the suite it is meant to predict.
 *
 * Their own directory keeps them out of every Chrome shard's glob, and `retry: 0` is the point:
 * a capability that only appears on the second attempt is not a capability.
 */
export default {
	...networkConfig,
	test: { ...networkConfig.test, include: ["tests/e2e/probes/*.test.ts"], retry: 0 },
}
