/**
 * Chrome-bound subclass of `PxeServiceClientBase`. The base class lives
 * in `@nulo/aztec-runtime/pxe` and is Chrome-agnostic; this subclass
 * adds the MV3 offscreen-document bootstrap via `onReady`.
 */
import { ensureOffscreenRunning } from "@/wallet/utils/offscreen"
import { PxeServiceClientBase } from "@nulo/aztec-runtime/pxe"

export class PxeServiceClient extends PxeServiceClientBase {
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
