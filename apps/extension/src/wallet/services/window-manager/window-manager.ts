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
import { randomIdNotIn } from "@/wallet/services/id-allocators"
import type { ClockPort, CreatedWindow, CreateWindowOptions, TimerHandle, WindowBounds, WindowPort } from "@nulo/wallet-core/ports"
import type { Unsubscribe } from "@nulo/wallet-core/ports"
import { deferred } from "@nulo/wallet-core/utils"

function completeBounds(anchor: WindowBounds | undefined): Required<WindowBounds> | undefined {
	if (!anchor) return undefined
	const { left, top, width, height } = anchor
	if ([left, top, width, height].some((n) => typeof n !== "number")) return undefined
	return anchor as Required<WindowBounds>
}

/** Center a `width`×`height` window on `anchor`. Signed arithmetic: a display
 *  left of or above the primary has negative coordinates, so never clamp.
 *  `{}` (let Chrome pick) when the anchor or any of its bounds is missing. */
export function centerOn(anchor: WindowBounds | undefined, width: number, height: number): { left?: number; top?: number } {
	const bounds = completeBounds(anchor)
	if (!bounds) return {}
	return {
		left: Math.round(bounds.left + (bounds.width - width) / 2),
		top: Math.round(bounds.top + (bounds.height - height) / 2),
	}
}

/** A `width`-wide window flush with `anchor`'s right edge and top, no taller than the anchor.
 *  Signed coordinates, never clamped: a display left of or above the primary is negative. A
 *  missing or partial anchor yields no position and the requested height, so the browser picks. */
export function topRightOf(
	anchor: WindowBounds | undefined,
	width: number,
	height: number,
): { left?: number; top?: number; height: number } {
	const bounds = completeBounds(anchor)
	if (!bounds) return { height }
	return { left: bounds.left + bounds.width - width, top: bounds.top, height: Math.min(height, bounds.height) }
}

/** `create`, retried once with `left` and `top` removed when the browser refuses a position and
 *  `stillWanted()` still holds. A size-only create, an unwanted retry and a second refusal all
 *  reject with the browser's error, which callers must not log or surface: it can carry the
 *  window's URL. */
export async function createPlaced(
	windows: Pick<WindowPort, "create">,
	options: CreateWindowOptions,
	stillWanted: () => boolean,
	logger: ILogger,
	source: string,
): Promise<CreatedWindow> {
	try {
		return await windows.create(options)
	} catch (err) {
		const { left, top, ...sizeOnly } = options
		if ((left === undefined && top === undefined) || !stillWanted()) throw err
		const created = await windows.create(sizeOnly)
		logger.log(source, LogLevel.Debug, "window position refused; opened with the size only")
		return created
	}
}

export type OpenAndAwaitOpts = {
	url: string
	width: number
	height: number
	timeoutMs: number
	/** Tag used in logs only — NOT for dedup or routing. */
	kind: string
	/** `top-right` retries a refused position with the size only; `center` creates once. */
	placement: "center" | "top-right"
}

export type AwaitedWindow<T> = {
	handleId: string
	promise: Promise<T>
}

type Handle<T> = {
	resolve: (value: T) => void
	reject: (reason: unknown) => void
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
		const handleId = randomIdNotIn((id) => this.handles.has(id))

		const { promise, resolve, reject } = deferred<T>()

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
			.getLastFocused()
			.then((anchor) => {
				// A timeout or cancel during the bounds lookup must prevent creation.
				if (this.handles.get(handleId) !== handle) return undefined
				return this.createWindow(opts, anchor, () => this.handles.get(handleId) === handle)
			})
			.then((created) => {
				if (created === undefined) return
				// Identity, not membership: a settled handle's 8-hex id is re-mintable,
				// so `has(handleId)` could match a NEWER handle and adopt this stale
				// create. And a handle lost mid-create (timeout settled first) leaves
				// a window nothing owns — close it, or a stray popup lingers.
				if (this.handles.get(handleId) !== handle) {
					if (created.id !== undefined) this.windows.remove(created.id).catch(() => undefined)
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
					this.windows.remove(created.id).catch(() => undefined)
					return
				}

				handle.unsubOnRemoved = unsub
			})
			.catch(() => {
				// The browser's error is dropped: it can carry the window URL, which holds request ids.
				if (this.handles.get(handleId) !== handle) return
				this.logger.log("window-manager", LogLevel.Error, `[${opts.kind}/${handleId}] window could not be opened`)
				this._settle(handleId, undefined, "Failed to open window.")
			})

		return { handleId, promise }
	}

	public settle<T>(handleId: string, value: T): void {
		this._settle(handleId, value, undefined)
	}

	/** An `Error` reason reaches the awaiting caller as that same instance — the
	 *  wallet-sdk envelope classifies dApp-facing errors by class, never by text. */
	public cancel(handleId: string, reason: string | Error): void {
		this._settle(handleId, undefined, reason)
	}

	/** Bring a live handle's window to the front. `false` when the handle or
	 *  its window is gone (including a window closed between lookup and update). */
	public async focus(handleId: string): Promise<boolean> {
		const windowId = this.handles.get(handleId)?.windowId
		if (windowId === undefined) return false
		try {
			await this.windows.update(windowId, { focused: true, drawAttention: true, state: "normal" })
			return true
		} catch {
			return false
		}
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
		this.stopWatching(handle)
	}

	private createWindow(opts: OpenAndAwaitOpts, anchor: WindowBounds | undefined, stillWanted: () => boolean): Promise<CreatedWindow> {
		const options = { type: "popup" as const, url: opts.url, width: opts.width, height: opts.height }
		if (opts.placement === "center") return this.windows.create({ ...options, ...centerOn(anchor, opts.width, opts.height) })
		const placed = { ...options, ...topRightOf(anchor, opts.width, opts.height) }
		return createPlaced(this.windows, placed, stillWanted, this.logger, "window-manager")
	}

	private stopWatching(handle: Handle<unknown>): void {
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

	private _settle(handleId: string, value: unknown, error: string | Error | undefined): void {
		const handle = this.handles.get(handleId)
		if (!handle) return
		if (handle.settled) {
			this.logger.log("window-manager", LogLevel.Debug, `[${handleId}] settle/cancel after already settled — ignored`)
			return
		}

		handle.settled = true
		this.handles.delete(handleId)

		this.stopWatching(handle)

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
