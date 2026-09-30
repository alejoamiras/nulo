/**
 * A service graph just deep enough to boot the SDK handler in a unit test. The dApp-session rows
 * are what discovery admission and establishment read: a remembered row auto-approves its origin
 * and, when trusted, establishes without a verify window. A row given `FAKE_SENDER`'s account and a
 * transaction grant lets an established session's `sendTx` reach the journal and the dispatcher.
 */
import { EventHandler } from "@nulo/wallet-core/utils"

export const FAKE_DAPP_ORIGIN = "https://dapp.example"
export const FAKE_SENDER = "0x01"

export type FakeDappSessionRow = {
	id: string
	profileId: string
	trustedVerification: boolean
	accounts?: string[]
	capabilityGrants?: Array<{ capability: { type: string } }>
}

export function fakeSdkServices(
	opts: {
		/** A row for the origin on chain 0 (the `{ chainId: "1", version: "1" }` the tests discover with). */
		remembered?: { trusted: boolean }
		popup?: (params: unknown, requestId: string) => Promise<{ approved: boolean; windowId?: number }>
		legal?: () => Promise<void>
		/** What `getActiveProfile` answers; `p1` by default. */
		activeProfile?: () => Promise<{ id: string } | undefined>
		/** The approval's second durable write; resolves at once by default. */
		setCapabilityGrants?: () => Promise<unknown>
		/** The operation journal; empty by default. */
		operationJournal?: Record<string, unknown>
	} = {},
): { services: never; rows: Map<string, FakeDappSessionRow> } {
	const rows = new Map<string, FakeDappSessionRow>()
	let rowSeq = 0
	const getActiveProfile = opts.activeProfile ?? (async () => ({ id: "p1" }))
	if (opts.remembered)
		rows.set(`${FAKE_DAPP_ORIGIN}|0`, { id: `row-${++rowSeq}`, profileId: "p1", trustedVerification: opts.remembered.trusted })
	const services = {
		get: (name: string) =>
			({
				network: { getNetworksRaw: async () => [{ id: "net-1" }] },
				account: { getAccounts: async () => [{ address: FAKE_SENDER }] },
				execution: { beginQueuedWait: () => {}, endQueuedWait: () => {} },
				profile: {
					onActiveProfileChanged: new EventHandler<unknown>(),
					getActiveProfile,
					getDeletionState: () => ({ capture: () => 0 }),
					captureExecutionFence: async () => {
						const profile = await getActiveProfile()
						if (!profile) throw new Error("Wallet locked")
						return { profileId: profile.id, epoch: 0, session: 1 }
					},
				},
				"dapp-interaction": { discover: opts.popup ?? (async () => ({ approved: true })) },
				"dapp-session": {
					onDappSessionDeleted: new EventHandler<unknown>(),
					tryGetDappSessionByOriginAndChain: async (origin: string, chainId: string) => rows.get(`${origin}|${chainId}`),
					addDappSession: async (metadata: { url: string }, _p: unknown, _a: unknown, _l: unknown, chainId: string) => {
						const row = { id: `row-${++rowSeq}`, profileId: "p1", trustedVerification: false }
						rows.set(`${metadata.url}|${chainId}`, row)
						return row
					},
					setCapabilityGrants: opts.setCapabilityGrants ?? (async () => undefined),
					deleteDappSession: async (id: string) => {
						for (const [key, row] of rows) if (row.id === id) rows.delete(key)
					},
					setVerificationHash: async () => undefined,
				},
				"operation-journal": opts.operationJournal ?? {},
				token: { getTokens: async () => [] },
				"legal-acceptance": { assertCurrent: opts.legal ?? (async () => undefined) },
			})[name],
	} as never
	return { services, rows }
}
