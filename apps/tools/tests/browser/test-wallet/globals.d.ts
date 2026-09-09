import type { Seed, TestWalletIdentity, TestWalletProfile } from "./profile"

/** The suite's control surface, reached through the wallet frame. */
export interface TestWalletControl {
	profile: TestWalletProfile
	ready: () => Promise<void>
	addAccount: (secret: `0x${string}`, salt?: string) => Promise<string>
	accounts: () => Promise<string[]>
	/** How many times each wallet method was called since this frame loaded (`sendTx`, `createAuthWit`, …). */
	calls: () => Record<string, number>
	/** Fault injection: the next `method` call whose serialized arguments contain `pattern` (any
	 *  call when omitted) rejects with `message` instead of running — one shot. */
	failNext: (method: string, pattern?: string, message?: string) => void
	/** The next capability prompt grants no contract scope — a declined token grant. One shot. */
	declineNextGrant: () => Promise<void>
}

declare global {
	/** Baked by `vite.config.mts` from the sandbox run's artifacts. */
	const __NULO_TEST_WALLET__: TestWalletIdentity
	interface Window {
		__nuloTestWallet?: TestWalletControl
		/** Set by the suite's context init script before any page script runs. */
		__nuloTestWalletSeeds?: Seed[]
	}
}
