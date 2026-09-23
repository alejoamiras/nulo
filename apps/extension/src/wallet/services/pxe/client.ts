/**
 * Chrome-bound subclass of `PxeServiceClientBase`. The base class lives
 * in `@nulo/aztec-runtime/pxe` and is Chrome-agnostic; this subclass
 * adds the MV3 offscreen-document bootstrap via `onReady`.
 */
import { ensureOffscreenRunning, isOffscreenDocumentSender } from "@/wallet/utils/offscreen"
import type { ILogger } from "@nulo/wallet-core/logger"
import { RecoveryModeError } from "@nulo/extension-messaging/errors"
import { type Methods, PxeServiceClientBase, type StoreKeyProvision } from "@nulo/aztec-runtime/pxe"

/**
 * Process-wide store-key derivation hook shared by every `PxeServiceClient` instance (each SW
 * service constructs its own client, so a per-instance provider could not be wired at the
 * construction sites). Registered once at SW boot (`runtime.ts`) against the live ProfileService;
 * returns undefined when the profile is locked, deleted, or tombstoned — such a profile cannot
 * (re)open its encrypted PXE store, by design. The provision pairs the derived key with the
 * row's CURRENT `pxeGeneration`, both read under the facade lock (#281 D4).
 */
let storeKeyProvider: ((profileId: string) => Promise<StoreKeyProvision | undefined>) | undefined
/** Generation-only lookup for op capture (no HKDF per op). Same registration pattern. */
let generationProvider: ((profileId: string) => Promise<string | undefined>) | undefined

export function registerPxeStoreKeyProvider(provider: (profileId: string) => Promise<StoreKeyProvision | undefined>): void {
	storeKeyProvider = provider
}

export function registerPxeGenerationProvider(provider: (profileId: string) => Promise<string | undefined>): void {
	generationProvider = provider
}

/** Synchronous SW-side read of "is this profile's session open WITHOUT its DEK" (recovery mode).
 *  Consulted before EVERY profile-bound request: the offscreen keeps store keys and chain
 *  runtimes warm across lock and profile switch, so an already-open runtime would otherwise
 *  serve a degraded session without ever consulting the store-key provider. The session state is
 *  committed before the unlock resolves, so there is no event or RPC ordering to race. */
let recoveryGuard: ((profileId: string) => boolean) | undefined

export function registerPxeRecoveryGuard(guard: (profileId: string) => boolean): void {
	recoveryGuard = guard
}

/** An op is profile-bound when its first argument is a `NetworkInfo` (profile + chain). The
 *  cleanup calls (`clearChainState`, `clearProfileState`) and the provision take a bare profileId
 *  first and stay admitted — a profile in recovery mode must still be purgeable. */
function isProfileBound(arg: unknown): arg is { profileId: string } {
	return typeof arg === "object" && arg !== null && typeof (arg as { profileId?: unknown }).profileId === "string" && "chainId" in arg
}

export class PxeServiceClient extends PxeServiceClientBase {
	public constructor(logger: ILogger) {
		super(logger)
		this.setStoreKeyProvider(async (profileId) => storeKeyProvider?.(profileId))
		this.setGenerationProvider(async (profileId) => generationProvider?.(profileId))
	}

	/**
	 * Ensure the offscreen document hosting PXE is live before every
	 * request. The base `ServiceClient` calls this hook before sending
	 * any request; bootstrapping here guarantees the transport exists
	 * without forcing every caller to remember `ensureOffscreenRunning`.
	 */
	protected override async onReady(): Promise<void> {
		await ensureOffscreenRunning()
	}

	/** Responses and events settle only from the offscreen document itself (exact URL). */
	protected override isAcceptedSender(sender: chrome.runtime.MessageSender | undefined): boolean {
		return isOffscreenDocumentSender(sender)
	}

	protected override async request<T extends keyof Methods>(
		method: T,
		...args: Parameters<Methods[T]>
	): Promise<Awaited<ReturnType<Methods[T]>>> {
		const netArg = args[0]
		if (isProfileBound(netArg) && recoveryGuard?.(netArg.profileId)) throw new RecoveryModeError()
		return super.request(method, ...args)
	}
}

// Re-export public surface so existing `@/wallet/services/pxe/client`
// import paths keep working. When the rest of the extension moves to
// import from `@nulo/aztec-runtime/pxe` directly, drop the shim.
export {
	PXE_SERVICE_NAME,
	type Methods,
	type NotesFilter,
	type IPXE,
	PXEProxy,
	type NetworkInfo,
	type ProveBackend,
	type ProvePhaseEvent,
} from "@nulo/aztec-runtime/pxe"
