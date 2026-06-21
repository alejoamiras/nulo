import type { ServiceSpec } from "@/wallet/base"
import { Service } from "@nulo/extension-messaging/background"
import type { ILogger } from "@/wallet/logger"
import { PASSKEY_SERVICE_NAME, type Methods, type PasskeyCredentialData, type PasskeyRequest } from "./spec"
import { PasskeyCredential } from "@nulo/wallet-crypto"
import { getRandomHex } from "@/wallet/utils"
import type { WindowManager } from "@/wallet/services/window-manager/window-manager"

export * from "./spec"

/**
 * Hard timeout for a passkey popup. Bounds the worst case when neither the
 * user interacts nor `chrome.windows.onRemoved` fires (eg. extension reload,
 * popup crash, MV3 suspension races). 5 minutes is ample for WebAuthn UX.
 */
const PASSKEY_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Two ceremony hosts share this service:
 *
 *   - PATH A — popup-driven in-page modal. Active path for register / unlock
 *     / import. The popup runs WebAuthn in its own frame via
 *     `src/wallet/utils/passkey-ceremony.ts:runPasskeyCeremony`, then hands
 *     the resulting `PasskeyCredentialData` to `ProfileService.{create,unlock,import}*`
 *     which call `materializeCredential` to wrap it back into a
 *     `PasskeyCredential`. NO window opens for Path A.
 *
 *   - PATH B — SW-driven popup window via `WindowManager`. Kept for future
 *     dApp/SW-triggered passkey ceremonies (e.g. content-script-triggered
 *     tx confirm via passkey when no popup is open). Currently NO production
 *     callers — `createKey`/`getKey` are unreferenced by Path A. The plumbing
 *     stays so a future dApp signing PR doesn't have to re-implement window
 *     spawning + pending-request bookkeeping. The spawned window
 *     (`src/popup/windows/passkey/index.vue`) calls the SAME
 *     `runPasskeyCeremony` helper as Path A so the WebAuthn shape stays
 *     in lock-step between both hosts.
 *
 * `pending`, `openWindowAndWait`, `getPendingRequest`, `resolvePasskeyRequest`,
 * `rejectPasskeyRequest`, `createKey`, `getKey` — all PATH B.
 * `materializeCredential` — PATH A.
 */

type PendingPasskey = {
	request: PasskeyRequest
	handleId: string
}

export class PasskeyService extends Service<Methods> implements ServiceSpec<Methods> {
	public static name = PASSKEY_SERVICE_NAME

	private pending: Map<string, PendingPasskey> = new Map()

	public constructor(
		logger: ILogger,
		private readonly windowManager: WindowManager,
	) {
		super(PASSKEY_SERVICE_NAME, logger)
	}

	/** PATH B — SW-driven window flow for create. No current PRODUCTION callers,
	 *  but reachable via `ProfileService.createPasskeyProfile` when no
	 *  `credentialData` is supplied. `name` is the profile name, slugified into
	 *  the credential label by `buildCreateOptions`. */
	public async createKey(userHandle: string, name: string): Promise<PasskeyCredential> {
		return await this.openWindowAndWait({ mode: "create", userHandle, name })
	}

	/** PATH B — SW-driven window flow for get. No current callers. */
	public async getKey(credentialId?: string): Promise<PasskeyCredential> {
		return await this.openWindowAndWait({ mode: "get", credentialId })
	}

	/**
	 * PATH A — wrap a `PasskeyCredentialData` (collected by the popup-side
	 * in-page modal) into a `PasskeyCredential`. SW-internal collaborator
	 * method; not exposed over RPC because `PasskeyCredential` carries
	 * `CryptoKey` state that cannot cross the postMessage boundary.
	 */
	public async materializeCredential(data: PasskeyCredentialData): Promise<PasskeyCredential> {
		return await PasskeyCredential.create(data)
	}

	public async getPendingRequest(requestId: string): Promise<PasskeyRequest> {
		const entry = this.pending.get(requestId)
		if (!entry) throw new Error("Invalid request id")
		return entry.request
	}

	public async resolvePasskeyRequest(requestId: string, result: PasskeyCredentialData): Promise<void> {
		const entry = this.pending.get(requestId)
		if (!entry) throw new Error("Invalid request id")
		this.pending.delete(requestId)
		const credential = await PasskeyCredential.create(result)
		this.logDebug("Passkey request resolved: ", credential.id)
		// Detach before settling: passkey popup closes after the user completes
		// the WebAuthn gesture; the onRemoved event can race with settle.
		this.windowManager.detach(entry.handleId)
		this.windowManager.settle(entry.handleId, credential)
	}

	public async rejectPasskeyRequest(requestId: string, reason: string): Promise<void> {
		const entry = this.pending.get(requestId)
		if (!entry) throw new Error("Invalid request id")
		this.pending.delete(requestId)
		this.logInfo("Passkey request rejected: ", reason)
		this.windowManager.cancel(entry.handleId, reason)
	}

	private async openWindowAndWait(request: PasskeyRequest): Promise<PasskeyCredential> {
		let id: string
		do {
			id = getRandomHex(8)
		} while (this.pending.has(id))

		const handle = this.windowManager.openAndAwait<PasskeyCredential>({
			url: chrome.runtime.getURL(`src/popup/index.html#/windows/passkey?requestId=${id}`),
			width: 500,
			height: 800,
			timeoutMs: PASSKEY_TIMEOUT_MS,
			kind: "passkey",
		})

		this.pending.set(id, { request, handleId: handle.handleId })

		return handle.promise.finally(() => {
			this.pending.delete(id)
		})
	}
}
