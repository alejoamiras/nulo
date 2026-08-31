/**
 * `subscribeActiveProfile`'s delivery discipline: no delivery after
 * unsubscribe, and no stale snapshot overwriting a fresher live event or a
 * newer reconnect snapshot. (The documented snapshot-before-subscribe
 * lost-event window is a separate, in-code-commented residual.)
 */

import { describe, expect, test } from "vitest"
import type { ProfileInfo } from "./spec"
import { ProfileServiceClient } from "./client"

function _deferred<T>() {
	let resolve!: (v: T) => void
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

const profile = (id: string) => ({ id, name: id, type: "password" }) as unknown as ProfileInfo

/** A client whose getActiveProfile is a controllable queue — no transport. */
function makeClient(): { client: ProfileServiceClient; queue: Array<Promise<ProfileInfo | undefined>> } {
	const client = new ProfileServiceClient()
	const queue: Array<Promise<ProfileInfo | undefined>> = []
	client.getActiveProfile = () => queue.shift() ?? Promise.resolve(undefined)
	return { client, queue }
}

describe("ProfileServiceClient.subscribeActiveProfile — delivery discipline", () => {
	test("an in-flight reconnect snapshot delivers NOTHING after unsubscribe", async () => {
		const { client, queue } = makeClient()
		const seen: Array<string | undefined> = []
		queue.push(Promise.resolve(profile("A")))
		const unsubscribe = await client.subscribeActiveProfile((p) => seen.push(p?.id))
		expect(seen).toEqual(["A"])

		const parked = _deferred<ProfileInfo | undefined>()
		queue.push(parked.promise)
		client.onConnected.invoke() // reconnect snapshot parks on the RPC
		unsubscribe()
		parked.resolve(profile("B"))
		await Promise.resolve()

		expect(seen).toEqual(["A"])
	})

	test("a live event outranks an older parked snapshot (no terminal→stale inversion)", async () => {
		const { client, queue } = makeClient()
		const seen: Array<string | undefined> = []
		queue.push(Promise.resolve(profile("A")))
		await client.subscribeActiveProfile((p) => seen.push(p?.id))

		const parked = _deferred<ProfileInfo | undefined>()
		queue.push(parked.promise)
		client.onConnected.invoke() // snapshot parks holding pre-switch state
		client.onActiveProfileChanged.invoke(profile("B")) // live switch delivers
		parked.resolve(profile("A")) // the stale snapshot finally resolves
		await Promise.resolve()

		expect(seen).toEqual(["A", "B"])
	})

	test("two overlapping reconnect snapshots resolving out of order keep the newest", async () => {
		const { client, queue } = makeClient()
		const seen: Array<string | undefined> = []
		queue.push(Promise.resolve(profile("A")))
		await client.subscribeActiveProfile((p) => seen.push(p?.id))

		const first = _deferred<ProfileInfo | undefined>()
		const second = _deferred<ProfileInfo | undefined>()
		queue.push(first.promise, second.promise)
		client.onConnected.invoke()
		client.onConnected.invoke()
		second.resolve(profile("B")) // newest snapshot lands first
		await Promise.resolve()
		first.resolve(profile("A")) // the older one must stand down
		await Promise.resolve()

		expect(seen).toEqual(["A", "B"])
	})
})
