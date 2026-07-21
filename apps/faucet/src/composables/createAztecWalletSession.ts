// Patch WalletSchema before wallet-sdk reads it (Nulo-custom `registerToken`).
// Must be the first import in this module - see @nulo/wallet-sdk-schema-patch.
import "@nulo/wallet-sdk-schema-patch/register"

import type { Wallet } from "@aztec/aztec.js/wallet"
import { WalletManager } from "@aztec/wallet-sdk/manager"
import type { PendingConnection, WalletProvider } from "@aztec/wallet-sdk/manager"
import { ref, shallowRef } from "vue"
import { readChainInfo } from "@/lib/chain-info"
import { hashToEmoji } from "@/lib/emoji"
import { type NormalizedError, normalizeError } from "@/lib/errors"

export type ConnectStatus = "idle" | "discovering" | "choosing" | "verifying" | "capability-approval" | "setting-up" | "connected" | "error"

export interface GrantedAccount {
	readonly address: string
	readonly alias: string
}

/**
 * A plain-data projection of a discovery announcement, safe for reactive state. `key` is an
 * opaque per-announcement counter — NOT the provider's claimed `id`: any wallet can claim any
 * id/name/icon, so claimed-id collisions render as separate rows instead of deduping the
 * impostor (or the real wallet) away.
 */
export interface DiscoveredWallet {
	readonly key: number
	readonly id: string
	readonly name: string
	readonly type: string
	readonly icon?: string
}

/** Remembered choice: id selects the auto-reconnect candidate, name feeds the idle-state label. */
interface PreferredWallet {
	readonly id: string
	readonly name: string
}

/** Bounded collision-detection window for the remembered path (best-effort — see plan). */
const REMEMBERED_AMBIGUITY_WINDOW_MS = 1_000

/** The stored name is rendered in the idle hint — cap it at WRITE time so a
 *  multi-megabyte claimed name can't defeat the picker's render capping. */
const PREFERRED_NAME_MAX = 48

/** Code-point-safe bounded truncation: a UTF-16 `slice` can split an emoji
 *  surrogate pair in a claimed wallet name. Shared by the picker's display
 *  capping and the persisted-name capping. */
export function truncateName(name: string, max: number): string {
	const points = Array.from(name)
	return points.length > max ? `${points.slice(0, max).join("")}…` : name
}

/**
 * Per-feature config for an Aztec wallet session. The faucet and the bridge each create ONE
 * session (a module-level singleton) with their own appId, capability manifest, and contract
 * registration - the codex finding: two independent sessions, not one shared connection.
 */
export interface AztecWalletSessionConfig {
	readonly appId: string
	/** Build the wallet-sdk capability manifest at connect time (async - needs the SponsoredFPC). */
	// biome-ignore lint/suspicious/noExplicitAny: SDK manifest type is zod-inferred, not exported usably.
	readonly buildManifest: () => Promise<any>
	/** Register the feature's contracts with the wallet's PXE after capabilities are granted. */
	readonly registerContracts: (wallet: Wallet) => Promise<void>
}

/**
 * Create an Aztec wallet session: discover → choose (picker) → verify (emoji match) → request
 * capabilities → register contracts → connected. Returns reactive state + the connection
 * methods. Call ONCE per feature at module scope (singleton) - `useWalletConnection` /
 * `useBridgeWallet` wrap it.
 *
 * Concurrency model: a single flow epoch. Every async continuation captures the epoch AND the
 * session handles (provider/pending/wallet) it operates on; cancel/disconnect/dismiss bump the
 * epoch and wipe state SYNCHRONOUSLY before any awaited SDK teardown, so a newer flow can never
 * be clobbered by an older one's cleanup. A stale continuation discards its result AND undoes
 * its own SDK side effects via its CAPTURED handles (never the mutable session fields — those
 * may already belong to a newer flow).
 */
