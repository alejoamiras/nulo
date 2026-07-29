// Patch WalletSchema before wallet-sdk reads it (Nulo-custom `registerToken`).
// Must be the first import in this module - see @nulo/wallet-sdk-schema-patch.
import "@nulo/wallet-sdk-schema-patch/register"

import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { WalletManager } from "@aztec/wallet-sdk/manager"
import type { PendingConnection, WalletProvider } from "@aztec/wallet-sdk/manager"
import { ref, shallowRef } from "vue"
import { readChainInfo } from "@/lib/chain-info"
import { hashToEmoji } from "@/lib/emoji"
import { type NormalizedError, normalizeError } from "@/lib/errors"

export type ConnectStatus =
	| "idle"
	| "discovering"
	| "choosing"
	| "verifying"
	| "capability-approval"
	| "choosing-account"
	| "setting-up"
	| "connected"
	| "error"

export interface GrantedAccount {
	readonly address: string
	readonly alias: string
}

/** One-shot UI notification from the selection logic. Emitted by the session at the triggering
 *  moment and DRAINED exactly once by a single UI owner (a module-level watcher in
 *  useWalletConnection) — panels must never infer these from status changes (plan D-25/D-29). */
export interface SelectionNotice {
	/** Monotonic per-session key — lets the consumer prove exactly-once handling. */
	readonly key: number
	readonly kind: "auto-remembered" | "grant-truncated"
	readonly alias?: string
	readonly address?: string
	readonly hiddenCount?: number
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

/** Wallet-claimed aliases are capped at parse time, same rationale as PREFERRED_NAME_MAX. */
const ALIAS_MAX = 48
/** Granted-list bound (DoS resistance). Truncation is DISCLOSED via a SelectionNotice, never
 *  silent — silently hiding account 17 would recreate the hidden-account bug this feature fixes
 *  (plan D-9/D-24). */
const MAX_GRANTED_ACCOUNTS = 16
/** Per-wallet selected-account memory: most-recent-first, so A→B→A keeps both (plan D-2). */
const MAX_REMEMBERED_WALLETS = 8
/** Bound on stored id/address strings — storage is untrusted input (plan D-23). */
const STORED_STRING_MAX = 256
/** Control chars + bidi override/isolate marks: a wallet-claimed alias must not reorder or hide
 *  adjacent UI text. The address is always rendered beside the alias as the unambiguous
 *  identity (plan D-10). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point
const UNSAFE_ALIAS_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

/** Code-point-safe bounded truncation: a UTF-16 `slice` can split an emoji
 *  surrogate pair in a claimed wallet name. Shared by the picker's display
 *  capping and the persisted-name capping. */
export function truncateName(name: string, max: number): string {
	const points = Array.from(name)
	return points.length > max ? `${points.slice(0, max).join("")}…` : name
}

/**
 * Per-feature config for an Aztec wallet session. The faucet app creates ONE session (a
 * module-level singleton in useWalletConnection; useBridgeWallet re-exports it) with a combined
 * capability manifest covering every tab — one connection, one grant, one active account.
 *
 * Account-selection contract for consumers: read `selectedAccount` AT ACTION TIME and capture it
 * for the operation's lifetime; wrap every account-sensitive prompt/send span in
 * `useOpsInFlight.withOperation` so switching is blocked while the operation runs.
 */
export interface AztecWalletSessionConfig {
	readonly appId: string
	/** Build the wallet-sdk capability manifest at connect time (async - needs the SponsoredFPC). */
	// biome-ignore lint/suspicious/noExplicitAny: SDK manifest type is zod-inferred, not exported usably.
	readonly buildManifest: () => Promise<any>
	/** Register the feature's contracts with the wallet's PXE after capabilities are granted. */
	readonly registerContracts: (wallet: Wallet) => Promise<void>
	/** Mutation-boundary guard for account switching: while it returns true, `selectAccount()`
	 *  rejects. Injected (rather than imported) so the factory stays UI-agnostic and the gate is
	 *  unit-testable — the faucet wires it to the ops-in-flight registry (plan D-18). */
	readonly isSwitchBlocked?: () => boolean
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
	/** Per-wallet selected-account memory (MRU pairs, see readRememberedMap). */
	const selectedStorageKey = `${config.appId}:selected-accounts`

	const status = ref<ConnectStatus>("idle")
	const verificationEmojis = ref<string | null>(null)
	const accounts = ref<GrantedAccount[]>([])
	const selectedAccount = ref<string | null>(null)
	/** Valid accounts dropped by the grant cap — drives the persistent "Showing N of M" disclosure
	 *  rows (the one-shot notice covers only the toast; plan D-24). */
	const hiddenAccountsCount = ref(0)
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

	// Single-use pause token for the choose-account step. Like the verification step's `pending`,
	// it is CLAIMED synchronously (nulled before any await) by whichever continuation runs first —
	// double-confirm, confirm-vs-cancel, and racing panels all collapse to one winner. Captures
	// the flow's own handles so stale cleanup never dereferences the mutable session fields
	// (plan D-3).
	let pendingAccountChoice: { flowEpoch: number; wallet: Wallet; provider: WalletProvider | null } | null = null

