/**
 * Generic "snapshot-then-events" subscription helper.
 *
 * The naive pattern has a microtask race:
 *
 *   const v0 = await client.getActive()    // fetch FIRST
 *   client.onChanged.add(handler)          // add handler AFTER
 *
 * Between the two lines, the port can receive an `onChanged` event with a
 * newer value. The messaging layer dispatches to whatever's registered at
 * that moment — none of `handler`'s callsites — so the event is lost. The
 * client ends up with stale state and no idea anything changed.
 *
 * The fix swaps the order: register the handler FIRST, fetch snapshot
 * SECOND, fire handler with snapshot. With port FIFO ordering, the
 * snapshot value is always at least as recent as any event delivered
 * during the fetch — and handler will have already seen those events.
 *
 * Handlers must be idempotent / last-write-wins. Snapshot fires last.
 *
 * Reconnect (`onConnected`) re-fires the snapshot so the client recovers
 * from any events missed during a port disconnect window (e.g. SW restart).
 *
 * Codified post-audit (Phase 2 plan v2 audit, opus 4.7) — `ProfileServiceClient`
 * had documented the race as "acceptable for the pilot"; the journal
 * service evolution needs the race closed because missing a stage transition
 * would leave the popup stuck on the wrong screen.
 */

/** Minimal interface a source must expose to be subscribable with snapshot. */
export interface SubscribableSource<TPayload> {
	/** Fires every time the underlying value changes. */
	onChange: {
		add: (handler: (value: TPayload) => void) => void
		remove: (handler: (value: TPayload) => void) => void
	}
	/** Fires when the transport reconnects (SW restart, port reopen). */
	onConnected: {
		add: (handler: () => void) => void
		remove: (handler: () => void) => void
	}
	/** Reads the current value. May throw — handler stays registered. */
	fetchSnapshot: () => Promise<TPayload>
}

/**
 * Subscribes `handler` to `source.onChange`, immediately reads the current
 * snapshot, and fires `handler` once with it. Re-fires on reconnect.
 *
 * Returns an unsubscribe function that detaches BOTH the change listener
 * AND the reconnect listener. Consumers should always invoke it in their
 * teardown path (`onBeforeUnmount`, service disconnect, etc.).
 */
export async function subscribeWithSnapshot<TPayload>(
	source: SubscribableSource<TPayload>,
	handler: (value: TPayload) => void,
): Promise<() => void> {
	// Tracks whether the subscription has been torn down. Checked inside
	// `emitSnapshot` so a late-arriving snapshot (fetch still in flight when
	// the caller unsubscribed) does NOT fire the handler. Without this guard
	// a Vue consumer that unsubscribes in `onBeforeUnmount` can still receive
	// one final stale snapshot tick.
	let unsubscribed = false

	source.onChange.add(handler)

	const emitSnapshot = async (): Promise<void> => {
		try {
			const value = await source.fetchSnapshot()
			if (unsubscribed) return
			handler(value)
		} catch {
			// Fetch failed (port disconnected, service errored). The reconnect
			// hook will retry once the port is live again. If the failure is
			// permanent, the caller's `onChange` events will catch up when the
			// underlying state next changes.
		}
	}

	source.onConnected.add(emitSnapshot)
	await emitSnapshot()

	return () => {
		unsubscribed = true
		source.onChange.remove(handler)
		source.onConnected.remove(emitSnapshot)
	}
}
