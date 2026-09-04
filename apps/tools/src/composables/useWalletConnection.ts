import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { DripperContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Dripper.js"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import {
	HUB,
	HUB_ARTIFACT,
	HUB_TOKEN_ARTIFACT,
	MANIFEST_TOKENS,
	rebuildHubInstance,
	rebuildHubTokenInstance,
} from "@/contracts/bridge-generation"
import { DRIPPER, NULO, OLUN, rebuildDripperInstance, rebuildNuloInstance, rebuildOlunInstance } from "@/contracts/deployments"
import { getPrivateFpc } from "@/contracts/private-fpc"
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import { watch } from "vue"
import { buildCombinedManifest } from "@/lib/capabilities"
import type { TokenWords } from "@/lib/send-model"
import { createAztecWalletSession } from "./createAztecWalletSession"
import { opsInFlight } from "./useOpsInFlight"
import { useToast } from "./useToast"

const APP_ID = "nulo-tools"
/** The app id before the tools rename; its stored wallet/account choices are still honoured. */
const LEGACY_APP_ID = "nulo-faucet"

/** A hub Token the app has asked the wallet for: enough to re-derive its instance for registration. */
export interface RequestedHubToken {
	/** Lowercase — the key of the requested set. */
	readonly l2Token: string
	readonly erc20: string
	readonly words: TokenWords
	readonly decimals: number
}

/** Every hub Token this app has asked to be granted, keyed by lowercase L2 address. An approval
 *  replaces the stored grant wholesale, so each request must carry the WHOLE set or the previously
 *  granted tokens silently lose their scopes. Insertion order IS recency: a re-request re-inserts. */
const requestedTokens = new Map<string, RequestedHubToken>()

/** Tokens a journal record depends on. They are never evicted: losing one costs a resumed lane its
 *  grant, where losing a browsed one costs at most one more prompt. */
const pinnedTokens = new Set<string>()

/** The wallet truncates the list it grants, so an unbounded set eventually asks for more than can
 *  come back — and a token missing from the answer re-prompts forever. Browsing is what grows
 *  without limit, so only browsed tokens are capped, oldest request first to go. */
const MAX_BROWSED_TOKENS = 32

/** Record a hub Token the app needs granted + registered. Idempotent; the next capability request
 *  (a fresh connect, or `retryCapabilities`) carries it. `pinned` marks a token the journal holds. */
export function requestHubToken(token: RequestedHubToken, opts: { pinned?: boolean } = {}): void {
	const l2Token = token.l2Token.toLowerCase()
	if (opts.pinned) pinnedTokens.add(l2Token)
	// Delete-then-set even for a known token: the map's order is the eviction order.
	requestedTokens.delete(l2Token)
	requestedTokens.set(l2Token, { ...token, l2Token })
	const browsed = [...requestedTokens.keys()].filter((key) => !pinnedTokens.has(key))
	// Clamped: a negative end index would make `slice` trim from the front while still under the cap.
	for (const key of browsed.slice(0, Math.max(0, browsed.length - MAX_BROWSED_TOKENS))) requestedTokens.delete(key)
}

/** Drop a hub Token from the requested set: the next capability request stops carrying it, and a
 *  pinned one loses its pin. */
export function forgetHubToken(l2Token: string): void {
	const key = l2Token.toLowerCase()
	requestedTokens.delete(key)
	pinnedTokens.delete(key)
}

/**
 * Re-derive the pinned set from what the journal still holds. A pin exists to stop browsing from
 * evicting a token a record needs; once that record is discarded or cleared the pin outlives its
 * reason, and every later capability request keeps asking the wallet for a token nothing wants.
 * Manifest tokens are never dropped — they are granted from the first connect and are not the
 * journal's to give up.
 */
export function retainPinnedHubTokens(needed: Iterable<string>): void {
	const keep = new Set(MANIFEST_TOKENS.map((t) => t.l2Token.toLowerCase()))
	for (const l2Token of needed) keep.add(l2Token.toLowerCase())
	for (const key of [...pinnedTokens]) if (!keep.has(key)) forgetHubToken(key)
}

export function requestedHubTokens(): readonly RequestedHubToken[] {
	return [...requestedTokens.values()]
}

/** The manifest's tokens plus everything the app has asked for, deduped, in that order. */
function grantedTokenAddresses(): AztecAddress[] {
	const seen = new Set<string>()
	const addresses: AztecAddress[] = []
	for (const raw of [...MANIFEST_TOKENS.map((t) => t.l2Token), ...requestedTokens.keys()]) {
		const key = raw.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		addresses.push(AztecAddress.fromStringUnsafe(raw))
	}
	return addresses
}

async function buildCapabilityManifest() {
	const sponsoredFpc = await getSponsoredFpcInstance()
	// The drip tokens (Dripper/NULO/OLUN) are universal deploys (deployer ZERO, fixed salts), so
	// the SAME addresses exist on BOTH networks — the grant includes them everywhere. The PrivateFPC +
	// FEE_JUICE + auth-registry grants keep private fuel and private-fuel-paid claims working.
	// The FPC is registered on both networks, so both grants must include it.
	return buildCombinedManifest({
		hub: HUB,
		hubTokens: grantedTokenAddresses(),
		sponsoredFpcAddress: sponsoredFpc.address,
		dripperAddress: DRIPPER,
		usdcAddress: NULO,
		ethAddress: OLUN,
	})
}