export function createAztecWalletSession(config: AztecWalletSessionConfig) {
	// Declared before the reactive state: `preferredWalletName`'s initializer
	// calls `readPreferred()`, which reads this (a TDZ here silently nulls the
	// initial name — the ReferenceError is swallowed by the best-effort catch).
	const storageKey = `${config.appId}:preferred-wallet`

	const status = ref<ConnectStatus>("idle")
	const verificationEmojis = ref<string | null>(null)
	const accounts = ref<GrantedAccount[]>([])
	const selectedAccount = ref<string | null>(null)
	const error = ref<NormalizedError | null>(null)
	// shallowRef: the SDK wallet handle must not be deep-proxied (same rationale as the balance
	// handles - deep reactivity over a class instance is waste and can break identity checks).
	const wallet = shallowRef<Wallet | null>(null)

	const discoveredWallets = ref<DiscoveredWallet[]>([])
	/** True while the discovery stream is live (drives the picker's "scanning" hint). */
	const scanning = ref(false)
	/** The picker modal's visibility — opened IMMEDIATELY on a fresh connect
	 *  (before any wallet answers: discovery approval in a wallet can gate the
	 *  first announcement, and the user must see the scan happening, not a
	 *  frozen button). The remembered path keeps it closed unless it falls
	 *  back to a choice. */
	const pickerOpen = ref(false)
	const preferredWalletName = ref<string | null>(readPreferred()?.name ?? null)

	let provider: WalletProvider | null = null
	let pending: PendingConnection | null = null
	let cancelDiscovery: (() => void) | null = null
	let unsubscribeDisconnect: (() => void) | null = null

	// Provider objects carry methods + a MessagePort — they must never enter reactive state.
	const providersByKey = new Map<number, WalletProvider>()
	let nextKey = 0

	// Flow epoch + owning token. `activeFlowEpoch` is the epoch that OWNS the in-flight flow —
	// a stale flow's cleanup releases the lock only if it still owns it, so it can never free a
	// newer flow's.
	let epoch = 0
	let activeFlowEpoch: number | null = null

	// Collision handling: once two announcements claim the remembered id, auto-reconnect stays
	// off until the page reloads — re-running discovery cannot un-ambiguate a spoofed identity.
	/** Sticky for the session after a remembered-id collision: reactive so the
	 *  UI can stop promising "Connect <name>" once auto-reconnect is off. */
	const autoReconnectDisabled = ref(false)
	// True while the in-flight connect chain was entered via the remembered path — its failures
	// clear the stored preference so one bad auto-path can't lock the user out of the picker.
	let connectingViaRemembered = false
	let ambiguityTimer: ReturnType<typeof setTimeout> | null = null

	function readPreferred(): PreferredWallet | null {
		try {
			const raw = localStorage.getItem(storageKey)
			if (!raw) return null
			const parsed: unknown = JSON.parse(raw)
			if (typeof parsed !== "object" || parsed === null) return null
			const { id, name } = parsed as { id?: unknown; name?: unknown }
			if (typeof id !== "string" || typeof name !== "string") return null
			return { id, name: truncateName(name, PREFERRED_NAME_MAX) }
		} catch {
			return null
		}
	}
	function writePreferred(value: PreferredWallet): void {
		const capped = { id: value.id, name: truncateName(value.name, PREFERRED_NAME_MAX) }
		try {
			localStorage.setItem(storageKey, JSON.stringify(capped))
		} catch {
			// Best-effort: a throwing storage must never affect an established session.
		}
		preferredWalletName.value = capped.name
	}
	function clearPreferred(): void {
		try {
			localStorage.removeItem(storageKey)
		} catch {
			// best-effort
		}
		preferredWalletName.value = null
	}

	function isStale(flowEpoch: number): boolean {
		return flowEpoch !== epoch
	}
	function releaseFlowIfOwner(flowEpoch: number): void {
		if (activeFlowEpoch === flowEpoch) activeFlowEpoch = null
	}
	function clearAmbiguityTimer(): void {
		if (ambiguityTimer !== null) {
			clearTimeout(ambiguityTimer)
			ambiguityTimer = null
		}
	}
	function stopDiscovery(): void {
		try {
			cancelDiscovery?.()
		} catch {
			// best-effort
		}
		cancelDiscovery = null
		scanning.value = false
	}
	function claimantsOf(id: string): DiscoveredWallet[] {
		return discoveredWallets.value.filter((w) => w.id === id)
	}

	/** Synchronous state wipe + terminal transition. SDK teardown of CAPTURED
	 *  handles happens AFTER this, so an overlapping newer flow is never
	 *  clobbered by an older teardown's awaits. */
	function wipeToIdle(): void {
		epoch++
		clearAmbiguityTimer()
		stopDiscovery()
		cleanupSession()
		status.value = "idle"
		error.value = null
		activeFlowEpoch = null
	}

	function connect(): Promise<void> {
		return connectImpl(false)
	}

	/** The split-button caret: a fresh scan that goes straight to the picker,
	 *  IGNORING the remembered wallet for this flow only. The stored preference
	 *  survives a cancel and is overwritten by whichever wallet next connects. */
	function connectWithPicker(): Promise<void> {
		return connectImpl(true)
	}

	async function connectImpl(forcePicker: boolean): Promise<void> {
		if (activeFlowEpoch !== null || status.value === "connected") return

		// Sweep any session residue from a previous ERRORED flow (retained
		// provider/wallet/subscription): wipe synchronously, then best-effort
		// disconnect the captured handle. Without this, "Retry connection"
		// discovery runs over a live wallet session whose stale onDisconnect
		// could later tear down the replacement.
		const staleProvider = provider
		if (provider || wallet.value || pending) {
			cleanupSession()
			if (staleProvider) {
				void staleProvider.disconnect().catch(() => {})
			}
		}

		const flowEpoch = ++epoch
		activeFlowEpoch = flowEpoch

		error.value = null
		connectingViaRemembered = false
		discoveredWallets.value = []
		providersByKey.clear()
		status.value = "discovering"
		scanning.value = true

		const preferred = forcePicker || autoReconnectDisabled.value ? null : readPreferred()
		pickerOpen.value = preferred === null

		try {
			const manager = WalletManager.configure({ extensions: { enabled: true } })
			const discovery = manager.getAvailableWallets({
				chainInfo: readChainInfo(),
				appId: config.appId,
				timeout: 60_000,
			})
			cancelDiscovery = discovery.cancel

			for await (const p of discovery.wallets) {
				// The SDK buffers yields past cancel() — the epoch check, not
				// cancellation, keeps a dismissed/superseded flow from
				// repopulating state. The status check stops the SAME flow's
				// buffered stragglers once a wallet has been selected
				// (verifying and beyond must not grow the list).
				if (isStale(flowEpoch) || (status.value !== "discovering" && status.value !== "choosing")) return
				const row: DiscoveredWallet = { key: nextKey++, id: p.id, name: p.name, type: p.type, icon: p.icon }
				providersByKey.set(row.key, p)
				discoveredWallets.value = [...discoveredWallets.value, row]

				if (preferred) {
					const claimants = claimantsOf(preferred.id)
					if (claimants.length >= 2) {
						// A second claimant to the remembered identity: fail closed —
						// kill the window, disable auto-reconnect for the session,
						// force the picker.
						clearAmbiguityTimer()
						autoReconnectDisabled.value = true
						if (status.value === "discovering") status.value = "choosing"
						pickerOpen.value = true
					} else if (ambiguityTimer === null && status.value === "discovering") {
						// FIRST announcement (claimant or not) opens the bounded
						// window. Discovery stays LIVE during it so buffered + late
						// announcements are seen. At fire: a sole claimant of the
						// remembered id auto-connects; otherwise the picker shows —
						// non-claimant wallets must never sit hidden for the full
						// 60s discovery timeout. Best-effort detection only — the
						// emoji verification remains the actual trust anchor.
						ambiguityTimer = setTimeout(() => {
							ambiguityTimer = null
							if (isStale(flowEpoch) || status.value !== "discovering") return
							const cs = claimantsOf(preferred.id)
							if (cs.length === 1) {
								connectingViaRemembered = true
								void proceedWith(cs[0].key, flowEpoch)
							} else if (discoveredWallets.value.length > 0) {
								status.value = "choosing"
								pickerOpen.value = true
							}
						}, REMEMBERED_AMBIGUITY_WINDOW_MS)
					}
				} else if (status.value === "discovering") {
					// Fresh path: the picker shows from the first announcement, waitless.
					status.value = "choosing"
				}
			}

			// Natural end of the stream (timeout/exhaustion) — not a cancel (that returns above).
			if (isStale(flowEpoch)) return
			cancelDiscovery = null
			scanning.value = false
			clearAmbiguityTimer()

			if (status.value === "discovering") {
				// Still no transition: either zero announcements, or the window
				// hadn't fired yet — resolve now.
				const soleClaimant = preferred ? claimantsOf(preferred.id) : []
				if (soleClaimant.length === 1) {
					connectingViaRemembered = true
					await proceedWith(soleClaimant[0].key, flowEpoch)
					return
				}
				if (discoveredWallets.value.length > 0) {
					status.value = "choosing"
					pickerOpen.value = true
					return
				}
				throw new Error("No wallet discovered")
			}
		} catch (err) {
			if (isStale(flowEpoch)) return
			error.value = normalizeError(err)
			status.value = "error"
			cleanupSession()
			releaseFlowIfOwner(flowEpoch)
		}
	}

	/** User picks a row. Transitions SYNCHRONOUSLY so a double click (or a second panel's click,
	 *  or a racing remembered-window timer) is a no-op. */
	function selectWallet(key: number): void {
		if (status.value !== "choosing" && status.value !== "discovering") return
		const flowEpoch = epoch
		clearAmbiguityTimer()
		connectingViaRemembered = false
		status.value = "verifying" // synchronous transition — closes every double-entry race
		pickerOpen.value = false
		void proceedWith(key, flowEpoch)
	}

	/** Shared tail of the remembered auto-path and manual selection: bind to ONE provider and
	 *  open the secure channel. */
	async function proceedWith(key: number, flowEpoch: number): Promise<void> {
		const chosen = providersByKey.get(key)
		if (!chosen) {
			error.value = normalizeError(new Error("No wallet discovered"))
			status.value = "error"
			cleanupSession()
			releaseFlowIfOwner(flowEpoch)
			return
		}
		stopDiscovery()
		status.value = "verifying"
		pickerOpen.value = false
		provider = chosen

		try {
			const p = await chosen.establishSecureChannel(config.appId)
			if (isStale(flowEpoch)) {
				// Stale resolution: discard AND undo the SDK side effect on the
				// CAPTURED handle (the session fields may belong to a newer flow).
				try {
					await p.cancel()
				} catch {
					// best-effort
				}
				return
			}
			pending = p
			verificationEmojis.value = hashToEmoji(p.verificationHash)
		} catch (err) {
			if (isStale(flowEpoch)) return
			// A stale announcement (extension reloaded between announce and pick) fails here:
			// discard every provider object — none is re-usable — and surface a retryable error.
			if (connectingViaRemembered) clearPreferred()
			error.value = normalizeError(err)
			status.value = "error"
			cleanupSession()
			releaseFlowIfOwner(flowEpoch)
		}
	}

	async function confirmVerification(): Promise<void> {
		if (!pending) return
		const flowEpoch = epoch
		// Capture the flow's own handles: stale-cleanup must never dereference
		// the mutable session fields (a newer flow may own them by then).
		// `pending` is CLAIMED synchronously — the verification dialog renders
		// in multiple always-mounted panels, and two same-tick confirms would
		// otherwise both call confirm() and race competing wallet wrappers
		// over one MessagePort.
		const flowPending = pending
		const flowProvider = provider
		pending = null
		try {
			const w = await flowPending.confirm()
			if (isStale(flowEpoch)) {
				// Confirmed-but-stale: the wallet-side session exists — disconnect it.
				try {
					await flowProvider?.disconnect()
				} catch {
					// best-effort
				}
				return
			}
			wallet.value = w
			verificationEmojis.value = null
			// Subscribe AFTER confirm: before the wallet exists the SDK returns a
			// no-op unsubscriber and the callback never fires (the pre-existing
			// silent bug). The handler is a REMOTE interruption: it must bump the
			// epoch (stale-ify in-flight continuations like registerContracts)
			// and release the flow, or a late continuation could set "connected"
			// over the wiped state.
			unsubscribeDisconnect =
				flowProvider?.onDisconnect(() => {
					if (connectingViaRemembered) clearPreferred()
					wipeToIdle()
				}) ?? null
			status.value = "capability-approval"
			await requestCapabilities(flowEpoch)
		} catch (err) {
			if (isStale(flowEpoch)) return
			console.error(`[${config.appId}] confirmVerification failed`, err)
			if (connectingViaRemembered) clearPreferred()
			error.value = normalizeError(err)
			status.value = "error"
			cleanupSession()
			releaseFlowIfOwner(flowEpoch)
		}
	}

	async function cancelVerification(): Promise<void> {
		const stalePending = pending
		if (connectingViaRemembered) clearPreferred()
		wipeToIdle()
		// SDK teardown AFTER the synchronous wipe, on the captured handle — an
		// overlapping new flow can no longer be wiped by this await's tail.
		if (stalePending) {
			try {
				await stalePending.cancel()
			} catch {
				// best-effort
			}
		}
	}

	async function retryCapabilities(): Promise<void> {
		if (!wallet.value) return
		// Flow ownership: while the INITIAL capability request (or any other
		// flow) is live, retry is a no-op — concurrent requestCapabilities runs
		// could interleave grants/contract setup.
		if (activeFlowEpoch !== null) return
		const flowEpoch = epoch
		activeFlowEpoch = flowEpoch
		error.value = null
		status.value = "capability-approval"
		await requestCapabilities(flowEpoch)
	}

	/** Dismiss the picker: back to idle. An intentional cancel is never a `no-wallet` error.
	 *  Valid from `choosing` AND from the open-while-scanning `discovering` state. */
	function cancelChoice(): void {
		if (status.value !== "choosing" && status.value !== "discovering") return
		wipeToIdle()
	}

	async function disconnect(): Promise<void> {
		const staleProvider = provider
		wipeToIdle()
		if (staleProvider) {
			try {
				await staleProvider.disconnect()
			} catch {
				// best-effort
			}
		}
	}

	/** Forget the remembered wallet (the "use a different wallet" affordances). */
	function forgetPreferredWallet(): void {
		clearPreferred()
	}

	/** The switch affordances: disconnect (if connected) + a forced-picker scan
	 *  in ONE action. The stored preference is KEPT — cancelling the picker
	 *  must not cost the user their remembered wallet; completing a connection
	 *  overwrites it anyway. */
	async function switchWallet(): Promise<void> {
		if (status.value === "connected") {
			await disconnect()
		}
		await connectWithPicker()
	}

	async function requestCapabilities(flowEpoch: number): Promise<void> {
		const flowWallet = wallet.value
		const flowProvider = provider
		if (!flowWallet) return
		try {
			const manifest = await config.buildManifest()
			if (isStale(flowEpoch)) {
				try {
					await flowProvider?.disconnect()
				} catch {
					// best-effort
				}
				return
			}
			// SDK uses zod-inferred AppCapabilities; the manifest shape is structurally compatible
			// but the public type is not exported in a usable form. Single typed-boundary cast.
			// biome-ignore lint/suspicious/noExplicitAny: SDK manifest type is zod-inferred
			const result = await flowWallet.requestCapabilities(manifest as any)
			if (isStale(flowEpoch)) {
				try {
					await flowProvider?.disconnect()
				} catch {
					// best-effort
				}
				return
			}
			const granted = extractGrantedAccounts(result)
			accounts.value = granted
			selectedAccount.value = granted[0]?.address ?? null

			if (granted.length === 0) {
				throw new Error("No accounts granted by wallet")
			}

			// The user already clicked Approve - we're now doing post-approval setup (registering
			// contracts with the wallet's PXE). This can take 2-4s, so a dedicated state keeps the
			// UI from saying "Awaiting permissions".
			status.value = "setting-up"
			await config.registerContracts(flowWallet)
			if (isStale(flowEpoch)) {
				try {
					await flowProvider?.disconnect()
				} catch {
					// best-effort
				}
				return
			}

			status.value = "connected"
			// Persist ONLY on full success, and never re-persist on the remembered path (the
			// stored value is already this wallet).
			if (!connectingViaRemembered && flowProvider) {
				writePreferred({ id: flowProvider.id, name: flowProvider.name })
			}
			connectingViaRemembered = false
			releaseFlowIfOwner(flowEpoch)
		} catch (err) {
			if (isStale(flowEpoch)) return
			console.error(`[${config.appId}] requestCapabilities failed`, err)
			if (connectingViaRemembered) clearPreferred()
			error.value = normalizeError(err)
			status.value = "error"
			releaseFlowIfOwner(flowEpoch)
		}
	}

	function cleanupSession(): void {
		if (unsubscribeDisconnect) {
			try {
				unsubscribeDisconnect()
			} catch {
				// best-effort
			}
			unsubscribeDisconnect = null
		}
		clearAmbiguityTimer()
		provider = null
		pending = null
		cancelDiscovery = null
		scanning.value = false
		pickerOpen.value = false
		providersByKey.clear()
		discoveredWallets.value = []
		connectingViaRemembered = false
		wallet.value = null
		accounts.value = []
		selectedAccount.value = null
		verificationEmojis.value = null
	}

	/** Reset all state (test helper + hard reset). Live SDK handles get the
	 *  same best-effort teardown as the production paths — a hard reset must
	 *  not leak a pending channel or a connected provider session. */
	function reset(): void {
		autoReconnectDisabled.value = false
		const stalePending = pending
		const staleProvider = provider
		wipeToIdle()
		// Promise.resolve tolerates both promise-returning and void-typed SDK
		// teardown signatures; try/catch covers synchronous throws.
		try {
			if (stalePending) void Promise.resolve(stalePending.cancel()).catch(() => {})
		} catch {
			// best-effort
		}
		try {
			if (staleProvider) void Promise.resolve(staleProvider.disconnect()).catch(() => {})
		} catch {
			// best-effort
		}
	}

	return {
		status,
		verificationEmojis,
		accounts,
		selectedAccount,
		error,
		wallet,
		discoveredWallets,
		scanning,
		pickerOpen,
		preferredWalletName,
		autoReconnectDisabled,
		connect,
		connectWithPicker,
		selectWallet,
		cancelChoice,
		forgetPreferredWallet,
		switchWallet,
		confirmVerification,
		cancelVerification,
		retryCapabilities,
		disconnect,
		reset,
	}
}

interface GrantedAccountsCap {
	type: "accounts"
	accounts?: Array<{ alias?: string; item?: { toString(): string } | string }>
}

export function extractGrantedAccounts(result: unknown): GrantedAccount[] {
	if (!result || typeof result !== "object") return []
	const granted = (result as { granted?: unknown[] }).granted
	if (!Array.isArray(granted)) return []
	const cap = granted.find((c): c is GrantedAccountsCap => {
		return typeof c === "object" && c !== null && (c as { type?: unknown }).type === "accounts"
	})
	if (!cap?.accounts) return []
	return cap.accounts.map((a) => ({
		address: typeof a.item === "string" ? a.item : (a.item?.toString() ?? ""),
		alias: a.alias ?? "",
	}))
}