	// One-shot UI notices (auto-remembered selection, grant truncation). Drained by the single
	// module-level owner in useWalletConnection — see SelectionNotice (plan D-25/D-29).
	const selectionNotices = ref<SelectionNotice[]>([])
	let nextNoticeKey = 0
	function pushSelectionNotice(notice: Omit<SelectionNotice, "key">): void {
		selectionNotices.value = [...selectionNotices.value, { ...notice, key: nextNoticeKey++ }]
	}
	/** Drain pending notices exactly once (returns them and clears the queue). */
	function consumeSelectionNotices(): SelectionNotice[] {
		const drained = selectionNotices.value
		if (drained.length > 0) selectionNotices.value = []
		return drained
	}

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

	/** Per-wallet selected-account memory: `[walletId, address][]`, most-recent-first. Storage is
	 *  untrusted input — the read path re-validates shape, bounds every string, dedupes ids, and
	 *  re-caps the list; content is only ever used to PRE-SELECT among the live grant, never to
	 *  select an outside address (plan D-2/D-23; validation against the grant happens at lookup
	 *  sites). */
	function readRememberedMap(): Array<[string, string]> {
		try {
			const raw = localStorage.getItem(selectedStorageKey)
			if (!raw) return []
			const parsed: unknown = JSON.parse(raw)
			if (!Array.isArray(parsed)) return []
			const out: Array<[string, string]> = []
			for (const entry of parsed) {
				if (!Array.isArray(entry) || entry.length !== 2) continue
				const [id, address] = entry as [unknown, unknown]
				if (typeof id !== "string" || typeof address !== "string") continue
				if (id.length === 0 || id.length > STORED_STRING_MAX || address.length === 0 || address.length > STORED_STRING_MAX) continue
				if (out.some(([seenId]) => seenId === id)) continue
				out.push([id, address])
				if (out.length >= MAX_REMEMBERED_WALLETS) break
			}
			return out
		} catch {
			return []
		}
	}
	function readRememberedAccount(walletId: string): string | null {
		return readRememberedMap().find(([id]) => id === walletId)?.[1] ?? null
	}
	function writeRememberedAccount(walletId: string, address: string): void {
		// Bound on WRITE as well as read (plan D-23): a hostile provider id must not produce
		// oversized writes / quota churn.
		if (walletId.length === 0 || walletId.length > STORED_STRING_MAX || address.length > STORED_STRING_MAX) return
		// Atomic rebuild: filter-out + unshift + cap, then ONE setItem (plan D-23).
		const head: [string, string] = [walletId, address]
		const next = [head, ...readRememberedMap().filter(([id]) => id !== walletId)].slice(0, MAX_REMEMBERED_WALLETS)
		try {
			localStorage.setItem(selectedStorageKey, JSON.stringify(next))
		} catch {
			// Best-effort: a throwing storage must never affect an established session.
		}
	}

	/** Set the active account and remember it for this wallet. Selection is persisted AT selection
	 *  time — before setup — so a setup failure + retry re-applies it without re-prompting
	 *  (plan D-20). */
	function applySelection(address: string, flowProvider: WalletProvider | null): void {
		selectedAccount.value = address
		if (flowProvider) writeRememberedAccount(flowProvider.id, address)
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
			const { accounts: granted, hiddenCount } = parseGrantedAccounts(result)
			accounts.value = granted
			hiddenAccountsCount.value = hiddenCount

			if (granted.length === 0) {
				throw new Error("No accounts granted by wallet")
			}
			if (hiddenCount > 0) {
				pushSelectionNotice({ kind: "grant-truncated", hiddenCount })
			}

			if (granted.length === 1) {
				applySelection(granted[0].address, flowProvider)
			} else {
				const remembered = flowProvider ? readRememberedAccount(flowProvider.id) : null
				const match = remembered ? granted.find((a) => a.address === remembered) : undefined
				if (match) {
					// Remembered choice still in the grant: auto-apply, but SAY so — a visible
					// signal that a stored value picked the account (plan D-11).
					applySelection(match.address, flowProvider)
					pushSelectionNotice({ kind: "auto-remembered", alias: match.alias, address: match.address })
				} else {
					// >1 accounts, nothing (valid) remembered: pause for the user. The flow stays
					// OWNED (activeFlowEpoch keeps its value), so retryCapabilities stays a no-op
					// while the modal is up; confirm/cancel resume via the captured token.
					pendingAccountChoice = { flowEpoch, wallet: flowWallet, provider: flowProvider }
					status.value = "choosing-account"
					return
				}
			}
		} catch (err) {
			if (isStale(flowEpoch)) return
			console.error(`[${config.appId}] requestCapabilities failed`, err)
			if (connectingViaRemembered) clearPreferred()
			error.value = normalizeError(err)
			status.value = "error"
			releaseFlowIfOwner(flowEpoch)
			return
		}
		await finishSetup(flowEpoch, flowWallet, flowProvider)
	}

