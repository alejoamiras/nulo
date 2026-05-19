/**
 * `chrome.alarms` abstracted. Unlike `setTimeout`, alarms survive MV3 SW
 * suspension — the browser wakes the worker to fire them. Used for the
 * proactive session-TTL lock and offscreen-keepalive bookkeeping.
 *
 * Chrome enforces a 30s minimum period floor. Adapters don't rewrite inputs;
 * callers must pass a valid value for their target browser.
 */

import type { Unsubscribe } from "./types"

export interface AlarmCreateOptions {
	/** Fire once at this epoch-ms timestamp. Mutually exclusive with `delayInMinutes`. */
	when?: number
	/** Fire once after this many minutes. Mutually exclusive with `when`. */
	delayInMinutes?: number
	/** If set, keep firing every `periodInMinutes` after the first firing. */
	periodInMinutes?: number
}

export interface AlarmEvent {
	name: string
	/** Epoch-ms when the alarm was scheduled to fire. */
	scheduledTime: number
}

export interface AlarmsPort {
	/** Create or replace an alarm with `name`. */
	create(name: string, options: AlarmCreateOptions): Promise<void>

	/** Clear an alarm by name. Resolves `true` if an alarm was cleared. */
	clear(name: string): Promise<boolean>

	/** Fires whenever any scheduled alarm goes off. */
	onAlarm(listener: (alarm: AlarmEvent) => void): Unsubscribe
}
