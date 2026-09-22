/**
 * A service graph just deep enough to boot the SDK handler in a unit test. The dApp-session rows
 * are what discovery admission and establishment read: a remembered row auto-approves its origin
 * and, when trusted, establishes without a verify window.
 */
import { EventHandler } from "@nulo/wallet-core/utils"

export const FAKE_DAPP_ORIGIN = "https://dapp.example"

export type FakeDappSessionRow = { id: string; profileId: string; trustedVerification: boolean }

export function fakeSdkServices(
	opts: {
		/** A row for the origin on chain 0 (the `{ chainId: "1", version: "1" }` the tests discover with). */
		remembered?: { trusted: boolean }
		popup?: () => Promise<{ approved: boolean }>
		legal?: () => Promise<void>
	} = {},
): { services: never; rows: Map<string, FakeDappSessionRow> } {
	const rows = new Map<string, FakeDappSessionRow>()
	if (opts.remembered) rows.set(`${FAKE_DAPP_ORIGIN}|0`, { id: "row-1", profileId: "p1", trustedVerification: opts.remembered.trusted })
	const services = {
		get: (name: string) =>
			({
				network: {},
				account: {},
				execution: {},
				profile: { onActiveProfileChanged: new EventHandler<unknown>(), getActiveProfile: async () => ({ id: "p1" }) },
				"dapp-interaction": { discover: opts.popup ?? (async () => ({ approved: true })) },
				"dapp-session": {
					onDappSessionDeleted: new EventHandler<unknown>(),
					tryGetDappSessionByOriginAndChain: async (origin: string, chainId: string) => rows.get(`${origin}|${chainId}`),
					addDappSession: async (_m: unknown, _p: unknown, _a: unknown, _l: unknown, chainId: string) => {
						const row = { id: `row-${rows.size + 1}`, profileId: "p1", trustedVerification: false }
						rows.set(`${FAKE_DAPP_ORIGIN}|${chainId}`, row)
						return row
					},
					setCapabilityGrants: async () => undefined,
					deleteDappSession: async () => undefined,
					setVerificationHash: async () => undefined,
				},
				"operation-journal": {},
				token: { getTokens: async () => [] },
				"legal-acceptance": { assertCurrent: opts.legal ?? (async () => undefined) },
			})[name],
	} as never
	return { services, rows }
}
