/**
 * Chrome-bound subclass of `PxeServiceClientBase`. The base class lives
 * in `@nulo/aztec-runtime/pxe` and is Chrome-agnostic; this subclass
 * adds the MV3 offscreen-document bootstrap via `onReady`.
 */
import { ensureOffscreenRunning } from "@/wallet/utils/offscreen"
import type { ILogger } from "@nulo/wallet-core/logger"
import { PxeServiceClientBase } from "@nulo/aztec-runtime/pxe"

/**
 * Process-wide store-key derivation hook shared by every `PxeServiceClient` instance (each SW
 * service constructs its own client, so a per-instance provider could not be wired at the
 * construction sites). Registered once at SW boot (`runtime.ts`) against the live ProfileService;
 * returns undefined when the profile is locked — a locked profile cannot open its encrypted PXE
 * store, by design.
 */
let storeKeyProvider: ((profileId: string) => Promise<Uint8Array | undefined>) | undefined

export function registerPxeStoreKeyProvider(provider: (profileId: string) => Promise<Uint8Array | undefined>): void {
	storeKeyProvider = provider
}

export class PxeServiceClient extends PxeServiceClientBase {
	public constructor(logger: ILogger) {
		super(logger)
		this.setStoreKeyProvider(async (profileId) => storeKeyProvider?.(profileId))
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
}

// Re-export public surface so existing `@/wallet/services/pxe/client`
// import paths keep working. When the rest of the extension moves to
// import from `@nulo/aztec-runtime/pxe` directly, drop the shim.
export { PXE_SERVICE_NAME, type Methods, type NotesFilter, type IPXE, PXEProxy, type NetworkInfo } from "@nulo/aztec-runtime/pxe"
