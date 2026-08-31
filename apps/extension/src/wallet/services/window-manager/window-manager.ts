/**
 * WindowManager — centralized chrome.windows.* lifecycle for popup-based
 * user approvals. Injectable collaborator (NOT a Service<Methods>); only
 * SW-side code calls it.
 *
 * Two consumer patterns today:
 *   - PasskeyService  (WebAuthn prompt)
 *   - DappInteractionService (dApp approval)
 *
 * Handles are keyed by a random `handleId`, NEVER by `kind` — concurrent
 * windows of the same kind are supported.
 */

import { LogLevel, type ILogger } from "@/wallet/logger"
import { getRandomHex } from "@/wallet/utils"
import type { ClockPort, TimerHandle, WindowPort } from "@nulo/wallet-core/ports"
import type { Unsubscribe } from "@nulo/wallet-core/ports"

export type OpenAndAwaitOpts = {
	url: string
	width: number
	height: number
	timeoutMs: number
	/** Tag used in logs only — NOT for dedup or routing. */
	kind: string
}

export type AwaitedWindow<T> = {
	handleId: string
	promise: Promise<T>
}

type Handle<T> = {
	resolve: (value: T) => void
	reject: (reason: string) => void
	windowId: number | undefined
	settled: boolean
	unsubOnRemoved: Unsubscribe | null
	timeoutHandle: TimerHandle | null
}

export class WindowManager {
	private readonly handles = new Map<string, Handle<unknown>>()

	public constructor(
		private readonly windows: WindowPort,
		private readonly clock: ClockPort,
		private readonly logger: ILogger,
	) {}

	public openAndAwait<T>(opts: OpenAndAwaitOpts): AwaitedWindow<T> {
		let handleId: string
		do {
			handleId = getRandomHex(8)
		} while (this.handles.has(handleId))

		let resolve!: (value: T) => void
		let reject!: (reason: string) => void

		const promise = new Promise<T>((res, rej) => {
			resolve = res
			reject = rej
		})

		const handle: Handle<T> = {
			resolve,
			reject,
			windowId: undefined,
			settled: false,
			unsubOnRemoved: null,
			timeoutHandle: null,
		}

		this.handles.set(handleId, handle as Handle<unknown>)

		const timeoutHandle = this.clock.setTimeout(() => {
			this.logger.log("window-manager", LogLevel.Warn, `[${opts.kind}/${handleId}] timed out`)
			this._settle(handleId, undefined, "Timed out waiting for window")
		}, opts.timeoutMs)

		handle.timeoutHandle = timeoutHandle

		this.windows
			.create({ type: "popup", url: opts.url, width: opts.width, height: opts.height })
			.then((created) => {
				// Identity, not membership: a settled handle's 8-hex id is re-mintable,
				// so `has(handleId)` could match a NEWER handle and adopt this stale
				// create. And a handle lost mid-create (timeout settled first) leaves
				// a window nothing owns — close it, or a stray popup lingers.
				if (this.handles.get(handleId) !== handle) {
					if (created.id !== undefined) void this.windows.remove(created.id)
					return
				}

				if (created.id === undefined) {
					this._settle(handleId, undefined, "Failed to open window.")
					return
				}

				handle.windowId = created.id

				const unsub = this.windows.onRemoved((closedId) => {
					if (closedId !== handle.windowId) return
					this.logger.log("window-manager", LogLevel.Info, `[${opts.kind}/${handleId}] closed by user`)
					handle.unsubOnRemoved?.()
					handle.unsubOnRemoved = null
					this._settleUserClose(handleId)
				})

				if (this.handles.get(handleId) !== handle) {
					unsub()
					void this.windows.remove(created.id)
					return
				}

				handle.unsubOnRemoved = unsub
			})
			.catch((err: unknown) => {
				const msg = err instanceof Error ? err.message : String(err)
				this.logger.log("window-manager", LogLevel.Error, `[${opts.kind}/${handleId}] window.create threw: ${msg}`)
				this._settle(handleId, undefined, msg)
			})

		return { handleId, promise }
	}

	public settle<T>(handleId: string, value: T): void {
		this._settle(handleId, value, undefined)
	}

	public cancel(handleId: string, reason: string): void {
		this._settle(handleId, undefined, reason)
	}

	/** Stop watching the popup window without settling the promise. Clears the
	 *  timeout and removes the onRemoved listener; the handle stays in the map
	 *  so a subsequent settle/cancel can still process it.
	 *
	 *  Call this when you have taken ownership of settlement — e.g., after
	 *  `approveInteraction` starts an async execution that will settle later,
	 *  or before `resolveInteraction` calls settle, to prevent the popup's
	 *  close event from racing with the settle call. */
	public detach(handleId: string): void {
		const handle = this.handles.get(handleId)
		if (!handle || handle.settled) return
		if (handle.timeoutHandle !== null) {
			this.clock.clearTimeout(handle.timeoutHandle)
			handle.timeoutHandle = null
		}
		if (handle.unsubOnRemoved !== null) {
			handle.unsubOnRemoved()
			handle.unsubOnRemoved = null
		}
	}

	private _settleUserClose(handleId: string): void {
		const handle = this.handles.get(handleId)
		if (!handle || handle.settled) return
		handle.settled = true
		this.handles.delete(handleId)
		if (handle.timeoutHandle !== null) {
			this.clock.clearTimeout(handle.timeoutHandle)
			handle.timeoutHandle = null
		}
		// Window is already gone — do NOT call windows.remove.
		handle.reject("Window closed by user.")
	}

	private _settle(handleId: string, value: unknown, error: string | undefined): void {
		const handle = this.handles.get(handleId)
		if (!handle) return
		if (handle.settled) {
			this.logger.log("window-manager", LogLevel.Debug, `[${handleId}] settle/cancel after already settled — ignored`)
			return
		}

		handle.settled = true
		this.handles.delete(handleId)

		if (handle.timeoutHandle !== null) {
			this.clock.clearTimeout(handle.timeoutHandle)
			handle.timeoutHandle = null
		}
		if (handle.unsubOnRemoved !== null) {
			handle.unsubOnRemoved()
			handle.unsubOnRemoved = null
		}

		if (handle.windowId !== undefined) {
			this.windows.remove(handle.windowId).catch(() => {
				// Window may already be closed — not an error.
			})
		}

		if (error !== undefined) {
			handle.reject(error)
		} else {
			handle.resolve(value)
		}
	}
}
