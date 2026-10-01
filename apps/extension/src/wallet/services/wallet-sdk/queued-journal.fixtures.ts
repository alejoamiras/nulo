/** A real journal over a fake browser, and the service stubs the arrival check reads. Test-only. */
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { vi } from "vitest"
import type { ActiveSession } from "@aztec-labs/wallet-sdk/extension/handlers"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import type { TryCreateQueuedJournalDeps } from "./queued-journal"

export function makeSession(sessionId = "session-A"): ActiveSession {
	return {
		sessionId,
		origin: "https://example.test",
		chainInfo: { chainId: "0x539", version: "0x1" },
	} as unknown as ActiveSession
}

export function makeDeps(overrides: Partial<TryCreateQueuedJournalDeps> = {}): {
	deps: TryCreateQueuedJournalDeps
	journal: OperationJournalService
	api: FakeBrowserApi
	profile: ReturnType<typeof makeProfileStub>
	dappSession: ReturnType<typeof makeDappSessionStub>
	networkSvc: ReturnType<typeof makeNetworkStub>
} {
	const api = new FakeBrowserApi()
	api.reset()
	const logger = new LoggerStore(new ConfigStore())
	const journal = new OperationJournalService(logger, api)
	const services = new ServiceCollection()
	services.add(journal)
	void services.start()

	const profile = makeProfileStub()
	const dappSession = makeDappSessionStub()
	const networkSvc = makeNetworkStub()
	const account = makeAccountStub()

	const deps: TryCreateQueuedJournalDeps = {
		journal,
		profile: profile as never,
		dappSession: dappSession as never,
		networkSvc: networkSvc as never,
		account: account as never,
		stampedProfileId: "profile-1",
		logger,
		...overrides,
	}
	return { deps, journal, api, profile, dappSession, networkSvc }
}

export function makeProfileStub() {
	return {
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		getActiveProfile: vi.fn<() => Promise<any>>(async () => ({ id: "profile-1" })),
		// The creator captures the deletion epoch alongside the profile and
		// threads it into the journal's create fence.
		getDeletionState: vi.fn(() => ({ capture: (_id: string) => 0 })),
	}
}

export function makeDappSessionStub(opts: { name?: string | null } = { name: "Example Dapp" }) {
	// `null` distinguishes "explicitly omit dappMetadata" from "default name" —
	// passing `undefined` would trigger the default parameter, so callers must
	// pass `{ name: null }` to simulate a session created before dappMetadata
	// was populated.
	const metadata = opts.name === null ? undefined : { name: opts.name }
	return {
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		tryGetDappSessionByOriginAndChain: vi.fn<() => Promise<any>>(async () => ({
			accounts: ["aztec:1338:0xabc"],
			capabilityGrants: [{ capability: { type: "transaction" } }, { capability: { type: "accounts" } }],
			dappMetadata: metadata,
		})),
	}
}

/** Wallet order is index-sorted, exactly as `AccountService.getAccounts` returns. */
export function makeAccountStub(addresses: string[] = ["0xabc"]) {
	return {
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		getAccounts: vi.fn<() => Promise<any[]>>(async () => addresses.map((address, index) => ({ address, index }))),
	}
}

export function makeNetworkStub() {
	return {
		// The anchored read: profileId-explicit, never the live active profile.
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		getNetworksRaw: vi.fn<(profileId: string, chainId?: number) => Promise<any[]>>(async () => [
			{ id: "network-row-1", chainId: 1338 },
		]),
	}
}
