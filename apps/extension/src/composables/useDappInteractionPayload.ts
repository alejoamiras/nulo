import { onScopeDispose, ref, type Ref } from "vue"
import type { EventHandler } from "@nulo/wallet-core/utils"
import type { DappMetadata } from "@/wallet/services/dapp-session/client"

export type UIDappMetadata = DappMetadata & {
	loadingLogo?: boolean
	logoBlobUrl?: string
}

/**
 * Minimal slice of `DappInteractionServiceClient` the composable needs.
 * The parent owns the actual client + its connect/disconnect lifecycle;
 * we just call the methods.
 */
export interface DappInteractionLike {
	getInteractionPayload(requestId: string): Promise<unknown>
	rejectInteraction(requestId: string, reason: string): void
	resolveInteraction(requestId: string, result: unknown): Promise<void>
	isInteractionCancelled(requestId: string): Promise<boolean>
	onInteractionCancelled: EventHandler<string>
}

export interface UseDappInteractionPayloadOptions<TPayload> {
	/** The dApp interaction service client. Lifecycle stays with the parent. */
	interactionService: DappInteractionLike
	/**
	 * The current request id — typically `() => router.currentRoute.value.query.requestId?.toString()`.
	 * Called once during `load()`.
	 */
	getRequestId: () => string | undefined
	/**
	 * Extract the `dappMetadata` from a typed payload. Different windows store
	 * it in different places (`payload.params.dappMetadata`, `payload.session.dappMetadata`, ...),
	 * so each window passes its own getter.
	 */
	dappOf: (payload: TPayload) => DappMetadata | undefined
}

export interface UseDappInteractionPayloadResult<TPayload> {
	requestId: Ref<string | undefined>
	payload: Ref<TPayload | null>
	dapp: Ref<UIDappMetadata | null>
	/** True from the moment the SW dispatches `onInteractionCancelled` for this request. */
	isCancelled: Ref<boolean>
	isLoading: Ref<boolean>
	error: Ref<unknown>
	/**
	 * Load the payload from the SW. Throws `Error("Invalid interaction request id")`
	 * if no requestId is in the route. Copies `dapp.logo` to `dapp.logoBlobUrl`
	 * directly (post-#29 the privacy gate is gone). Returns the typed payload.
	 */
	load: () => Promise<TPayload>
	/**
	 * Reject the interaction (no-op if already cancelled or no requestId).
	 * Does NOT close the window — the parent decides what UI does next.
	 */
	reject: (reason: string) => void
	dispose: () => void
}

export function useDappInteractionPayload<TPayload>(
	options: UseDappInteractionPayloadOptions<TPayload>,
): UseDappInteractionPayloadResult<TPayload> {
	const { interactionService, getRequestId, dappOf } = options

	const requestId = ref<string | undefined>(undefined)
	const payload = ref<TPayload | null>(null) as Ref<TPayload | null>
	const dapp = ref<UIDappMetadata | null>(null) as Ref<UIDappMetadata | null>
	const isCancelled = ref(false)
	const isLoading = ref(false)
	const error = ref<unknown>(null)
	let disposed = false

	const onCancelled = (incoming: string) => {
		if (requestId.value === incoming) isCancelled.value = true
	}
	interactionService.onInteractionCancelled.add(onCancelled)

	/** Post-fetch steps: replay a pre-subscribe cancel and surface the dapp meta.
	 *  Throws on mid-await disposal, mirroring the fetch path's disposed check. */
	const finishLoad = async (id: string, result: TPayload) => {
		// Replay a cancel that fired before this popup subscribed — the
		// broadcast alone is lost to late mounts; the record's flag is not.
		// Best-effort: a failed replay read must not fail an otherwise-good
		// load (the live broadcast still covers the common path).
		const cancelled = await interactionService.isInteractionCancelled(id).catch(() => false)
		if (disposed) throw new Error("Composable disposed before payload landed")
		if (cancelled) {
			isCancelled.value = true
		}

		const meta = dappOf(result) as UIDappMetadata | undefined
		if (meta) {
			if (meta.logo) meta.logoBlobUrl = meta.logo
			dapp.value = meta
		}
	}

	const load = async (): Promise<TPayload> => {
		isLoading.value = true
		error.value = null
		try {
			const id = getRequestId()
			if (!id) throw new Error("Invalid interaction request id")
			requestId.value = id

			const result = (await interactionService.getInteractionPayload(id)) as TPayload
			if (disposed) throw new Error("Composable disposed before payload landed")
			payload.value = result

			await finishLoad(id, result)
			return result
		} catch (err) {
			error.value = err
			throw err
		} finally {
			if (!disposed) isLoading.value = false
		}
	}

	const reject = (reason: string) => {
		if (isCancelled.value || !requestId.value) return
		interactionService.rejectInteraction(requestId.value, reason)
	}

	const dispose = () => {
		if (disposed) return
		disposed = true
		interactionService.onInteractionCancelled.remove(onCancelled)
	}

	onScopeDispose(dispose)

	return { requestId, payload, dapp, isCancelled, isLoading, error, load, reject, dispose }
}