	/** Shared post-selection tail for BOTH the auto path and the choose-account confirm path.
	 *  Owns its errors identically for both callers (plan D-20) — it never throws. */
	async function finishSetup(flowEpoch: number, flowWallet: Wallet, flowProvider: WalletProvider | null): Promise<void> {
		try {
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
			console.error(`[${config.appId}] finishSetup failed`, err)
			if (connectingViaRemembered) clearPreferred()
			error.value = normalizeError(err)
			status.value = "error"
			releaseFlowIfOwner(flowEpoch)
		}
	}

	/** The choose-account modal's Confirm. Claims the pause token SYNCHRONOUSLY (double-confirm
	 *  and racing panels are no-ops), validates the address against the LIVE grant, then resumes
	 *  the connect flow. The selection is persisted BEFORE setup so a setup failure + retry
	 *  auto-applies it instead of re-prompting (plan D-20). */
	async function confirmAccountChoice(address: string): Promise<void> {
		if (status.value !== "choosing-account") return
		const token = pendingAccountChoice
		if (!token || isStale(token.flowEpoch)) return
		if (!accounts.value.some((a) => a.address === address)) return
		pendingAccountChoice = null // synchronous claim — closes every double-entry race
		applySelection(address, token.provider)
		await finishSetup(token.flowEpoch, token.wallet, token.provider)
	}

	/** Dismiss the choose-account step: abandoning the choice cancels the CONNECT (same semantics
	 *  as cancelVerification — a half-connected session must not linger). SDK teardown happens
	 *  AFTER the synchronous wipe, on the token's captured handle. */
	async function cancelAccountChoice(): Promise<void> {
		if (status.value !== "choosing-account") return
		const token = pendingAccountChoice
		pendingAccountChoice = null
		wipeToIdle()
		if (token?.provider) {
			try {
				await token.provider.disconnect()
			} catch {
				// best-effort
			}
		}
	}

	/** Post-connect account switching. Gated at the MUTATION BOUNDARY (plan D-18): rejects unless
	 *  connected, the address is in the live grant, and no tracked operation is in flight. Returns
	 *  whether the switch applied — the UI toasts on true. */
	function selectAccount(address: string): boolean {
		if (status.value !== "connected") return false
		if (config.isSwitchBlocked?.()) return false
		if (!accounts.value.some((a) => a.address === address)) return false
		applySelection(address, provider)
		return true
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
		pendingAccountChoice = null
		selectionNotices.value = []
		hiddenAccountsCount.value = 0
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
		selectionNotices,
		hiddenAccountsCount,
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
		confirmAccountChoice,
		cancelAccountChoice,
		selectAccount,
		consumeSelectionNotices,
		retryCapabilities,
		disconnect,
		reset,
	}
}

interface GrantedAccountsCap {
	type: "accounts"
	accounts?: Array<{ alias?: unknown; item?: { toString(): string } | string } | null>
}

export interface ParsedGrantedAccounts {
	readonly accounts: GrantedAccount[]
	/** Valid, deduped accounts dropped by the MAX_GRANTED_ACCOUNTS cap — disclosed to the user. */
	readonly hiddenCount: number
}

/**
 * Hardened grant parsing (plan D-9/D-10/D-21): the capability result is WALLET-CONTROLLED input.
 * Per entry, inside try/catch: the address must round-trip `AztecAddress.fromStringUnsafe` —
 * syntactic + canonical-form validation ONLY, NOT curve validity (authorization is enforced
 * wallet-side per RPC); a throwing `toString` or malformed entry is skipped, never a crash.
 * Aliases are sanitized (control/bidi strip) and capped; addresses deduped (first wins); the
 * list is bounded with DISCLOSED truncation.
 */
export function parseGrantedAccounts(result: unknown): ParsedGrantedAccounts {
	const none: ParsedGrantedAccounts = { accounts: [], hiddenCount: 0 }
	if (!result || typeof result !== "object") return none
	const granted = (result as { granted?: unknown[] }).granted
	if (!Array.isArray(granted)) return none
	const cap = granted.find((c): c is GrantedAccountsCap => {
		return typeof c === "object" && c !== null && (c as { type?: unknown }).type === "accounts"
	})
	if (!cap?.accounts || !Array.isArray(cap.accounts)) return none

	const seen = new Set<string>()
	const accounts: GrantedAccount[] = []
	let hiddenCount = 0
	for (const entry of cap.accounts) {
		let address: string
		try {
			const raw = typeof entry?.item === "string" ? entry.item : (entry?.item?.toString() ?? "")
			address = AztecAddress.fromStringUnsafe(raw).toString()
		} catch {
			continue
		}
		if (seen.has(address)) continue
		seen.add(address)
		if (accounts.length >= MAX_GRANTED_ACCOUNTS) {
			hiddenCount++
			continue
		}
		const rawAlias = typeof entry?.alias === "string" ? entry.alias : ""
		accounts.push({ address, alias: truncateName(rawAlias.replace(UNSAFE_ALIAS_CHARS, ""), ALIAS_MAX) })
	}
	return { accounts, hiddenCount }
}

/** Back-compat projection of parseGrantedAccounts (existing call sites and tests). */
export function extractGrantedAccounts(result: unknown): GrantedAccount[] {
	return parseGrantedAccounts(result).accounts
}