/** The hub and every hub Token the grant covers — the manifest's and the ones the app asked for. A
 *  manifest token is granted from the first connect and never re-prompted, so this is the only
 *  place its instance reaches the wallet. Nothing on a placeholder network. */
async function registerHubContracts(w: Wallet): Promise<void> {
	if (!HUB) return
	await w.registerContract(await rebuildHubInstance(), HUB_ARTIFACT)
	const seen = new Set<string>()
	const manifestTokens = MANIFEST_TOKENS.map((t) => ({
		l2Token: t.l2Token,
		erc20: t.erc20,
		words: { nameWord: t.nameWord as `0x${string}`, symbolWord: t.symbolWord as `0x${string}` },
		decimals: t.decimals,
	}))
	for (const token of [...manifestTokens, ...requestedHubTokens()]) {
		const key = token.l2Token.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		const instance = await rebuildHubTokenInstance(token.erc20, {
			nameWord: token.words.nameWord,
			symbolWord: token.words.symbolWord,
			decimals: token.decimals,
		})
		await w.registerContract(instance, HUB_TOKEN_ARTIFACT)
	}
}

async function registerAllContracts(w: Wallet): Promise<void> {
	// The Drip tab's Dripper/NULO/OLUN exist on both networks (universal deploys — identical addresses
	// per salt+args).
	const [dripperInst, nuloInst, olunInst] = await Promise.all([rebuildDripperInstance(), rebuildNuloInstance(), rebuildOlunInstance()])
	await w.registerContract(dripperInst, DripperContractArtifact)
	await w.registerContract(nuloInst, TokenContractArtifact)
	await w.registerContract(olunInst, TokenContractArtifact)
	await registerHubContracts(w)
	// The PrivateFPC must be pre-registered so the no-fuel-claim gate's private Fee-Juice balance read
	// resolves: the wallet only auto-registers it when a tx uses it as fee payer, which is too late for
	// the pre-claim read. See @/contracts/private-fpc.
	const { instance: privateFpcInst, artifact: privateFpcArtifact } = await getPrivateFpc()
	await w.registerContract(privateFpcInst, privateFpcArtifact)
}

// Module-level singleton - ONE Aztec session shared by both the Drip and Bridge tabs. The two tabs
// are the same origin = the same app to the wallet, so a single combined manifest is granted once;
// connect on either tab and the other inherits the connection + the full grant (no second prompt).
const session = createAztecWalletSession({
	appId: APP_ID,
	legacyAppId: LEGACY_APP_ID,
	buildManifest: buildCapabilityManifest,
	registerContracts: registerAllContracts,
	// The mutation-boundary switch gate: selectAccount() rejects while any account-sensitive
	// operation (drip / deposit / withdraw / fuel / add-token / journal continuation) is in
	// flight — the UI's disabled rows are UX on top, not the enforcement (plan D-18).
	isSwitchBlocked: opsInFlight,
})

// Single owner of selection notices → toasts (plan D-25/D-29). The session pushes explicit
// one-shot notices (auto-remembered selection, grant truncation); this MODULE — one instance,
// unlike the three always-mounted panels — drains them exactly once. Panels never infer these
// from status changes.
function shortAddr(address: string): string {
	return `${address.slice(0, 6)}…${address.slice(-4)}`
}
watch(session.selectionNotices, (list) => {
	if (list.length === 0) return
	// useToast resolved lazily INSIDE the callback: calling it at module init would run before
	// test files' mock fixtures are initialized (hoisted vi.mock factories + TDZ).
	const { push } = useToast()
	for (const notice of session.consumeSelectionNotices()) {
		if (notice.kind === "auto-remembered") {
			const label = notice.alias || (notice.address ? shortAddr(notice.address) : "")
			push({ kind: "info", text: `Using account ${label}` })
		} else if (notice.kind === "grant-truncated") {
			push({
				kind: "info",
				text: `Your wallet granted more accounts than the app can show — using the first ${session.accounts.value.length} (${notice.hiddenCount} hidden).`,
			})
		}
	}
})

/** Switch the active account WITH user-visible feedback — the one path every UI surface uses
 *  (AccountSwitcher rows, journal-card switch actions), so gating and toast copy stay
 *  consistent. Returns whether the switch applied (false: busy-blocked / not granted / not
 *  connected). */
export function switchActiveAccount(address: string): boolean {
	const applied = session.selectAccount(address)
	if (applied) {
		const acct = session.accounts.value.find((a) => a.address === address)
		const label = acct?.alias || `${address.slice(0, 6)}…${address.slice(-4)}`
		useToast().push({ kind: "ok", text: `Active account: ${label}` })
	}
	return applied
}

export function useWalletConnection() {
	return session
}

/** Test-only: clear state between cases. */
export function __resetWalletConnectionForTests(): void {
	requestedTokens.clear()
	pinnedTokens.clear()
	session.reset()
}

export { extractGrantedAccounts, parseGrantedAccounts, parseGrantedContracts } from "./createAztecWalletSession"
export type { ConnectStatus, DiscoveredWallet, GrantedAccount, ParsedGrantedAccounts, SelectionNotice } from "./createAztecWalletSession"
