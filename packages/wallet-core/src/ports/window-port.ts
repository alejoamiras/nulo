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
}

export interface WindowPort {
	/** Open a new browser window. `id` may be absent if creation failed. */
	create(options: CreateWindowOptions): Promise<CreatedWindow>

	/** Fires with `windowId` whenever any window closes. */
	onRemoved(listener: (windowId: number) => void): Unsubscribe

	/** Close a window by id. No-op / rejects if it is already closed. */
	remove(windowId: number): Promise<void>
}
