/**
 * `chrome.windows` abstracted. Used by `DappInteractionService` and
 * `PasskeyService` (via `WindowManager`) to open approval / passkey popups.
 */

import type { Unsubscribe } from "./types"

export interface CreatedWindow {
	id?: number
}

export interface CreateWindowOptions {
	type?: "normal" | "popup" | "panel"
	url: string
	height?: number
	width?: number
	focused?: boolean
	/** Desktop coordinates, SIGNED: a display left of or above the primary is negative. */
	left?: number
	top?: number
}

/** Position and size of an existing window, in signed desktop coordinates. */
export interface WindowBounds {
	left?: number
	top?: number
	width?: number
	height?: number
}

export interface UpdateWindowOptions {
	focused?: boolean
	/** Draw the user's attention without changing focus (ignored when already focused). */
	drawAttention?: boolean
	/** `normal` restores a minimized window; also exits maximized / fullscreen. */
	state?: "normal"
}

export interface WindowPort {
	/** Open a new browser window. `id` may be absent if creation failed. */
	create(options: CreateWindowOptions): Promise<CreatedWindow>

	/** Fires with `windowId` whenever any window closes. */
	onRemoved(listener: (windowId: number) => void): Unsubscribe

	/** Close a window by id. No-op / rejects if it is already closed. */
	remove(windowId: number): Promise<void>

	/** Focus / restore a window by id. Rejects if it is already closed. */
	update(windowId: number, options: UpdateWindowOptions): Promise<void>

	/** Bounds of the last-focused NORMAL window (never a popup), or `undefined`
	 *  when there is none or the lookup fails. Never throws. */
	getLastFocused(): Promise<WindowBounds | undefined>
}
