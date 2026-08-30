import type { DefaultTokenSeed } from "@/wallet/services/token/default-tokens"

/**
 * Storage key the e2e seed source reads. A test writes the sandbox token it
 * just deployed; the seeder then treats that as its entire seed list. Exported
 * so e2e fixtures import the exact literal — `_build-extension.yml` also greps
 * production builds to assert this string is ABSENT.
 */
export const TOKEN_SEEDS_KEY = "nulo:e2e:token-seeds"

/**
 * The sandbox token's symbol is fixed by the e2e fixture
 * (`tests/e2e/fixtures/aztec.ts` deploys "TestToken"/"TST"), so it is pinned
 * HERE rather than accepted from storage: the address is the only field a test
 * genuinely cannot know before the per-run deploy.
 */
const SANDBOX_SYMBOL = "TST"

/** Sandbox chain id. A seed for any other chain is rejected outright — an
 *  armed build must never be able to inject against a real network. */
const SANDBOX_CHAIN_ID = 0

/** Aztec field elements as this repo writes them: 0x + 64 lowercase hex. */
const FIELD_RE = /^0x[0-9a-f]{64}$/

/**
 * Reads the e2e seed list from `chrome.storage.session`.
 *
 * Armed builds REPLACE the production list with this, so an absent or
 * malformed blob yields an empty list — never a fallback to
 * `DEFAULT_TOKEN_SEEDS`. That is what keeps the e2e suites off the public RPC
 * endpoints the real seeds point at.
 *
 * The blob is attacker-shaped by construction (any trusted extension page can
 * write session storage), so it is validated to exactly one sandbox-chain
 * entry with canonical field shapes. The seeder's own TOFU pin checks then run
 * unchanged on whatever survives. The real production control is that this
 * module is absent from shipped bundles — see `config.ts`'s
 * `E2E_TOKEN_SEEDS` and the negative grep in `_build-extension.yml`.
 */
export class ChromeStorageTokenSeeds {
	public async get(): Promise<readonly DefaultTokenSeed[]> {
		let raw: unknown
		try {
			raw = (await chrome.storage.session.get(TOKEN_SEEDS_KEY))[TOKEN_SEEDS_KEY]
		} catch {
			return []
		}
		if (!Array.isArray(raw) || raw.length !== 1) return []
		const entry = raw[0] as Partial<DefaultTokenSeed> | null
		if (!entry || typeof entry !== "object") return []
		if (entry.chainId !== SANDBOX_CHAIN_ID) return []
		if (typeof entry.contract !== "string" || !FIELD_RE.test(entry.contract)) return []
		if (typeof entry.expectedClassId !== "string" || !FIELD_RE.test(entry.expectedClassId)) return []
		return [
			{
				chainId: SANDBOX_CHAIN_ID,
				contract: entry.contract,
				expectedClassId: entry.expectedClassId,
				expectedSymbol: SANDBOX_SYMBOL,
			},
		]
	}
}
